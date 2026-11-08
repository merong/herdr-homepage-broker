import { useEffect, useState } from "react";
import {
  clock,
  getJson,
  hm,
  projectApi,
  statusNames,
  taskNames,
  useEvents,
  type BrokerEvent,
} from "./data";

const runtime: Record<string, string> = {
  idle: "idle",
  done: "done",
  unknown: "알 수 없음",
};

export function describe(e: BrokerEvent): {
  tone?: string;
  title: string;
  detail?: string;
} {
  switch (e.kind) {
    case "run":
      return {
        tone: "running",
        title: e.feedback
          ? "피드백을 반영한 새 run을 접수했습니다"
          : "새 run을 접수했습니다",
      };
    case "status":
      return {
        tone:
          e.to === "review_pending"
            ? "ok"
            : e.to === "failed"
              ? "danger"
              : ["waiting_input", "paused"].includes(e.to)
                ? "warn"
                : undefined,
        title: `상태 ${statusNames[e.from] ?? e.from} → ${statusNames[e.to] ?? e.to}`,
        detail: e.reason ?? undefined,
      };
    case "task":
      return {
        tone:
          e.to === "completed"
            ? "ok"
            : e.to === "failed"
              ? "danger"
              : e.to === "running"
                ? "running"
                : undefined,
        title: `${e.title}: ${e.from ? (taskNames[e.from] ?? e.from) : "계획"} → ${taskNames[e.to] ?? e.to}${e.attempt > 1 ? ` (${e.attempt}회차)` : ""}`,
        detail: e.result ?? undefined,
      };
    case "report":
      return { title: `${e.title} 보고`, detail: e.result ?? undefined };
    case "input":
      return {
        tone: "warn",
        title: "PM이 질문을 보냈습니다",
        detail: e.question,
      };
    case "answered":
      return { tone: "ok", title: "질문에 답변했습니다" };
    case "preview":
      return e.status === "ready"
        ? {
            tone: "ok",
            title: "미리보기가 준비되었습니다",
            detail: e.url ?? undefined,
          }
        : {
            tone: "danger",
            title: "미리보기를 시작하지 못했습니다",
            detail: e.error ?? undefined,
          };
    case "stall":
      return {
        tone: "warn",
        title: `응답 없음: ${e.task_id} 태스크 · Herdr ${runtime[e.status] ?? e.status} ${e.minutes}분`,
        detail: "같은 시각에 Herdr 알림을 요청했습니다.",
      };
    case "stall_cleared":
      return { title: `응답 없음 해제: ${e.task_id}` };
    default:
      return { title: e.kind };
  }
}

// Newest first. The first page follows the project revision; older pages are
// appended with "더 보기" and stay until the run changes. `limit` shows only
// the newest few titles (the collapsed activity section).
export function Timeline(props: {
  projectId: string;
  runId: string;
  revision: number;
  limit?: number;
}) {
  const { data, error } = useEvents(props.projectId, props.revision);
  const [older, setOlder] = useState<BrokerEvent[]>([]);
  const [next, setNext] = useState<number | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setOlder([]);
    setNext(undefined);
  }, [props.runId]);
  const cursor = next === undefined ? data?.next_before : next;
  const first = data?.events ?? [];
  const seen = new Set(first.map((e) => e.seq));
  const events = [...first, ...older.filter((e) => !seen.has(e.seq))];
  const more = async () => {
    if (cursor == null) return;
    setLoading(true);
    try {
      const page = await getJson(
        projectApi(props.projectId, `events?limit=200&before=${cursor}`),
        0,
      );
      setOlder((o) => [...o, ...page.events]);
      setNext(page.next_before);
    } finally {
      setLoading(false);
    }
  };
  if (!data)
    return (
      <p className="help">
        {error
          ? `활동 기록을 불러오지 못했습니다 (${error}).`
          : "활동 기록을 불러오고 있습니다."}
      </p>
    );
  if (!events.length)
    return (
      <p className="help">
        아직 기록이 없습니다. 상태가 바뀌면 여기에 쌓입니다.
      </p>
    );
  const today = new Date().toDateString();
  const shown = props.limit ? events.slice(0, props.limit) : events;
  return (
    <div className="stack">
      <div className="group timeline" data-compact={!!props.limit || undefined}>
        {shown.map((e) => {
          const d = describe(e);
          const date = new Date(e.at);
          return (
            <div className="tl-item" key={e.seq}>
              <span className="tl-time" title={date.toLocaleString("ko-KR")}>
                {date.toDateString() === today
                  ? props.limit
                    ? hm(e.at)
                    : clock(e.at)
                  : date.toLocaleDateString("ko-KR", {
                      month: "numeric",
                      day: "numeric",
                    })}
              </span>
              <span className="dot" data-state={d.tone} />
              <span className="tl-text">
                <span>{d.title}</span>
                {d.detail && !props.limit && (
                  <span className="tl-detail">{d.detail}</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
      {cursor != null && !props.limit && (
        <div>
          <button className="btn btn-sm" onClick={more} disabled={loading}>
            {loading ? "불러오는 중…" : "더 보기"}
          </button>
        </div>
      )}
    </div>
  );
}
