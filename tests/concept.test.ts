import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fixture, FakeHerdr } from "./helpers.js";
import { Dashboard } from "../src/web/server.js";
import { conceptAgent } from "../src/concept/agent.js";
import { GREETING } from "../src/concept/prompt.js";

const draft = (extra: object = {}) => ({
  project_id: "moru-coffee",
  name: "모루",
  business: "성수동 핸드드립 카페",
  audience: "",
  primary_action: "",
  must_include: ["원두 판매"],
  tone: "",
  sections: [],
  images: "",
  missing: ["방문자", "분위기"],
  ...extra,
});
const documents = (extra: object = {}) => ({
  project_id: "moru-coffee",
  prd: "# 모루 — 카페 홈페이지",
  design: "# 모루 — 디자인 방향",
  ...extra,
});
const answer = (extra: object = {}) => ({
  reply: "주로 어떤 분들이 찾아오나요?",
  choices: ["동네 주민이에요", "알아서 정해 주세요"],
  ready: false,
  draft: draft(),
  ...extra,
});

// A fake claude: records argv, stdin, cwd and env names, then prints the
// --output-format json envelope around output.json (chat turns) or
// compose.json (the documents schema). `mode` selects failures.
async function setup() {
  const f = await fixture();
  const dir = path.join(f.root, "fake");
  await fs.mkdir(dir);
  const bin = path.join(dir, "claude.cjs");
  await fs.writeFile(
    bin,
    `#!${process.execPath}
const fs = require("fs"), path = require("path"), dir = ${JSON.stringify(dir)};
let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (s) => (stdin += s));
process.stdin.on("end", () => {
  fs.appendFileSync(path.join(dir, "calls.jsonl"), JSON.stringify({ argv: process.argv.slice(2), stdin, cwd: process.cwd(), env: Object.keys(process.env) }) + "\\n");
  let mode = "ok";
  try { mode = fs.readFileSync(path.join(dir, "mode"), "utf8").trim(); } catch {}
  const schema = process.argv[process.argv.indexOf("--json-schema") + 1] || "";
  const file = schema.includes('"prd"') ? "compose.json" : "output.json";
  const out = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
  const reply = () => {
    if (mode === "login") {
      process.stdout.write(JSON.stringify({ type: "result", is_error: true, result: "Not logged in · Please run /login" }));
      process.exit(1);
    }
    process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: JSON.stringify(out), structured_output: out }));
  };
  const wait = /^sleep:(\\d+)$/.exec(mode);
  if (wait) setTimeout(reply, Number(wait[1])); else reply();
});
`,
  );
  await fs.chmod(bin, 0o755);
  await fs.writeFile(path.join(dir, "output.json"), JSON.stringify(answer()));
  await fs.writeFile(
    path.join(dir, "compose.json"),
    JSON.stringify(documents()),
  );
  conceptAgent.bin = bin;
  conceptAgent.timeoutMs = 120_000;
  conceptAgent.composeTimeoutMs = 240_000;
  const d = new Dashboard(
    async () => {
      throw new Error("status is not used by concept routes");
    },
    f.config,
    undefined,
    new FakeHerdr(f.config),
  );
  await d.start(0);
  const url = d.url!;
  const csrf = (await (await fetch(url + "/api/bootstrap")).json()).csrf;
  const post = (
    route: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(url + route, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: url,
        "X-Homepage-Token": csrf,
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  const calls = async () => {
    try {
      return (await fs.readFile(path.join(dir, "calls.jsonl"), "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
    } catch {
      return [];
    }
  };
  return {
    ...f,
    dir,
    bin,
    url,
    post,
    calls,
    concepts: path.join(f.root, "concepts"),
    create: async () => (await post("/api/concepts", {})).json(),
    say: (
      id: string,
      text: string,
      client_message_id: string = crypto.randomUUID(),
    ) => post(`/api/concepts/${id}/messages`, { text, client_message_id }),
    compose: (id: string, client_request_id: string = crypto.randomUUID()) =>
      post(`/api/concepts/${id}/documents`, { client_request_id }),
    get: async (id: string) =>
      (await fetch(url + `/api/concepts/${id}`)).json(),
    mode: (m: string) => fs.writeFile(path.join(dir, "mode"), m),
    output: (o: unknown) =>
      fs.writeFile(path.join(dir, "output.json"), JSON.stringify(o)),
    composed: (o: unknown) =>
      fs.writeFile(path.join(dir, "compose.json"), JSON.stringify(o)),
    close: async () => {
      conceptAgent.bin = null;
      conceptAgent.timeoutMs = 120_000;
      conceptAgent.composeTimeoutMs = 240_000;
      await d.close();
      await fs.rm(f.root, { recursive: true, force: true });
    },
  };
}

async function until(check: () => Promise<boolean>) {
  for (let i = 0; i < 200 && !(await check()); i++)
    await new Promise((r) => setTimeout(r, 20));
}

test("C01 concept writes need same origin, the action token and JSON", async () => {
  const f = await setup();
  try {
    const c = await f.create();
    for (const [route, body] of [
      ["/api/concepts", {}],
      [
        `/api/concepts/${c.concept_id}/messages`,
        { text: "카페", client_message_id: "c01-message" },
      ],
      [
        `/api/concepts/${c.concept_id}/documents`,
        { client_request_id: "c01-documents" },
      ],
    ] as const) {
      assert.equal(
        (await f.post(route, body, { "X-Homepage-Token": "wrong" })).status,
        403,
      );
      assert.equal(
        (await f.post(route, body, { Origin: "http://evil.example" })).status,
        403,
      );
      assert.equal(
        (await f.post(route, body, { "Content-Type": "text/plain" })).status,
        403,
      );
    }
    // No origin header at all is not a browser write either.
    const bare = await fetch(f.url + "/api/concepts", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Homepage-Token": "x" },
      body: "{}",
    });
    assert.equal(bare.status, 403);
    assert.equal((await f.calls()).length, 0);
    assert.equal((await fetch(f.url + "/api/concepts")).status, 405);
    assert.equal(
      (await f.post(`/api/concepts/${c.concept_id}`, {})).status,
      405,
    );
    assert.equal(
      (await fetch(f.url + `/api/concepts/${c.concept_id}/documents`)).status,
      405,
    );
    assert.equal(
      (await fetch(f.url + "/api/concepts/no-such-chat")).status,
      404,
    );
    assert.equal(
      (await fetch(f.url + "/api/concepts/..%2Fconfig")).status,
      404,
    );
    assert.equal((await f.post("/api/concepts", { prd: "x" })).status, 400);
    assert.equal((await f.post("/api/concepts", "not json")).status, 400);
  } finally {
    await f.close();
  }
});

test("C02 conversation: greeting, one turn through a tool-less claude, stored 0600 without paths", async () => {
  const f = await setup();
  try {
    const c = await f.create();
    assert.match(c.concept_id, /^[a-zA-Z0-9_-]{1,128}$/);
    assert.deepEqual(
      c.messages.map((m: any) => [m.role, m.text]),
      [["agent", GREETING]],
    );
    assert.equal(c.draft, null);
    assert.equal(c.agent.available, true);
    assert.equal((await f.calls()).length, 0, "the greeting calls no model");
    const text = "성수동에서 '모루'라는 핸드드립 카페를 해요. --tools Bash";
    const res = await f.say(c.concept_id, text);
    assert.equal(res.status, 200);
    const v = await res.json();
    assert.equal(v.messages.length, 3);
    assert.deepEqual(v.messages[1], {
      role: "user",
      text,
      at: v.messages[1].at,
    });
    assert.equal(v.messages[2].text, "주로 어떤 분들이 찾아오나요?");
    assert.deepEqual(v.messages[2].choices, [
      "동네 주민이에요",
      "알아서 정해 주세요",
    ]);
    assert.equal(v.draft.name, "모루");
    assert.equal(v.ready, false);
    assert.equal(v.user_turns, 1);
    assert.equal(v.pending, null);

    const [call] = await f.calls();
    const at = (flag: string) => call.argv[call.argv.indexOf(flag) + 1];
    assert.equal(call.argv[0], "-p");
    assert.equal(at("--tools"), "");
    assert.equal(at("--model"), "claude-opus-5-5");
    assert.equal(at("--effort"), "medium");
    assert.equal(at("--setting-sources"), "");
    assert.equal(at("--output-format"), "json");
    assert.ok(
      !at("--json-schema").includes('"prd"'),
      "chat writes no documents",
    );
    for (const flag of [
      "--strict-mcp-config",
      "--no-session-persistence",
      "--json-schema",
      "--system-prompt",
    ])
      assert.ok(call.argv.includes(flag), flag);
    assert.ok(
      !call.argv.some((a: string) => a.includes("모루")),
      "user text stays out of argv",
    );
    assert.ok(call.stdin.includes("모루"));
    assert.ok(call.stdin.includes(GREETING));
    assert.match(call.stdin, /데이터/);
    assert.equal(
      await fs.realpath(call.cwd),
      await fs.realpath(path.join(f.concepts, "work")),
    );
    assert.ok(!call.env.some((k: string) => /^(HERDR_|HOMEPAGE_)/.test(k)));

    const file = path.join(f.concepts, `${c.concept_id}.json`);
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
    const saved = JSON.parse(await fs.readFile(file, "utf8"));
    assert.equal(saved.messages.length, 3);
    const got = await fetch(f.url + `/api/concepts/${c.concept_id}`);
    assert.equal(got.status, 200);
    const body = await got.text();
    assert.equal(JSON.parse(body).messages.length, 3);
    for (const secret of [
      f.root,
      f.bin,
      "--json-schema",
      "--system-prompt",
      'client_message_id":"',
    ])
      assert.ok(!body.includes(secret), secret);

    // Ready means "enough to write the documents"; the turn carries none.
    await f.output(
      answer({
        ready: true,
        reply: "이제 문서를 만들 수 있어요.",
        draft: draft({ missing: [] }),
      }),
    );
    const ready = await (
      await f.say(c.concept_id, "알아서 정해 주세요")
    ).json();
    assert.equal(ready.ready, true);
    assert.equal(ready.draft.project_id, "moru-coffee");
    assert.equal(ready.draft.prd, undefined);
    assert.equal(ready.documents, null);
    assert.equal(ready.documents_stale, false);
    assert.match(
      (await f.calls())[1].stdin,
      /성수동/,
      "history goes to the next turn",
    );
  } finally {
    await f.close();
  }
});

test("C03 limits: 2000 characters, busy turn 409, one model call per client_message_id, turn and capacity caps", async () => {
  const f = await setup();
  try {
    const c = await f.create();
    const long = await f.say(c.concept_id, "가".repeat(2001));
    assert.equal(long.status, 400);
    assert.equal((await long.json()).error, "invalid_request");
    assert.equal((await f.say(c.concept_id, "   ")).status, 400);
    assert.equal(
      (
        await f.post(`/api/concepts/${c.concept_id}/messages`, {
          text: "카페",
          client_message_id: "c03",
          extra: 1,
        })
      ).status,
      400,
    );
    assert.equal((await f.calls()).length, 0);

    await f.mode("sleep:600");
    const first = f.say(c.concept_id, "카페를 해요", "c03-first-message");
    await until(async () => (await f.calls()).length === 1);
    const view = await (
      await fetch(f.url + `/api/concepts/${c.concept_id}`)
    ).json();
    assert.equal(view.pending.text, "카페를 해요");
    const busy = await f.say(c.concept_id, "다른 말", "c03-other-message");
    assert.equal(busy.status, 409);
    assert.equal((await busy.json()).error, "concept_busy");
    // The same message sent again while running waits for the same turn.
    const joined = await f.say(
      c.concept_id,
      "카페를 해요",
      "c03-first-message",
    );
    assert.equal((await (await first).json()).messages.length, 3);
    assert.equal((await joined.json()).messages.length, 3);
    await f.mode("ok");
    const again = await f.say(c.concept_id, "카페를 해요", "c03-first-message");
    assert.equal(again.status, 200);
    assert.equal((await again.json()).messages.length, 3);
    assert.equal(
      (await f.calls()).length,
      1,
      "resends never call claude again",
    );

    // Two turns run at once in total.
    await f.mode("sleep:600");
    const [a, b, x] = [await f.create(), await f.create(), await f.create()];
    const runs = [f.say(a.concept_id, "하나"), f.say(b.concept_id, "둘")];
    await until(async () => (await f.calls()).length === 3);
    const full = await f.say(x.concept_id, "셋");
    assert.equal(full.status, 503);
    assert.equal((await full.json()).error, "concept_capacity");
    for (const r of await Promise.all(runs)) assert.equal(r.status, 200);

    // 16 user turns per conversation.
    const file = path.join(f.concepts, `${x.concept_id}.json`);
    const saved = JSON.parse(await fs.readFile(file, "utf8"));
    for (let i = 0; i < 16; i++)
      saved.messages.push(
        {
          role: "user",
          text: `답 ${i}`,
          at: saved.created_at,
          client_message_id: `seed-${i}-message`,
        },
        { role: "agent", text: "다음 질문", at: saved.created_at, choices: [] },
      );
    await fs.writeFile(file, JSON.stringify(saved));
    const capped = await f.say(x.concept_id, "하나 더");
    assert.equal(capped.status, 409);
    assert.equal((await capped.json()).error, "concept_turn_limit");
  } finally {
    await f.close();
  }
});

test("C04 failed turns are not recorded: invalid output, login, timeout, missing claude", async () => {
  const f = await setup();
  try {
    const c = await f.create();
    const file = path.join(f.concepts, `${c.concept_id}.json`);
    const before = await fs.readFile(file, "utf8");
    const expect = async (status: number, error: string) => {
      const res = await f.say(c.concept_id, "카페를 해요");
      assert.equal(res.status, status, error);
      const body = await res.json();
      assert.equal(body.error, error);
      assert.match(body.message, /[가-힣]/);
      assert.ok(!JSON.stringify(body).includes(f.root));
      assert.equal(
        await fs.readFile(file, "utf8"),
        before,
        `${error} leaves no turn`,
      );
    };
    for (const bad of [
      { ...answer(), reply: "가".repeat(601) },
      { ...answer(), choices: ["하나", "둘", "셋", "넷", "다섯"] },
      { ...answer(), draft: draft({ project_id: "Moru Coffee" }) },
      { ...answer(), draft: draft({ prd: "# 모루", design: "# 모루" }) },
      { ...answer(), extra: true },
      { reply: "형식 없음" },
    ]) {
      await f.output(bad);
      await expect(502, "concept_output_invalid");
    }
    await f.output(answer());
    await f.mode("login");
    await expect(503, "concept_login_required");
    await f.mode("sleep:2000");
    conceptAgent.timeoutMs = 200;
    await expect(504, "concept_timeout");
    conceptAgent.timeoutMs = 120_000;
    await f.mode("ok");
    conceptAgent.bin = path.join(f.dir, "missing-claude");
    await expect(503, "concept_claude_missing");
    conceptAgent.bin = f.bin;
    const ok = await f.say(c.concept_id, "카페를 해요");
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).messages.length, 3);
  } finally {
    await f.close();
  }
});

test("C05 concept files expire after 14 days and at most 50 are kept", async () => {
  const f = await setup();
  try {
    const first = await f.create();
    const old = path.join(f.concepts, `${first.concept_id}.json`);
    const day = 24 * 3600 * 1000;
    await fs.utimes(
      old,
      new Date(Date.now() - 15 * day),
      new Date(Date.now() - 15 * day),
    );
    await f.create();
    await assert.rejects(fs.stat(old));
    for (let i = 0; i < 55; i++) await f.create();
    const files = (await fs.readdir(f.concepts)).filter((n) =>
      n.endsWith(".json"),
    );
    assert.equal(files.length, 50);
    assert.equal(
      (await fetch(f.url + `/api/concepts/${first.concept_id}`)).status,
      404,
    );
  } finally {
    await f.close();
  }
});

// A conversation that has reached ready (one user turn); later chat turns
// stay ready unless a test changes output.json.
async function readyConcept(f: Awaited<ReturnType<typeof setup>>) {
  const c = await f.create();
  await f.output(answer({ ready: true, draft: draft({ missing: [] }) }));
  assert.equal((await f.say(c.concept_id, "모루 카페, 알아서")).status, 200);
  return c.concept_id as string;
}

test("C06 documents: separate tool-less call, stored once per client_request_id, shares the turn lock", async () => {
  const f = await setup();
  try {
    const early = await f.create();
    const notReady = await f.compose(early.concept_id, "c06-early-request");
    assert.equal(notReady.status, 409);
    assert.equal((await notReady.json()).error, "concept_not_ready");
    assert.equal((await f.calls()).length, 0);

    const id = await readyConcept(f);
    const file = path.join(f.concepts, `${id}.json`);
    const res = await f.compose(id, "c06-documents-1");
    assert.equal(res.status, 200);
    const v = await res.json();
    assert.deepEqual(v.documents, {
      ...documents(),
      at: v.documents.at,
      user_turns: 1,
    });
    assert.equal(v.documents_stale, false);
    assert.equal(v.pending, null);
    assert.equal(v.messages.length, 3, "documents add no chat message");

    const calls = await f.calls();
    assert.equal(calls.length, 2);
    const [chat, write] = calls;
    const at = (flag: string) => write.argv[write.argv.indexOf(flag) + 1];
    assert.equal(write.argv[0], "-p");
    assert.equal(at("--tools"), "");
    assert.equal(at("--model"), "claude-opus-5-5");
    assert.equal(at("--effort"), "medium");
    assert.equal(at("--setting-sources"), "");
    for (const flag of ["--strict-mcp-config", "--no-session-persistence"])
      assert.ok(write.argv.includes(flag), flag);
    assert.ok(at("--json-schema").includes('"prd"'));
    assert.notEqual(
      at("--system-prompt"),
      chat.argv[chat.argv.indexOf("--system-prompt") + 1],
    );
    assert.ok(!write.argv.some((a: string) => a.includes("모루 카페")));
    assert.ok(write.stdin.includes("모루 카페, 알아서"));
    assert.match(write.stdin, /데이터/);
    assert.equal(
      await fs.realpath(write.cwd),
      await fs.realpath(path.join(f.concepts, "work")),
    );
    assert.ok(!write.env.some((k: string) => /^(HERDR_|HOMEPAGE_)/.test(k)));
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
    const saved = JSON.parse(await fs.readFile(file, "utf8"));
    assert.equal(saved.documents.prd, documents().prd);
    const body = await (await fetch(f.url + `/api/concepts/${id}`)).text();
    for (const secret of [
      f.root,
      f.bin,
      'client_request_id":"',
      "--json-schema",
    ])
      assert.ok(!body.includes(secret), secret);

    // The same request again returns the stored documents.
    const again = await f.compose(id, "c06-documents-1");
    assert.equal(again.status, 200);
    assert.equal((await again.json()).documents.prd, documents().prd);
    assert.equal((await f.calls()).length, 2, "no second model call");

    // While documents are written, messages and other requests are busy.
    await f.mode("sleep:600");
    const running = f.compose(id, "c06-documents-2");
    await until(async () => (await f.calls()).length === 3);
    const pending = (await f.get(id)).pending;
    assert.equal(pending.kind, "documents");
    assert.equal(pending.text, undefined);
    const busy = await f.say(id, "분위기를 밝게");
    assert.equal(busy.status, 409);
    assert.equal((await busy.json()).error, "concept_busy");
    const other = await f.compose(id, "c06-documents-3");
    assert.equal(other.status, 409);
    const joined = await f.compose(id, "c06-documents-2");
    assert.equal((await running).status, 200);
    assert.equal(joined.status, 200);
    assert.equal((await f.calls()).length, 3);

    // And a running chat turn blocks documents.
    const turn = f.say(id, "분위기를 밝게", "c06-message-1");
    await until(async () => (await f.calls()).length === 4);
    assert.equal((await f.get(id)).pending.kind, "message");
    const blocked = await f.compose(id, "c06-documents-4");
    assert.equal(blocked.status, 409);
    assert.equal((await blocked.json()).error, "concept_busy");
    assert.equal((await turn).status, 200);
    await f.mode("ok");

    // Failed writes leave the stored documents as they were.
    const before = await fs.readFile(file, "utf8");
    for (const bad of [
      documents({ prd: "" }),
      documents({ project_id: "Moru Coffee" }),
      documents({ extra: true }),
      { project_id: "moru-coffee", prd: "# 모루" },
      answer(),
    ]) {
      await f.composed(bad);
      const r = await f.compose(id);
      assert.equal(r.status, 502);
      const e = await r.json();
      assert.equal(e.error, "concept_output_invalid");
      assert.match(e.message, /문서/);
      assert.equal(await fs.readFile(file, "utf8"), before);
    }
    await f.composed(documents());
    await f.mode("sleep:2000");
    conceptAgent.composeTimeoutMs = 200;
    const slow = await f.compose(id);
    assert.equal(slow.status, 504);
    const timeout = await slow.json();
    assert.equal(timeout.error, "concept_timeout");
    assert.match(timeout.message, /문서 직접 작성/);
    assert.equal(await fs.readFile(file, "utf8"), before);
  } finally {
    await f.close();
  }
});

test("C07 documents go stale when the chat continues and avoid existing project IDs", async () => {
  const f = await setup();
  try {
    const id = await readyConcept(f);
    await fs.mkdir(path.join(f.config.projectsRoot!, "moru-coffee"), {
      recursive: true,
    });
    const first = await (await f.compose(id)).json();
    assert.equal(first.documents.project_id, "moru-coffee-2");
    assert.equal(first.documents_stale, false);

    await f.output(answer({ ready: true, draft: draft({ tone: "밝게" }) }));
    const edited = await (await f.say(id, "분위기를 더 밝게 해 주세요")).json();
    assert.equal(edited.documents_stale, true);
    assert.equal(edited.documents.user_turns, 1);
    assert.equal(edited.user_turns, 2);
    assert.match(
      (await f.calls()).at(-1).stdin,
      /"documents_made": true/,
      "the chat knows documents exist",
    );

    await fs.mkdir(path.join(f.config.projectsRoot!, "moru-coffee-2"));
    const second = await (await f.compose(id)).json();
    assert.equal(second.documents.project_id, "moru-coffee-3");
    assert.equal(second.documents.user_turns, 2);
    assert.equal(second.documents_stale, false);
  } finally {
    await f.close();
  }
});
