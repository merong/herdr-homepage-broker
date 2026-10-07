import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Config, Project, Run } from "../contracts/types.js";
import { atomic } from "../storage/store.js";
import { brokerSocket, claudeRoot } from "../config.js";

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
  const check = path.join(
    plugin.path,
    "skills/quality-gate/scripts/check_page.py",
  );
  const shared = `# Homepage: one Herdr PM with homepage-studio helpers

Execution mode: claude-native. Exactly one Herdr pane and one main Claude session (PM). This execution instruction supersedes older PRD/design wording about three Herdr panes; product requirements stay authoritative. Model: Claude Opus 5.5 high effort. Helpers inherit the PM model and high effort. No extra Herdr panes, independent/background Claude sessions, agent teams or separate QA agent.

## homepage-studio plugin
Loaded for this session from ${plugin.path} (version ${plugin.version}); skill reference files resolve under ${plugin.path}/skills/<skill>/. PM loads skill homepage-studio:homepage-studio first and follows its stage order and artifact paths. Other skills: homepage-studio:frontend-design, homepage-studio:korean-copywriting, homepage-studio:korean-typography, homepage-studio:asset-kit, homepage-studio:quality-gate, homepage-studio:seo-basics.
Helpers via Claude's native Agent tool, when useful (PM may also work directly): homepage-studio:homepage-copywriter (reports/research.md, reports/copy-deck.md), homepage-studio:homepage-designer (assets/), homepage-studio:homepage-developer (app/). At most two helpers at a time is a workflow instruction, not a broker-enforced Claude concurrency limit. Every delegation message includes this run guide path: ${guide}.

## Inputs and paths
Read immutable PRD ${r.inputs.prd.path} and design ${r.inputs.design.path}. Never edit originals or snapshots. ${r.feedback ? "Feedback: " + r.feedback : ""}
Source app/: ${path.join(p.directory, "app")}. Skill artifact paths reports/... and assets/... resolve under the run directory ${dir}: reports ${dir}/reports/, assets ${dir}/assets/. Helpers return results to PM; they never read *-assignment.json, send broker commands or edit meta.json, task.json, agents.json or checkpoint. PM alone reports state through broker CLI.

## Quality gate
Run homepage-studio:quality-gate once after the build, against the running localhost preview: python3 ${check} <preview URL> ${dir}/reports/auto-check (writes reports/auto-check/auto-check.json and screenshots), then one PM self-check written to reports/self-check.md, then at most one fix pass. After the fix pass the close task may run the same script once more into ${dir}/reports/auto-check/final as final evidence only; it starts no further fixes. Apart from that single final capture: no separate QA agent and no repeated check or fix loops.

## Media budget
If the PRD states explicit image or video counts, the PRD wins. Otherwise the build uses at most 12 images plus 1 hero video in total, including a logo draft when no logo is supplied. The budget covers PM and all helpers together, not each helper. PM chooses one image owner and prevents duplicate submissions. Save actual provider job IDs, status, output paths and hashes in ${dir}/assets/media-receipts.json. Do not fabricate success or resubmit an unknown job outcome. ${
    c.mcp
      ? "Higgsfield is configured via broker stdio: the designer returns proposed image arguments to PM. Only PM calls media-request. After acceptance PM returns without polling; the broker notifies PM when finished."
      : "Use the already installed/authenticated Higgsfield MCP, normally via homepage-studio:homepage-designer; PM may use it directly. Return actual connection/auth errors to PM. Do not repeatedly poll through model turns."
  }

## Delivery
Deliver local source + localhost preview + user review. Do not deploy, publish a hosted Higgsfield website, or create source archives. Built-in tools, including web search and fetch for research, stay available. Use only the homepage-studio plugin, any configured skill files listed below and the Higgsfield MCP. Do not install other skills, plugins or servers. Do not repeat answered intake questions.
Higgsfield reference directories (read specific files only when a homepage-studio skill points to them; ignore their hosting, deployment and install steps):
${await higgsfieldReferences()}
${
  skills
    ? `
## Configured skill files
The operator configured these skill files; they follow in full. Resolve references relative to each source file. homepage-studio stage order and artifacts remain the workflow. User requirements and local delivery override skill hosting, installation, publication or extra-skill instructions.
${skills}
`
    : ""
}`;
  await atomic(guide, shared);
  return `You are the sole Herdr PM and main Claude orchestrator. Read the shared guide below. Native Agent/Task/Skill features remain available. Load skill homepage-studio:homepage-studio first. Use homepage-studio:homepage-copywriter, homepage-studio:homepage-designer and homepage-studio:homepage-developer as needed, and include the run guide path ${guide} in every delegation message. Do not send team-create; this mode has no separate Herdr workers.
${shared}
PM broker protocol: CLI ${process.execPath} ${fileURLToPath(new URL("../cli.js", import.meta.url))}; socket ${brokerSocket(c)}. Each dispatched task supplies pm-assignment.json. Only PM uses its agent_id/token, project/run, task, attempt and assignment_id. Send report --file <JSON command file>; fresh command_id/event_id UUIDs and strictly increasing sequence. Kinds: plan (initial plan task only), progress/result, completed/result, failed/result, question/question_kind/question/response_schema. Question kinds: execution_choice, requirements_change, terminal_action.
Send plan directly after reading inputs. Tasks contain task_id, role, title, depends_on, writes. Logical roles keep their boundaries: developer app/, designer assets/, pm reports/. Map studio stages onto them: research, design brief, copy deck and the quality-gate self-check are pm tasks (reports/); the asset kit is a designer task (assets/); the build and the single fix pass are developer tasks (app/). All logical tasks are dispatched to this same PM, one assignment at a time. Delegate only the current assignment and consolidate helper results yourself. Wait for all internal helpers to finish (or stop them and confirm they stopped) before completed/failed/question reports; background helpers must not outlive an assignment. After plan/completed/question report, return and wait for the next broker task.
Report meaningful milestones: delegation started/completed, image job accepted/completed, source integrated, preview ready. Include helper name and actual job ID where relevant. Web UI observes only PM Herdr runtime and these reports, not internal helper runtime; do not invent helper pane IDs or send timer-based reports.
PM alone starts preview: preview-start with argv (program and arguments, {port} placeholder, bind 127.0.0.1), project/run and agent_id/token. Start the preview before the quality-gate task and keep it serving the final source. Broker decides overall review_pending. Shared guide: ${guide}.
`;
}
