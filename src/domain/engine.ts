import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  Agent,
  Checkpoint,
  Command,
  Config,
  Project,
  Run,
  Task,
  fail,
  roles,
  terminal,
  now,
} from "../contracts/types.js";
import { ajv, required } from "../contracts/validate.js";
import {
  canonical,
  hash,
  realDirectory,
  snapshotInputs,
  atomic,
  readInputs,
} from "../storage/store.js";
export const current = (p: Project) =>
  p.runs.find((r) => r.run_id === p.current_run_id)!;
// Existing runs keep their team and lineage. New runs have a single Herdr PM.
export const requiredAgents = (r: Run) =>
  r.orchestration?.mode === "claude-native" ||
  (r.orchestration?.mode === "pm-led" && !r.orchestration.team_requested)
    ? r.agents.filter((a) => a.role === "pm")
    : r.agents;
// Task roles describe work ownership, not extra Herdr sessions in native mode.
export const taskAgent = (r: Run, t: Task) =>
  r.agents.find(
    (a) =>
      a.role === (r.orchestration?.mode === "claude-native" ? "pm" : t.role),
  )!;
export function target(s: Checkpoint, c: Command) {
  const p = s.projects[c.project_id ?? ""];
  if (!p) fail("unknown_project", "Project not found");
  const r = current(p);
  if (c.run_id !== r.run_id)
    fail("stale_run", "Explicit current run_id required");
  return { p, r };
}
export function unknown(r: Run) {
  return (
    r.operations.some(
      (o) => o.status === "unknown" || o.status === "dispatching",
    ) || r.media.some((m) => !["succeeded", "failed"].includes(m.status))
  );
}
export function quiescent(r: Run) {
  return (
    !unknown(r) &&
    r.agents.every(
      (a) =>
        !a.herdr.pane_id ||
        (["idle", "done", "stopped"].includes(a.runtime.status) &&
          a.runtime.fresh === true),
    )
  );
}
export function idleAgent(a: Agent) {
  return (
    !a.herdr.pane_id ||
    (["idle", "done"].includes(a.runtime.status) && a.runtime.fresh === true)
  );
}
export function makeTask(
  task_id: string,
  role: Task["role"],
  title: string,
  depends_on: string[] = [],
  writes: string[] = [],
): Task {
  return {
    task_id,
    role,
    title,
    depends_on,
    writes,
    status: "pending",
    attempt: 0,
    assignment_id: null,
    event_ids: {},
  };
}
const boundaries: Record<Task["role"], string> = {
  developer: "app/",
  designer: "assets/",
  pm: "reports/",
};
// A claude-native run has one writer (the PM), so roles are labels and any
// task may write under the three run roots. Other modes keep role boundaries.
export function validatePlan(
  input: any,
  mode?: NonNullable<Run["orchestration"]>["mode"],
): Task[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 30)
    fail("invalid_plan", "Plan needs 1..30 tasks");
  const tasks: Task[] = input.map((x: any) => {
    if (
      !roles.includes(x.role) ||
      !/^[-a-zA-Z0-9_]{1,64}$/.test(x.task_id) ||
      x.task_id === "plan" ||
      !Array.isArray(x.depends_on) ||
      !Array.isArray(x.writes)
    )
      fail("invalid_plan", "Invalid role/task/paths");
    const allowed =
      mode === "claude-native"
        ? Object.values(boundaries)
        : [boundaries[x.role as Task["role"]]];
    for (const file of x.writes) {
      if (
        typeof file !== "string" ||
        file.includes("..") ||
        path.isAbsolute(file) ||
        !allowed.some((root) => file.startsWith(root))
      )
        fail("invalid_plan", "Role writes outside assigned boundary");
    }
    return makeTask(
      x.task_id,
      x.role,
      required(x, "title"),
      x.depends_on,
      x.writes,
    );
  });
  const ids = new Set(tasks.map((t) => t.task_id));
  if (ids.size !== tasks.length) fail("invalid_plan", "Duplicate task IDs");
  const visiting = new Set<string>(),
    done = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) fail("invalid_plan", "Dependency cycle");
    if (done.has(id)) return;
    const t = tasks.find((t) => t.task_id === id);
    if (!t) fail("invalid_plan", "Unknown dependency");
    visiting.add(id);
    for (const dep of t.depends_on) visit(dep);
    visiting.delete(id);
    done.add(id);
  };
  tasks.forEach((t) => visit(t.task_id));
  return tasks;
}
export function readyTasks(r: Run) {
  return r.tasks.filter(
    (t) =>
      ["pending", "retrying"].includes(t.status) &&
      t.depends_on.every(
        (id) => r.tasks.find((x) => x.task_id === id)?.status === "completed",
      ),
  );
}
export function overlaps(a: string, b: string) {
  return (
    a === b ||
    a.startsWith(b.replace(/\/$/, "") + "/") ||
    b.startsWith(a.replace(/\/$/, "") + "/")
  );
}
export function canAssign(r: Run, t: Task) {
  const a = taskAgent(r, t);
  return (
    !a.task_id &&
    idleAgent(a) &&
    !r.tasks.some(
      (x) =>
        x.status === "running" &&
        x.writes.some((a) => t.writes.some((b) => overlaps(a, b))),
    )
  );
}
export function authenticate(r: Run, payload: any) {
  const a = r.agents.find((a) => a.agent_id === payload.agent_id);
  if (!a || a.token !== payload.token)
    fail("report_owner", "Invalid agent capability");
  return a;
}
export function report(r: Run, payload: any) {
  const a = authenticate(r, payload);
  const event = required(payload, "event_id");
  const t = r.tasks.find((t) => t.task_id === payload.task_id);
  if (
    !t ||
    taskAgent(r, t)?.agent_id !== a.agent_id ||
    t.assignment_id !== payload.assignment_id ||
    t.attempt !== payload.attempt
  )
    fail("stale_assignment", "Report assignment does not match");
  const signature = hash(canonical(payload));
  if (t.event_ids[event]) {
    if (t.event_ids[event] !== signature)
      fail("event_conflict", "Event ID reused with different content");
    return { duplicate: true };
  }
  if (terminal.has(r.status) || r.status === "cancelling" || r.resume_required)
    fail("run_closed", "Run is closed, cancelling or paused");
  if (!Number.isSafeInteger(payload.sequence) || payload.sequence <= a.seq)
    fail("stale_sequence", "Report sequence must increase");
  if (
    t.status === "completed" ||
    t.status === "cancelled" ||
    a.task_id !== t.task_id
  )
    fail("task_closed", "Task no longer owns assignment");
  const kind = required(payload, "kind");
  if (kind === "team-create") {
    if (a.role !== "pm" || t.task_id !== "plan")
      fail(
        "report_owner",
        "Only the PM planning assignment can create the team",
      );
    if (r.orchestration?.mode !== "pm-led")
      fail("legacy_team", "Existing runs already own their team");
    if (!r.orchestration.team_requested) {
      r.orchestration.team_requested = true;
      r.orchestration.requested_by = a.agent_id;
      r.orchestration.requested_at = now();
    }
  } else if (kind === "plan") {
    if (a.role !== "pm" || t.task_id !== "plan")
      fail("report_owner", "Only PM planning task can submit plan");
    if (r.orchestration?.mode === "pm-led" && !r.orchestration.team_requested)
      fail(
        "team_required",
        "PM must send team-create before submitting its plan",
      );
    const tasks = validatePlan(payload.tasks, r.orchestration?.mode);
    r.tasks.push(...tasks);
    t.status = "completed";
    a.task_id = null;
    a.status = "waiting";
    a.waiting_reason = "dependency";
  } else if (kind === "completed") {
    if (t.task_id === "plan")
      fail("invalid_report", "Use plan report for initial task");
    t.status = "completed";
    t.result = required(payload, "result");
    a.task_id = null;
    a.status = "waiting";
    a.waiting_reason = "dependency";
  } else if (kind === "failed") {
    t.result = required(payload, "result");
    a.task_id = null;
    a.status = "waiting";
    a.waiting_reason = "runtime_settle";
    if (t.attempt < 3) {
      t.status = "retrying";
      r.status = "retrying";
    } else {
      t.status = "waiting_input";
      r.questions.push({
        request_id: randomUUID(),
        run_id: r.run_id,
        agent_id: a.agent_id,
        task_id: t.task_id,
        kind: "requirements_change",
        question:
          "자동 복구 2회를 소진했습니다. 새 실행으로 재시도하거나 취소해주세요.",
        response_schema: { type: "string" },
        status: "open",
      });
      r.reason = "retry_exhausted";
      a.waiting_reason = "retry_exhausted";
    }
  } else if (kind === "question") {
    if (
      !["execution_choice", "requirements_change", "terminal_action"].includes(
        payload.question_kind,
      )
    )
      fail("invalid_question", "Unsupported question kind");
    if (!ajv.validateSchema(payload.response_schema))
      fail("invalid_question", "Invalid response schema");
    const q = {
      request_id: randomUUID(),
      run_id: r.run_id,
      agent_id: a.agent_id,
      task_id: t.task_id,
      kind: payload.question_kind,
      question: required(payload, "question"),
      response_schema: payload.response_schema,
      status: "open" as const,
    };
    r.questions.push(q);
    t.status = "waiting_input";
    a.status = "waiting";
    a.waiting_reason = q.request_id;
    a.task_id = null;
  } else if (kind === "progress") {
    t.result = required(payload, "result");
  } else
    fail(
      "invalid_report",
      "Supported: team-create, plan, progress, completed, failed, question",
    );
  a.seq = payload.sequence;
  t.updated_at = now();
  t.event_ids[event] = signature;
  return { accepted: true };
}
export async function newRun(
  s: Checkpoint,
  p: Project,
  payload: any,
  c: Config,
  run_id = randomUUID(),
  prepared?: Record<string, Buffer>,
): Promise<Run> {
  const inputs = await snapshotInputs(
    p.directory,
    run_id,
    payload.inputs,
    prepared,
  );
  const agents: Agent[] = (["pm"] as const).map((role) => ({
    agent_id: `${p.project_id}-${run_id.slice(0, 8)}-${role}`,
    role,
    model: c.model,
    effort: "high",
    status: role === "pm" ? "ready" : "waiting",
    waiting_reason: role === "pm" ? null : "orchestrator",
    task_id: null,
    token: randomUUID(),
    seq: 0,
    herdr: { session_name: "homepage" },
    runtime: { status: "unknown", fresh: false },
  }));
  const r: Run = {
    run_id,
    status: "queued",
    inputs,
    queue_seq: ++s.queue_seq,
    slot: false,
    resume_required: false,
    orchestration: {
      mode: "claude-native",
    },
    agents,
    tasks: [
      makeTask(
        "plan",
        "pm",
        "Read PRD/design and send the homepage-studio plan (direction, first-screen, build-out). This PM session designs, writes, generates images and builds the site itself. No additional Herdr panes.",
      ),
    ],
    questions: [],
    operations: [],
    media: [],
    preview: { status: "stopped", run_id },
    created_at: now(),
    herdr: {
      session_name: "homepage",
      socket_path: c.socketPath,
      workspace_id: null,
    },
  };
  if (payload.feedback) r.feedback = String(payload.feedback);
  p.runs.push(r);
  p.current_run_id = run_id;
  return r;
}
export async function mutate(
  s: Checkpoint,
  c: Command,
  config: Config,
): Promise<any> {
  if (c.type === "submit") {
    const id = required(c, "project_id");
    if (s.projects[id])
      fail("project_exists", "Use feedback for an existing project");
    const directory = await realDirectory(required(c.payload, "directory"));
    if (Object.values(s.projects).some((p) => overlaps(p.directory, directory)))
      fail("source_conflict", "Project directories may not overlap");
    for (const name of ["meta.json", "task.json", "agents.json"]) {
      try {
        await fs.lstat(path.join(directory, name));
        fail("unowned_directory", `Existing ${name} would be overwritten`);
      } catch (e: any) {
        if (e.code !== "ENOENT") throw e;
      }
    }
    const prepared = await readInputs(c.payload.inputs);
    const staging = path.join(directory, ".herdr/pending-submit.json");
    let intent = {
      command_id: c.command_id,
      hash: hash(canonical(c)),
      run_id: randomUUID(),
    };
    try {
      const stat = await fs.lstat(path.join(directory, ".herdr"));
      if (stat.isSymbolicLink()) fail("unsafe_path", "Refuse symlink .herdr");
      const saved = JSON.parse(await fs.readFile(staging, "utf8"));
      if (saved.command_id !== c.command_id || saved.hash !== intent.hash)
        fail(
          "unowned_directory",
          "Existing staging belongs to a different request",
        );
      intent = saved;
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
      try {
        await fs.lstat(path.join(directory, ".herdr"));
        fail(
          "unowned_directory",
          "Existing .herdr has no matching staging intent",
        );
      } catch (check: any) {
        if (check.code !== "ENOENT") throw check;
      }
      await atomic(staging, JSON.stringify(intent));
    }
    const p: Project = {
      project_id: id,
      directory,
      revision: 1,
      current_run_id: "",
      runs: [],
    };
    const r = await newRun(s, p, c.payload, config, intent.run_id, prepared);
    s.projects[id] = p;
    await fs.mkdir(path.join(directory, "app"), { recursive: true });
    return { project_id: id, run_id: r.run_id, status: r.status };
  }
  const { p, r } = target(s, c);
  p.revision++;
  if (c.type === "report") return report(r, c.payload);
  if (c.type === "cancel") {
    if (terminal.has(r.status)) fail("run_closed", "Run already closed");
    r.status = "cancelling";
    r.resume_required = false;
    r.reason = "cancellation_requested";
    return { status: r.status };
  }
  if (c.type === "answer") {
    if (terminal.has(r.status)) fail("run_closed", "Run already closed");
    const q = r.questions.find((q) => q.request_id === c.payload.request_id);
    if (!q || q.status === "answered")
      fail("stale_question", "Question missing or answered");
    if (!ajv.validate(q.response_schema, c.payload.response))
      fail("invalid_answer", ajv.errorsText());
    q.response = c.payload.response;
    q.received_at = now();
    q.status =
      q.kind === "requirements_change" ? "awaiting_documents" : "answered";
    if (q.kind === "terminal_action" && c.payload.terminal_resolved !== true)
      fail(
        "terminal_action_required",
        "Resolve authentication in the pane first",
      );
    if (q.status === "answered") {
      const t = r.tasks.find((t) => t.task_id === q.task_id);
      if (t) t.status = "pending";
      const a = r.agents.find((a) => a.agent_id === q.agent_id);
      if (a) {
        a.waiting_reason = null;
        a.task_id = null;
      }
      if (!r.slot) {
        r.status = "queued";
        r.queue_seq = ++s.queue_seq;
      }
    }
    return { request_id: q.request_id, status: q.status };
  }
  if (c.type === "resume") {
    if (terminal.has(r.status) || r.status === "cancelling")
      fail("run_closed", "Use feedback/new run for closed work");
    if (unknown(r) || !quiescent(r))
      fail(
        "reconcile_required",
        "Refresh and resolve external operations/runtime before resume",
      );
    if (r.agents.some((a) => a.herdr.started && a.runtime.status === "stopped"))
      fail(
        "resource_missing",
        "Owned agent exited; cancel and create a feedback run",
      );
    if (r.questions.some((q) => q.status !== "answered"))
      fail("input_required", "Unresolved questions remain");
    for (const t of r.tasks)
      if (t.status === "running") {
        t.status = "pending";
        taskAgent(r, t).task_id = null;
      }
    r.resume_required = false;
    r.slot = false;
    r.status = "queued";
    r.execution_requested = true;
    delete r.reason;
    r.queue_seq = ++s.queue_seq;
    return { status: r.status };
  }
  if (c.type === "feedback" || c.type === "apply-inputs") {
    validateReplacement(r, c);
    const next = await newRun(s, p, c.payload, config);
    if (!terminal.has(r.status)) r.status = "superseded";
    r.slot = false;
    return { run_id: next.run_id, status: next.status };
  }
  fail("invalid_command", `Unsupported mutation ${c.type}`);
}

export function validateReplacement(r: Run, c: Command) {
  if (c.type === "feedback" && !terminal.has(r.status))
    fail("active_run", "Feedback requires a closed run");
  if (
    !quiescent(r) ||
    r.preview.status === "ready" ||
    r.preview.status === "unknown"
  )
    fail(
      "stop_required",
      "Stop preview and reconcile agents before replacing the run",
    );
  if (c.type === "apply-inputs") {
    const q = r.questions.find((q) => q.request_id === c.payload.request_id);
    if (
      c.payload.request_id &&
      (!q ||
        q.kind !== "requirements_change" ||
        q.status !== "awaiting_documents")
    )
      fail("stale_question", "Requirement answer is not ready");
  }
}
