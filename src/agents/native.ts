import fs from "node:fs/promises";
import path from "node:path";
import { Config, Project, Run, fail } from "../contracts/types.js";
import { atomic, realDirectory } from "../storage/store.js";
import { brokerSocket } from "../config.js";
import { fileURLToPath } from "node:url";

// Files are loaded before Claude starts; long instructions never enter its argv.
export async function nativePrompt(
  c: Config,
  p: Project,
  r: Run,
  skills: string,
) {
  const dir = path.join(p.directory, ".herdr/runs", r.run_id);
  const guide = path.join(dir, "homepage-orchestration.md");
  const marker = "<!-- Managed by herdr-homepage-broker -->";
  const agentsDir = await realDirectory(
    path.join(p.directory, ".claude/agents"),
  );
  const definitions = ["developer", "designer"].map((role) => ({
    file: path.join(agentsDir, `homepage-${role}.md`),
    text: `---\nname: homepage-${role}\ndescription: Homepage ${role} working inside the PM session.\nmodel: inherit\neffort: high\n---\n${marker}\nYou are the homepage ${role}. First read ${JSON.stringify(guide)} in full, including immutable inputs and selected skill excerpts. Work only on PM's delegated scope and return actual evidence to PM. Never read assignment capability files or submit broker commands. Do not create Herdr panes, separate model sessions or more agents. You share the project with PM; preserve others' work.\n`,
  }));
  for (const { file } of definitions) {
    try {
      if ((await fs.lstat(file)).isSymbolicLink())
        fail("unsafe_path", "Refuse symlink agent definition");
      if (!(await fs.readFile(file, "utf8")).includes(marker))
        fail(
          "agent_definition_conflict",
          `기존 사용자 에이전트 파일을 덮어쓸 수 없습니다: ${file}`,
        );
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  const shared = `# Homepage: one Herdr PM with Claude native agents

Execution mode: claude-native. Exactly one Herdr pane and one main Claude session (PM). This execution instruction supersedes older PRD/design wording about three Herdr panes; product requirements stay authoritative. Model: Claude Opus 5.5 high effort. Internal helpers inherit the PM model and high effort. PM may use homepage-developer and homepage-designer via Claude's native Agent tool when useful, or implement directly. At most two internal helpers at a time is a workflow instruction, not a broker-enforced Claude concurrency limit. No extra Herdr panes, independent/background Claude sessions or agent teams. No separate QA role or repeated QA loops.

Read immutable PRD ${r.inputs.prd.path} and design ${r.inputs.design.path}. Never edit originals or snapshots. ${r.feedback ? "Feedback: " + r.feedback : ""}
Source: ${path.join(p.directory, "app")}; assets: ${dir}/assets/; reports: ${dir}/reports/. Developer handles source; designer handles assets and design handoff. PM can implement directly within the current task write boundary. Helpers return results to PM; they never read *-assignment.json, send broker commands or edit meta.json, task.json, agents.json or checkpoint. PM alone reports state through broker CLI.

Deliver local source + localhost preview + user review. Do not deploy, publish a hosted Higgsfield website, or create source archives. Use only selected homepage skills and Higgsfield MCP. Do not install other skills or servers. Follow PRD image count and paid submission budget across all helpers, not per helper. PM chooses one image owner and prevents duplicate submissions. Save actual provider job IDs, status, output paths and hashes in ${dir}/assets/media-receipts.json. Do not fabricate success or resubmit an unknown job outcome. ${
    c.mcp
      ? "Higgsfield is configured via broker stdio: the designer returns proposed image arguments to PM. Only PM calls media-request. After acceptance PM returns without polling; the broker notifies PM when finished."
      : "Use the already installed/authenticated Higgsfield MCP, normally via homepage-designer; PM may use it directly. Return actual connection/auth errors to PM. Do not repeatedly poll through model turns."
  }

Selected homepage skill excerpts follow. Resolve references relative to each source file. User requirements and local delivery override skill hosting, installation, publication or extra-skill instructions. Do not repeat answered intake questions.
${skills}
`;
  await atomic(guide, shared);
  for (const { file, text } of definitions) await atomic(file, text);
  return `You are the sole Herdr PM and main Claude orchestrator. Read the shared guide below. Native Agent/Task/Skill features remain available. Use homepage-developer/homepage-designer as needed. Do not send team-create; this mode has no separate Herdr workers.
${shared}
PM broker protocol: CLI ${process.execPath} ${fileURLToPath(new URL("../cli.js", import.meta.url))}; socket ${brokerSocket(c)}. Each dispatched task supplies pm-assignment.json. Only PM uses its agent_id/token, project/run, task, attempt and assignment_id. Send report --file <JSON command file>; fresh command_id/event_id UUIDs and strictly increasing sequence. Kinds: plan (initial plan task only), progress/result, completed/result, failed/result, question/question_kind/question/response_schema. Question kinds: execution_choice, requirements_change, terminal_action.
Send plan directly after reading inputs. Tasks contain task_id, role, title, depends_on, writes. Logical roles keep their boundaries: developer app/, designer assets/, pm reports/. All logical tasks are dispatched to this same PM, one assignment at a time. Delegate only the current assignment and consolidate helper results yourself. Wait for all internal helpers to finish (or stop them and confirm they stopped) before completed/failed/question reports; background helpers must not outlive an assignment. After plan/completed/question report, return and wait for the next broker task.
Report meaningful milestones: delegation started/completed, image job accepted/completed, source integrated, preview ready. Include helper name and actual job ID where relevant. Web UI observes only PM Herdr runtime and these reports, not internal helper runtime; do not invent helper pane IDs or send timer-based reports.
PM alone starts preview: preview-start with argv (program and arguments, {port} placeholder, bind 127.0.0.1), project/run and agent_id/token. Minimal final verification only. Broker decides overall review_pending. Shared guide: ${guide}.
`;
}
