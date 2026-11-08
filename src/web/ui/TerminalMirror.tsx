import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { parseAnsi } from "./ansi";
import { ago, projectApi, useJson, useNow } from "./data";

interface Agent {
  agent_id: string;
  role: string;
  pane_id: string | null;
  runtime: { status: string; fresh: boolean };
}
interface Terminal {
  agent_id: string | null;
  pane_id: string | null;
  available: boolean;
  reason?: string;
  text?: string;
  read_at?: string;
}

const roleNames: Record<string, string> = {
  pm: "PM",
  developer: "개발자",
  designer: "디자이너",
};
const reasons: Record<string, string> = {
  no_pane: "아직 Herdr pane이 없습니다. 제작이 시작되면 PM 화면이 보입니다.",
  pane_not_found: "Herdr에서 이 pane을 찾지 못했습니다.",
  read_failed: "Herdr에서 화면을 읽지 못했습니다. 잠시 후 다시 읽습니다.",
};
function runtimeDot(a?: Agent) {
  if (!a?.runtime.fresh) return undefined;
  if (["working", "busy"].includes(a.runtime.status)) return "running";
  if (a.runtime.status === "blocked") return "warn";
  return "idle";
}
function runtimeText(a?: Agent) {
  if (!a) return "—";
  if (!a.runtime.fresh) return "갱신 대기";
  const s = a.runtime.status;
  return s === "busy" ? "working" : s === "unknown" ? "알 수 없음" : s;
}

// Read-only mirror of a Herdr pane, opened from a terminal thumbnail. Polls
// only while mounted and the page is visible; the server coalesces reads per
// pane, so the mirror and the thumbnails cost one CLI call.
export function TerminalMirror(props: {
  projectId: string;
  interval: number;
  agents: Agent[];
}) {
  const panes = props.agents.filter((a) => a.pane_id);
  const [chosen, setChosen] = useState<string | null>(null);
  const agent =
    panes.find((a) => a.agent_id === chosen) ??
    panes.find((a) => a.role === "pm") ??
    panes[0];
  const url = projectApi(
    props.projectId,
    `terminal${chosen ? `?agent=${encodeURIComponent(chosen)}` : ""}`,
  );
  const { data, error } = useJson<Terminal>(url, {
    interval: props.interval,
    maxAge: 800,
  });
  const now = useNow(1000);
  const lines = useMemo(() => parseAnsi(data?.text ?? ""), [data?.text]);
  const body = useRef<HTMLPreElement>(null);
  const pinned = useRef(true);
  // Follow new output only while the viewer is already at the bottom.
  useLayoutEffect(() => {
    const el = body.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [data?.text]);
  const onScroll = () => {
    const el = body.current;
    if (el)
      pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };
  const label = agent
    ? `${roleNames[agent.role] ?? agent.role} · ${agent.pane_id}`
    : "pane 없음";
  return (
    <div className="term">
      <div className="term-head">
        <span className="pane">{label}</span>
        <span className="dot" data-state={runtimeDot(agent)} />
        <span>{runtimeText(agent)}</span>
        {panes.length > 1 && (
          <span className="term-tabs" role="tablist" aria-label="pane 선택">
            {panes.map((a) => (
              <button
                key={a.agent_id}
                role="tab"
                aria-selected={a.agent_id === agent?.agent_id}
                onClick={() => setChosen(a.agent_id)}
              >
                {roleNames[a.role] ?? a.role}
              </button>
            ))}
          </span>
        )}
        <span className="grow" />
        <span className="num">
          {data?.available ? ago(data.read_at, now) : error ? "연결 끊김" : ""}
        </span>
      </div>
      {data?.available ? (
        <pre
          className="term-body ansi"
          ref={body}
          onScroll={onScroll}
          tabIndex={0}
          aria-label={`${label} 터미널 화면`}
        >
          {lines.map((line, i) => (
            <span key={i}>
              {line.map((s, j) => (
                <span
                  key={j}
                  className={s.classes.length ? s.classes.join(" ") : undefined}
                  style={
                    s.fg || s.bg
                      ? { color: s.fg, backgroundColor: s.bg }
                      : undefined
                  }
                >
                  {s.text}
                </span>
              ))}
              {"\n"}
            </span>
          ))}
        </pre>
      ) : (
        <div className="term-empty">
          {data
            ? (reasons[data.reason ?? ""] ??
              `Herdr에서 화면을 읽지 못했습니다 (${data.reason}).`)
            : error
              ? `터미널을 불러오지 못했습니다 (${error}).`
              : "터미널을 불러오고 있습니다."}
        </div>
      )}
      <div className="term-foot">읽기 전용 · 입력은 Herdr에서 합니다</div>
    </div>
  );
}
