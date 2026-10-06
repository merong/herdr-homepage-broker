import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Agent, Config, Project, Run, Task } from "../contracts/types.js";
import { atomic, hash } from "../storage/store.js";
import { brokerSocket } from "../config.js";
export async function rolePrompt(c: Config, p: Project, r: Run, a: Agent) {
  const skills = [];
  for (const f of c.skills) {
    const bytes = await fs.readFile(f);
    skills.push({ path: f, sha256: hash(bytes), text: bytes.toString("utf8") });
  }
  const dir = path.join(p.directory, ".herdr/runs", r.run_id);
  await atomic(
    path.join(dir, "skills-lock.json"),
    JSON.stringify(
      skills.map(({ text, ...s }) => s),
      null,
      2,
    ),
  );
  return `You are the ${a.role} of the homepage website team. There are exactly 3 roles: PM, developer, designer. Never spawn subagents, run another model/agent CLI, install skills, or delegate. Model is Claude Opus 5.5 high effort. No deployment or source archive. Finish at source + localhost preview + user review. Minimal verification only; no repeated QA loops.\nUse only the immutable PRD ${r.inputs.prd.path} and design ${r.inputs.design.path}. Do not edit their originals or snapshots. ${r.feedback ? "Feedback: " + r.feedback : ""}\nDeveloper owns app/. Designer owns ${dir}/assets/ and provides design handoff; never edit app/. PM owns ${dir}/reports/ and plans/reviews only. Never write meta.json, task.json, agents.json or broker checkpoint. State mutations must use the broker CLI. No polling with model turns. Return after each task report.\nThe available CLI is ${process.execPath} ${fileURLToPath(new URL("../cli.js", import.meta.url))}. Use --socket ${brokerSocket(c)}. Each assigned task provides assignment.json with agent capability, run, task, attempt and sequence. Send report --file <JSON command file>; command_id and event_id must be fresh UUIDs; sequence must increase. The report payload copies the assignment fields plus kind and required fields. Supported kinds: plan (PM planning only: tasks array of task_id, role, title, depends_on, writes), progress/result, completed/result, failed/result, question/question_kind/question/response_schema. Question kinds: execution_choice, requirements_change, terminal_action. After question or completed report stop working. Do not mark overall review on your own.\nPlan should include designer assets, developer implementation, and PM final minimal review. Relative write boundaries are app/, assets/, reports/. To start preview send preview-start with argv (program and args, use {port} placeholder, bind 127.0.0.1), with current project/run and agent_id/token. Use media-request with payload arguments for configured Higgsfield generator. After media-request is accepted, return without polling; the broker will notify this same agent when the job finishes. Images must flow through broker tracking; do not call untracked generators.\nOnly these explicitly configured skill excerpts apply; if their deploy instructions conflict, the localhost limit wins:\n${skills.map((s) => s.text).join("\n\n")}`;
}
export async function assignment(
  c: Config,
  p: Project,
  r: Run,
  a: Agent,
  t: Task,
) {
  const payload = {
    agent_id: a.agent_id,
    token: a.token,
    task_id: t.task_id,
    assignment_id: t.assignment_id,
    attempt: t.attempt,
    sequence: a.seq + 1,
  };
  const file = path.join(
    p.directory,
    ".herdr/runs",
    r.run_id,
    a.role + "-assignment.json",
  );
  await atomic(
    file,
    JSON.stringify(
      {
        schema_version: 1,
        command_id: "REPLACE_WITH_UUID",
        type: "report",
        project_id: p.project_id,
        run_id: r.run_id,
        payload: {
          ...payload,
          event_id: "REPLACE_WITH_UUID",
          kind: t.task_id === "plan" ? "plan" : "completed",
        },
      },
      null,
      2,
    ),
  );
  return `Task ${t.task_id}: ${t.title}\nAssignment file: ${file}. Read it and the immutable inputs. Write ownership: ${t.writes.join(", ") || "planning only"}. The assets/ and reports/ paths are relative to ${path.join(p.directory, ".herdr/runs", r.run_id)}. Deliver report through CLI; never edit the state files. Relevant user answers: ${JSON.stringify(r.questions.filter((q) => q.task_id === t.task_id && q.status === "answered").map((q) => ({ question: q.question, response: q.response })))}. Prior result: ${t.result ?? "none"}`;
}
export const claudeArgs = (system: string) => [
  "--model",
  "claude-opus-5-5",
  "--effort",
  "high",
  "--disable-slash-commands",
  "--strict-mcp-config",
  "--mcp-config",
  '{"mcpServers":{}}',
  "--setting-sources",
  "",
  "--disallowedTools",
  "Agent,Task,Skill",
  "--append-system-prompt",
  system,
];
