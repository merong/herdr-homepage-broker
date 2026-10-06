export const roles = ["pm", "developer", "designer"] as const;
export type Role = (typeof roles)[number];
export type Status =
  | "queued"
  | "starting"
  | "running"
  | "waiting_input"
  | "retrying"
  | "paused"
  | "cancelling"
  | "review_pending"
  | "failed"
  | "cancelled"
  | "superseded";
export const terminal = new Set<Status>([
  "review_pending",
  "failed",
  "cancelled",
  "superseded",
]);
export interface Command {
  schema_version: 1;
  command_id: string;
  type: string;
  project_id?: string;
  run_id?: string;
  payload: Record<string, any>;
}
export interface Inputs {
  prd: { path: string; sha256: string };
  design: { path: string; sha256: string };
}
export interface Question {
  request_id: string;
  run_id: string;
  agent_id: string;
  task_id: string;
  kind: "execution_choice" | "requirements_change" | "terminal_action";
  question: string;
  response_schema: Record<string, unknown>;
  status: "open" | "awaiting_documents" | "answered";
  response?: unknown;
  received_at?: string;
}
export interface Agent {
  agent_id: string;
  role: Role;
  model: string;
  effort: "high";
  status: "ready" | "working" | "waiting" | "stopped" | "failed";
  waiting_reason: string | null;
  task_id: string | null;
  token: string;
  seq: number;
  herdr: Record<string, any>;
  runtime: Record<string, any>;
}
export interface Task {
  task_id: string;
  role: Role;
  title: string;
  depends_on: string[];
  writes: string[];
  status:
    | "pending"
    | "running"
    | "waiting_input"
    | "retrying"
    | "completed"
    | "failed"
    | "cancelled";
  attempt: number;
  assignment_id: string | null;
  result?: string;
  updated_at?: string;
  event_ids: Record<string, string>;
}
export interface Operation {
  operation_id: string;
  kind: string;
  status: "prepared" | "dispatching" | "acknowledged" | "settled" | "unknown";
  request: Record<string, any>;
  result?: any;
  error?: string;
  created_at: string;
}
export interface Preview {
  status:
    | "stopped"
    | "starting"
    | "ready"
    | "failed"
    | "unknown"
    | "waiting_resource";
  run_id: string;
  url?: string;
  pid?: number;
  process_start?: string;
  port?: number;
  argv?: string[];
  started_at?: string;
  error?: string;
}
export interface Run {
  run_id: string;
  status: Status;
  inputs: Inputs;
  queue_seq: number;
  slot: boolean;
  resume_required: boolean;
  execution_requested?: boolean;
  orchestration?:
    | { mode: "claude-native" }
    | {
        mode: "pm-led";
        team_requested: boolean;
        requested_by: string | null;
        requested_at: string | null;
      };
  agents: Agent[];
  tasks: Task[];
  questions: Question[];
  operations: Operation[];
  preview: Preview;
  feedback?: string;
  created_at: string;
  reason?: string;
  herdr: {
    session_name: "homepage";
    socket_path: string;
    workspace_id: string | null;
  };
  media: Record<string, any>[];
}
export interface Project {
  project_id: string;
  directory: string;
  revision: number;
  current_run_id: string;
  runs: Run[];
}
export interface Checkpoint {
  schema_version: 1;
  revision: number;
  queue_seq: number;
  projects: Record<string, Project>;
  commands: Record<string, { hash: string; result: any }>;
}
export interface Config {
  stateRoot: string;
  projectsRoot?: string;
  session: "homepage";
  herdrBin: string;
  socketPath: string;
  model: "claude-opus-5-5";
  effort: "high";
  maxProjects: 2;
  maxPreviews: 2;
  skills: string[];
  mcp?: {
    command: string;
    args: string[];
    env?: Record<string, string>;
    generateTool: string;
    statusTool: string;
    jobIdPath: string;
    statusPath: string;
    assetPath: string;
    statusArgument: string;
  };
  tsk?: { binary: string; stateDir: string };
  allowExecution: boolean;
  autoStart?: boolean;
  web?: { enabled: boolean; port: number };
}
export class Fault extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function fail(code: string, message: string): never {
  throw new Fault(code, message);
}
export const now = () => new Date().toISOString();
