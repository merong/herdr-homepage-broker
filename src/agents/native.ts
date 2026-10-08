import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Config, Project, Run } from "../contracts/types.js";
import { atomic } from "../storage/store.js";
import { brokerSocket, claudeRoot } from "../config.js";
import { lookScript } from "./studio.js";

// The plan the homepage-studio skill tells the PM to send (SKILL.md "plan").
export const studioPlan = [
  {
    task_id: "direction",
    role: "pm",
    title: "방향 정하기",
    depends_on: [],
    writes: ["reports/direction.md"],
  },
  {
    task_id: "first-screen",
    role: "developer",
    title: "첫 화면과 대표 섹션",
    depends_on: ["direction"],
    writes: ["app/", "assets/", "reports/look/"],
  },
  {
    task_id: "build-out",
    role: "developer",
    title: "전체 페이지 완성",
    depends_on: ["first-screen"],
    writes: ["app/", "assets/", "reports/"],
  },
];

// POSIX single quotes. Used for the wrapper and for every command line the PM
// pastes into its shell, so paths with spaces, quotes or $ stay one word.
export const shellQuote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;
// One executable path for the PM's broker calls. zsh does not word-split a
// "$CLI" variable holding "node cli.js", so the PM must call a single path.
// The wrapper carries no capability; tokens stay in the assignment file.
export async function brokerCli(c: Config, dir: string) {
  const file = path.join(dir, "broker-cli");
  const cli = fileURLToPath(new URL("../cli.js", import.meta.url));
  await atomic(
    file,
    `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(cli)} --socket ${shellQuote(brokerSocket(c))} "$@"\n`,
    0o700,
  );
  return file;
}

async function higgsfieldReferences() {
  const lines = [];
  for (const name of ["higgsfield-websites", "higgsfield-brandkit"]) {
    const dir = path.join(claudeRoot(), "skills", name, "references");
    let found = false;
    try {
      found = (await fs.stat(dir)).isDirectory();
    } catch {}
    lines.push(`- ${name}: ${found ? dir : "not installed"}`);
  }
  return lines.join("\n");
}

// Files are loaded before Claude starts; long instructions never enter its argv.
export async function nativePrompt(
  c: Config,
  p: Project,
  r: Run,
  skills: string,
  plugin: { version: string; path: string },
) {
  const dir = path.join(p.directory, ".herdr/runs", r.run_id);
  const guide = path.join(dir, "homepage-orchestration.md");
  // The quoted path is the first word of every command shown to the PM.
  const cli = shellQuote(await brokerCli(c, dir));
  // Quoted the same way; <preview URL> and <round> stay outside the quotes so
  // the PM replaces them without touching a quoted path.
  const look = `python3 ${shellQuote(path.join(plugin.path, lookScript))} <preview URL> ${shellQuote(path.join(dir, "reports/look"))}/<round>`;
  const shared = `# Homepage: one Herdr PM builds the site with homepage-studio

Execution mode: claude-native. Exactly one Herdr pane and one main Claude session (PM). This execution instruction supersedes older PRD/design wording about separate developer, designer or copywriter agents or panes; product requirements stay authoritative. Model: Claude Opus 5.5 high effort. No extra Herdr panes, independent/background Claude sessions, agent teams or separate QA agent.

## How you work
You (PM) design, write the copy, generate images and build the site yourself in this one session, so intent and visual judgment stay in one context. Load skill homepage-studio:homepage-studio first and follow it; for visual craft load homepage-studio:design-taste, homepage-studio:high-end-visual-design and homepage-studio:frontend-design at the stages the homepage-studio skill names, and on conflict follow the priority set in the homepage-studio skill. Do not hand design, copy or build work to subagents. Built-in subagents are allowed only to run independent image generations in parallel: you write every prompt and review every result yourself. Wait for every subagent to finish before a completed, failed or question report.

## homepage-studio plugin
Loaded for this session from ${plugin.path} (version ${plugin.version}); skill reference files resolve under ${plugin.path}/skills/<skill>/.

## Inputs and paths
Read immutable PRD ${r.inputs.prd.path} and design ${r.inputs.design.path}. Never edit originals or snapshots. ${r.feedback ? "Feedback: " + r.feedback : ""}
Source app/: ${path.join(p.directory, "app")}. Skill paths reports/... and assets/... resolve under the run directory ${dir}: reports ${dir}/reports/, assets ${dir}/assets/. Never edit meta.json, task.json, agents.json, *-assignment.json or the broker checkpoint; state changes go only through the broker CLI.

## Look loop
Judge the page from screenshots, not from documents. Run: ${look} (add --reduced-motion when the skill asks). It writes desktop.png, desktop-full.png, mobile.png, mobile-full.png, parts/ slices of the full pages and issues.json, and prints a short summary. Open the screenshots and judge them yourself. first-screen: at most 2 rounds. build-out: at most 3 rounds, then one final run with final as <round>, as delivery evidence, with no fixes after it. No separate QA agent: fix what you see rather than writing long reports. If look.py says Playwright is missing, do not install it; send one progress report saying screenshots are unavailable and continue with the checks you can run.

## Preview
Start the preview in the first-screen task as soon as the first screen renders, and keep it serving the final source until the run ends.

## Media
Explicit image or video counts in the PRD or design win. Otherwise generate only images whose placement and job on the page are decided, at most 12 in total, and no video unless the PRD or design asks for one. Record each generated file in ${dir}/assets/media-receipts.json (file, purpose, placement, model, job_id, status, sha256). Never fabricate success or resubmit a job whose outcome is unknown. ${
    c.mcp
      ? `Higgsfield is configured via broker stdio: only PM calls media-request (${cli} media request --file <json>), with generation arguments PM wrote. After acceptance do not poll; continue other work or return, and the broker prompts this session with the result when it is idle.`
      : "Use the already installed/authenticated Higgsfield MCP directly. If it is missing or needs login, report the actual connection/auth error as one execution_choice question. Do not poll through repeated model turns."
  }

## Delivery
Deliver local source + localhost preview + user review. Do not deploy, publish a hosted Higgsfield website, or create source archives. Built-in tools, including web search and fetch, stay available. Use only the homepage-studio plugin, any configured skill files listed below and the Higgsfield MCP. Do not install other skills, plugins or servers. Do not repeat answered intake questions.
Higgsfield reference directories (read specific files only when a homepage-studio skill points to them; ignore their hosting, deployment and install steps):
${await higgsfieldReferences()}
${
  skills
    ? `
## Configured skill files
The operator configured these skill files; they follow in full. Resolve references relative to each source file. homepage-studio and its three tasks remain the workflow. User requirements and local delivery override skill hosting, installation, publication or extra-skill instructions.
${skills}
`
    : ""
}`;
  // homepage-orchestration.md is an operator copy; the PM reads the guide once,
  // inside pm-instructions.md, so the PM text never points at the copy.
  await atomic(guide, shared);
  return `You are the sole Herdr PM and the only Claude session that builds this homepage. Read the shared guide below; it is complete here, so do not open its copy homepage-orchestration.md. Load skill homepage-studio:homepage-studio first. Do not send team-create; this mode has no separate Herdr workers.
${shared}
PM broker protocol: call the broker only through the run's broker-cli wrapper (it already holds node, the CLI path and its fixed socket; it takes no --socket override). Shell commands below start with its shell-quoted path; paste them as written and replace only the <placeholder>: ${cli} report --file <JSON command file>. Call that path directly every time; do not keep a multi-word command in one shell variable (zsh does not split "$CLI"). Each dispatched task supplies pm-assignment.json with this PM's agent_id/token, and its task file has complete report envelopes for that assignment. Only PM uses its agent_id/token, project/run, task, attempt and assignment_id. Fresh command_id/event_id UUIDs for every new report and strictly increasing sequence, above the last one the broker accepted; resend an unchanged file (same command_id and content) only to re-check a report whose result you did not see. Kinds: plan (initial plan task only), progress/result, completed/result, failed/result, question/question_kind/question/response_schema. Question kinds: execution_choice, requirements_change, terminal_action.
Send plan directly after reading inputs: the three tasks from the skill (direction, first-screen, build-out), each with task_id, role, title, depends_on, writes. In claude-native runs any task may write under app/, assets/ or reports/; roles are display labels. Tasks are dispatched to this same PM one at a time; do only the current assignment. After a plan, completed or question report, return and wait for the next broker task.
Report milestones with progress: direction set, image job accepted/completed with the actual job ID, first screen visible, each look round result, preview ready. Do not send timer-based reports. The web UI shows only this PM's Herdr runtime and these reports.
PM alone starts preview: ${cli} preview start --file <json> with type preview-start and argv (program and arguments, {port} placeholder, bind 127.0.0.1), project/run and agent_id/token. Broker decides overall review_pending: every task completed, preview ready and this session idle.
`;
}
