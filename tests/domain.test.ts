import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fixture, cmd, legacyTeam } from "./helpers.js";
import { command, checkpoint } from "../src/contracts/validate.js";
import {
  mutate,
  current,
  validatePlan,
  report,
  readyTasks,
  canAssign,
  makeTask,
} from "../src/domain/engine.js";
import { Checkpoint } from "../src/contracts/types.js";
import { canonical, hash, Store } from "../src/storage/store.js";
import { config, actionGuard } from "../src/config.js";
const blank = (): Checkpoint => ({
  schema_version: 1,
  revision: 0,
  queue_seq: 0,
  projects: {},
  commands: {},
});
async function project() {
  const f = await fixture();
  const s = blank();
  await mutate(s, f.submit(), f.config);
  return { ...f, s, p: s.projects.A, r: current(s.projects.A) };
}
test("T01 rejects malformed envelope and unknown version", () => {
  for (const v of [
    {},
    { schema_version: 2, command_id: "x", type: "submit", payload: {} },
    { schema_version: 1, command_id: "x", type: "oops", payload: {} },
  ])
    assert.throws(() => command(v));
});
test("T02 checkpoint preserves one PM and rejects invalid status/model/slots", async () => {
  const f = await project();
  try {
    assert.equal(checkpoint(f.s), f.s);
    assert.equal(f.r.agents.length, 1);
    const extra = structuredClone(f.s);
    extra.projects.A.runs[0].agents.push(structuredClone(f.r.agents[0]));
    assert.throws(() => checkpoint(extra), /run record/);
    const legacy = structuredClone(f.s);
    legacyTeam(legacy.projects.A.runs[0]);
    assert.equal(checkpoint(legacy), legacy);
    delete legacy.projects.A.runs[0].orchestration;
    assert.equal(checkpoint(legacy), legacy);
    const bad = structuredClone(f.s);
    bad.projects.A.runs[0].agents[0].model = "wrong";
    assert.throws(() => checkpoint(bad));
  } finally {
    await fs.rm(f.root, { recursive: true });
  }
});
test("T03 immutable bytes/hash and document mismatch", async () => {
  const f = await project();
  try {
    await fs.writeFile(f.inputs.prd.path, "v2");
    assert.equal(
      hash(await fs.readFile(f.r.inputs.prd.path)),
      f.inputs.prd.sha256,
    );
    await assert.rejects(() => mutate(f.s, f.submit("B"), f.config), /prd/);
    assert.equal(f.s.projects.B, undefined);
    const overlap = f.submit("C");
    overlap.payload.directory = path.join(f.p.directory, "nested");
    await assert.rejects(() => mutate(f.s, overlap, f.config), /overlap/);
  } finally {
    await fs.rm(f.root, { recursive: true });
  }
});
test("T07 malformed checkpoint is refused without replacement", async () => {
  const f = await fixture();
  try {
    const store = new Store(f.config);
    await store.acquire();
    await fs.writeFile(
      path.join(store.dir, "broker-checkpoint.json"),
      "{broken",
    );
    await assert.rejects(() => store.load());
    assert.equal(
      await fs.readFile(path.join(store.dir, "broker-checkpoint.json"), "utf8"),
      "{broken",
    );
    await store.release();
  } finally {
    await fs.rm(f.root, { recursive: true });
  }
});
test("T19 wrong role, duplicate event, out of order, completed task cannot regress", async () => {
  const f = await project();
  try {
    const a = f.r.agents[0],
      t = f.r.tasks[0];
    f.r.status = "running";
    a.task_id = t.task_id;
    t.status = "running";
    t.attempt = 1;
    t.assignment_id = "x";
    const payload = {
      agent_id: a.agent_id,
      token: a.token,
      task_id: t.task_id,
      assignment_id: "x",
      attempt: 1,
      event_id: "e1",
      sequence: 1,
      kind: "progress",
      result: "planning",
    };
    assert.throws(() => report(f.r, { ...payload, token: "wrong" }));
    report(f.r, payload);
    assert.equal(report(f.r, payload).duplicate, true);
    assert.throws(
      () => report(f.r, { ...payload, event_id: "e2" }),
      /sequence/,
    );
    assert.throws(
      () =>
        report(f.r, {
          ...payload,
          event_id: "team",
          sequence: 2,
          kind: "team-create",
        }),
      /already own/,
    );
    report(f.r, {
      ...payload,
      event_id: "e3",
      sequence: 3,
      kind: "plan",
      tasks: [
        {
          task_id: "build",
          role: "developer",
          title: "build",
          depends_on: [],
          writes: ["app/"],
        },
      ],
    });
    assert.throws(
      () => report(f.r, { ...payload, event_id: "e4", sequence: 4 }),
      /no longer/,
    );
  } finally {
    await fs.rm(f.root, { recursive: true });
  }
});
test("T17/T18 answer validates schema and requirements await versioned documents", async () => {
  const f = await project();
  try {
    f.r.questions.push({
      request_id: "q",
      run_id: f.r.run_id,
      agent_id: f.r.agents[0].agent_id,
      task_id: "plan",
      kind: "requirements_change",
      question: "회사명",
      response_schema: { type: "string" },
      status: "open",
    });
    const answer = cmd("answer", f.p, { request_id: "q", response: "새 회사" });
    await mutate(f.s, answer, f.config);
    assert.equal(f.r.questions[0].status, "awaiting_documents");
    await assert.rejects(
      () => mutate(f.s, cmd("resume", f.p), f.config),
      /questions/,
    );
    await mutate(
      f.s,
      cmd("apply-inputs", f.p, { request_id: "q", inputs: f.inputs }),
      f.config,
    );
    assert.equal(f.r.status, "superseded");
    assert.equal(f.p.runs.length, 2);
    assert.equal(f.p.runs[1].status, "queued");
    await assert.rejects(() => mutate(f.s, answer, f.config), /current run_id/);
  } finally {
    await fs.rm(f.root, { recursive: true });
  }
});
test("T20 exactly initial plus two automatic retries", async () => {
  const f = await project();
  try {
    const t = makeTask("build", "developer", "build");
    f.r.tasks = [t];
    f.r.status = "running";
    const a = f.r.agents[0];
    for (let attempt = 1; attempt <= 3; attempt++) {
      t.attempt = attempt;
      t.assignment_id = "a" + attempt;
      t.status = "running";
      a.task_id = "build";
      report(f.r, {
        agent_id: a.agent_id,
        token: a.token,
        task_id: t.task_id,
        assignment_id: t.assignment_id,
        attempt,
        event_id: randomUUID(),
        sequence: attempt,
        kind: "failed",
        result: "error",
      });
      assert.equal(t.status, attempt < 3 ? "retrying" : "waiting_input");
    }
    assert.equal(f.r.reason, "retry_exhausted");
    assert.equal(t.attempt, 3);
  } finally {
    await fs.rm(f.root, { recursive: true });
  }
});
test("T23/T30 rejects extra roles, source boundary, cycles; serializes overlapping writes", () => {
  const base = {
    task_id: "x",
    role: "developer",
    title: "x",
    depends_on: [],
    writes: ["app/"],
  };
  for (const plan of [
    [{ ...base, role: "qa" }],
    [{ ...base, writes: ["prd.md"] }],
    [{ ...base, depends_on: ["x"] }],
    [{ ...base, depends_on: ["absent"] }],
    [{ ...base, writes: ["app/../prd.md"] }],
  ])
    assert.throws(() => validatePlan(plan));
});
const studioPlan = () => [
  {
    task_id: "direction",
    role: "pm",
    title: "방향 정하기",
    depends_on: [],
    writes: ["reports/direction.md"],
  },
  {
    task_id: "first-screen",
    role: "developer",
    title: "첫 화면과 대표 섹션",
    depends_on: ["direction"],
    writes: ["app/", "assets/", "reports/look/"],
  },
  {
    task_id: "build-out",
    role: "developer",
    title: "전체 페이지 완성",
    depends_on: ["first-screen"],
    writes: ["app/", "assets/", "reports/"],
  },
];
test("T32 claude-native tasks may write any run root; pm-led and legacy keep role boundaries", () => {
  const plan = studioPlan();
  assert.deepEqual(
    validatePlan(plan, "claude-native").map((t) => [t.role, t.writes]),
    plan.map((t) => [t.role, t.writes]),
  );
  assert.deepEqual(
    validatePlan(
      [{ ...plan[0], role: "designer", writes: ["app/x", "reports/y"] }],
      "claude-native",
    )[0].writes,
    ["app/x", "reports/y"],
  );
  for (const mode of ["pm-led", undefined] as const)
    assert.throws(() => validatePlan(plan, mode), /outside assigned boundary/);
  assert.equal(
    validatePlan(
      [
        { ...plan[0], role: "designer", writes: ["assets/hero.png"] },
        { ...plan[1], depends_on: [], role: "developer", writes: ["app/"] },
      ],
      "pm-led",
    ).length,
    2,
  );
  for (const writes of [
    ["prd.md"],
    ["/tmp/app/x"],
    ["app/../prd.md"],
    ["assets/../../meta.json"],
    ["application/"],
    ["app"],
    [7],
  ])
    assert.throws(
      () =>
        validatePlan([{ ...plan[2], depends_on: [], writes }], "claude-native"),
      /outside assigned boundary/,
      JSON.stringify(writes),
    );
});
test("T33 native PM plan with multi-root tasks is accepted and dispatched one at a time; pm-led rejects it", async () => {
  const f = await project();
  try {
    const plan = (r: typeof f.r, sequence: number) => {
      const a = r.agents[0],
        t = r.tasks[0];
      r.status = "running";
      a.task_id = t.task_id;
      t.status = "running";
      t.attempt = 1;
      t.assignment_id = "plan-1";
      return report(r, {
        agent_id: a.agent_id,
        token: a.token,
        task_id: t.task_id,
        assignment_id: "plan-1",
        attempt: 1,
        event_id: randomUUID(),
        sequence,
        kind: "plan",
        tasks: studioPlan(),
      });
    };
    assert.equal(plan(f.r, 1).accepted, true);
    assert.deepEqual(
      readyTasks(f.r).map((t) => t.task_id),
      ["direction"],
    );
    const [direction, first, build] = f.r.tasks.slice(1);
    assert.equal(canAssign(f.r, direction), true);
    direction.status = "completed";
    assert.deepEqual(
      readyTasks(f.r).map((t) => t.task_id),
      ["first-screen"],
    );
    first.status = "running";
    f.r.agents[0].task_id = first.task_id;
    assert.equal(canAssign(f.r, build), false, "one PM, one assignment");
    f.r.agents[0].task_id = null;
    assert.equal(canAssign(f.r, build), false, "overlapping roots serialize");
    first.status = "completed";
    assert.equal(canAssign(f.r, build), true);
    assert.equal(checkpoint(f.s), f.s);

    const led = await project();
    try {
      legacyTeam(led.r);
      led.r.orchestration = {
        mode: "pm-led",
        team_requested: true,
        requested_by: led.r.agents[0].agent_id,
        requested_at: new Date().toISOString(),
      };
      assert.throws(() => plan(led.r, 1), /outside assigned boundary/);
      assert.equal(led.r.tasks.length, 1, "rejected plan adds no tasks");
    } finally {
      await fs.rm(led.root, { recursive: true });
    }
  } finally {
    await fs.rm(f.root, { recursive: true });
  }
});
test("T31 rejects other session/model/effort and plugin context", async () => {
  const f = await fixture();
  try {
    const file = path.join(f.root, "config.json");
    for (const data of [
      { session: "default" },
      { model: "opus" },
      { effort: "medium" },
      { socketPath: "/tmp/herdr.sock" },
    ]) {
      await fs.writeFile(file, JSON.stringify(data));
      await assert.rejects(() => config(file));
    }
    const prior = process.env.HERDR_SESSION;
    process.env.HERDR_SESSION = "default";
    assert.throws(() => actionGuard(f.config));
    if (prior) process.env.HERDR_SESSION = prior;
    else delete process.env.HERDR_SESSION;
  } finally {
    await fs.rm(f.root, { recursive: true });
  }
});
test("canonical request hashing ignores property order", () =>
  assert.equal(canonical({ b: 2, a: 1 }), canonical({ a: 1, b: 2 })));

test("T06 interrupted pre-checkpoint submit reuses only its own staging intent", async () => {
  const f = await fixture();
  try {
    const c = f.submit();
    const first = blank();
    await mutate(first, c, f.config);
    const second = blank();
    await mutate(second, c, f.config);
    assert.equal(
      current(first.projects.A).run_id,
      current(second.projects.A).run_id,
    );
    const foreign = { ...c, command_id: randomUUID() };
    await assert.rejects(
      () => mutate(blank(), foreign, f.config),
      /different request/,
    );
  } finally {
    await fs.rm(f.root, { recursive: true });
  }
});

test("T30 overlapping writes are not simultaneously assignable", async () => {
  const f = await project();
  try {
    const a = makeTask("a", "developer", "one", [], ["app/"]);
    const b = makeTask("b", "developer", "two", [], ["app/index.html"]);
    f.r.tasks = [a, b];
    a.status = "running";
    assert.equal(canAssign(f.r, b), false);
    a.status = "completed";
    assert.equal(canAssign(f.r, b), true);
  } finally {
    await fs.rm(f.root, { recursive: true });
  }
});
