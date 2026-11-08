import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import vm from "node:vm";
import { randomUUID } from "node:crypto";
import { fixture, FakeHerdr } from "./helpers.js";
import { Broker } from "../src/broker/broker.js";
import { brokerSocket, config } from "../src/config.js";
import { request } from "../src/broker/client.js";
import { current, makeTask } from "../src/domain/engine.js";
import { Dashboard, previewUrl } from "../src/web/server.js";
import { displayName } from "../src/web/showcase.js";
import { parseAnsi } from "../src/web/ui/ansi.js";
import { eventsFile, readEvents } from "../src/storage/events.js";

const exec = promisify(execFile);
async function setup() {
  const f = await fixture();
  f.config.web = { enabled: true, port: 0 };
  const h = new FakeHerdr(f.config),
    b = new Broker(f.config, h);
  await b.start(false);
  clearInterval(b.timer);
  return {
    ...f,
    b,
    h,
    url: b.dashboard!.url!,
    close: async () => {
      await b.close();
      await fs.rm(f.root, { recursive: true, force: true });
    },
  };
}
function httpRequest(
  url: string,
  headers: http.OutgoingHttpHeaders = {},
  method = "GET",
) {
  return new Promise<{
    status: number;
    body: string;
    headers: http.IncomingHttpHeaders;
  }>((resolve, reject) => {
    const req = http.request(url, { headers, method }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (s) => (body += s));
      res.on("end", () =>
        resolve({ status: res.statusCode!, body, headers: res.headers }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

test("W01 HTTP assets, empty queue, IPC updates and sanitized status without writes", async () => {
  const f = await setup();
  try {
    for (const [route, marker] of [
      ["/", 'id="landing"'],
      ["/dashboard", "홈페이지 제작 현황"],
      ["/landing.css", ".lp-hero"],
      ["/legacy.js", "/dashboard"],
      ["/app.js", "textContent"],
      ["/app.css", ".live-card"],
      ["/tokens.css", "--accent"],
      ["/bundle.css", ".term-body"],
      ["/icons.js", "BrokerIcons"],
      ["/ui/components.js", "BrokerUI"],
    ]) {
      const res = await fetch(f.url + route);
      assert.equal(res.status, 200);
      assert.ok((await res.text()).includes(marker));
      assert.equal(res.headers.get("cache-control"), "no-store");
      assert.match(
        res.headers.get("content-security-policy")!,
        /frame-ancestors 'none'/,
      );
    }
    assert.equal(
      (await (await fetch(f.url + "/api/status")).json()).projects.length,
      0,
    );
    await request(brokerSocket(f.config), f.submit("company"));
    const p = f.b.store.state.projects.company,
      r = current(p);
    r.tasks = [
      makeTask(
        "layout",
        "designer",
        "레이아웃 <script>alert(1)</script>",
        [],
        ["assets/"],
      ),
    ];
    r.agents[0].token = "PRIVATE_AGENT_CAPABILITY";
    r.agents[0].herdr.argv = ["PRIVATE_LAUNCH_ARGS"];
    r.questions.push({
      request_id: "q1",
      run_id: r.run_id,
      agent_id: r.agents[0].agent_id,
      task_id: "layout",
      kind: "execution_choice",
      question: "로고를 확인해주세요",
      response_schema: { type: "string", maxLength: 200 },
      response: "PRIVATE_ANSWER",
      status: "open",
    });
    r.operations.push({
      operation_id: "op1",
      kind: "media.generate",
      status: "unknown",
      request: { token: "PRIVATE_REQUEST" },
      result: "PRIVATE_RESULT",
      created_at: new Date().toISOString(),
    });
    r.preview = {
      status: "ready",
      run_id: r.run_id,
      url: "http://127.0.0.1:4300",
      argv: ["PRIVATE_PREVIEW_ARGS"],
    };
    await f.b.save(p);
    const before = JSON.stringify(f.b.store.state);
    const res = await fetch(f.url + "/api/status"),
      body = await res.text(),
      data = JSON.parse(body);
    assert.equal(data.session, "homepage");
    assert.equal(data.projects[0].input_required, true);
    // The answer form needs the schema; the answer itself stays private.
    assert.deepEqual(data.projects[0].input_requests[0].response_schema, {
      type: "string",
      maxLength: 200,
    });
    assert.equal(data.projects[0].preview.url, "http://127.0.0.1:4300/");
    assert.equal(data.projects[0].tasks[0].title, r.tasks[0].title);
    assert.deepEqual(data.projects[0].unknown_operations, [
      { operation_id: "op1", kind: "media.generate" },
    ]);
    assert.equal(body.includes("PRIVATE_"), false);
    assert.equal(JSON.stringify(f.b.store.state), before);
    assert.equal(f.h.calls.length, 0);
  } finally {
    await f.close();
  }
});

test("W02 read-only API denies writes, cross-origin and foreign Host; no file routes", async () => {
  const f = await setup();
  try {
    const before = JSON.stringify(f.b.store.state);
    for (const method of ["POST", "PUT", "DELETE", "OPTIONS"])
      assert.equal(
        (await httpRequest(f.url + "/api/status", {}, method)).status,
        405,
      );
    for (const headers of [
      { Host: "evil.example" },
      { Origin: "https://evil.example" },
      { "Sec-Fetch-Site": "cross-site" },
    ])
      assert.equal(
        (await httpRequest(f.url + "/api/status", headers)).status,
        403,
      );
    const local = await httpRequest(f.url + "/api/status", { Origin: f.url });
    assert.equal(local.status, 200);
    assert.equal(local.headers["access-control-allow-origin"], undefined);
    for (const route of [
      "/api/command",
      "/../config.json",
      "/%2e%2e/config.json",
      "/meta.json",
      "/api/status?project=other",
    ])
      assert.equal((await httpRequest(f.url + route)).status, 404);
    const head = await httpRequest(f.url + "/", {}, "HEAD");
    assert.equal(head.status, 200);
    assert.equal(head.body, "");
    assert.equal(JSON.stringify(f.b.store.state), before);
  } finally {
    await f.close();
  }
});

test("W03 preview links only allow ready localhost HTTP addresses", () => {
  for (const url of [
    "javascript:alert(1)",
    "https://example.com",
    "http://127.0.0.1.evil.test",
    "http://user:pass@localhost:3000",
    "file:///tmp/x",
    "invalid",
  ])
    assert.equal(previewUrl("ready", url), null);
  assert.equal(previewUrl("unknown", "http://localhost:3000"), null);
  assert.equal(
    previewUrl("ready", "http://localhost:3000"),
    "http://localhost:3000/",
  );
});

test("W04 web configuration defaults, explicit disable and validation", async () => {
  const f = await fixture(),
    file = path.join(f.root, "config.json");
  try {
    assert.deepEqual((await config()).web, { enabled: true, port: 7318 });
    for (const web of [
      null,
      [],
      "true",
      { enabled: "yes" },
      { port: -1 },
      { port: 65536 },
      { port: 7.5 },
      { host: "0.0.0.0" },
    ]) {
      await fs.writeFile(file, JSON.stringify({ web }));
      await assert.rejects(() => config(file), /web accepts/);
    }
    await fs.writeFile(
      file,
      JSON.stringify({ web: { enabled: false, port: 0 } }),
    );
    assert.deepEqual((await config(file)).web, { enabled: false, port: 0 });
  } finally {
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

test("W05 port conflict preserves broker IPC and shutdown releases web listener", async () => {
  const f = await setup(),
    other = await fixture();
  other.config.web = { enabled: true, port: Number(new URL(f.url).port) };
  const second = new Broker(other.config, new FakeHerdr(other.config));
  try {
    await second.start(false);
    clearInterval(second.timer);
    const s = await request(brokerSocket(other.config), {
      schema_version: 1,
      command_id: "status",
      type: "status",
      payload: {},
    });
    assert.equal(s.web.error, "EADDRINUSE");
    assert.equal(s.web.url, null);
    await request(brokerSocket(other.config), other.submit());
    assert.equal(second.status().projects.length, 1);
    await f.b.close();
    const replacement = new Dashboard(async () => second.status());
    try {
      await replacement.start(other.config.web.port);
      assert.equal(replacement.url, f.url);
    } finally {
      await replacement.close();
    }
  } finally {
    await second.close();
    await f.close();
    await fs.rm(other.root, { recursive: true, force: true });
  }
});

test("W06 concurrent readers coalesce and failed reads recover", async () => {
  const f = await setup();
  let reads = 0,
    release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const web = new Dashboard(async () => {
    reads++;
    await gate;
    if (reads === 1) throw new Error("PRIVATE_EXCEPTION");
    return f.b.status();
  });
  try {
    await web.start(0);
    const a = fetch(web.url + "/api/status"),
      b = fetch(web.url + "/api/status");
    await new Promise((r) => setTimeout(r, 60));
    release();
    for (const res of await Promise.all([a, b])) {
      assert.equal(res.status, 503);
      assert.deepEqual(await res.json(), { error: "status_unavailable" });
    }
    assert.equal(reads, 1);
    assert.equal((await fetch(web.url + "/api/status")).status, 200);
  } finally {
    await web.close();
    await f.close();
  }
});

test("W07 CLI returns actual web URL and plugin action retains homepage guard", async () => {
  const f = await setup();
  try {
    const file = path.join(f.root, "config.json");
    await fs.writeFile(file, JSON.stringify(f.config));
    const { stdout } = await exec(process.execPath, [
      "dist/src/cli.js",
      "web",
      "status",
      "--config",
      file,
    ]);
    assert.equal(JSON.parse(stdout).url, f.url);
    await assert.rejects(
      () =>
        exec(
          process.execPath,
          ["dist/src/cli.js", "plugin", "web", "--config", file],
          { env: { ...process.env, HERDR_SESSION: "other" } },
        ),
      /session_mismatch/,
    );
    const noWeb = new Broker({ ...f.config, web: { enabled: false, port: 0 } });
    assert.deepEqual(noWeb.status().web, {
      enabled: false,
      url: null,
      error: null,
    });
  } finally {
    await f.close();
  }
});

test(
  "W08 SSE receives committed progress and Herdr state, rejects foreign origin, reconnects and closes",
  { timeout: 10000 },
  async () => {
    const f = await setup();
    const abort = new AbortController();
    try {
      assert.equal(
        (
          await httpRequest(f.url + "/api/events", {
            Origin: "https://foreign.test",
          })
        ).status,
        403,
      );
      const res = await fetch(f.url + "/api/events", { signal: abort.signal });
      assert.match(res.headers.get("content-type")!, /text\/event-stream/);
      const reader = res.body!.getReader();
      let buffer = "";
      async function nextStatus() {
        while (true) {
          const boundary = buffer.indexOf("\n\n");
          if (boundary !== -1) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            if (frame.startsWith("event: status\n"))
              return JSON.parse(frame.split("\ndata: ")[1]);
            continue;
          }
          const next = await reader.read();
          assert.equal(next.done, false);
          buffer += new TextDecoder().decode(next.value);
        }
      }
      assert.equal((await nextStatus()).projects.length, 0);
      await f.b.handle(f.submit("stream-project"));
      const p = f.b.store.state.projects["stream-project"],
        r = current(p);
      r.status = "running";
      r.execution_requested = true;
      r.tasks[0].status = "running";
      r.tasks[0].result = "히어로 생성 요청 접수 · job-123";
      r.tasks[0].updated_at = new Date().toISOString();
      r.agents[0].runtime = {
        status: "busy",
        fresh: true,
        interactive_ready: false,
      };
      r.agents[0].token = "PRIVATE_STREAM_TOKEN";
      r.operations.push({
        operation_id: "op-stream",
        kind: "agent.start",
        status: "dispatching",
        request: { token: "PRIVATE_REQUEST" },
        created_at: new Date().toISOString(),
      });
      await f.b.save(p);
      let data;
      do {
        data = await nextStatus();
      } while (data.revision < f.b.store.state.revision);
      assert.equal(
        data.projects[0].tasks[0].result,
        "히어로 생성 요청 접수 · job-123",
      );
      assert.equal(data.projects[0].agents[0].runtime.status, "busy");
      assert.equal(data.projects[0].execution_requested, true);
      assert.deepEqual(
        data.projects[0].active_operations.map((o: any) => o.kind),
        ["agent.start"],
      );
      assert.doesNotMatch(JSON.stringify(data), /PRIVATE_/);
      abort.abort();
      const again = await fetch(f.url + "/api/events");
      const againReader = again.body!.getReader();
      assert.equal((await againReader.read()).done, false);
      await f.b.dashboard!.close();
      while (!(await againReader.read()).done) {
        /* Drain final frame. */
      }
    } finally {
      abort.abort();
      await f.close();
    }
  },
);

test("W09 MCP endpoint returns checking promptly and shares checks across readers", async () => {
  const { McpHealth } = await import("../src/media/health.js");
  const f = await setup();
  let finish!: (value: any) => void,
    calls = 0;
  const health = new McpHealth(undefined, () => {
    calls++;
    return new Promise((r) => {
      finish = r;
    });
  });
  const dashboard = new Dashboard(async () => f.b.status(), undefined, health);
  try {
    await dashboard.start(0);
    for (const route of ["/api/mcp", "/api/mcp?refresh=1"]) {
      const res = await fetch(dashboard.url + route);
      assert.equal(res.status, 200);
      assert.equal((await res.json()).checking, true);
    }
    assert.equal(calls, 1);
    finish({
      servers: [{ name: "higs", status: "needs_auth", higgsfield: true }],
      error: null,
    });
    await health.settled();
    const data = await (await fetch(dashboard.url + "/api/mcp")).json();
    assert.equal(data.checking, false);
    assert.equal(data.higgsfield.available, false);
    assert.equal(data.higgsfield.status, "needs_auth");
    assert.equal(
      (await httpRequest(dashboard.url + "/api/mcp", { Host: "foreign.test" }))
        .status,
      403,
    );
  } finally {
    await dashboard.close();
    await f.close();
  }
});

// A submitted project whose PM already owns a Herdr pane.
async function withPane(f: Awaited<ReturnType<typeof setup>>) {
  await request(brokerSocket(f.config), f.submit("company"));
  const p = f.b.store.state.projects.company,
    r = current(p),
    a = r.agents[0];
  r.herdr.workspace_id = "w1";
  a.herdr = { pane_id: "w1:p1", terminal_id: "term1", started: true };
  a.runtime = { status: "working", fresh: true };
  f.h.workspaces.push({ workspace_id: "w1" });
  f.h.panes.push({
    pane_id: "w1:p1",
    terminal_id: "term1",
    workspace_id: "w1",
    agent_status: "working",
    interactive_ready: true,
  });
  await f.b.save(p);
  return { p, r, a };
}

test("W10 terminal mirror reads the PM pane through Herdr once per second per pane", async () => {
  const f = await setup();
  try {
    const { p, a } = await withPane(f);
    f.h.paneText.set("w1:p1", "\x1b[32m✓ done\x1b[0m\nnext");
    const url = f.url + "/api/projects/company/terminal";
    const [one, two] = await Promise.all([
      fetch(url).then((r) => r.json()),
      fetch(url).then((r) => r.json()),
    ]);
    assert.equal(one.available, true);
    assert.equal(one.text, "\x1b[32m✓ done\x1b[0m\nnext");
    assert.equal(one.pane_id, "w1:p1");
    assert.equal(two.text, one.text);
    assert.deepEqual(f.h.reads, [
      ["pane", "read", "w1:p1", "--source", "visible", "--format", "ansi"],
    ]);
    assert.equal(
      (await fetch(url + "?agent=" + a.agent_id).then((r) => r.json())).text,
      one.text,
    );
    assert.equal((await httpRequest(url + "?raw=1")).status, 404);
    assert.equal(
      (await httpRequest(f.url + "/api/projects/missing/terminal")).status,
      404,
    );
    a.herdr.pane_id = "w1:p9";
    await f.b.save(p);
    const failed = await fetch(url).then((r) => r.json());
    assert.equal(failed.available, false);
    assert.equal(failed.reason, "read_failed");
    a.runtime = { status: "stopped", fresh: true };
    await f.b.save(p);
    assert.equal((await fetch(url).then((r) => r.json())).reason, "no_pane");
    assert.equal(
      f.h.calls.some((c) => c[0] !== "notification"),
      false,
    );
  } finally {
    await f.close();
  }
});

test("W11 events.jsonl records commit differences and pages newest first", async () => {
  const f = await setup();
  try {
    await request(brokerSocket(f.config), f.submit("company"));
    const p = f.b.store.state.projects.company,
      r = current(p);
    r.tasks = [makeTask("direction", "pm", "방향 정하기", [], ["reports/"])];
    r.status = "running";
    await f.b.save(p);
    r.tasks[0].status = "running";
    await f.b.save(p);
    r.tasks[0].result = "방향 확정";
    r.tasks[0].updated_at = new Date().toISOString();
    r.questions.push({
      request_id: "q1",
      run_id: r.run_id,
      agent_id: r.agents[0].agent_id,
      task_id: "direction",
      kind: "execution_choice",
      question: "로고를 확인해주세요",
      response_schema: { secret: "PRIVATE_SCHEMA" },
      status: "open",
    });
    await f.b.save(p);
    // An unrelated save (runtime only) adds nothing.
    r.agents[0].runtime = { status: "idle", fresh: true };
    await f.b.save(p);
    const lines = (await fs.readFile(eventsFile(p.directory), "utf8"))
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    assert.deepEqual(
      lines.map((e) => e.kind),
      // The run's initial plan task is logged with the run itself.
      ["run", "task", "status", "task", "task", "report", "input"],
    );
    assert.equal(lines[2].from, "queued");
    assert.equal(lines[2].to, "running");
    assert.equal(lines[4].to, "running");
    assert.equal(lines[5].result, "방향 확정");
    assert.equal(JSON.stringify(lines).includes("PRIVATE_"), false);
    assert.ok(lines.every((e) => e.run_id === r.run_id));
    const page = await (
      await fetch(f.url + "/api/projects/company/events?limit=2")
    ).json();
    assert.deepEqual(
      page.events.map((e: any) => e.kind),
      ["input", "report"],
    );
    assert.equal(page.next_before, 5);
    const rest = await (
      await fetch(
        f.url +
          `/api/projects/company/events?limit=200&before=${page.next_before}`,
      )
    ).json();
    assert.deepEqual(
      rest.events.map((e: any) => e.kind),
      ["task", "task", "status", "task", "run"],
    );
    assert.equal(rest.next_before, null);
    assert.equal(
      (await httpRequest(f.url + "/api/projects/company/events?limit=x"))
        .status,
      400,
    );
    // Other runs and a torn final line are skipped.
    await fs.appendFile(
      eventsFile(p.directory),
      JSON.stringify({ at: "x", run_id: "other", kind: "run" }) + '\n{"torn',
    );
    assert.equal(
      (await readEvents(p.directory, { run_id: r.run_id })).events.length,
      7,
    );
  } finally {
    await f.close();
  }
});

test("W12 stall: changed_at tracking, one Herdr notification, banner data and clear", async () => {
  const f = await setup();
  try {
    const { p, r, a } = await withPane(f);
    await f.b.observe(await f.h.snapshot());
    const first = a.runtime.changed_at;
    assert.ok(first);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await f.b.observe(await f.h.snapshot());
    assert.equal(a.runtime.changed_at, first, "same status keeps changed_at");
    f.h.panes[0].agent_status = "idle";
    await f.b.observe(await f.h.snapshot());
    assert.notEqual(a.runtime.changed_at, first, "status change resets it");

    r.status = "running";
    r.tasks = [makeTask("direction", "pm", "방향 정하기", [], ["reports/"])];
    r.tasks[0].status = "running";
    a.task_id = "direction";
    a.runtime.changed_at = new Date(Date.now() - 11 * 60000).toISOString();
    await f.b.save(p);
    await f.b.checkStall(p, r);
    await f.b.checkStall(p, r);
    const notices = f.h.calls.filter((c) => c[0] === "notification");
    assert.equal(notices.length, 1);
    assert.equal(notices[0][1], "show");
    assert.ok(notices[0].includes("--sound"));
    assert.ok(
      notices[0][notices[0].indexOf("--body") + 1].endsWith(
        `${f.url}/dashboard#/p/company`,
      ),
    );
    const status = await (await fetch(f.url + "/api/status")).json();
    assert.equal(status.projects[0].stall.task_id, "direction");
    assert.ok(status.projects[0].stall.minutes >= 11);
    assert.ok(status.projects[0].agents[0].runtime.changed_at);
    const boot = await (await fetch(f.url + "/api/bootstrap")).json();
    assert.equal(boot.stall_after_minutes, 5);

    // A blocked agent is a terminal_action request, not a stall.
    a.runtime.status = "blocked";
    assert.equal(f.b.status().projects[0].stall, null);
    a.runtime.status = "working";
    await f.b.checkStall(p, r);
    const kinds = (await readEvents(p.directory)).events.map((e) => e.kind);
    assert.equal(kinds[0], "stall_cleared");
    assert.ok(kinds.includes("stall"));
    assert.equal(
      f.h.calls.filter((c) => c[0] === "notification").length,
      1,
      "clearing does not notify",
    );
  } finally {
    await f.close();
  }
});

test("W13 screenshots and generated images: listing, whitelist and containment", async () => {
  const f = await setup();
  try {
    await request(brokerSocket(f.config), f.submit("company"));
    const p = f.b.store.state.projects.company,
      run = current(p).run_id,
      dir = path.join(p.directory, ".herdr/runs", run);
    const png = Buffer.from("89504e470d0a1a0a0000", "hex");
    for (const file of [
      "reports/look/1/desktop.png",
      "reports/look/1/mobile-full.png",
      "reports/look/final/desktop.png",
      "assets/hero.png",
      "assets/.hidden.png",
    ]) {
      await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true });
      await fs.writeFile(path.join(dir, file), png);
    }
    await fs.writeFile(path.join(dir, "reports/look/1/issues.json"), "{}");
    await fs.writeFile(
      path.join(dir, "reports/look/1/verdict.md"),
      "첫 화면 통과",
    );
    await fs.writeFile(path.join(dir, "assets/notes.txt"), "x");
    await fs.writeFile(path.join(f.root, "secret.png"), png);
    await fs.symlink(
      path.join(f.root, "secret.png"),
      path.join(dir, "assets/escape.png"),
    );
    const shots = await (
      await fetch(f.url + "/api/projects/company/shots")
    ).json();
    assert.deepEqual(
      shots.rounds.map((r: any) => [r.round, r.stage]),
      [
        ["1", "first-screen"],
        ["final", "final"],
      ],
    );
    assert.equal(shots.rounds[0].verdict, "첫 화면 통과");
    assert.deepEqual(
      shots.rounds[0].files.map((x: any) => x.name),
      ["desktop.png", "mobile-full.png"],
    );
    // Symlinks, dotfiles and non-images are not listed.
    assert.deepEqual(
      shots.assets.map((x: any) => x.name),
      ["hero.png"],
    );
    const image = await fetch(
      f.url + `/api/projects/company/shots/${run}/1/desktop.png?v=1`,
    );
    assert.equal(image.status, 200);
    assert.equal(image.headers.get("content-type"), "image/png");
    assert.match(image.headers.get("cache-control")!, /immutable/);
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
    assert.equal(
      (
        await httpRequest(
          f.url + `/api/projects/company/assets/${run}/hero.png`,
        )
      ).status,
      200,
    );
    for (const route of [
      `/api/projects/company/shots/${run}/1/issues.json`,
      `/api/projects/company/shots/${run}/1/verdict.md`,
      `/api/projects/company/shots/${run}/../../../meta.json`,
      `/api/projects/company/shots/${run}/1/%2e%2e`,
      `/api/projects/company/shots/${run}/1/desktop.png?x=1`,
      `/api/projects/company/shots/../1/desktop.png`,
      `/api/projects/company/assets/${run}/escape.png`,
      `/api/projects/company/assets/${run}/.hidden.png`,
      `/api/projects/company/assets/${run}/notes.txt`,
      `/api/projects/company/assets/..%2f..%2fmeta.json`,
      `/api/projects/company/shots?x=1`,
      `/api/projects/other/shots`,
    ])
      assert.equal((await httpRequest(f.url + route)).status, 404, route);
  } finally {
    await f.close();
  }
});

test("W14 Herdr focus requires the action token and changes no broker state", async () => {
  const f = await setup();
  try {
    await request(brokerSocket(f.config), f.submit("company"));
    const csrf = (await (await fetch(f.url + "/api/bootstrap")).json()).csrf;
    const send = (body: any, token = csrf) =>
      fetch(f.url + "/api/projects/focus", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: f.url,
          "X-Homepage-Token": token,
        },
        body: JSON.stringify(body),
      });
    assert.equal((await send({ project_id: "company" }, "wrong")).status, 403);
    const none = await send({ project_id: "company" });
    assert.equal(none.status, 409);
    assert.equal((await none.json()).error, "no_workspace");
    assert.equal(
      (await send({ project_id: "company", workspace_id: "w9" })).status,
      409,
    );
    const p = f.b.store.state.projects.company;
    current(p).herdr.workspace_id = "w1";
    f.h.workspaces.push({ workspace_id: "w1" });
    await f.b.save(p);
    const before = JSON.stringify(f.b.store.state);
    const ok = await send({ project_id: "company" });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).workspace_id, "w1");
    assert.deepEqual(f.h.calls.at(-1), ["workspace", "focus", "w1"]);
    assert.equal(JSON.stringify(f.b.store.state), before);
    current(p).herdr.workspace_id = "w2";
    await f.b.save(p);
    assert.equal((await send({ project_id: "company" })).status, 502);
  } finally {
    await f.close();
  }
});

test("W15 stallAfterMinutes accepts integers 1..120 only", async () => {
  const f = await fixture(),
    file = path.join(f.root, "config.json");
  try {
    for (const stallAfterMinutes of [0, 121, 1.5, "5"]) {
      await fs.writeFile(file, JSON.stringify({ stallAfterMinutes }));
      await assert.rejects(() => config(file), /stallAfterMinutes/);
    }
    await fs.writeFile(file, JSON.stringify({ stallAfterMinutes: 30 }));
    assert.equal((await config(file)).stallAfterMinutes, 30);
  } finally {
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

test("W16 ANSI parser maps SGR to terminal tokens and drops other escapes", () => {
  const text = (l: any[]) => l.map((s) => s.text).join("");
  const [a] = parseAnsi("\x1b[1;32mok\x1b[22m plain\x1b[0m");
  assert.deepEqual(
    a.map((s) => [s.text, s.classes]),
    [
      ["ok", ["t-green", "t-strong"]],
      [" plain", ["t-green"]],
    ],
  );
  const [b] = parseAnsi(
    "\x1b[38;5;196mr\x1b[38;2;1;2;3mt\x1b[48;5;232mg\x1b[39;49m",
  );
  assert.equal(b[0].fg, "rgb(255,0,0)");
  assert.equal(b[1].fg, "rgb(1,2,3)");
  assert.equal(b[2].bg, "rgb(8,8,8)");
  const [c] = parseAnsi("\x1b[38:2::10:20:30mx\x1b[0m");
  assert.equal(c[0].fg, "rgb(10,20,30)");
  const [d] = parseAnsi(
    "\x1b]0;title\x07\x1b[2K\x1b[?25lA\rB\x1b[97mC\x1b[7mD",
  );
  assert.equal(text(d), "ABCD");
  // Inverse swaps the bright-white foreground into the background.
  assert.deepEqual(d.at(-1)!.classes, ["b-strong"]);
  assert.deepEqual(parseAnsi("\x1b[7mE")[0][0].classes, ["t-inverse"]);
  assert.ok(d.find((s) => s.text === "C")!.classes.includes("t-strong"));
  const lines = parseAnsi("one\n\x1b[31mtwo\n\n  \n");
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[1][0].classes, ["t-red"]);
  assert.deepEqual(parseAnsi(""), [[]]);
});

test("W17 landing at /, dashboard at /dashboard, drawn characters and legacy hash forwarding", async () => {
  const f = await setup();
  try {
    const landing = await fetch(f.url + "/");
    assert.equal(landing.status, 200);
    assert.match(landing.headers.get("content-type")!, /^text\/html/);
    const html = await landing.text();
    assert.ok(html.includes('id="landing"'));
    assert.ok(
      html.includes('href="/dashboard"'),
      "fallback links the dashboard",
    );
    // The redirect runs before the theme script and any paint.
    assert.ok(html.indexOf("/legacy.js") < html.indexOf("/theme.js"));
    assert.ok(html.includes("/ui/components.js"));
    assert.equal(html.includes("/app.js"), false);
    const dashboard = await (await fetch(f.url + "/dashboard")).text();
    assert.ok(dashboard.includes("/app.js"));
    assert.ok(dashboard.includes('class="toolbar-brand" href="/"'));
    // The characters are drawn in the bundle (Cast.tsx); the landing serves
    // no image files of its own.
    const bundle = await (await fetch(f.url + "/ui/components.js")).text();
    for (const marker of ["lp-hero", "cast-float", "lp-pipe"])
      assert.ok(bundle.includes(marker), marker);
    // The team shows the two reviewer subagents the PM really calls.
    for (const member of ["SEO 에이전트", "보안 에이전트"])
      assert.ok(bundle.includes(member), member);
    for (const route of [
      "/dashboard/",
      "/dashboard?x=1",
      "/index.html",
      "/landing.html",
      "/dashboard.html",
      "/landing/",
      "/landing/other.webp",
      "/landing/hero.webp",
      "/landing/agent-pm.webp",
      "/landing/team.webp",
      "/landing/../config.json",
    ])
      assert.equal((await httpRequest(f.url + route)).status, 404, route);

    // legacy.js as served: old dashboard hashes move to /dashboard, the
    // landing's own anchors stay.
    const legacy = await (await fetch(f.url + "/legacy.js")).text();
    const forward = (hash: string) => {
      let target: string | null = null;
      vm.runInNewContext(legacy, {
        location: { hash, replace: (url: string) => (target = url) },
      });
      return target;
    };
    for (const [hash, target] of [
      ["#/", "/dashboard#/"],
      ["#/p/company", "/dashboard#/p/company"],
      ["#/p/%ED%95%9C", "/dashboard#/p/%ED%95%9C"],
      ["#/structure", "/dashboard#/structure"],
      ["#/request", "/dashboard#/request"],
      ["#company-2026", "/dashboard#company-2026"],
      ["#showcase", null],
      ["#flow", null],
      ["#watch", null],
      ["#team", null],
      ["#examples", null],
      ["#faq", null],
      ["#main", null],
      ["", null],
      ["#%EC%82%AC%EB%A1%80", null],
    ])
      assert.equal(forward(hash!), target, hash!);
  } finally {
    await f.close();
  }
});

test("W18 showcase lists produced projects with a cover shot and nothing else", async () => {
  const f = await setup();
  try {
    const empty = await (await fetch(f.url + "/api/showcase")).json();
    assert.deepEqual(empty.projects, []);
    assert.equal(empty.summary.projects, 0);
    assert.equal(empty.summary.max_parallel, 2);

    const png = Buffer.from("89504e470d0a1a0a0000", "hex");
    const put = async (dir: string, file: string, at: string) => {
      const target = path.join(dir, file);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, png);
      await fs.utimes(target, new Date(at), new Date(at));
    };
    for (const id of ["company", "second", "third", "dropped", "blank"])
      await request(brokerSocket(f.config), f.submit(id));
    const projects = f.b.store.state.projects;
    const runOf = (id: string) => current(projects[id]).run_id;
    const runs = (id: string, run = runOf(id)) =>
      path.join(projects[id].directory, ".herdr/runs", run);

    // Delivered: final + an earlier round, a ready preview, a PRD heading.
    const company = projects.company;
    await fs.writeFile(
      path.join(company.directory, "prd.md"),
      "# 한결 식탁공방 — 공방 소개 홈페이지\n\nSECRET_PRD_BODY 연락처 010-0000-0000\n",
    );
    await put(
      runs("company"),
      "reports/look/1/desktop.png",
      "2026-10-01T01:00:00Z",
    );
    for (const file of ["desktop.png", "mobile.png", "desktop-full.png"])
      await put(
        runs("company"),
        `reports/look/final/${file}`,
        "2026-10-02T01:00:00Z",
      );
    await fs.writeFile(
      path.join(runs("company"), "reports/look/final/verdict.md"),
      "PRIVATE_VERDICT",
    );
    const cr = current(company);
    cr.agents[0].token = "PRIVATE_AGENT_CAPABILITY";
    cr.preview = {
      status: "ready",
      run_id: cr.run_id,
      url: "http://127.0.0.1:4300",
      argv: ["PRIVATE_PREVIEW_ARGS"],
    };
    await f.b.save(company);
    // In progress: only round 2 so far, no PRD file (name falls back to id).
    await put(
      runs("second"),
      "reports/look/2/desktop.png",
      "2026-10-03T01:00:00Z",
    );
    // Final in an earlier run, nothing yet in the current one.
    await put(
      runs("third", "run-old"),
      "reports/look/final/desktop.png",
      "2026-10-01T05:00:00Z",
    );
    const tr = current(projects.third);
    tr.preview = {
      status: "ready",
      run_id: tr.run_id,
      url: "http://127.0.0.1:4301",
    };
    await f.b.save(projects.third);
    // Cancelled without a final round: not a produced homepage.
    await put(
      runs("dropped"),
      "reports/look/1/desktop.png",
      "2026-10-04T01:00:00Z",
    );
    current(projects.dropped).status = "cancelled";
    await f.b.save(projects.dropped);

    const before = JSON.stringify(f.b.store.state);
    const res = await fetch(f.url + "/api/showcase");
    assert.equal(res.status, 200);
    const body = await res.text(),
      data = JSON.parse(body);
    assert.deepEqual(
      data.projects.map((p: any) => [p.project_id, p.delivered, p.round]),
      [
        ["company", true, "final"],
        ["third", true, "final"],
        ["second", false, "2"],
      ],
    );
    const [c, t, s] = data.projects;
    assert.equal(c.name, "한결 식탁공방");
    assert.equal(s.name, "second");
    assert.equal(c.rounds, 2);
    assert.equal(c.stage, "final");
    assert.deepEqual(c.shots.desktop, {
      path: `${cr.run_id}/final/desktop.png`,
      mtime: "2026-10-02T01:00:00.000Z",
    });
    assert.equal(c.shots.mobile_full, null);
    assert.equal(c.preview_url, "http://127.0.0.1:4300/");
    assert.equal(t.run_id, "run-old");
    assert.equal(t.preview_url, null, "preview belongs to the current run");
    assert.equal(s.stage, "first-screen");
    assert.deepEqual(data.summary, {
      projects: 5,
      showcased: 3,
      delivered: 2,
      active: 0,
      queued: 4,
      review: 0,
      max_parallel: 2,
    });
    assert.deepEqual(Object.keys(c).sort(), [
      "at",
      "created_at",
      "delivered",
      "name",
      "preview_url",
      "project_id",
      "round",
      "rounds",
      "run_id",
      "shots",
      "stage",
      "status",
    ]);
    for (const secret of [
      f.root,
      "SECRET_PRD_BODY",
      "010-0000",
      "PRIVATE_",
      "verdict",
      "directory",
      "token",
    ])
      assert.equal(body.includes(secret), false, secret);
    // Covers load through the existing whitelisted image route.
    for (const url of [
      `/api/projects/company/shots/${c.shots.desktop.path}?v=1`,
      `/api/projects/third/shots/${t.shots.desktop.path}?v=1`,
    ]) {
      const image = await fetch(f.url + url);
      assert.equal(image.status, 200, url);
      assert.equal(image.headers.get("content-type"), "image/png");
    }
    assert.equal((await httpRequest(f.url + "/api/showcase?x=1")).status, 404);
    assert.equal(
      (await httpRequest(f.url + "/api/showcase", {}, "POST")).status,
      405,
    );
    assert.equal(JSON.stringify(f.b.store.state), before);
    assert.equal(f.h.calls.length, 0);
  } finally {
    await f.close();
  }
});

test("W19 showcase display name comes from the PRD heading only", () => {
  for (const [prd, name] of [
    ["# 반경 정비소 홈페이지\n## Overview", "반경 정비소"],
    ["# 한결 식탁공방 — 공방 소개 홈페이지", "한결 식탁공방"],
    ["# Morrow Works 기업용 랜딩 페이지 PRD", "Morrow Works"],
    [
      "# Example Studio 홈페이지 · Higgsfield 이미지 생성 테스트 PRD",
      "Example Studio",
    ],
    ["작성일 2026-10-07\n## 개요\n# **PAW & DAY** — 웰니스", "PAW & DAY"],
    ["# A\u0007B 홈페이지", "AB"],
    ["# 홈페이지", "fallback"],
    ["본문만 있고 제목이 없습니다", "fallback"],
    ["#해시태그처럼 붙은 줄", "fallback"],
    [`# ${"가".repeat(80)}`, "가".repeat(48)],
  ])
    assert.equal(displayName(prd, "fallback"), name, prd);
});

test("W20 answer route: action token, Korean schema errors, receipt dedupe, stale question and schema-only snapshot", async () => {
  const f = await setup();
  try {
    await f.b.handle(f.submit());
    const p = f.b.store.state.projects.A,
      r = current(p);
    const choice = {
      type: "object",
      properties: {
        choice: {
          type: "string",
          enum: ["retry", "complete_without_preview"],
          description:
            "retry: 다시 시도 / complete_without_preview: 미리보기 없이 완료",
        },
        note: { type: "string" },
      },
      required: ["choice"],
    };
    const question = (
      request_id: string,
      kind: "execution_choice" | "terminal_action",
      schema: any,
    ) => ({
      request_id,
      run_id: r.run_id,
      agent_id: r.agents[0].agent_id,
      task_id: "plan",
      kind,
      question: `${request_id} 질문`,
      response_schema: schema,
      status: "open" as const,
    });
    r.questions.push(
      question("q1", "execution_choice", choice),
      question("q2", "terminal_action", { type: "string" }),
    );
    await f.b.save(p);
    const csrf = (await (await fetch(f.url + "/api/bootstrap")).json()).csrf;
    const post = (body: any, headers: Record<string, string> = {}) =>
      fetch(f.url + "/api/projects/answer", {
        method: "POST",
        headers: {
          Origin: f.url,
          "Content-Type": "application/json",
          "X-Homepage-Token": csrf,
          ...headers,
        },
        body: typeof body === "string" ? body : JSON.stringify(body),
      });
    const ok = {
      project_id: "A",
      run_id: r.run_id,
      request_id: "q1",
      response: { choice: "retry", note: "다른 미리보기를 멈췄습니다" },
      command_id: randomUUID(),
    };
    const before = JSON.stringify(f.b.store.state);
    assert.equal((await post(ok, { "X-Homepage-Token": "wrong" })).status, 403);
    assert.equal(
      (await post(ok, { "Content-Type": "text/plain" })).status,
      403,
    );
    assert.equal(
      (await post(ok, { Origin: "http://evil.example" })).status,
      403,
    );
    const noToken = await fetch(f.url + "/api/projects/answer", {
      method: "POST",
      headers: { Origin: f.url, "Content-Type": "application/json" },
      body: JSON.stringify(ok),
    });
    assert.equal(noToken.status, 403);
    for (const value of [
      { ...ok, argv: ["sh"] },
      { ...ok, command_id: "short" },
      { ...ok, terminal_resolved: "yes" },
      {
        project_id: "A",
        run_id: r.run_id,
        request_id: "q1",
        command_id: randomUUID(),
      },
    ]) {
      const res = await post(value);
      assert.equal(res.status, 400);
      assert.equal((await res.json()).error, "invalid_request");
    }
    const large = await post({
      ...ok,
      response: { choice: "retry", note: "가".repeat(30000) },
    });
    assert.equal(large.status, 413);
    const bad = await post({ ...ok, response: { choice: "maybe" } });
    assert.equal(bad.status, 422);
    const badBody = await bad.json();
    assert.equal(badBody.error, "invalid_answer");
    assert.match(badBody.message, /질문의 형식에 맞지 않습니다/);
    assert.doesNotMatch(JSON.stringify(badBody), /must|cli\.js|\/private\//);
    const terminal = {
      ...ok,
      request_id: "q2",
      response: "pane에서 로그인했습니다",
      command_id: randomUUID(),
    };
    const unresolved = await post(terminal);
    assert.equal(unresolved.status, 422);
    assert.equal((await unresolved.json()).error, "terminal_action_required");
    assert.equal(JSON.stringify(f.b.store.state), before);

    const first = await post(ok);
    assert.equal(first.status, 200);
    const receipt = await first.json();
    assert.equal(receipt.request_id, "q1");
    assert.equal(receipt.status, "answered");
    const again = await post(ok);
    assert.equal(again.status, 200);
    const replay = await again.json();
    assert.deepEqual(
      [replay.request_id, replay.status],
      [receipt.request_id, receipt.status],
    );
    const conflict = await post({
      ...ok,
      response: { choice: "complete_without_preview" },
    });
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).error, "command_conflict");
    const stale = await post({ ...ok, command_id: randomUUID() });
    assert.equal(stale.status, 409);
    const staleBody = await stale.json();
    assert.equal(staleBody.error, "stale_question");
    assert.match(staleBody.message, /이미 답했거나/);
    const resolved = await post({ ...terminal, terminal_resolved: true });
    assert.equal(resolved.status, 200);
    const run = current(f.b.store.state.projects.A);
    assert.deepEqual(
      run.questions.map((q) => q.status),
      ["answered", "answered"],
    );
    assert.deepEqual(run.questions[0].response, ok.response);

    const status = await (await fetch(f.url + "/api/status")).json();
    const shown = status.projects[0].input_requests;
    assert.deepEqual(shown[0].response_schema, choice);
    assert.deepEqual(shown[1].response_schema, { type: "string" });
    assert.ok(shown.every((q: any) => !("response" in q)));
    assert.ok(!JSON.stringify(status).includes(r.agents[0].token));
  } finally {
    await f.close();
  }
});
