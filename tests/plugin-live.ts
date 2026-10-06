import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { config, brokerSocket, stateDir } from "../src/config.js";
import { Herdr } from "../src/herdr/transport.js";
import { request } from "../src/broker/client.js";
const exec = promisify(execFile);
const root = await fs.mkdtemp("/private/tmp/hp-plugin-");
const id = "homepage-test-" + randomUUID().slice(0, 8);
const cfg = path.join(root, "config.json");
await fs.writeFile(
  cfg,
  JSON.stringify({ stateRoot: root, allowExecution: false, web: { port: 0 } }),
);
const c = await config(cfg);
const cli = path.resolve("dist/src/cli.js");
const args = [process.execPath, cli];
const tomlArgs = (args: string[]) => JSON.stringify(args);
await fs.writeFile(
  path.join(root, "herdr-plugin.toml"),
  `id = "${id}"\nname = "Homepage broker test"\nversion = "0.1.0"\nmin_herdr_version = "0.8.0"\nplatforms = ["macos"]\n[[actions]]\nid = "start"\ntitle = "Start test broker"\ncommand = ${tomlArgs([...args, "plugin", "start", "--config", cfg])}\n[[panes]]\nid = "board"\ntitle = "Homepage jobs test"\nplacement = "split"\ncommand = ${tomlArgs([...args, "board", "--config", cfg])}\n`,
);
const h = new Herdr(c);
let workspace: string | undefined;
let linked = false;
const evidence: any = {
  at: new Date().toISOString(),
  session: "homepage",
  plugin_id: id,
  model_calls: 0,
  checks: [],
};
const until = async (fn: () => Promise<boolean>) => {
  const end = Date.now() + 12000;
  while (!(await fn())) {
    if (Date.now() > end) throw new Error("Plugin readiness timed out");
    await new Promise((r) => setTimeout(r, 100));
  }
};
try {
  await exec(c.herdrBin, ["--session", "homepage", "plugin", "link", root]);
  linked = true;
  const made = await h.cli([
    "workspace",
    "create",
    "--cwd",
    root,
    "--label",
    id,
    "--focus",
  ]);
  workspace = made.workspace.workspace_id;
  await h.cli(["plugin", "action", "invoke", "start", "--plugin", id]);
  await until(async () => {
    try {
      await request(brokerSocket(c), {
        schema_version: 1,
        command_id: randomUUID(),
        type: "status",
        payload: {},
      });
      return true;
    } catch {
      return false;
    }
  });
  const result = await h.cli([
    "plugin",
    "pane",
    "open",
    "--plugin",
    id,
    "--entrypoint",
    "board",
    "--placement",
    "split",
    "--target-pane",
    made.root_pane.pane_id,
    "--focus",
  ]);
  const snap = await h.snapshot();
  const board = snap.panes.find(
    (p: any) =>
      p.workspace_id === workspace && p.pane_id !== made.root_pane.pane_id,
  );
  assert.ok(board);
  let text = "";
  await until(async () => {
    const read = await exec(c.herdrBin, [
      "--session",
      "homepage",
      "pane",
      "read",
      board.pane_id,
      "--source",
      "visible",
      "--lines",
      "30",
    ]);
    text = read.stdout;
    return text.includes("HOMEPAGE");
  });
  evidence.checks.push({
    id: "H05",
    status: "partial",
    detail:
      "Real plugin link, guarded start action, broker IPC, board pane and terminal text; input/actions not exercised",
    board_pane: board.pane_id,
  });
} finally {
  if (workspace) await h.cli(["workspace", "close", workspace]);
  try {
    const owner = JSON.parse(
      await fs.readFile(path.join(stateDir(c), "lock/owner.json"), "utf8"),
    );
    process.kill(owner.pid, "SIGTERM");
    await until(async () => {
      try {
        await fs.stat(path.join(stateDir(c), "lock"));
        return false;
      } catch {
        return true;
      }
    });
  } catch (e) {
    evidence.cleanup_error = String(e);
  }
  if (linked)
    await exec(c.herdrBin, ["--session", "homepage", "plugin", "unlink", id]);
  await fs.rm(root, { recursive: true, force: true });
  evidence.cleanup = "Only test plugin/workspace/broker removed";
  await fs.mkdir("docs/verification/implementation-20261006", {
    recursive: true,
  });
  await fs.writeFile(
    "docs/verification/implementation-20261006/plugin-live.json",
    JSON.stringify(evidence, null, 2),
  );
}
console.log(JSON.stringify(evidence, null, 2));
