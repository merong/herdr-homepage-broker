import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { fixture, cmd, FakeHerdr } from "./helpers.js";
import { Broker } from "../src/broker/broker.js";
import { request } from "../src/broker/client.js";
import { current, makeTask, report } from "../src/domain/engine.js";
import { brokerSocket } from "../src/config.js";
import { Store, recoverLock, hash } from "../src/storage/store.js";
import {
  Herdr,
  Lines,
  socketRequest,
  Observer,
} from "../src/herdr/transport.js";
import { Mcp } from "../src/media/mcp.js";
import { startPreview, stopPreview } from "../src/preview/manager.js";
const exec = promisify(execFile);
async function setup() {
  const f = await fixture();
  const h = new FakeHerdr(f.config);
  const b = new Broker(f.config, h);
  await b.start(false);
  clearInterval(b.timer);
  return {
    ...f,
    h,
    b,
    close: async () => {
      await b.close();
      await fs.rm(f.root, { recursive: true, force: true });
    },
  };
}
async function eventually(
  fn: () => boolean | Promise<boolean>,
  timeout = 5000,
) {
  const start = Date.now();
  while (!(await fn())) {
    if (Date.now() - start > timeout) throw new Error("condition timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
}
test("T04/T08 IPC deduplicates/conflicts and publishes consistent JSON without agent tokens", async () => {
  const f = await setup();
  try {
    const c = f.submit();
    const a = await request(brokerSocket(f.config), c);
    const b = await request(brokerSocket(f.config), c);
    assert.equal(a.run_id, b.run_id);
    await assert.rejects(
      () =>
        request(brokerSocket(f.config), {
          ...c,
          payload: { ...c.payload, directory: c.payload.directory + "-other" },
        }),
      /reused/,
    );
    assert.equal(Object.keys(f.b.store.state.projects).length, 1);
    const files = await Promise.all(
      ["meta", "task", "agents"].map(async (n) =>
        JSON.parse(
          await fs.readFile(
            path.join(c.payload.directory, n + ".json"),
            "utf8",
          ),
        ),
      ),
    );
    assert.equal(new Set(files.map((f) => f.revision)).size, 1);
    assert.equal(files[2].agents.length, 3);
    assert.equal(files[2].agents[0].token, undefined);
    assert.equal(f.h.calls.length, 0);
  } finally {
    await f.close();
  }
});
test("T05 exclusive writer lock and no PID-based takeover", async () => {
  const f = await setup();
  try {
    const second = new Store(f.config);
    await assert.rejects(() => second.acquire(), /lock exists/);
    await assert.rejects(() => recoverLock(f.config), /PID exists/);
  } finally {
    await f.close();
  }
});
test("T09 restart preserves requests but requires explicit resume; republishes missing projection", async () => {
  const f = await setup();
  try {
    await f.b.handle(f.submit());
    const p = f.b.store.state.projects.A;
    await fs.rm(path.join(p.directory, "agents.json"));
    await f.b.close();
    const next = new Broker(f.config, f.h);
    await next.start(false);
    clearInterval(next.timer);
    f.b = next;
    assert.equal(current(next.store.state.projects.A).resume_required, true);
    assert.equal(current(next.store.state.projects.A).status, "paused");
    assert.equal(
      JSON.parse(
        await fs.readFile(path.join(p.directory, "agents.json"), "utf8"),
      ).agents.length,
      3,
    );
    await next.handle(cmd("resume", next.store.state.projects.A));
    assert.equal(current(next.store.state.projects.A).status, "queued");
    assert.equal(next.status().projects[0].resume_required, false);
    assert.equal(next.status().projects[0].reason, undefined);
    const meta = JSON.parse(
      await fs.readFile(path.join(p.directory, "meta.json"), "utf8"),
    );
    assert.equal(meta.resume_required, false);
    assert.equal(meta.reason, null);
    await next.close();
  } finally {
    await fs.rm(f.root, { recursive: true, force: true });
  }
});
test("T11 byte fragmented UTF-8, multiplexed IDs, oversized frames and early close", async () => {
  const f = await fixture();
  const socket = path.join(f.root, "wire.sock");
  const server = net.createServer((s) => {
    s.once("data", (b) => {
      const req = JSON.parse(b.toString());
      const data = Buffer.from(
        JSON.stringify({ id: "unrelated", result: { type: "ignore" } }) +
          "\n" +
          JSON.stringify({
            id: req.id,
            result: { type: "pong", text: "한글" },
          }) +
          "\n",
      );
      for (const byte of data) s.write(Buffer.from([byte]));
    });
  });
  await new Promise<void>((r) => server.listen(socket, r));
  try {
    assert.equal((await socketRequest(socket, "ping")).text, "한글");
    const lines = new Lines(() => {}, 10);
    assert.throws(() => lines.push(Buffer.from("x".repeat(11))), /exceeds/);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await fs.rm(f.root, { recursive: true });
  }
});
test("T14/T31 scheduler reserves only two projects, third queued, with six role panes", async () => {
  const f = await setup();
  try {
    for (const id of ["A", "B", "C"]) await f.b.handle(f.submit(id));
    f.config.allowExecution = true;
    f.b.mcp = { connect: async () => {}, close: () => {} } as any;
    await f.b.tick();
    assert.equal(
      Object.values(f.b.store.state.projects).filter((p) => current(p).slot)
        .length,
      2,
    );
    await f.b.tick();
    await f.b.tick();
    const rs = Object.values(f.b.store.state.projects).map(current);
    assert.equal(rs[2].status, "queued");
    assert.equal(f.h.calls.filter((c) => c[0] === "workspace").length, 2);
    assert.equal(
      f.h.calls.filter((c) => c[0] === "agent" && c[1] === "start").length,
      6,
    );
    assert.equal(
      f.h.calls.filter((c) => c[0] === "agent" && c[1] === "prompt").length,
      2,
    );
    for (const r of rs.slice(0, 2))
      for (const a of r.agents) {
        assert.equal(a.herdr.session_name, "homepage");
        assert.ok(a.herdr.terminal_id);
        assert.ok(a.herdr.launch_argv.includes("claude-opus-5-5"));
        assert.ok(a.herdr.launch_argv.includes("high"));
      }
  } finally {
    await f.close();
  }
});
test("T15/T16 partial input waiting keeps independent task moving; full wait releases slot only after idle", async () => {
  const f = await setup();
  try {
    await f.b.handle(f.submit());
    const p = f.b.store.state.projects.A,
      r = current(p);
    r.status = "running";
    r.slot = true;
    r.tasks = [
      makeTask("design", "designer", "design", [], ["assets/"]),
      makeTask("build", "developer", "build", [], ["app/"]),
    ];
    r.tasks[0].status = "waiting_input";
    r.questions.push({
      request_id: "q",
      run_id: r.run_id,
      agent_id: r.agents[2].agent_id,
      task_id: "design",
      kind: "execution_choice",
      question: "logo?",
      response_schema: { type: "string" },
      status: "open",
    });
    for (const a of r.agents) {
      a.runtime = { status: "idle", fresh: true };
      a.herdr = {
        pane_id: a.role,
        terminal_id: a.role,
        workspace_id: "w",
        session_name: "homepage",
      };
      f.h.panes.push({ ...a.herdr, agent_status: "idle" });
    }
    r.herdr.workspace_id = "w";
    await f.b.save(p);
    await f.b.tick();
    assert.equal(r.tasks[1].status, "running");
    assert.equal(r.status, "running");
    r.tasks[1].status = "waiting_input";
    r.agents[1].task_id = null;
    await f.b.tick();
    assert.equal(r.status, "waiting_input");
    assert.equal(r.slot, false);
  } finally {
    await f.close();
  }
});
test("T21 cancellation closes only recorded matching panes and cannot be revived by report", async () => {
  const f = await setup();
  try {
    await f.b.handle(f.submit());
    f.config.allowExecution = true;
    f.b.mcp = { connect: async () => {}, close: () => {} } as any;
    await f.b.tick();
    await f.b.tick();
    const p = f.b.store.state.projects.A;
    f.h.panes.push({
      pane_id: "foreign",
      terminal_id: "x",
      workspace_id: "foreign",
      agent_status: "working",
    });
    await f.b.handle(cmd("cancel", p));
    await f.b.tick();
    assert.equal(current(f.b.store.state.projects.A).status, "cancelled");
    assert.equal(f.h.panes.length, 1);
    assert.equal(f.h.panes[0].pane_id, "foreign");
  } finally {
    await f.close();
  }
});
test("T22 unknown dispatch is durable and never blindly retried", async () => {
  const f = await setup();
  try {
    await f.b.handle(f.submit());
    f.config.allowExecution = true;
    f.b.mcp = { connect: async () => {}, close: () => {} } as any;
    await f.b.tick();
    await f.b.tick();
    f.h.failPrompt = true;
    await f.b.tick();
    const r = current(f.b.store.state.projects.A);
    assert.equal(r.status, "paused");
    assert.equal(r.operations.at(-1)?.status, "unknown");
    const n = f.h.calls.length;
    await f.b.tick();
    assert.equal(f.h.calls.length, n);
    await assert.rejects(
      () => f.b.handle(cmd("resume", f.b.store.state.projects.A)),
      (e: any) => e.code === "reconcile_required",
    );
  } finally {
    await f.close();
  }
});
test("T24/T25 actual stdio MCP protocol; lost generation receipt does not generate again", async () => {
  const f = await setup();
  try {
    const calls = path.join(f.root, "calls");
    f.config.mcp = {
      command: process.execPath,
      args: [path.resolve("tests/fixtures/mcp-server.mjs")],
      env: { CALLS_FILE: calls },
      generateTool: "generate",
      statusTool: "status",
      jobIdPath: "job_id",
      statusPath: "status",
      assetPath: "asset",
      statusArgument: "job_id",
    };
    f.b.mcp = new Mcp(f.config.mcp);
    await f.b.handle(f.submit());
    const p = f.b.store.state.projects.A,
      r = current(p);
    r.status = "running";
    const c = cmd("media-request", p, { arguments: { disconnect: true } });
    await assert.rejects(() => f.b.handle(c), /disconnected/);
    await assert.rejects(() => f.b.handle(c), /reconciliation/);
    assert.equal((await fs.readFile(calls, "utf8")).trim(), "generate");
    assert.equal(r.operations.at(-1)?.status, "unknown");
  } finally {
    await f.close();
  }
});
test("T26/T27 owned preview uses real HTTP and process identity, PID reuse refuses stop", async () => {
  const f = await setup();
  let r: any;
  try {
    await f.b.handle(f.submit());
    const p = f.b.store.state.projects.A;
    r = current(p);
    await fs.copyFile(
      "tests/fixtures/preview.mjs",
      path.join(p.directory, "app/server.mjs"),
    );
    await startPreview(p, r, [process.execPath, "server.mjs", "{port}"], () =>
      f.b.save(p),
    );
    assert.equal(r.preview.status, "ready");
    assert.match(
      await (await fetch(r.preview.url)).text(),
      /homepage preview fixture/,
    );
    const original = r.preview.process_start;
    r.preview.process_start = "different start";
    await assert.rejects(() => stopPreview(r.preview), /reused/);
    r.preview.process_start = original;
    await stopPreview(r.preview);
    assert.equal(r.preview.status, "stopped");
  } finally {
    if (r?.preview.pid)
      try {
        await stopPreview(r.preview);
      } catch {}
    await f.close();
  }
});
test("T29 feedback creates exactly one run and keeps old snapshots", async () => {
  const f = await setup();
  try {
    await f.b.handle(f.submit());
    const p = f.b.store.state.projects.A;
    const old = current(p);
    old.status = "review_pending";
    const c = cmd("feedback", p, {
      inputs: f.inputs,
      feedback: "회사 소개 섹션 추가",
    });
    const first = await f.b.handle(c);
    const second = await f.b.handle(c);
    assert.equal(first.run_id, second.run_id);
    const live = f.b.store.state.projects.A;
    assert.equal(live.runs.length, 2);
    assert.equal(
      hash(await fs.readFile(live.runs[0].inputs.prd.path)),
      f.inputs.prd.sha256,
    );
    assert.notEqual(live.runs[0].run_id, live.runs[1].run_id);
  } finally {
    await f.close();
  }
});
test("T06 real broker process killed after committed receipt; stale-lock recovery and projection rebuild", async () => {
  const f = await fixture();
  const configFile = path.join(f.root, "config.json");
  await fs.writeFile(configFile, JSON.stringify(f.config));
  const child = spawn(
    process.execPath,
    ["dist/src/cli.js", "broker", "start", "--config", configFile],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stderr.resume();
  const socket = brokerSocket(f.config);
  try {
    await eventually(async () => {
      try {
        await fs.stat(socket);
        return true;
      } catch {
        return false;
      }
    });
    const c = f.submit();
    const res = await request(socket, c);
    assert.ok(res.run_id);
    child.kill("SIGKILL");
    await new Promise((r) => child.once("exit", r));
    await recoverLock(f.config);
    const b = new Broker(f.config, new FakeHerdr(f.config));
    await b.start(false);
    clearInterval(b.timer);
    try {
      const replay = await b.handle(c);
      assert.equal(replay.run_id, res.run_id);
      assert.equal(current(b.store.state.projects.A).resume_required, true);
    } finally {
      await b.close();
    }
  } finally {
    if (child.exitCode === null && !child.killed) child.kill("SIGKILL");
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

test("T10 real execFile forwards argv literally and isolates Herdr environment", async () => {
  const f = await fixture();
  try {
    const bin = path.join(f.root, "fake-herdr");
    await fs.writeFile(
      bin,
      `#!${process.execPath}\nconsole.log(JSON.stringify({result:{argv:process.argv.slice(2),session:process.env.HERDR_SESSION,config:process.env.HERDR_CONFIG_PATH,pane:process.env.HERDR_PANE_ID??null}}));\n`,
      { mode: 0o700 },
    );
    f.config.herdrBin = bin;
    const injected = "한글 path $(touch /tmp/SHOULD_NOT_RUN) ; \\n";
    const result = await new Herdr(f.config).cli([
      "workspace",
      "create",
      "--label",
      injected,
    ]);
    assert.deepEqual(result.argv, [
      "--session",
      "homepage",
      "workspace",
      "create",
      "--label",
      injected,
    ]);
    assert.equal(result.session, "homepage");
    assert.equal(result.config, path.join(f.root, "config.toml"));
    assert.equal(result.pane, null);
  } finally {
    await fs.rm(f.root, { recursive: true });
  }
});

test("T24 successful MCP job is polled by broker and linked to the run", async () => {
  const f = await setup();
  try {
    f.config.mcp = {
      command: process.execPath,
      args: [path.resolve("tests/fixtures/mcp-server.mjs")],
      generateTool: "generate",
      statusTool: "status",
      jobIdPath: "job_id",
      statusPath: "status",
      assetPath: "asset",
      statusArgument: "job_id",
    };
    f.b.mcp = new Mcp(f.config.mcp);
    await f.b.handle(f.submit());
    const p = f.b.store.state.projects.A;
    current(p).status = "running";
    await f.b.handle(
      cmd("media-request", p, { arguments: { prompt: "fixture" } }),
    );
    await f.b.handle(cmd("media-status", f.b.store.state.projects.A));
    const r = current(f.b.store.state.projects.A);
    assert.equal(r.media[0].status, "succeeded");
    assert.equal(r.media[0].job_id, "fixture-job-1");
    assert.equal(r.operations[0].status, "settled");
  } finally {
    await f.close();
  }
});

test("T12 reused terminal ID pauses run and prevents foreign pane cancellation", async () => {
  const f = await setup();
  try {
    await f.b.handle(f.submit());
    const p = f.b.store.state.projects.A,
      r = current(p);
    r.status = "running";
    r.slot = true;
    r.herdr.workspace_id = "own";
    const a = r.agents[0];
    a.herdr = {
      pane_id: "p1",
      terminal_id: "original",
      workspace_id: "own",
      started: true,
    };
    f.h.panes.push({
      pane_id: "p1",
      terminal_id: "replacement",
      workspace_id: "own",
      agent_status: "idle",
    });
    await f.b.observe(await f.h.snapshot());
    assert.equal(r.status, "paused");
    assert.equal(a.runtime.fresh, false);
    await f.b.handle(cmd("cancel", p));
    await f.b.tick();
    assert.equal(
      f.h.calls.filter((x) => x[0] === "pane" && x[1] === "close").length,
      0,
    );
    assert.notEqual(current(f.b.store.state.projects.A).status, "cancelled");
  } finally {
    await f.close();
  }
});

test("T29 replacement closes old three agents before any new role starts", async () => {
  const f = await setup();
  try {
    await f.b.handle(f.submit());
    f.config.allowExecution = true;
    f.b.mcp = { connect: async () => {}, close: () => {} } as any;
    await f.b.tick();
    await f.b.tick();
    const p = f.b.store.state.projects.A;
    current(p).status = "review_pending";
    current(p).slot = false;
    assert.equal(f.h.panes.length, 3);
    await f.b.handle(
      cmd("feedback", p, { inputs: f.inputs, feedback: "revise" }),
    );
    assert.equal(f.h.panes.length, 0);
    assert.ok(
      f.b.store.state.projects.A.runs[0].agents.every(
        (a) => a.status === "stopped",
      ),
    );
    await f.b.tick();
    await f.b.tick();
    assert.equal(f.h.panes.length, 3);
  } finally {
    await f.close();
  }
});

test("T05 execution ownership is shared by state roots targeting one homepage session", async () => {
  const f = await fixture();
  f.config.allowExecution = true;
  const a = new Store(f.config);
  const b = new Store({ ...f.config, stateRoot: path.join(f.root, "second") });
  try {
    await a.acquire();
    await assert.rejects(() => b.acquire(), /execution broker|owns/i);
    assert.ok(await fs.stat(a.executionLock));
    await a.release();
  } finally {
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

test("T07 storage failure poisons writer and cannot accept subsequent commits", async () => {
  const f = await fixture();
  const s = new Store(f.config);
  try {
    await s.acquire();
    await fs.mkdir(path.join(s.dir, "broker-checkpoint.json"));
    await assert.rejects(
      () => s.commit(structuredClone(s.state)),
      (e: any) => e.code === "storage_unknown",
    );
    assert.equal(s.failed, true);
    await assert.rejects(
      () => s.commit(structuredClone(s.state)),
      /Writer stopped/,
    );
    await s.release();
  } finally {
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

test("MCP missing tool never becomes a usable generation connection", async () => {
  const cfg = {
    command: process.execPath,
    args: [path.resolve("tests/fixtures/mcp-server.mjs")],
    generateTool: "missing",
    statusTool: "status",
    jobIdPath: "job_id",
    statusPath: "status",
    assetPath: "asset",
    statusArgument: "job_id",
  };
  const mcp = new Mcp(cfg);
  try {
    await assert.rejects(
      () => mcp.connect(),
      (e: any) => e.code === "mcp_tool_missing",
    );
    assert.equal(mcp.ready, false);
    await assert.rejects(() => mcp.generate({ prompt: "not sent" }));
  } finally {
    mcp.close();
  }
});

test("Herdr stderr keeps definitive validation errors and startup uncertainty distinct", async () => {
  const f = await fixture();
  try {
    const bin = path.join(f.root, "refusing-herdr");
    f.config.herdrBin = bin;
    for (const code of ["invalid_agent_name", "agent_not_ready"]) {
      await fs.writeFile(
        bin,
        `#!${process.execPath}\nconsole.error(JSON.stringify({error:{code:${JSON.stringify(code)},message:"fixture refusal"}}));process.exit(1);\n`,
        { mode: 0o700 },
      );
      await assert.rejects(
        () => new Herdr(f.config).cli(["agent", "start"]),
        (e: any) => e.code === code,
      );
    }
  } finally {
    await fs.rm(f.root, { recursive: true, force: true });
  }
});
