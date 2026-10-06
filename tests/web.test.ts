import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fixture, FakeHerdr } from "./helpers.js";
import { Broker } from "../src/broker/broker.js";
import { brokerSocket, config } from "../src/config.js";
import { request } from "../src/broker/client.js";
import { current, makeTask } from "../src/domain/engine.js";
import { Dashboard, previewUrl } from "../src/web/server.js";

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
      ["/", "홈페이지 제작 현황"],
      ["/app.js", "textContent"],
      ["/style.css", ".workbench"],
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
      response_schema: { secret: "PRIVATE_SCHEMA" },
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
