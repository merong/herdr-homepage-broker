import { minutes, useEvents, useNow, type BrokerEvent } from "./data";

interface Task {
  task_id: string;
  title: string;
  status: string;
  updated_at: string | null;
}
interface Project {
  project_id: string;
  revision: number;
  status: string;
  orchestration: { mode: string } | null;
  tasks: Task[];
  stall: { task_id: string; minutes: number } | null;
}

const native = ["direction", "first-screen", "build-out"];
const activeTask = new Set(["running", "retrying", "waiting_input"]);

// When each task started and finished, from the run's event log.
function times(events: BrokerEvent[], taskId: string) {
  let start: number | undefined, end: number | undefined;
  for (const e of [...events].reverse()) {
    if (e.kind !== "task" || e.task_id !== taskId) continue;
    const at = Date.parse(e.at);
    if (e.to === "running" && start === undefined) start = at;
    if (e.to === "completed") end = at;
  }
  return { start, end };
}

// direction → first-screen → build-out for native runs; legacy runs show
// their own planned tasks in order.
export function StageBar({ project: p }: { project: Project }) {
  const { data } = useEvents(p.project_id, p.revision);
  const now = useNow(15000);
  const events = data?.events ?? [];
  const planned = native.every((id) => p.tasks.some((t) => t.task_id === id))
    ? native.map((id) => p.tasks.find((t) => t.task_id === id)!)
    : p.tasks.slice(0, 6);
  const stages: Task[] = planned.length
    ? planned
    : p.orchestration?.mode === "claude-native"
      ? native.map((task_id) => ({
          task_id,
          title: task_id,
          status: "pending",
          updated_at: null,
        }))
      : [];
  if (!stages.length)
    return <p className="help">PM이 계획을 등록하면 진행 단계가 표시됩니다.</p>;
  return (
    <div
      className="stages"
      style={{
        gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))`,
      }}
    >
      {stages.map((t) => {
        const { start, end } = times(events, t.task_id);
        const stalled = p.stall?.task_id === t.task_id;
        const state =
          t.status === "completed"
            ? "done"
            : activeTask.has(t.status)
              ? stalled
                ? "stalled"
                : "running"
              : t.status === "failed"
                ? "failed"
                : "pending";
        const label =
          state === "done"
            ? start && end
              ? `완료 ${minutes(end - start)}`
              : "완료"
            : state === "stalled"
              ? `응답 없음 ${p.stall!.minutes}분`
              : state === "running"
                ? t.status === "waiting_input"
                  ? "입력 대기"
                  : start
                    ? `진행 ${minutes(now - start)}`
                    : "진행 중"
                : state === "failed"
                  ? "실패"
                  : "대기";
        const name = native.includes(t.task_id) ? t.task_id : t.title;
        return (
          <div className="stage" data-state={state} key={t.task_id}>
            <div className="stage-label">
              <b title={t.title}>{name}</b>
              <span className="num">{label}</span>
            </div>
            {state === "running" || state === "stalled" ? (
              <progress className="stage-bar" aria-label={`${name} ${label}`} />
            ) : (
              <progress
                className="stage-bar"
                max={1}
                value={state === "done" || state === "failed" ? 1 : 0}
                aria-label={`${name} ${label}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
