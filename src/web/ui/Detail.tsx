import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRight, CircleQuestionMark, ExternalLink } from "lucide-react";
import {
  clock,
  minutes,
  statusNames,
  taskNames,
  useEvents,
  useNow,
  useShots,
  when,
} from "./data";
import { StageBar, times } from "./StageBar";
import { TerminalThumb, type ThumbProject } from "./TerminalThumb";
import { describe, Timeline } from "./Timeline";
import { AssetGrid, AssetList, assetSummary } from "./Shots";

interface Task {
  task_id: string;
  title: string;
  role: string;
  status: string;
  attempt: number;
  result: string | null;
  updated_at: string | null;
}
interface Project extends ThumbProject {
  run_id: string;
  revision: number;
  orchestration: { mode: string } | null;
  stall: { task_id: string; minutes: number } | null;
  tasks: Task[];
  preview: { status: string; url: string | null };
}

const native = ["direction", "first-screen", "build-out"];
const activeTask = new Set(["running", "retrying", "waiting_input"]);
const activeRun = new Set([
  "starting",
  "running",
  "retrying",
  "waiting_input",
  "cancelling",
]);
const taskWords: Record<string, string> = {
  running: "진행 중",
  retrying: "재시도 중",
  waiting_input: "입력 대기",
};
const roles: Record<string, string> = {
  pm: "PM",
  developer: "개발자",
  designer: "디자이너",
};
const stageName = (t: Task) =>
  native.includes(t.task_id) ? t.task_id : t.title;

// The one line that says where the run is: the current stage, or what the
// run waits for when no task is in progress.
function headline(p: Project): { stage: string; task?: string; at?: Task } {
  const t = p.tasks.find((x) => activeTask.has(x.status));
  const extra = (x: Task) => (x.title !== stageName(x) ? x.title : undefined);
  if (t)
    return activeRun.has(p.status)
      ? {
          stage: `${stageName(t)} ${taskWords[t.status]}`,
          task: extra(t),
          at: t,
        }
      : {
          stage: `${stageName(t)} · ${statusNames[p.status] ?? p.status}`,
          task: extra(t),
        };
  if (p.status === "review_pending")
    return {
      stage: "납품 준비 완료",
      task: "미리보기와 결과 스크린샷을 확인하세요.",
    };
  const failed = p.tasks.find((x) => x.status === "failed");
  if (failed)
    return { stage: `${stageName(failed)} 실패`, task: extra(failed) };
  const next = p.tasks.find((x) => x.status === "pending");
  if (next)
    return {
      stage: `${stageName(next)} · ${statusNames[p.status] ?? p.status}`,
      task: extra(next),
    };
  return {
    stage: statusNames[p.status] ?? p.status,
    task: p.tasks.length
      ? undefined
      : "PM이 계획을 등록하면 단계가 표시됩니다.",
  };
}

const toAnswers = () =>
  document
    .getElementById("answers")
    ?.scrollIntoView({ behavior: "smooth", block: "start" });

// Top of the project detail: stage, timing, links and the stage bar, with the
// PM terminal thumbnail on the right (click opens the 1 s mirror).
export function RunSummary({ project: p }: { project: Project }) {
  const { data } = useEvents(p.project_id, p.revision);
  const now = useNow(15000);
  const h = headline(p);
  const start = h.at
    ? times(data?.events ?? [], h.at.task_id).start
    : undefined;
  const last = p.tasks
    .map((t) => t.updated_at)
    .filter((x): x is string => !!x)
    .sort()
    .at(-1);
  const done = p.tasks.filter((t) => t.status === "completed").length;
  const questions = p.input_requests.filter(
    (q) => q.status !== "answered",
  ).length;
  const port = p.preview.url ? new URL(p.preview.url).port : "";
  return (
    <section className="summary" aria-label="진행 요약">
      <div className="summary-main">
        <div className="summary-head">
          <h2 className="summary-stage">{h.stage}</h2>
          {h.task && <span className="summary-task">{h.task}</span>}
        </div>
        <div className="summary-meta">
          {start !== undefined && (
            <span className="num">이 단계 {minutes(now - start)}째</span>
          )}
          <span className="num">최근 보고 {last ? when(last) : "—"}</span>
          <span className="num">
            작업 {done}/{p.tasks.length}
          </span>
          {questions > 0 && (
            <button type="button" className="summary-attn" onClick={toAnswers}>
              <CircleQuestionMark className="icon icon-xs" />
              열린 질문 {questions}건
            </button>
          )}
          {p.preview.url && (
            <a href={p.preview.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="icon icon-xs" />
              미리보기{port ? ` :${port}` : ""}
            </a>
          )}
        </div>
        <StageBar project={p} />
      </div>
      <div className="summary-thumb">
        <TerminalThumb project={p} size="detail" openable />
      </div>
    </section>
  );
}

type FoldKey = "stages" | "activity" | "assets";
const foldKey = (id: string) => `homepage-fold:${id}`;
function readFolds(id: string): Partial<Record<FoldKey, boolean>> {
  try {
    const v = JSON.parse(sessionStorage.getItem(foldKey(id)) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}
// Open sections per project, for this tab only; everything starts collapsed.
function useFolds(id: string) {
  const [open, setOpen] = useState(() => readFolds(id));
  useEffect(() => setOpen(readFolds(id)), [id]);
  const set = (key: FoldKey, value: boolean) =>
    setOpen((o) => {
      const next = { ...o, [key]: value };
      try {
        sessionStorage.setItem(foldKey(id), JSON.stringify(next));
      } catch {}
      return next;
    });
  return [open, set] as const;
}

function Fold(props: {
  id: string;
  title: string;
  summary: ReactNode;
  open: boolean;
  onToggle: () => void;
  className?: string;
  children?: ReactNode;
  foldRef?: React.Ref<HTMLElement>;
}) {
  return (
    <section
      className={`fold ${props.className ?? ""}`}
      data-open={props.open}
      ref={props.foldRef}
    >
      <button
        type="button"
        className="fold-head"
        aria-expanded={props.open}
        aria-controls={props.id}
        onClick={props.onToggle}
      >
        <ChevronRight className="icon icon-sm fold-chevron" />
        <span className="fold-title">{props.title}</span>
        <span className="fold-sum">{props.summary}</span>
      </button>
      <div className="fold-body" id={props.id} hidden={!props.children}>
        {props.children}
      </div>
    </section>
  );
}

function TaskList({ project: p }: { project: Project }) {
  if (!p.tasks.length)
    return (
      <p className="help fold-pad">PM이 계획을 등록하면 작업이 표시됩니다.</p>
    );
  return (
    <div className="group task-list">
      {p.tasks.map((t) => (
        <div className="group-row" key={t.task_id}>
          <div className="task-main">
            <span className="ui">{t.title}</span>
            <span className="meta muted">
              <span className="mono">{t.task_id}</span> ·{" "}
              {roles[t.role] ?? t.role} · 실행 {t.attempt}회
              {t.updated_at ? ` · 최근 보고 ${clock(t.updated_at)}` : ""}
            </span>
            {t.result && <span className="task-result">{t.result}</span>}
          </div>
          <span
            className="badge"
            data-tone={
              {
                completed: "ok",
                failed: "danger",
                waiting_input: "warn",
                retrying: "warn",
              }[t.status]
            }
          >
            {t.status === "running" && (
              <span className="dot" data-state="running" />
            )}
            {taskNames[t.status] ?? t.status}
          </span>
        </div>
      ))}
    </div>
  );
}

// Collapsed by default, one summary line per header. Collapsed activity still
// lists the newest four events, and the asset column sits beside it; opening
// the asset section turns that column into the full list below.
export function DetailSections({ project: p }: { project: Project }) {
  const [open, set] = useFolds(p.project_id);
  const events = useEvents(p.project_id, p.revision).data?.events;
  const shots = useShots(p.project_id, p.revision).data;
  const assets = useRef<HTMLElement>(null);
  const h = headline(p);
  const done = p.tasks.filter((t) => t.status === "completed").length;
  const last = events?.[0];
  const props = {
    projectId: p.project_id,
    runId: p.run_id,
    revision: p.revision,
  };
  const showAll = () => {
    set("assets", true);
    requestAnimationFrame(() =>
      assets.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  };
  return (
    <div className="detail-sections">
      <Fold
        id={`fold-stages-${p.project_id}`}
        title="진행 단계"
        summary={`작업 ${done}/${p.tasks.length} · ${h.stage}`}
        open={!!open.stages}
        onToggle={() => set("stages", !open.stages)}
      >
        {open.stages && <TaskList project={p} />}
      </Fold>
      <div className="detail-split">
        <Fold
          id={`fold-activity-${p.project_id}`}
          title="활동"
          summary={
            last ? (
              <>
                <span className="num">{when(last.at)}</span> ·{" "}
                {describe(last).title}
              </>
            ) : events ? (
              "기록 없음"
            ) : (
              "불러오는 중"
            )
          }
          open={!!open.activity}
          onToggle={() => set("activity", !open.activity)}
          className="detail-activity"
        >
          <Timeline {...props} limit={open.activity ? undefined : 4} />
        </Fold>
        <Fold
          id={`fold-assets-${p.project_id}`}
          title="에셋"
          summary={assetSummary(shots ?? null)}
          open={!!open.assets}
          onToggle={() => set("assets", !open.assets)}
          className="detail-assets"
          foldRef={assets}
        >
          {open.assets ? (
            <AssetList {...props} />
          ) : (
            <AssetGrid {...props} onMore={showAll} />
          )}
        </Fold>
      </div>
    </div>
  );
}
