import path from "node:path";
import fs from "node:fs/promises";
import { Config, roles, fail } from "../contracts/types.js";
import { atomic, realDirectory } from "../storage/store.js";

// Broker-owned metadata only. Never rewrite PRD/design, credentials or Claude settings.
export async function prepareRuntime(c: Config, directory: string) {
  if ((await fs.realpath(directory)) !== directory)
    fail("unsafe_path", "Symlink project refused");
  await realDirectory(path.join(directory, "app"));
  const runtime = {
    schema_version: 1,
    session: c.session,
    model: c.model,
    effort: c.effort,
    roles: [...roles],
    orchestration: {
      mode: "pm-led",
      bootstrap: "pm",
      team_request: "report:team-create",
      workers: ["developer", "designer"],
      max_agents: 3,
    },
    max_projects: c.maxProjects,
    start_mode: c.autoStart ? "queue" : "explicit",
    skills: c.skills,
    higgsfield: {
      transport: c.mcp ? "broker-stdio" : "claude-installed",
      credentials: "inherited-not-copied",
    },
    source: path.join(directory, "app"),
    preview: "localhost",
  };
  const file = path.join(directory, "homepage-runtime.json");
  await atomic(file, JSON.stringify(runtime, null, 2) + "\n");
  return { file, ...runtime };
}
