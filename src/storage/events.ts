import fs from "node:fs/promises";
import path from "node:path";
import { Checkpoint, Project, Run, now } from "../contracts/types.js";

// One JSON object per line in <project>/.herdr/events.jsonl. The broker is the
// only writer; entries are appended and never rewritten or rotated.
export interface BrokerEvent {
  at: string;
  run_id: string;
  kind:
    | "run"
    | "status"
    | "task"
    | "report"
    | "input"
    | "answered"
    | "preview"
    | "stall"
    | "stall_cleared";
  [field: string]: unknown;
}

export const eventsFile = (directory: string) =>
  path.join(directory, ".herdr", "events.jsonl");

const currentRun = (p: Project) =>
  p.runs.find((r) => r.run_id === p.current_run_id)!;

// Consecutive commits of the single writer are the complete change log, so the
// timeline is derived from their difference instead of from each call site.
// Question responses, schemas, tokens and operation payloads never appear here.
export function diffEvents(
  prev: Checkpoint,
  next: Checkpoint,
  at = now(),
): Map<string, BrokerEvent[]> {
  const out = new Map<string, BrokerEvent[]>();
  for (const p of Object.values(next.projects)) {
    const r = currentRun(p);
    const before: Run | undefined = prev.projects[p.project_id]?.runs.find(
      (x) => x.run_id === r.run_id,
    );
    const list: BrokerEvent[] = [];
    const add = (kind: BrokerEvent["kind"], fields: Record<string, unknown>) =>
      list.push({ at, run_id: r.run_id, kind, ...fields });
    if (!before) add("run", { status: r.status, feedback: !!r.feedback });
    else if (before.status !== r.status)
      add("status", {
        from: before.status,
        to: r.status,
        reason: r.reason ?? null,
      });
    for (const t of r.tasks) {
      const b = before?.tasks.find((x) => x.task_id === t.task_id);
      const reported = !!t.result && t.updated_at !== b?.updated_at;
      if (!b || b.status !== t.status)
        add("task", {
          task_id: t.task_id,
          title: t.title,
          from: b?.status ?? null,
          to: t.status,
          attempt: t.attempt,
          result: reported ? t.result : null,
        });
      else if (reported)
        add("report", {
          task_id: t.task_id,
          title: t.title,
          status: t.status,
          result: t.result,
        });
    }
    for (const q of r.questions) {
      const b = before?.questions.find((x) => x.request_id === q.request_id);
      if (!b)
        add("input", {
          request_id: q.request_id,
          task_id: q.task_id,
          question_kind: q.kind,
          question: q.question,
        });
      else if (b.status !== "answered" && q.status === "answered")
        add("answered", { request_id: q.request_id, question_kind: q.kind });
    }
    if (
      before?.preview.status !== r.preview.status &&
      ["ready", "failed"].includes(r.preview.status)
    )
      add("preview", {
        status: r.preview.status,
        url: r.preview.status === "ready" ? (r.preview.url ?? null) : null,
        error: r.preview.error ?? null,
      });
    if (list.length) out.set(p.directory, list);
  }
  return out;
}

export async function appendEvents(directory: string, events: BrokerEvent[]) {
  if (!events.length) return;
  await fs.mkdir(path.dirname(eventsFile(directory)), { recursive: true });
  await fs.appendFile(
    eventsFile(directory),
    events.map((e) => JSON.stringify(e) + "\n").join(""),
    { mode: 0o600 },
  );
}

// Newest first, optionally one run only. `before` is an exclusive line index
// returned as `next_before` by the previous page.
export async function readEvents(
  directory: string,
  options: { before?: number; limit?: number; run_id?: string } = {},
) {
  let text = "";
  try {
    text = await fs.readFile(eventsFile(directory), "utf8");
  } catch (e: any) {
    if (e.code !== "ENOENT") throw e;
  }
  const lines = text.split("\n").filter(Boolean);
  const limit = options.limit ?? 200;
  const events: (BrokerEvent & { seq: number })[] = [];
  let i = Math.min(options.before ?? lines.length, lines.length) - 1;
  for (; i >= 0 && events.length < limit; i--) {
    let event: BrokerEvent;
    try {
      event = JSON.parse(lines[i]);
    } catch {
      continue; // A torn final line from a crash is skipped, not fatal.
    }
    if (!options.run_id || event.run_id === options.run_id)
      events.push({ ...event, seq: i });
  }
  return { events, next_before: i >= 0 ? i + 1 : null };
}
