import fs from "node:fs";
import { fullCommandSchema } from "../dist/src/contracts/validate.js";
const common = {
  schema_version: { const: 1 },
  revision: { type: "integer", minimum: 1 },
  project_id: { type: "string" },
  run_id: { type: "string" },
};
const schema = (title, extra, required) => ({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title,
  type: "object",
  required: [...Object.keys(common), ...required],
  properties: { ...common, ...extra },
});
const role = (name) => ({
  type: "object",
  required: ["role"],
  properties: { role: { const: name } },
});
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
const outputs = {
  command: fullCommandSchema,
  meta: schema(
    "Project read projection",
    {
      status: { enum: statuses },
      input_required: { type: "boolean" },
      input_requests: { type: "array" },
      herdr: {
        type: "object",
        required: ["session_name", "socket_path", "workspace_id"],
        properties: {
          session_name: { const: "homepage" },
          socket_path: { type: "string" },
          workspace_id: { type: ["string", "null"] },
        },
      },
      artifacts: { type: "object" },
      resume_required: { type: "boolean" },
      orchestration: {
        oneOf: [
          { type: "null" },
          {
            type: "object",
            additionalProperties: false,
            required: ["mode"],
            properties: { mode: { const: "claude-native" } },
          },
          {
            type: "object",
            additionalProperties: false,
            required: [
              "mode",
              "team_requested",
              "requested_by",
              "requested_at",
            ],
            properties: {
              mode: { const: "pm-led" },
              team_requested: { type: "boolean" },
              requested_by: { type: ["string", "null"] },
              requested_at: { type: ["string", "null"] },
            },
          },
        ],
      },
    },
    [
      "status",
      "input_required",
      "input_requests",
      "artifacts",
      "herdr",
      "resume_required",
    ],
  ),
  task: schema(
    "Task read projection",
    {
      tasks: {
        type: "array",
        items: {
          type: "object",
          required: [
            "task_id",
            "role",
            "status",
            "attempt",
            "depends_on",
            "writes",
            "assignment_id",
          ],
          properties: {
            task_id: { type: "string" },
            role: { enum: ["pm", "developer", "designer"] },
            status: {
              enum: [
                "pending",
                "running",
                "waiting_input",
                "retrying",
                "completed",
                "failed",
                "cancelled",
              ],
            },
            attempt: { type: "integer", minimum: 0 },
            depends_on: { type: "array", items: { type: "string" } },
            writes: { type: "array", items: { type: "string" } },
            assignment_id: { type: ["string", "null"] },
          },
        },
      },
    },
    ["tasks"],
  ),
  agents: {
    ...schema(
      "Agent read projection",
      {
        orchestration_mode: { enum: ["claude-native", "pm-led", "legacy"] },
        agents: {
          type: "array",
          items: {
            type: "object",
            required: [
              "agent_id",
              "role",
              "model",
              "effort",
              "herdr",
              "runtime",
              "status",
              "waiting_reason",
            ],
            properties: {
              role: { enum: ["pm", "developer", "designer"] },
              model: { const: "claude-opus-5-5" },
              effort: { const: "high" },
              status: {
                enum: ["ready", "working", "waiting", "stopped", "failed"],
              },
              token: false,
            },
          },
          // One native PM, or the fixed three-role pm-led/legacy team.
          oneOf: [
            { minItems: 1, maxItems: 1, prefixItems: [role("pm")] },
            {
              minItems: 3,
              maxItems: 3,
              allOf: ["pm", "developer", "designer"].map((r) => ({
                contains: role(r),
                minContains: 1,
                maxContains: 1,
              })),
            },
          ],
        },
      },
      ["agents"],
    ),
    if: {
      required: ["orchestration_mode"],
      properties: { orchestration_mode: { const: "claude-native" } },
    },
    then: { properties: { agents: { maxItems: 1 } } },
    else: {
      if: { required: ["orchestration_mode"] },
      then: { properties: { agents: { minItems: 3 } } },
    },
  },
  checkpoint: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "Broker checkpoint (additional invariants enforced by checkpoint())",
    type: "object",
    additionalProperties: false,
    required: [
      "schema_version",
      "revision",
      "queue_seq",
      "projects",
      "commands",
    ],
    properties: {
      schema_version: { const: 1 },
      revision: { type: "integer", minimum: 0 },
      queue_seq: { type: "integer", minimum: 0 },
      projects: { type: "object" },
      commands: { type: "object" },
    },
  },
};
fs.mkdirSync("schemas", { recursive: true });
for (const [name, value] of Object.entries(outputs))
  fs.writeFileSync(
    `schemas/${name}.schema.json`,
    JSON.stringify(value, null, 2) + "\n",
  );
