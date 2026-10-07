import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Agent, Config, Project, Run, Task } from "../contracts/types.js";
import { atomic, hash } from "../storage/store.js";
import { brokerCli, nativePrompt, shellQuote, studioPlan } from "./native.js";
import { studioPlugin, treeHash } from "./studio.js";
import { brokerSocket, injectedSkills } from "../config.js";
export async function rolePrompt(c: Config, p: Project, r: Run, a: Agent) {
  const mode = r.orchestration?.mode ?? "legacy";
  const skills = [];
  for (const f of injectedSkills(c, mode)) {
    const bytes = await fs.readFile(f);
    skills.push({ path: f, sha256: hash(bytes), text: bytes.toString("utf8") });
  }
  const dir = path.join(p.directory, ".herdr/runs", r.run_id);
  const lock = skills.map(({ text, ...s }) => s);
  if (mode === "claude-native") {
    const plugin = await studioPlugin();
    const tree = await treeHash(plugin.path);
    await atomic(
      path.join(dir, "skills-lock.json"),
      JSON.stringify(
        {
          schema_version: 1,
          skills: lock,
          plugin: { ...plugin, tree_sha256: tree.sha256, files: tree.files },
        },
        null,
        2,
      ),
    );
    return nativePrompt(
      c,
      p,
      r,
      skills.map((s) => `Source: ${s.path}\n${s.text}`).join("\n\n"),
      plugin,
    );
  }
  await atomic(
    path.join(dir, "skills-lock.json"),
    JSON.stringify(lock, null, 2),
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
  return `You are the ${a.role} of the homepage website team. There are exactly 3 roles: PM, developer, designer. Team creation is allowed only through the PM broker report protocol below. Never spawn unmanaged subagents, run another model/agent CLI, or install skills. ${orchestration} Project orchestration guide: ${guide}. Model is Claude Opus 5.5 high effort. No deployment or source archive. Finish at source + localhost preview + user review. Minimal verification only; no repeated QA loops.\nUse only the immutable PRD ${r.inputs.prd.path} and design ${r.inputs.design.path}. Do not edit their originals or snapshots. ${r.feedback ? "Feedback: " + r.feedback : ""}\nDeveloper owns app/. Designer owns ${dir}/assets/ and provides design handoff; never edit app/. PM owns ${dir}/reports/ and plans/reviews only. Never write meta.json, task.json, agents.json or broker checkpoint. State mutations must use the broker CLI. Send a concise progress report at meaningful milestones (task started, image job accepted/completed, source integrated, preview ready), including actual facts and provider job ID when relevant. Do not send timer-based reports or poll with model turns. Progress reports may continue the assigned task; return after a completion or question report.\nThe available CLI is ${shellQuote(process.execPath)} ${shellQuote(fileURLToPath(new URL("../cli.js", import.meta.url)))}. Use --socket ${shellQuote(brokerSocket(c))}. Each assigned task provides assignment.json with agent capability, run, task, attempt and sequence. Send report --file <JSON command file>; command_id and event_id must be fresh UUIDs; sequence must increase. The report payload copies the assignment fields plus kind and required fields. Supported kinds: team-create (PM initial planning assignment only; requests the fixed developer/designer team without finishing the task), plan (PM planning only: tasks array of task_id, role, title, depends_on, writes), progress/result, completed/result, failed/result, question/question_kind/question/response_schema. Question kinds: execution_choice, requirements_change, terminal_action. After question or completed report stop working. Do not mark overall review on your own.\nPlan should include designer assets, developer implementation, and PM final minimal review. Relative write boundaries are app/, assets/, reports/. Only PM may start preview. Developers report the exact preview argv to PM and never call preview-start. PM: to start preview send preview-start with argv (program and args, use {port} placeholder, bind 127.0.0.1), with current project/run and agent_id/token. ${media}\nOnly these selected homepage skill excerpts apply. Resolve relative references against each source file directory. User PRD/design and local-only scope override skill hosting, install, publish, and extra-skill instructions. Do not ask already answered intake questions:\n${skills.map((s) => `Source: ${s.path}\n${s.text}`).join("\n\n")}`;
}
export async function assignment(
  c: Config,
  p: Project,
  r: Run,
  a: Agent,
  t: Task,
) {
  const native = r.orchestration?.mode === "claude-native";
  const envelope = (token: string, sequence: number, fields: object) => ({
    schema_version: 1,
    command_id: "REPLACE_WITH_UUID",
    type: "report",
    project_id: p.project_id,
    run_id: r.run_id,
    payload: {
      agent_id: a.agent_id,
      token,
      task_id: t.task_id,
      assignment_id: t.assignment_id,
      attempt: t.attempt,
      sequence,
      event_id: "REPLACE_WITH_UUID",
      ...fields,
    },
  });
  const file = path.join(
    p.directory,
    ".herdr/runs",
    r.run_id,
    a.role + "-assignment.json",
  );
  await atomic(
    file,
    JSON.stringify(
      envelope(
        a.token,
        a.seq + 1,
        t.task_id === "plan"
          ? { kind: "plan", ...(native ? { tasks: studioPlan } : {}) }
          : { kind: "completed" },
      ),
      null,
      2,
    ),
  );
  const message = `Task ${t.task_id}: ${t.title}\nAssignment file: ${file}. Read it and the immutable inputs. Write ownership: ${t.writes.join(", ") || "planning only"}. The assets/ and reports/ paths are relative to ${path.join(p.directory, ".herdr/runs", r.run_id)}. Deliver report through CLI; never edit the state files. Relevant user answers: ${JSON.stringify(r.questions.filter((q) => q.task_id === t.task_id && q.status === "answered").map((q) => ({ question: q.question, response: q.response })))}. Prior result: ${t.result ?? "none"}`;
  if (native) {
    const dir = path.join(p.directory, ".herdr/runs", r.run_id);
    const taskFile = path.join(dir, `task-${t.assignment_id}.md`);
    // Shell-quoted: the project path may hold spaces, quotes or $.
    const cli = shellQuote(await brokerCli(c, dir));
    // Complete examples so the PM never has to read broker source. The token
    // stays only in the assignment file.
    const token = "TOKEN_FROM_ASSIGNMENT_FILE";
    const json = (label: string, value: object) =>
      `${label}\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n`;
    const examples =
      t.task_id === "plan"
        ? [
            json(
              "progress (optional):",
              envelope(token, a.seq + 1, {
                kind: "progress",
                result: "REPLACE_WITH_ONE_LINE_FACT",
              }),
            ),
            json(
              "plan (send once after reading the inputs; this completes the task; sequence one above your last accepted report):",
              envelope(token, a.seq + 2, { kind: "plan", tasks: studioPlan }),
            ),
          ]
        : [
            json(
              "progress (at each milestone):",
              envelope(token, a.seq + 1, {
                kind: "progress",
                result: "REPLACE_WITH_ONE_LINE_FACT",
              }),
            ),
            json(
              "completed (once, when this task is done; sequence one above your last accepted report, not necessarily the number shown):",
              envelope(token, a.seq + 2, {
                kind: "completed",
                result: "REPLACE_WITH_RESULT_SUMMARY",
              }),
            ),
            json(
              `preview-start (when the skill says to start the preview; send with ${cli} preview start --file <file>). argv runs in app/, its program must be node, npm, npx, pnpm, bun or python3, and it keeps {port} and binds 127.0.0.1; adjust the example to the actual build output:`,
              {
                schema_version: 1,
                command_id: "REPLACE_WITH_UUID",
                type: "preview-start",
                project_id: p.project_id,
                run_id: r.run_id,
                payload: {
                  agent_id: a.agent_id,
                  token,
                  argv: [
                    "python3",
                    "-m",
                    "http.server",
                    "{port}",
                    "--bind",
                    "127.0.0.1",
                  ],
                },
              },
            ),
          ];
    await atomic(
      taskFile,
      `${message}\n\n## Reports for this assignment\n\nWrite each command to its own JSON file and send it with the line below. The path is shell-quoted; paste it as written and replace only <file>:\n\n    ${cli} report --file <file>\n\nCall that path directly; do not keep a multi-word command in one shell variable. In each copy replace every REPLACE_WITH_UUID with a new UUID (uuidgen) and ${token} with payload.token from ${file}. Every other ID below is already correct. The sequence numbers below are starting values: every report needs a sequence above the last one the broker accepted, so count up by one per report (${a.seq + 1}, ${a.seq + 2}, ${a.seq + 3}, ...) and give the final report the next number after your last progress. Every new report gets new UUIDs; only to re-check a command whose result you did not see, resend the same file unchanged (same command_id and content) and the broker returns its original result without running it again. failed adds result; question adds question_kind, question and response_schema.\n\n${examples.join("\n")}`,
    );
    const instructions = path.join(
      p.directory,
      ".herdr/runs",
      r.run_id,
      "pm-instructions.md",
    );
    return `Initialize this PM session by reading and following ${JSON.stringify(instructions)}. Then read ${JSON.stringify(taskFile)} and execute only that assignment in this session yourself; all broker reports come from this PM.`;
  }
  return message;
}
export const claudeArgs = (
  systemFile: string | undefined,
  installedMcp = false,
  pluginDir?: string,
) => [
  "--model",
  "claude-opus-5-5",
  "--effort",
  "high",
  ...(installedMcp
    ? []
    : ["--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}']),
  "--setting-sources=",
  ...(pluginDir ? ["--plugin-dir", pluginDir] : []),
  ...(systemFile ? ["--append-system-prompt-file", systemFile] : []),
];
