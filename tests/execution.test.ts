import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Broker } from "../src/broker/broker.js";
import { current } from "../src/domain/engine.js";
import { fixture, pmReport, FakeHerdr, cmd, legacyTeam } from "./helpers.js";
import { studio } from "../src/agents/studio.js";
async function setup(ready: boolean | "native" = true) {
  const f = await fixture();
  f.config.autoStart = false;
  f.config.web = { enabled: true, port: 0 };
  if (ready) {
    const skill = path.join(f.root, "SKILL.md");
    await fs.writeFile(skill, "# Fixture homepage skill\nLocal source only.");
    f.config.skills = [skill];
    f.config.allowExecution = true;
    if (ready !== "native")
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
  }
  const h = new FakeHerdr(f.config),
    b = new Broker(f.config, h);
  await b.start(false);
  clearInterval(b.timer);
  await b.handle(f.submit());
  const url = b.dashboard!.url!;
  const csrf = (await (await fetch(url + "/api/bootstrap")).json()).csrf;
  const input = (action = "start") => ({
    project_id: "A",
    run_id: b.status().projects[0].run_id,
    action,
    command_id: randomUUID(),
  });
  const send = (value: any, token = csrf, origin = url) =>
    fetch(url + "/api/projects/execute", {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "X-Homepage-Token": token,
      },
      body: JSON.stringify(value),
    });
  const readiness = async () =>
    (await fetch(url + "/api/projects/A/execution")).json();
  return {
    ...f,
    b,
    h,
    url,
    csrf,
    input,
    send,
    readiness,
    close: async () => {
      await b.close();
      await fs.rm(f.root, { recursive: true, force: true });
    },
  };
}
test("E01 web execution readiness reports disabled configuration and refuses dispatch", async () => {
  const f = await setup(false);
  try {
    const before = JSON.stringify(f.b.store.state);
    const check = await f.readiness();
    assert.equal(check.action, "start");
    assert.equal(check.ready, false);
    assert.deepEqual(
      check.checks.map((c: any) => c.code),
      ["documents_ready", "plugin_ready"],
    );
    assert.equal(check.checks[0].ok, true);
    assert.equal(check.checks[1].ok, false);
    assert.equal(JSON.stringify(f.b.store.state), before);
    const response = await f.send(f.input());
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, "execution_not_ready");
    assert.equal(JSON.stringify(f.b.store.state), before);
    assert.equal(f.h.calls.length, 0);
  } finally {
    await f.close();
  }
});
test("E02 real HTTP to CLI start deduplicates and starts only the PM", async () => {
  const f = await setup();
  try {
    const before = f.b.status().projects[0],
      seq = current(f.b.store.state.projects.A).queue_seq;
    assert.equal((await f.readiness()).ready, true);
    assert.equal(
      f.b.mcp!.ready,
      false,
      "readiness does not connect MCP or launch a model",
    );
    const command = f.input();
    const responses = await Promise.all([f.send(command), f.send(command)]);
    for (const res of responses) {
      assert.equal(res.status, 200);
      const result = await res.json();
      assert.equal(result.transport, "broker-cli");
      assert.equal(result.status, "queued");
      assert.equal(result.run_id, before.run_id);
    }
    assert.equal(f.b.mcp!.ready, true);
    assert.equal(
      current(f.b.store.state.projects.A).queue_seq,
      seq,
      "start preserves FIFO ordering",
    );
    await f.b.tick();
    await f.b.tick();
    assert.equal(
      f.h.calls.filter((c) => c[0] === "workspace" && c[1] === "create").length,
      1,
    );
    assert.equal(
      f.h.calls.filter((c) => c[0] === "agent" && c[1] === "start").length,
      1,
    );
    const start = f.h.calls.find((c) => c[0] === "agent" && c[1] === "start")!;
    assert.equal(start.includes("--disallowedTools"), false);
    assert.equal(start.includes("--disable-slash-commands"), false);
    const calls = f.h.calls.length;
    assert.equal(
      (await f.send(command)).status,
      200,
      "lost receipt can be recovered after state advanced",
    );
    assert.equal(f.h.calls.length, calls);
    assert.equal(
      (await f.send(f.input())).status,
      409,
      "new start cannot target an active run",
    );
  } finally {
    await f.close();
  }
});
test("E03 web resume preserves run and JSON identity; unresolved questions block", async () => {
  const f = await setup();
  try {
    let p = f.b.store.state.projects.A,
      r = current(p);
    r.status = "paused";
    r.resume_required = true;
    r.reason = "broker_restarted";
    r.questions.push({
      request_id: "q",
      run_id: r.run_id,
      agent_id: r.agents[0].agent_id,
      task_id: "plan",
      kind: "execution_choice",
      question: "회사명?",
      response_schema: { type: "string" },
      status: "open",
    });
    await f.b.save(p);
    assert.equal((await f.readiness()).ready, false);
    assert.equal((await f.send(f.input("resume"))).status, 409);
    r.questions[0].status = "answered";
    r.questions[0].response = "Fixture";
    await f.b.save(p);
    const check = await f.readiness();
    assert.equal(check.action, "resume");
    assert.equal(check.ready, true);
    const command = f.input("resume"),
      result = await f.send(command);
    assert.equal(result.status, 200);
    const json = await (await fetch(f.url + "/api/projects/A/state")).json();
    assert.equal(json.consistent, true);
    assert.equal(json.run_id, r.run_id);
    assert.equal(json.files["meta.json"].status, "queued");
    assert.equal(json.files["meta.json"].resume_required, false);
    assert.equal(json.files["meta.json"].reason, null);
    assert.equal((await f.send(command)).status, 200);
    assert.equal(f.b.store.state.projects.A.runs.length, 1);
  } finally {
    await f.close();
  }
});
test("E04 execution rejects missing token, wrong origin, arbitrary fields and stale run IDs", async () => {
  const f = await setup();
  try {
    const before = JSON.stringify(f.b.store.state),
      c = f.input();
    assert.equal((await f.send(c, "bad")).status, 403);
    assert.equal((await f.send(c, f.csrf, "https://evil.example")).status, 403);
    for (const value of [
      { ...c, argv: ["sh"] },
      { ...c, action: "cancel" },
      { ...c, command_id: "__proto__" },
    ])
      assert.equal((await f.send(value)).status, 409);
    const stale = await f.send({ ...c, run_id: randomUUID() });
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).error, "stale_run");
    assert.equal(JSON.stringify(f.b.store.state), before);
    assert.equal(f.b.mcp!.ready, false);
  } finally {
    await f.close();
  }
});
test("E05 full capacity remains queued and missing skill blocks execution", async () => {
  const f = await setup();
  try {
    await f.b.handle(f.submit("B"));
    await f.b.handle(f.submit("C"));
    for (const id of ["B", "C"]) {
      const p = f.b.store.state.projects[id];
      current(p).slot = true;
      current(p).status = "running";
      await f.b.save(p);
    }
    const ready = await f.readiness();
    assert.equal(ready.ready, true);
    assert.equal(ready.waiting_for_slot, true);
    assert.equal((await f.send(f.input())).status, 200);
    assert.equal(f.b.status("A").projects[0].slot, false);
    assert.equal(f.h.calls.length, 0);
    await fs.unlink(f.config.skills[0]);
    assert.equal((await f.readiness()).ready, false);
    assert.equal((await f.send(f.input())).status, 409);
  } finally {
    await f.close();
  }
});

test("E06 MCP tool mismatch refuses a ready-looking request before run mutation", async () => {
  const f = await setup();
  try {
    f.config.mcp!.generateTool = "missing-tool";
    const before = JSON.stringify(f.b.store.state);
    assert.equal(
      (await f.readiness()).ready,
      true,
      "GET checks configuration only",
    );
    const res = await f.send(f.input());
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error, "mcp_tool_missing");
    assert.equal(JSON.stringify(f.b.store.state), before);
    assert.equal(f.h.calls.length, 0);
    assert.equal(f.b.mcp!.ready, false);
  } finally {
    await f.close();
  }
});

test("E07 installed Claude MCP needs no broker mapping and only the requested project starts", async () => {
  const f = await setup("native");
  try {
    await f.b.handle(f.submit("B"));
    await f.b.tick();
    assert.equal(
      f.h.calls.length,
      0,
      "initialization/submission must not launch models",
    );
    const ready = await f.readiness();
    assert.equal(ready.ready, true);
    assert.equal(ready.checks.length, 2);
    assert.equal(f.b.mcp, undefined);
    assert.equal((await f.send(f.input())).status, 200);
    const state = await (await fetch(f.url + "/api/projects/A/state")).json();
    assert.equal(state.files["meta.json"].execution_requested, true);
    await f.b.tick();
    await f.b.tick();
    assert.equal(current(f.b.store.state.projects.B).status, "queued");
    const starts = f.h.calls.filter(
      (c) => c[0] === "agent" && c[1] === "start",
    );
    assert.equal(starts.length, 1);
    for (const args of starts) {
      assert.equal(args.includes("--strict-mcp-config"), false);
      assert.equal(args.includes("--mcp-config"), false);
      assert.equal(args.includes("--disable-slash-commands"), false);
      assert.equal(args.includes("--disallowedTools"), false);
      assert.ok(args.includes("--setting-sources="));
      assert.ok(args.every((arg) => arg.length > 0 && !/[\n\r\x00]/.test(arg)));
      assert.equal(args.includes("--append-system-prompt-file"), false);
      const p = f.b.store.state.projects.A;
      const systemFile = path.join(
        p.directory,
        ".herdr/runs",
        p.current_run_id,
        "pm-instructions.md",
      );
      assert.match(
        await fs.readFile(systemFile, "utf8"),
        /installed\/authenticated Higgsfield MCP/,
      );
      assert.equal(args[args.indexOf("--model") + 1], "claude-opus-5-5");
      assert.equal(args[args.indexOf("--effort") + 1], "high");
    }
    const runtime = JSON.parse(
      await fs.readFile(
        path.join(
          f.b.store.state.projects.A.directory,
          "homepage-runtime.json",
        ),
        "utf8",
      ),
    );
    assert.equal(runtime.higgsfield.transport, "claude-installed");
    assert.equal(runtime.start_mode, "explicit");
  } finally {
    await f.close();
  }
});

test("E08 changed documents or unavailable plugin still block the two-check preflight", async () => {
  const f = await setup("native");
  try {
    const doc = current(f.b.store.state.projects.A).inputs.prd.path;
    await fs.writeFile(doc, "tampered");
    let ready = await f.readiness();
    assert.equal(ready.ready, false);
    assert.equal(ready.checks[0].ok, false);
    assert.equal(ready.checks[1].ok, true);
    assert.equal((await f.send(f.input())).status, 409);
    f.h.doctor = async () => {
      throw new Error("offline");
    };
    ready = await f.readiness();
    assert.equal(ready.checks[1].ok, false);
    assert.equal(f.h.calls.length, 0);
  } finally {
    await f.close();
  }
});

test("E09 status remains readable from committed JSON while agent startup is waiting", async () => {
  const f = await setup("native");
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const seen = new Promise<void>((r) => (entered = r));
  const cli = f.h.cli.bind(f.h);
  f.h.cli = async (args) => {
    if (args[0] === "agent" && args[1] === "start") {
      assert.match(args[2], /^[a-z][a-z0-9_-]{0,31}$/);
      entered();
      await gate;
    }
    return cli(args);
  };
  let tick: Promise<void> | undefined;
  try {
    assert.equal((await f.send(f.input())).status, 200);
    await f.b.tick();
    tick = f.b.serial(() => f.b.tick());
    await seen;
    const response = await fetch(f.url + "/api/status", {
      signal: AbortSignal.timeout(1500),
    });
    assert.equal(response.status, 200);
    const json = await response.json();
    assert.equal(json.projects[0].status, "starting");
    assert.equal(json.projects[0].run_id, f.input().run_id);
    release();
    await tick;
  } finally {
    release();
    await tick;
    await f.close();
  }
});

test("E10 PM authority gates team creation, plan, replay and restart", async () => {
  const f = await setup("native");
  try {
    legacyTeam(current(f.b.store.state.projects.A));
    await f.b.save();
    await f.send(f.input());
    await f.b.tick();
    await f.b.tick();
    await f.b.tick();
    let p = f.b.store.state.projects.A;
    let r = current(p);
    assert.equal(f.h.panes.length, 1);
    assert.ok(
      r.agents
        .slice(1)
        .every((a) => !a.herdr.pane_id && a.waiting_reason === "orchestrator"),
    );
    const plan = [
      {
        task_id: "build",
        role: "developer",
        title: "Build",
        depends_on: [],
        writes: ["app/"],
      },
    ];
    const before = JSON.stringify(f.b.store.state);
    await assert.rejects(
      () => f.b.handle(pmReport(p, "plan", { tasks: plan })),
      (e: any) => e.code === "team_required",
    );
    await assert.rejects(
      () =>
        f.b.handle(
          pmReport(p, "team-create", {
            agent_id: r.agents[1].agent_id,
            token: r.agents[1].token,
          }),
        ),
      /assignment/,
    );
    await assert.rejects(
      () => f.b.handle(pmReport(p, "team-create", { roles: ["qa"] })),
      /additional properties/,
    );
    await assert.rejects(
      () => f.b.handle(pmReport(p, "team-create", { token: "wrong" })),
      /capability/,
    );
    assert.equal(JSON.stringify(f.b.store.state), before);
    const create = pmReport(p, "team-create");
    await f.b.handle(create);
    await f.b.handle(create);
    assert.equal(f.h.panes.length, 1, "receipt commits before provisioning");
    r = current(f.b.store.state.projects.A);
    assert.equal(
      r.orchestration?.mode === "pm-led" && r.orchestration.requested_by,
      r.agents[0].agent_id,
    );
    assert.equal(
      r.tasks[0].status,
      "running",
      "creating team does not finish PM planning",
    );
    // Restart after durable intent, before any worker is created.
    await f.b.close();
    const restarted = new Broker(f.config, f.h);
    f.b = restarted;
    await f.b.start(false);
    clearInterval(f.b.timer);
    p = f.b.store.state.projects.A;
    await f.b.handle(cmd("resume", p));
    await f.b.tick();
    await f.b.tick();
    assert.equal(f.h.panes.length, 3);
    const starts = f.h.calls.filter(
      (c) => c[0] === "agent" && c[1] === "start",
    );
    assert.equal(
      starts.length,
      3,
      "restart never creates a second PM or duplicate worker",
    );
    await f.b.handle(create);
    await f.b.tick(); // Resume assigns a fresh PM planning assignment.
    p = f.b.store.state.projects.A;
    await f.b.handle(pmReport(p, "plan", { tasks: plan }));
    await f.b.tick();
    assert.equal(f.h.panes.length, 3);
    r = current(f.b.store.state.projects.A);
    assert.equal(r.tasks[1].status, "running");
    const meta = JSON.parse(
      await fs.readFile(path.join(p.directory, "meta.json"), "utf8"),
    );
    assert.equal(meta.orchestration.team_requested, true);
    assert.match(
      await fs.readFile(
        path.join(
          p.directory,
          ".herdr/runs",
          r.run_id,
          "homepage-orchestration.md",
        ),
        "utf8",
      ),
      /MAIN ORCHESTRATOR/,
    );
    assert.match(
      await fs.readFile(
        path.join(p.directory, ".herdr/runs", r.run_id, "developer-system.md"),
        "utf8",
      ),
      /Never create agents/,
    );
  } finally {
    await f.b.close();
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

test("E11 native PM uses file bootstrap, owns all logical tasks and survives restart without another pane", async () => {
  const f = await setup("native");
  try {
    await f.send(f.input());
    for (let i = 0; i < 3; i++) await f.b.tick();
    let p = f.b.store.state.projects.A,
      r = current(p);
    assert.equal(r.agents.length, 1);
    assert.equal(r.orchestration?.mode, "claude-native");
    const start = f.h.calls.find((c) => c[0] === "agent" && c[1] === "start")!;
    assert.deepEqual(start.slice(start.indexOf("--") + 1), [
      "--model",
      "claude-opus-5-5",
      "--effort",
      "high",
      "--setting-sources=",
      "--plugin-dir",
      studio.dir,
    ]);
    const bootstrap = f.h.calls.find(
      (c) => c[0] === "agent" && c[1] === "prompt",
    )![3];
    assert.match(bootstrap, /Initialize this PM session/);
    assert.match(bootstrap, /pm-instructions.md/);
    assert.ok(bootstrap.length < 1200);
    await assert.rejects(
      () => fs.stat(path.join(p.directory, ".claude/agents")),
      /ENOENT/,
      "native runs write no project agent files",
    );
    await assert.rejects(
      () => f.b.handle(pmReport(p, "team-create")),
      /already own/,
    );
    await f.b.handle(
      pmReport(p, "plan", {
        tasks: [
          {
            task_id: "direction",
            role: "pm",
            title: "Direction",
            writes: ["reports/direction.md"],
            depends_on: [],
          },
          {
            task_id: "first-screen",
            role: "developer",
            title: "First screen",
            writes: ["app/", "assets/", "reports/look/"],
            depends_on: [],
          },
        ],
      }),
    );
    await f.b.tick();
    r = current(f.b.store.state.projects.A);
    assert.equal(r.agents[0].task_id, "direction");
    assert.equal(r.tasks.filter((t) => t.status === "running").length, 1);
    const oldAssignment = r.tasks[1].assignment_id;
    await f.b.close();
    f.b = new Broker(f.config, f.h);
    await f.b.start(false);
    clearInterval(f.b.timer);
    p = f.b.store.state.projects.A;
    await f.b.handle(cmd("resume", p));
    for (let i = 0; i < 3; i++) await f.b.tick();
    r = current(f.b.store.state.projects.A);
    assert.notEqual(r.tasks[1].assignment_id, oldAssignment);
    const sendTask = async (kind: string, extra = {}) => {
      const p = f.b.store.state.projects.A,
        r = current(p),
        a = r.agents[0];
      const t = r.tasks.find((t) => t.task_id === a.task_id)!;
      return f.b.handle(
        cmd("report", p, {
          agent_id: a.agent_id,
          token: a.token,
          task_id: t.task_id,
          assignment_id: t.assignment_id,
          attempt: t.attempt,
          event_id: randomUUID(),
          sequence: a.seq + 1,
          kind,
          ...extra,
        }),
      );
    };
    await sendTask("progress", {
      result: "direction set",
    });
    const ui = await (await fetch(f.b.dashboard!.url + "/api/status")).json();
    assert.equal(ui.projects[0].agents.length, 1);
    assert.match(ui.projects[0].tasks[1].result, /direction set/);
    await sendTask("completed", { result: "direction ready" });
    await f.b.tick();
    assert.equal(
      current(f.b.store.state.projects.A).agents[0].task_id,
      "first-screen",
    );
    await sendTask("completed", { result: "first screen ready" });
    await f.b.tick();
    assert.equal(
      f.h.calls.filter((c) => c[0] === "agent" && c[1] === "start").length,
      1,
    );
    assert.equal(
      f.h.calls.filter((c) => c[0] === "pane" && c[1] === "split").length,
      0,
    );
    assert.equal(f.h.panes.length, 1);
  } finally {
    await f.b.close();
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

test("E12 native PM requests broker media with its own capability", async () => {
  const f = await setup();
  try {
    await f.send(f.input());
    for (let i = 0; i < 3; i++) await f.b.tick();
    const p = f.b.store.state.projects.A,
      r = current(p),
      a = r.agents[0];
    const result = await f.b.handle(
      cmd("media-request", p, {
        agent_id: a.agent_id,
        token: a.token,
        arguments: { prompt: "fixture" },
      }),
    );
    assert.ok(result.job_id);
    assert.equal(
      current(f.b.store.state.projects.A).media[0].agent_id,
      a.agent_id,
    );
  } finally {
    await f.close();
  }
});

test("E13 native launch leaves existing project agent definitions untouched", async () => {
  const f = await setup("native");
  try {
    const p = f.b.store.state.projects.A;
    const dir = path.join(p.directory, ".claude/agents");
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, "homepage-designer.md");
    await fs.writeFile(file, "user-owned instructions");
    await f.send(f.input());
    await f.b.tick();
    await f.b.tick();
    assert.equal(await fs.readFile(file, "utf8"), "user-owned instructions");
    assert.deepEqual(await fs.readdir(dir), ["homepage-designer.md"]);
    assert.equal(
      f.h.calls.filter((c) => c[0] === "agent" && c[1] === "start").length,
      1,
    );
  } finally {
    await f.close();
  }
});
