import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Broker } from "../src/broker/broker.js";
import { current } from "../src/domain/engine.js";
import { fixture, FakeHerdr } from "./helpers.js";
async function setup(ready = true) {
  const f = await fixture();
  f.config.web = { enabled: true, port: 0 };
  if (ready) {
    const skill = path.join(f.root, "SKILL.md");
    await fs.writeFile(skill, "# Fixture homepage skill\nLocal source only.");
    f.config.skills = [skill];
    f.config.allowExecution = true;
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
    for (const code of [
      "execution_disabled",
      "skills_unavailable",
      "mcp_unconfigured",
    ])
      assert.ok(check.checks.some((c: any) => c.code === code && !c.ok));
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
test("E02 real HTTP to CLI start deduplicates and scheduler still creates only three fake agent panes", async () => {
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
      3,
    );
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
