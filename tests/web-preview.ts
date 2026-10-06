// Browser QA harness only. Isolated temporary state, no real Herdr/model calls.
// stdin: offline | online | empty | update. Ctrl+C removes the fixture.
import fs from "node:fs/promises";
import readline from "node:readline";
import { fixture, FakeHerdr } from "./helpers.js";
import { Broker } from "../src/broker/broker.js";
import { current, makeTask } from "../src/domain/engine.js";
import { Dashboard } from "../src/web/server.js";
const f = await fixture();
const b = new Broker(f.config, new FakeHerdr(f.config));
await b.start(false);
clearInterval(b.timer);
for (const id of ["company-demo", "studio-demo", "next-demo"])
  await b.handle(f.submit(id));
const p = b.store.state.projects["company-demo"],
  r = current(p);
r.status = "running";
r.slot = true;
r.herdr.workspace_id = "fixture-w1";
r.tasks = [
  makeTask("brief", "pm", "요구사항 정리와 작업 계획", [], ["reports/"]),
  makeTask(
    "design",
    "designer",
    "기업 소개 페이지 레이아웃 · 이미지 구성",
    ["brief"],
    ["assets/"],
  ),
  makeTask(
    "build",
    "developer",
    "반응형 랜딩 페이지 구현",
    ["design"],
    ["app/"],
  ),
];
for (const [i, t] of r.tasks.entries()) {
  t.status = i < 2 ? "completed" : "running";
  t.attempt = 1;
}
for (const [i, a] of r.agents.entries()) {
  a.herdr = {
    pane_id: `fixture-w1:p${i + 1}`,
    terminal_id: `fixture-t${i + 1}`,
  };
  a.runtime = { fresh: i !== 2, status: i === 1 ? "working" : "idle" };
  a.status = i === 1 ? "working" : "waiting";
  a.waiting_reason =
    i === 0
      ? "브랜드 자료 확인 대기"
      : i === 2
        ? "디자인 초안 전달 완료"
        : null;
}
r.agents[1].task_id = "build";
r.questions.push({
  request_id: "fixture-question",
  run_id: r.run_id,
  agent_id: r.agents[0].agent_id,
  task_id: "brief",
  kind: "execution_choice",
  question: "회사 로고 원본을 사용할까요, 텍스트 로고로 진행할까요?",
  response_schema: { type: "string" },
  status: "open",
});
const review = current(b.store.state.projects["studio-demo"]);
review.status = "review_pending";
review.tasks = [
  makeTask("build", "developer", "소개 페이지 구현 완료", [], ["app/"]),
];
review.tasks[0].status = "completed";
review.preview.status = "unknown";
await b.save();
let offline = false,
  closing = false;
b.dashboard = new Dashboard(async () => {
  if (offline) throw new Error("fixture_disconnected");
  return b.serial(async () => structuredClone(b.status()));
});
await b.dashboard.start(Number(process.argv[2] ?? 0));
console.log(
  JSON.stringify({
    fixture: true,
    url: b.dashboard.url,
    root: f.root,
    model_calls: 0,
  }),
);
const close = async () => {
  if (closing) return;
  closing = true;
  await b.close();
  await fs.rm(f.root, { recursive: true, force: true });
  process.exit(0);
};
process.once("SIGINT", () => {
  void close();
});
process.once("SIGTERM", () => {
  void close();
});
for await (const line of readline.createInterface({ input: process.stdin })) {
  if (line === "offline") offline = true;
  if (line === "online") offline = false;
  if (line === "empty") {
    b.store.state.projects = {};
    await b.save();
  }
  if (line === "update") {
    r.tasks[2].status = "completed";
    r.questions[0].status = "answered";
    r.status = "review_pending";
    r.slot = false;
    r.preview.status = "unknown";
    await b.save(p);
  }
  console.log(
    JSON.stringify({ command: line, revision: b.store.state.revision }),
  );
}
