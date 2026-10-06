import readline from "node:readline";
import { randomUUID } from "node:crypto";
import { request } from "../broker/client.js";
import { Config } from "../contracts/types.js";
import { Herdr } from "../herdr/transport.js";
export const clean = (s: unknown) =>
  String(s ?? "").replace(/[\x00-\x1f\x7f-\x9f]/g, " ");
export async function board(socket: string, c: Config) {
  let selected = 0,
    closed = false,
    rows: any[] = [],
    message = "";
  let busy = false;
  const refresh = async () => {
    if (busy || closed) return;
    busy = true;
    try {
      const status = await request(socket, {
        schema_version: 1,
        command_id: randomUUID(),
        type: "status",
        payload: {},
      });
      rows = status.projects;
      selected = Math.min(selected, Math.max(0, rows.length - 1));
      if (process.stdout.isTTY) process.stdout.write("\x1b[2J\x1b[H");
      console.log("HOMEPAGE  |  최대 2개 프로젝트 · PM / 개발자 / 디자이너");
      console.log(
        `실행: ${status.execution_enabled ? "enabled" : "disabled"}  revision: ${status.revision}  ${clean(status.runtime_error)}`,
      );
      console.log("↑↓ 선택 · p PM pane 이동 · r 재개 · c 취소 · q 종료");
      for (const [i, p] of rows.entries())
        console.log(
          `${i === selected ? ">" : " "} ${clean(p.project_id)}  ${p.status}  ${p.input_required ? "입력 필요" : ""} ${clean(p.reason)}`,
        );
      const p = rows[selected];
      if (p) {
        console.log("\n소스: " + clean(p.directory) + "/app");
        console.log(
          "미리보기: " + clean(p.preview.url) + " (" + p.preview.status + ")",
        );
        for (const a of p.agents)
          console.log(
            `${a.role}: ${a.status} / ${clean(a.waiting_reason)} / ${clean(a.herdr.pane_id)}`,
          );
        for (const q of p.input_requests.filter(
          (q: any) => q.status !== "answered",
        ))
          console.log(
            `질문 ${q.request_id}: ${clean(q.question)} [${q.status}]`,
          );
        console.log("답변은 answer --file <command.json> 으로 전달합니다.");
      }
      console.log(message);
    } catch (e: any) {
      console.log(clean(e.message));
    } finally {
      busy = false;
    }
  };
  await refresh();
  if (!process.stdin.isTTY) return;
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  let confirm = "";
  const handler = async (_: string, key: any) => {
    if (key.name === "q" || (key.ctrl && key.name === "c")) {
      closed = true;
      return;
    }
    if (key.name === "down") selected = Math.min(selected + 1, rows.length - 1);
    if (key.name === "up") selected = Math.max(0, selected - 1);
    const p = rows[selected];
    try {
      if (key.name === "p" && p) {
        const pane = p.agents.find((a: any) => a.role === "pm")?.herdr.pane_id;
        if (pane) await new Herdr(c).cli(["agent", "focus", pane]);
      }
      if (["r", "c"].includes(key.name) && p) {
        const target = `${key.name}:${p.project_id}:${p.run_id}`;
        if (confirm !== target) {
          confirm = target;
          message =
            "같은 키를 다시 누르면 " + p.project_id + " 작업에 적용됩니다.";
        } else {
          await request(socket, {
            schema_version: 1,
            command_id: randomUUID(),
            type: key.name === "r" ? "resume" : "cancel",
            project_id: p.project_id,
            run_id: p.run_id,
            payload: {},
          });
          confirm = "";
          message = "요청을 전달했습니다.";
        }
      }
    } catch (e: any) {
      message = e.message;
    }
    await refresh();
  };
  process.stdin.on("keypress", handler);
  while (!closed) {
    await new Promise((r) => setTimeout(r, 1000));
    await refresh();
  }
  process.stdin.off("keypress", handler);
  process.stdin.setRawMode(false);
  process.stdin.pause();
}
