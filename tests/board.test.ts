import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { PassThrough } from "node:stream";
import { ReadStream, WriteStream } from "node:tty";
import { randomUUID } from "node:crypto";
import { board } from "../src/ui/board.js";
import { Broker } from "../src/broker/broker.js";
import { brokerSocket } from "../src/config.js";
import { request } from "../src/broker/client.js";
import { fixture, FakeHerdr } from "./helpers.js";
const waitFor = async (fn: () => boolean, timeout = 5000) => {
  const deadline = Date.now() + timeout;
  while (!fn()) {
    if (Date.now() > deadline) throw new Error("board condition timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
};
test("B01 disconnected board retains stale state without flooding, blocks actions, and reconnects", async () => {
  const f = await fixture();
  const h = new FakeHerdr(f.config);
  let b = new Broker(f.config, h);
  const input = Object.assign(new PassThrough(), {
    isTTY: true,
    isRaw: false,
    setRawMode(value: boolean) {
      this.isRaw = value;
      return this;
    },
  });
  const output = Object.assign(new PassThrough(), { isTTY: true });
  const frames: string[] = [];
  output.on("data", (v) => frames.push(String(v)));
  let done: Promise<void> | undefined;
  try {
    await b.start(false);
    clearInterval(b.timer);
    await b.handle(f.submit());
    done = board(brokerSocket(f.config), f.config, {
      input: input as unknown as ReadStream,
      output: output as unknown as WriteStream,
    });
    await waitFor(() => frames.some((s) => s.includes("> A  queued")));
    input.write("r");
    await waitFor(() => frames.at(-1)!.includes("같은 키"));
    await b.close();
    await waitFor(() => frames.at(-1)!.includes("브로커 연결 끊김"));
    assert.match(frames.at(-1)!, /마지막 수신:.*현재 상태가 아닙니다/);
    assert.match(frames.at(-1)!, /plugin action invoke start/);
    assert.match(frames.at(-1)!, /> A  queued/);
    const count = frames.length;
    await new Promise((r) => setTimeout(r, 2200));
    assert.equal(
      frames.length,
      count,
      "repeated ENOENT must not append or repaint",
    );
    input.write("rrcc");
    await waitFor(() => frames.at(-1)!.includes("연결 복구 후 다시 시도"));
    assert.equal(
      frames.filter((s) => s.includes("요청을 전달했습니다")).length,
      0,
    );
    b = new Broker(f.config, h);
    await b.start(false);
    clearInterval(b.timer);
    await waitFor(() => frames.at(-1)!.includes("연결이 복구되었습니다"));
    assert.match(frames.at(-1)!, /> A  paused/);
    assert.doesNotMatch(frames.at(-1)!, /마지막 수신|연결 끊김/);
    assert.equal(
      Object.keys(b.store.state.commands).length,
      1,
      "offline keys must not queue commands",
    );
    input.write("r");
    await waitFor(() => frames.at(-1)!.includes("같은 키"));
    assert.equal(
      Object.keys(b.store.state.commands).length,
      1,
      "confirmation must reset after disconnect",
    );
    input.write("r");
    await waitFor(() => frames.at(-1)!.includes("요청을 전달했습니다"));
    assert.match(frames.at(-1)!, /> A  queued/);
    assert.equal(b.status().projects[0].resume_required, false);
    assert.equal(h.calls.length, 0);
  } finally {
    input.write("q");
    await done;
    assert.equal(input.isRaw, false);
    await b.close();
    input.destroy();
    output.destroy();
    await fs.rm(f.root, { recursive: true, force: true });
  }
});
test("B02 status timeout releases a stalled socket without mutation receipt wording", async () => {
  const f = await fixture();
  const socket = path.join(f.root, "stalled.sock");
  const clients = new Set<net.Socket>();
  const server = net.createServer((s) => {
    clients.add(s);
    s.on("data", () => {});
    s.on("close", () => clients.delete(s));
  });
  try {
    await new Promise<void>((r) => server.listen(socket, r));
    await assert.rejects(
      request(
        socket,
        {
          schema_version: 1,
          command_id: randomUUID(),
          type: "status",
          payload: {},
        },
        50,
      ),
      /Status request timed out/,
    );
    await waitFor(() => clients.size === 0);
  } finally {
    for (const s of clients) s.destroy();
    await new Promise<void>((r) => server.close(() => r()));
    await fs.rm(f.root, { recursive: true, force: true });
  }
});
