import fs from "node:fs/promises";
import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../src/config.js";
import { Herdr, Observer } from "../src/herdr/transport.js";
const c = await config();
const h = new Herdr(c);
const evidence: any = {
  at: new Date().toISOString(),
  scope: "Real Herdr; no model or media calls",
  session: "homepage",
  checks: [],
  resources: [],
};
const prefix = "homepage-broker-test-" + randomUUID().slice(0, 8);
const root = await fs.mkdtemp("/private/tmp/homepage-herdr-");
let workspace: string | undefined;
let observer: Observer | undefined;
try {
  evidence.runtime = await h.doctor();
  const before = await h.snapshot();
  const made = await h.cli([
    "workspace",
    "create",
    "--cwd",
    root,
    "--label",
    prefix,
    "--no-focus",
  ]);
  workspace = made.workspace.workspace_id;
  const panes = [made.root_pane];
  for (let i = 0; i < 2; i++) {
    const split = await h.cli([
      "pane",
      "split",
      made.root_pane.pane_id,
      "--direction",
      "down",
      "--cwd",
      root,
      "--no-focus",
    ]);
    assert.ok(split.pane);
    panes.push(split.pane);
  }
  const snapshot = await h.snapshot();
  assert.equal(
    snapshot.panes.filter((p: any) => p.workspace_id === workspace).length,
    3,
  );
  for (const p of panes) {
    assert.ok(
      snapshot.panes.some(
        (v: any) =>
          v.terminal_id === p.terminal_id &&
          v.pane_id === p.pane_id &&
          v.workspace_id === workspace,
      ),
    );
    evidence.resources.push({
      workspace_id: workspace,
      tab_id: p.tab_id,
      pane_id: p.pane_id,
      terminal_id: p.terminal_id,
    });
  }
  evidence.checks.push({
    id: "H01",
    status: "passed",
    detail: "3 real panes, CLI/API IDs agree",
  });
  let observations = 0,
    renamed = false;
  observer = new Observer(
    h,
    async (s) => {
      observations++;
      if (
        s.workspaces.some(
          (w: any) =>
            w.workspace_id === workspace && w.label === prefix + "-renamed",
        )
      )
        renamed = true;
    },
    () => {},
  );
  observer.start();
  const until = async (fn: () => boolean) => {
    const deadline = Date.now() + 8000;
    while (!fn()) {
      if (Date.now() > deadline) throw new Error("event observation timeout");
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  await until(() => observations > 0);
  await h.cli(["workspace", "rename", workspace!, prefix + "-renamed"]);
  await until(() => renamed);
  evidence.checks.push({
    id: "H02",
    status: "partial",
    detail:
      "Actual workspace rename event triggers snapshot; exit/move/auth states not tested",
  });
  observer.socket?.destroy();
  const count = observations;
  await until(() => observations > count);
  evidence.checks.push({
    id: "H03",
    status: "partial",
    detail: "Real observer reconnect and snapshot; server unchanged",
  });
  const after = await h.snapshot();
  for (const w of before.workspaces)
    assert.ok(
      after.workspaces.some(
        (v: any) => v.workspace_id === w.workspace_id && v.label === w.label,
      ),
    );
} finally {
  observer?.close();
  if (workspace) await h.cli(["workspace", "close", workspace]);
  await fs.rm(root, { recursive: true, force: true });
  evidence.cleanup = "Only owned test workspace removed";
  await fs.mkdir("docs/verification/implementation-20261006", {
    recursive: true,
  });
  await fs.writeFile(
    "docs/verification/implementation-20261006/herdr-live.json",
    JSON.stringify(evidence, null, 2),
  );
}
console.log(JSON.stringify(evidence, null, 2));
