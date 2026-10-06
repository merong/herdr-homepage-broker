import readline from "node:readline";
import { randomUUID } from "node:crypto";
import { ReadStream, WriteStream } from "node:tty";
import { request } from "../broker/client.js";
import { Config } from "../contracts/types.js";
import { Herdr } from "../herdr/transport.js";
export const clean = (s: unknown) =>
  String(s ?? "").replace(/[\x00-\x1f\x7f-\x9f]/g, " ");
export async function board(
  socket: string,
  c: Config,
  io: { input: ReadStream; output: WriteStream } = {
    input: process.stdin,
    output: process.stdout,
  },
) {
  const { input, output } = io;
  let selected = 0,
    closed = false,
    rows: any[] = [],
    message = "",
    confirm = "",
    connectionError = "",
    lastFrame = "",
    receivedAt = "";
  let busy = false,
    acting = false,
    status: any;
  const render = () => {
    if (closed) return;
    const lines = ["HOMEPAGE  |  최대 2개 프로젝트 · PM / 개발자 / 디자이너"];
    if (connectionError) {
      lines.push(
        "브로커 연결 끊김 · 자동 재연결 대기",
        receivedAt
          ? `마지막 수신: ${receivedAt} · 아래 상태는 현재 상태가 아닙니다.`
          : "아직 상태를 받지 못했습니다.",
        "브로커가 중지됐다면 다른 터미널에서 실행하세요:",
        "herdr --session homepage plugin action invoke start --plugin herdr-homepage-broker",
        `연결 오류: ${clean(connectionError)}`,
      );
    }
    if (status)
      lines.push(
        `${connectionError ? "마지막 상태 · " : ""}실행: ${status.execution_enabled ? "enabled" : "disabled"}  revision: ${status.revision}  ${clean(status.runtime_error)}`,
      );
    if (!connectionError && status && !status.execution_enabled)
      lines.push(
        "접수 모드 · r은 프로젝트 재개이며 모델 실행 설정을 켜지 않습니다.",
      );
    lines.push(
      connectionError
        ? "↑↓ 선택 · q 종료 · 연결 복구 전 작업 명령 사용 불가"
        : "↑↓ 선택 · p PM pane 이동 · r 재개 · c 취소 · q 종료",
    );
    for (const [i, p] of rows.entries())
      lines.push(
        `${i === selected ? ">" : " "} ${clean(p.project_id)}  ${p.status}  ${p.input_required ? "입력 필요" : ""} ${clean(p.reason)}`,
      );
    const p = rows[selected];
    if (p) {
      lines.push("\n소스: " + clean(p.directory) + "/app");
      lines.push(
        "미리보기: " + clean(p.preview.url) + " (" + p.preview.status + ")",
      );
      for (const a of p.agents)
        lines.push(
          `${a.role}: ${a.status} / ${clean(a.waiting_reason)} / ${clean(a.herdr.pane_id)}`,
        );
      for (const q of p.input_requests.filter(
        (q: any) => q.status !== "answered",
      ))
        lines.push(`질문 ${q.request_id}: ${clean(q.question)} [${q.status}]`);
      lines.push("답변은 answer --file <command.json> 으로 전달합니다.");
    }
    lines.push(clean(message));
    const frame = lines.join("\n") + "\n";
    if (frame === lastFrame) return;
    lastFrame = frame;
    output.write((output.isTTY ? "\x1b[2J\x1b[H" : "") + frame);
  };
  const refresh = async () => {
    if (busy || closed) return;
    busy = true;
    try {
      status = await request(
        socket,
        {
          schema_version: 1,
          command_id: randomUUID(),
          type: "status",
          payload: {},
        },
        3000,
      );
      rows = status.projects;
      selected = Math.min(selected, Math.max(0, rows.length - 1));
      receivedAt = new Date().toLocaleTimeString();
      if (connectionError)
        message = "브로커 연결이 복구되었습니다. 작업을 확인한 후 재개하세요.";
      connectionError = "";
    } catch (e: any) {
      if (!connectionError) message = "";
      connectionError = e.code ?? e.message;
      confirm = "";
    } finally {
      busy = false;
      render();
    }
  };
  await refresh();
  if (!input.isTTY) return;
  readline.emitKeypressEvents(input);
  const wasRaw = input.isRaw;
  input.setRawMode(true);
  input.resume();
  const handler = async (_: string, key: any) => {
    if (!key || closed) return;
    if (key.name === "q" || (key.ctrl && key.name === "c")) {
      closed = true;
      return;
    }
    if (acting) return;
    if (["down", "up"].includes(key.name)) {
      selected = Math.max(
        0,
        Math.min(selected + (key.name === "down" ? 1 : -1), rows.length - 1),
      );
      confirm = "";
      message = "";
    }
    const p = rows[selected];
    if (connectionError && ["p", "r", "c"].includes(key.name)) {
      confirm = "";
      message =
        "연결 복구 후 다시 시도하세요. 브로커 시작은 위 start 명령을 사용합니다.";
      render();
      return;
    }
    acting = true;
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
          confirm = "";
          await request(socket, {
            schema_version: 1,
            command_id: randomUUID(),
            type: key.name === "r" ? "resume" : "cancel",
            project_id: p.project_id,
            run_id: p.run_id,
            payload: {},
          });
          message = "요청을 전달했습니다.";
          await refresh();
        }
      }
    } catch (e: any) {
      message = e.message;
      await refresh();
    } finally {
      acting = false;
      render();
    }
  };
  input.on("keypress", handler);
  try {
    while (!closed) {
      await new Promise((r) => setTimeout(r, 1000));
      await refresh();
    }
  } finally {
    input.off("keypress", handler);
    input.setRawMode(wasRaw);
    input.pause();
  }
}
