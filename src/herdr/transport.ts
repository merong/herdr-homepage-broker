import net from "node:net";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Config, Fault, fail } from "../contracts/types.js";
const exec = promisify(execFile);
export class HerdrRejected extends Fault {}
export class Lines {
  private decoder = new StringDecoder("utf8");
  private buffer = "";
  constructor(
    private receive: (value: any) => void,
    private limit = 4 * 1024 * 1024,
  ) {}
  push(chunk: Buffer) {
    this.buffer += this.decoder.write(chunk);
    if (Buffer.byteLength(this.buffer) > this.limit)
      fail("frame_too_large", "JSON frame exceeds limit");
    let i;
    while ((i = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, i);
      this.buffer = this.buffer.slice(i + 1);
      if (line.trim()) this.receive(JSON.parse(line));
    }
  }
}
export function socketRequest(
  socketPath: string,
  method: string,
  params: any = {},
  timeout = 5000,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const s = net.connect(socketPath);
    let settled = false;
    const finish = (err?: Error, value?: any) => {
      if (settled) return;
      settled = true;
      s.destroy();
      err ? reject(err) : resolve(value);
    };
    const lines = new Lines((v) => {
      if (v.id !== id) return;
      if (v.error)
        finish(
          new Fault(
            v.error.code ?? "herdr_error",
            v.error.message ?? "Herdr refused",
          ),
        );
      else if (v.result) finish(undefined, v.result);
      else finish(new Fault("invalid_response", "Missing result"));
    });
    s.setTimeout(timeout);
    s.on("connect", () =>
      s.write(JSON.stringify({ id, method, params }) + "\n"),
    );
    s.on("data", (b) => {
      try {
        lines.push(b);
      } catch (e) {
        finish(e as Error);
      }
    });
    s.on("error", (e) => finish(new Fault("session_unavailable", e.message)));
    s.on("timeout", () =>
      finish(new Fault("timeout", "Socket outcome unknown")),
    );
    s.on("end", () =>
      finish(new Fault("disconnected", "Socket ended before response")),
    );
  });
}
export class Herdr {
  constructor(public config: Config) {}
  async cli(args: string[], timeout = 40000) {
    const env = {
      ...process.env,
      HERDR_SESSION: "homepage",
      HERDR_SOCKET_PATH: this.config.socketPath,
      HERDR_CONFIG_PATH:
        process.env.HERDR_CONFIG_PATH &&
        path.dirname(path.resolve(process.env.HERDR_CONFIG_PATH)) ===
          path.dirname(path.dirname(path.dirname(this.config.socketPath)))
          ? process.env.HERDR_CONFIG_PATH
          : path.join(
              path.dirname(path.dirname(path.dirname(this.config.socketPath))),
              "config.toml",
            ),
    };
    for (const k of [
      "HERDR_PANE_ID",
      "HERDR_TAB_ID",
      "HERDR_WORKSPACE_ID",
      "HERDR_PLUGIN_CONTEXT_JSON",
    ])
      delete env[k as keyof typeof env];
    try {
      const { stdout } = await exec(
        this.config.herdrBin,
        ["--session", "homepage", ...args],
        { env, timeout, maxBuffer: 4 * 1024 * 1024 },
      );
      const data = JSON.parse(stdout);
      if (data.error)
        throw new Fault(
          data.error.code ?? "herdr_error",
          data.error.message ?? "Herdr refused",
        );
      return data.result ?? data;
    } catch (e: any) {
      if (e instanceof Fault) throw e;
      try {
        const error = JSON.parse(e.stderr || e.stdout).error;
        if (error?.code && error?.message) {
          if (
            ["invalid_agent_name", "invalid_agent_argument"].includes(
              error.code,
            )
          )
            throw new HerdrRejected(error.code, error.message);
          throw new Fault(error.code, error.message);
        }
      } catch (parsed) {
        if (parsed instanceof Fault) throw parsed;
      }
      throw new Fault(
        "dispatch_unknown",
        "Herdr CLI did not return a confirmed result",
      );
    }
  }
  api(method: string, params: any = {}) {
    return socketRequest(this.config.socketPath, method, params);
  }
  async snapshot() {
    const r = await this.api("session.snapshot");
    if (r.type !== "session_snapshot" || !Array.isArray(r.snapshot?.panes))
      fail("invalid_response", "Invalid Herdr snapshot");
    return r.snapshot;
  }
  async shellReady(pane: string) {
    const r = await this.api("pane.process_info", { pane_id: pane });
    const p = r.process_info;
    return (
      !!p?.shell_pid &&
      p.foreground_process_group_id === p.shell_pid &&
      p.foreground_processes?.length === 1 &&
      p.foreground_processes[0].pid === p.shell_pid
    );
  }
  async doctor() {
    const p = await this.api("ping");
    if (p.type !== "pong" || p.protocol < 19)
      fail("protocol_unsupported", "Herdr protocol 19+ required");
    return {
      version: p.version,
      protocol: p.protocol,
      session: "homepage",
      socket: this.config.socketPath,
    };
  }
}
export class Observer {
  stopped = false;
  socket?: net.Socket;
  timer?: NodeJS.Timeout;
  backoff = 250;
  refreshing = false;
  dirty = false;
  constructor(
    public herdr: Herdr,
    public changed: (snapshot: any) => Promise<void>,
    public stale: () => void,
  ) {}
  start() {
    this.connect();
  }
  private connect() {
    if (this.stopped) return;
    const id = randomUUID();
    const s = (this.socket = net.connect(this.herdr.config.socketPath));
    let accepted = false;
    const retry = () => {
      if (this.stopped || this.timer) return;
      this.stale();
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.connect();
      }, this.backoff);
      this.backoff = Math.min(this.backoff * 2, 10000);
    };
    const lines = new Lines((v) => {
      if (v.id === id) {
        if (v.error || v.result?.type !== "subscription_started") {
          s.destroy();
          return;
        }
        accepted = true;
        this.backoff = 250;
        void this.refresh();
      } else if (v.event === "events_lost" || v.type === "events_lost") {
        s.destroy();
      } else if (accepted) {
        void this.refresh();
      }
    });
    s.on("connect", () =>
      s.write(
        JSON.stringify({
          id,
          method: "events.subscribe",
          params: {
            subscriptions: [
              { type: "pane.updated" },
              { type: "pane.exited" },
              { type: "pane.moved" },
              { type: "workspace.closed" },
            ],
          },
        }) + "\n",
      ),
    );
    s.on("data", (b) => {
      try {
        lines.push(b);
      } catch {
        s.destroy();
      }
    });
    s.on("error", () => s.destroy());
    s.on("close", retry);
    s.setTimeout(15000, () => {
      if (!accepted) s.destroy();
    });
  }
  async refresh() {
    this.dirty = true;
    if (this.refreshing || this.stopped) return;
    this.refreshing = true;
    try {
      while (this.dirty && !this.stopped) {
        this.dirty = false;
        await this.changed(await this.herdr.snapshot());
      }
    } catch {
      this.stale();
      this.socket?.destroy();
    } finally {
      this.refreshing = false;
    }
  }
  close() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.socket?.destroy();
  }
}
