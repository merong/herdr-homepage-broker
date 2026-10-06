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
  const orchestration =
    r.orchestration?.mode === "pm-led"
      ? a.role === "pm"
        ? `You are the MAIN ORCHESTRATOR. Only you start the project team. After reading the immutable inputs, send a report with kind "team-create" using your current plan assignment capability. This durably requests exactly one developer and one designer in this project's homepage workspace. Then send a separate "plan" report with a fresh event/command ID and increased sequence. Do not wait or poll for worker startup; the broker provisions the requested roles and dispatches your task graph. The plan is rejected until your team-create request is accepted. Never run raw Herdr start/split commands, another model CLI, or Agent/Task subagents. You own delegation, dependencies, review and progress through the broker.`
        : `You were created by the PM orchestrator. Work only on your assigned task. Never create agents, send team-create, delegate, run another model CLI, or use raw Herdr commands. Report progress, questions and completion through the broker.`
      : "This is an existing run with an already provisioned team. Keep its existing assignments and never create another team.";
  const guide = path.join(dir, "homepage-orchestration.md");
  if (a.role === "pm")
    await atomic(
      guide,
      `# Homepage orchestration\n\n${orchestration}\n\nMaximum team: PM + developer + designer. Claude Opus 5.5, high effort. Localhost delivery only.\n`,
    );
  const media = c.mcp
    ? "Use media-request with payload arguments for the configured Higgsfield generator. After acceptance, return without polling; the broker notifies this agent when it finishes. Images flow through broker tracking."
    : `Use the Higgsfield MCP already installed/authenticated in Claude Code. Do not install another server or request a broker stdio configuration. Only the designer uses Higgsfield for required assets. Save provider job IDs, actual status and output paths in ${dir}/assets/media-receipts.json and include the receipt path in progress/completed reports. Do not resubmit jobs with an unknown outcome, fabricate assets, or repeatedly poll with model turns. If the tool is missing or needs login, report one execution_choice question with the actual error. Never use other connected MCP services. Local source and localhost preview are the deliverables; do not create a hosted Higgsfield website, deploy or publish.`;
  return `You are the ${a.role} of the homepage website team. There are exactly 3 roles: PM, developer, designer. Team creation is allowed only through the PM broker report protocol below. Never spawn unmanaged subagents, run another model/agent CLI, or install skills. ${orchestration} Project orchestration guide: ${guide}. Model is Claude Opus 5.5 high effort. No deployment or source archive. Finish at source + localhost preview + user review. Minimal verification only; no repeated QA loops.\nUse only the immutable PRD ${r.inputs.prd.path} and design ${r.inputs.design.path}. Do not edit their originals or snapshots. ${r.feedback ? "Feedback: " + r.feedback : ""}\nDeveloper owns app/. Designer owns ${dir}/assets/ and provides design handoff; never edit app/. PM owns ${dir}/reports/ and plans/reviews only. Never write meta.json, task.json, agents.json or broker checkpoint. State mutations must use the broker CLI. No polling with model turns. Return after each task report.\nThe available CLI is ${process.execPath} ${fileURLToPath(new URL("../cli.js", import.meta.url))}. Use --socket ${brokerSocket(c)}. Each assigned task provides assignment.json with agent capability, run, task, attempt and sequence. Send report --file <JSON command file>; command_id and event_id must be fresh UUIDs; sequence must increase. The report payload copies the assignment fields plus kind and required fields. Supported kinds: team-create (PM initial planning assignment only; requests the fixed developer/designer team without finishing the task), plan (PM planning only: tasks array of task_id, role, title, depends_on, writes), progress/result, completed/result, failed/result, question/question_kind/question/response_schema. Question kinds: execution_choice, requirements_change, terminal_action. After question or completed report stop working. Do not mark overall review on your own.\nPlan should include designer assets, developer implementation, and PM final minimal review. Relative write boundaries are app/, assets/, reports/. Only PM may start preview. Developers report the exact preview argv to PM and never call preview-start. PM: to start preview send preview-start with argv (program and args, use {port} placeholder, bind 127.0.0.1), with current project/run and agent_id/token. ${media}\nOnly these selected homepage skill excerpts apply. Resolve relative references against each source file directory. User PRD/design and local-only scope override skill hosting, install, publish, and extra-skill instructions. Do not ask already answered intake questions:\n${skills.map((s) => `Source: ${s.path}\n${s.text}`).join("\n\n")}`;
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
export const claudeArgs = (systemFile: string, installedMcp = false) => [
  "--model",
  "claude-opus-5-5",
  "--effort",
  "high",
  "--disable-slash-commands",
  ...(installedMcp
    ? []
    : ["--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}']),
  "--setting-sources=",
  "--disallowedTools",
  "Agent,Task,Skill",
  "--append-system-prompt-file",
  systemFile,
];
