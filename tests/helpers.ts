import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Config, Command } from "../src/contracts/types.js";
import { hash } from "../src/storage/store.js";
import { Herdr } from "../src/herdr/transport.js";
export async function fixture() {
  const root = await fs.mkdtemp("/private/tmp/hp-");
  const config: Config = {
    stateRoot: root,
    projectsRoot: path.join(root, "projects"),
    session: "homepage",
    herdrBin: "herdr",
    socketPath: path.join(root, "sessions/homepage/herdr.sock"),
    model: "claude-opus-5-5",
    effort: "high",
    maxProjects: 2,
    maxPreviews: 2,
    skills: [],
    allowExecution: false,
    web: { enabled: false, port: 0 },
  };
  await fs.writeFile(path.join(root, "prd.md"), "회사 홈페이지 요구사항 v1");
  await fs.writeFile(path.join(root, "design.md"), "레이아웃·이미지·모션");
  const inputs = {
    prd: {
      path: path.join(root, "prd.md"),
      sha256: hash(await fs.readFile(path.join(root, "prd.md"))),
    },
    design: {
      path: path.join(root, "design.md"),
      sha256: hash(await fs.readFile(path.join(root, "design.md"))),
    },
  };
  return {
    root,
    config,
    inputs,
    submit: (id = "A"): Command => ({
      schema_version: 1,
      command_id: randomUUID(),
      type: "submit",
      project_id: id,
      payload: { directory: path.join(root, "projects", id), inputs },
    }),
  };
}
export const cmd = (type: string, p: any, payload: any = {}): Command => ({
  schema_version: 1,
  command_id: randomUUID(),
  type,
  project_id: p.project_id,
  run_id: p.current_run_id,
  payload,
});
export class FakeHerdr extends Herdr {
  calls: string[][] = [];
  panes: any[] = [];
  workspaces: any[] = [];
  counter = 0;
  failPrompt = false;
  async api() {
    return { type: "workspace_metadata_updated" };
  }
  async doctor() {
    return {
      version: "test-double",
      protocol: 19,
      session: "homepage",
      socket: this.config.socketPath,
    };
  }
  async snapshot() {
    return {
      panes: this.panes,
      agents: this.panes,
      workspaces: this.workspaces,
    };
  }
  async cli(args: string[]) {
    this.calls.push(args);
    const n = ++this.counter;
    if (args[0] === "workspace" && args[1] === "create") {
      const workspace_id = "w" + n;
      const pane = {
        workspace_id,
        pane_id: workspace_id + ":p1",
        terminal_id: "term" + n,
        tab_id: workspace_id + ":t1",
        agent_status: "idle",
        interactive_ready: true,
      };
      const workspace = {
        workspace_id,
        label: args[args.indexOf("--label") + 1],
      };
      this.panes.push(pane);
      this.workspaces.push(workspace);
      return { workspace, root_pane: pane };
    }
    if (args[0] === "pane" && args[1] === "split") {
      const root = this.panes.find((x) => x.pane_id === args[2]);
      const pane = {
        ...root,
        pane_id: root.workspace_id + ":p" + n,
        terminal_id: "term" + n,
      };
      this.panes.push(pane);
      return { pane };
    }
    if (args[0] === "agent" && args[1] === "start")
      return {
        agent: this.panes.find(
          (x) => x.pane_id === args[args.indexOf("--pane") + 1],
        ),
        argv: args.slice(args.indexOf("--") + 1),
      };
    if (args[0] === "agent" && args[1] === "prompt") {
      if (this.failPrompt) throw new Error("provider accepted but reply lost");
      return { agent: this.panes.find((x) => x.pane_id === args[2]) };
    }
    if (args[0] === "pane" && args[1] === "close") {
      this.panes = this.panes.filter((x) => x.pane_id !== args[2]);
      return { type: "pane_closed" };
    }
    throw new Error("Unhandled fake CLI " + args.slice(0, 2));
  }
}
