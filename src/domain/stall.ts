import type { Run } from "../contracts/types.js";

export const DEFAULT_STALL_MINUTES = 5;
// `blocked` is not a stall: observe() already opens a terminal_action request.
const quiet = new Set(["idle", "done", "unknown"]);

export interface Stall {
  agent_id: string;
  task_id: string;
  status: string;
  since: string;
  minutes: number;
}

// A run is stalled when its agent holds a running task but Herdr has reported a
// non-working state for longer than the threshold. Business status stays as is;
// this only drives the warning banner, the timeline entry and one notification.
export function stallOf(
  r: Run,
  thresholdMinutes: number,
  at = Date.now(),
): Stall | null {
  if (r.status !== "running") return null;
  for (const a of r.agents) {
    const task = r.tasks.find(
      (t) => t.status === "running" && t.task_id === a.task_id,
    );
    if (!task || a.runtime?.fresh !== true || !quiet.has(a.runtime.status))
      continue;
    const since = Date.parse(a.runtime.changed_at ?? "");
    if (!Number.isFinite(since) || at - since < thresholdMinutes * 60000)
      continue;
    return {
      agent_id: a.agent_id,
      task_id: task.task_id,
      status: a.runtime.status,
      since: a.runtime.changed_at,
      minutes: Math.floor((at - since) / 60000),
    };
  }
  return null;
}
