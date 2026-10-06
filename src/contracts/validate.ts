import { Ajv2020 } from "ajv/dist/2020.js";
import { Command, Checkpoint, fail } from "./types.js";
export const ajv = new Ajv2020({ allErrors: true, strict: false });
export const commandSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["schema_version", "command_id", "type", "payload"],
  properties: {
    schema_version: { const: 1 },
    command_id: { type: "string", minLength: 1, maxLength: 128 },
    type: {
      enum: [
        "submit",
        "status",
        "answer",
        "apply-inputs",
        "feedback",
        "resume",
        "execute",
        "execution-status",
        "cancel",
        "report",
        "preview-start",
        "preview-stop",
        "media-request",
        "media-status",
        "reconcile",
      ],
    },
    project_id: { type: "string", pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$" },
    run_id: { type: "string", minLength: 1, maxLength: 128 },
    payload: { type: "object" },
  },
};
const string = { type: "string", minLength: 1, maxLength: 8192 };
const document = {
  type: "object",
  additionalProperties: false,
  required: ["path", "sha256"],
  properties: {
    path: string,
    sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
  },
};
const inputs = {
  type: "object",
  additionalProperties: false,
  required: ["prd", "design"],
  properties: { prd: document, design: document },
};
const capability = { agent_id: string, token: string };
const payload = (required: string[], properties: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  required,
  properties,
});
export const payloadSchemas: Record<string, any> = {
  submit: payload(["directory", "inputs"], { directory: string, inputs }),
  status: payload([], {}),
  answer: payload(["request_id", "response"], {
    request_id: string,
    response: {},
    terminal_resolved: { type: "boolean" },
  }),
  "apply-inputs": payload(["inputs"], {
    inputs,
    request_id: string,
    feedback: string,
  }),
  feedback: payload(["inputs", "feedback"], { inputs, feedback: string }),
  resume: payload([], {}),
  execute: payload(["action"], { action: { enum: ["start", "resume"] } }),
  "execution-status": payload([], {}),
  cancel: payload([], {}),
  report: payload(
    [
      "agent_id",
      "token",
      "task_id",
      "assignment_id",
      "attempt",
      "event_id",
      "sequence",
      "kind",
    ],
    {
      ...capability,
      task_id: string,
      assignment_id: string,
      attempt: { type: "integer", minimum: 1 },
      event_id: string,
      sequence: { type: "integer", minimum: 1 },
      kind: {
        enum: [
          "team-create",
          "plan",
          "progress",
          "completed",
          "failed",
          "question",
        ],
      },
      tasks: { type: "array" },
      result: string,
      question_kind: {
        enum: ["execution_choice", "requirements_change", "terminal_action"],
      },
      question: string,
      response_schema: { type: "object" },
    },
  ),
  "preview-start": payload(["argv"], {
    ...capability,
    argv: { type: "array", minItems: 1, maxItems: 100, items: string },
  }),
  "preview-stop": payload([], { ...capability }),
  "media-request": payload(["arguments"], {
    ...capability,
    arguments: { type: "object" },
  }),
  "media-status": payload([], {}),
  reconcile: payload([], {
    operation_id: string,
    confirm_not_executed: { type: "boolean" },
  }),
};
export const fullCommandSchema = {
  ...commandSchema,
  allOf: Object.entries(payloadSchemas).map(([type, schema]) => ({
    if: { properties: { type: { const: type } } },
    then: {
      required:
        type === "status"
          ? []
          : ["submit", "execution-status"].includes(type)
            ? ["project_id"]
            : ["project_id", "run_id"],
      properties: { payload: schema },
    },
  })),
};
const validateCommand = ajv.compile(fullCommandSchema);
export function command(value: unknown): Command {
  if (!validateCommand(value))
    fail("invalid_command", ajv.errorsText(validateCommand.errors));
  const c = value as unknown as Command;
  if (
    ["__proto__", "constructor", "prototype"].includes(c.command_id) ||
    ["__proto__", "constructor", "prototype"].includes(c.project_id ?? "")
  )
    fail("invalid_command", "Reserved identifier");
  return c;
}
export function checkpoint(value: any): Checkpoint {
  if (
    value?.schema_version !== 1 ||
    !Number.isSafeInteger(value.revision) ||
    !Number.isSafeInteger(value.queue_seq) ||
    !value.projects ||
    typeof value.projects !== "object" ||
    Array.isArray(value.projects) ||
    !value.commands
  )
    fail("invalid_checkpoint", "Unsupported or corrupt checkpoint");
  const statuses = [
    "queued",
    "starting",
    "running",
    "waiting_input",
    "retrying",
    "paused",
    "cancelling",
    "review_pending",
    "failed",
    "cancelled",
    "superseded",
  ];
  let slots = 0;
  for (const [id, p] of Object.entries<any>(value.projects)) {
    if (
      p.project_id !== id ||
      typeof p.directory !== "string" ||
      !Array.isArray(p.runs) ||
      !p.runs.some((r: any) => r.run_id === p.current_run_id)
    )
      fail("invalid_checkpoint", "Invalid project record");
    for (const r of p.runs) {
      if (
        !statuses.includes(r.status) ||
        !Number.isSafeInteger(p.revision) ||
        typeof r.resume_required !== "boolean" ||
        (r.execution_requested !== undefined &&
          typeof r.execution_requested !== "boolean")
      )
        fail("invalid_checkpoint", "Invalid status/revision");
      if (r.run_id === p.current_run_id && r.slot) slots++;
      if (
        r.orchestration !== undefined &&
        r.orchestration?.mode !== "claude-native" &&
        (r.orchestration?.mode !== "pm-led" ||
          typeof r.orchestration.team_requested !== "boolean" ||
          (r.orchestration.team_requested &&
            (r.orchestration.requested_by !==
              r.agents?.find((a: any) => a.role === "pm")?.agent_id ||
              typeof r.orchestration.requested_at !== "string")))
      )
        fail("invalid_checkpoint", "Invalid orchestration authority");
      if (
        r.herdr?.session_name !== "homepage" ||
        !Array.isArray(r.agents) ||
        r.agents.length !==
          (r.orchestration?.mode === "claude-native" ? 1 : 3) ||
        !Array.isArray(r.tasks) ||
        !Array.isArray(r.operations) ||
        !Array.isArray(r.questions) ||
        typeof r.slot !== "boolean" ||
        !r.inputs?.prd?.sha256 ||
        !r.inputs?.design?.sha256
      )
        fail("invalid_checkpoint", "Invalid run record");
      if (
        new Set(r.agents.map((a: any) => a.role)).size !== r.agents.length ||
        (r.orchestration?.mode === "claude-native" &&
          r.agents[0].role !== "pm") ||
        r.agents.some(
          (a: any) =>
            !["pm", "developer", "designer"].includes(a.role) ||
            a.model !== "claude-opus-5-5" ||
            a.effort !== "high" ||
            typeof a.token !== "string",
        )
      )
        fail("invalid_checkpoint", "Invalid agents");
      if (
        r.tasks.some(
          (t: any) =>
            ![
              "pending",
              "running",
              "waiting_input",
              "retrying",
              "completed",
              "failed",
              "cancelled",
            ].includes(t.status) ||
            !["pm", "developer", "designer"].includes(t.role) ||
            !Number.isInteger(t.attempt) ||
            t.attempt < 0 ||
            !Array.isArray(t.depends_on),
        )
      )
        fail("invalid_checkpoint", "Invalid tasks");
      if (
        r.operations.some(
          (o: any) =>
            ![
              "prepared",
              "dispatching",
              "acknowledged",
              "settled",
              "unknown",
            ].includes(o.status),
        )
      )
        fail("invalid_checkpoint", "Invalid operation");
    }
  }
  if (slots > 2) fail("invalid_checkpoint", "Too many reserved project slots");
  return value;
}
export function required(obj: any, key: string): string {
  if (typeof obj?.[key] !== "string" || !obj[key].trim())
    fail("invalid_command", `${key} is required`);
  return obj[key];
}
