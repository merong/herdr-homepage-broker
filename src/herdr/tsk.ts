import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Config, Project, Run } from "../contracts/types.js";
const exec = promisify(execFile);
export async function syncTsk(c: Config, p: Project, r: Run) {
  if (!c.tsk) return;
  const env = { ...process.env, TSK_STATE_DIR: c.tsk.stateDir };
  const title = `[${p.project_id}/${r.run_id}] 홈페이지 제작`;
  const result = await exec(
    c.tsk.binary,
    ["add", "-t", title, "-p", p.directory, "--thread", "homepage", "--json"],
    { env, timeout: 5000, maxBuffer: 1024 * 1024 },
  );
  const task = JSON.parse(result.stdout);
  const status =
    r.status === "review_pending"
      ? "review"
      : r.status === "queued"
        ? "ready"
        : ["running", "starting", "retrying"].includes(r.status)
          ? "started"
          : "blocked";
  await exec(c.tsk.binary, ["status", task.id, status], { env, timeout: 5000 });
  return { id: task.id, number: task.number, status };
}
