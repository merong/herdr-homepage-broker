import {
  spawn,
  execFile,
  ChildProcessWithoutNullStreams,
} from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { Config, Fault, fail } from "../contracts/types.js";
import { Lines } from "../herdr/transport.js";
const exec = promisify(execFile);
export async function detectMcp() {
  try {
    const { stdout } = await exec(
      "claude",
      ["--setting-sources", "", "mcp", "list"],
      {
        timeout: 25000,
        maxBuffer: 1024 * 1024,
      },
    );
    const lines = stdout.split("\n").filter((s) => /higgs?field/i.test(s));
    return {
      source: "claude mcp list",
      detected: lines.length > 0,
      connected: lines.some(
        (s) => /✓|connected/i.test(s) && !/disconnected|failed|needs/i.test(s),
      ),
      servers: lines.map((s) =>
        s
          .split(":")[0]
          .trim()
          .replace(/[^a-zA-Z0-9 _.-]/g, ""),
      ),
      note: "Installed Claude MCP is reused by default. No credentials are copied.",
    };
  } catch {
    return {
      source: "claude mcp list",
      detected: false,
      connected: false,
      note: "MCP discovery unavailable or timed out",
    };
  }
}
export class Mcp {
  child?: ChildProcessWithoutNullStreams;
  ready = false;
  pending = new Map<
    string,
    {
      resolve: (v: any) => void;
      reject: (e: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  constructor(public config: NonNullable<Config["mcp"]>) {}
  async connect() {
    if (this.child) {
      if (this.ready) return;
      fail("mcp_not_ready", "MCP initialization did not finish successfully");
    }
    const child = (this.child = spawn(this.config.command, this.config.args, {
      env: { ...process.env, ...this.config.env },
      stdio: "pipe",
    }));
    const abort = () => {
      if (this.child !== child) return;
      this.ready = false;
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(
          new Fault(
            "mcp_disconnected",
            "MCP disconnected; submission outcome may be unknown",
          ),
        );
      }
      this.pending.clear();
      this.child = undefined;
    };
    const lines = new Lines((v) => {
      if (v.id === undefined) return;
      const p = this.pending.get(String(v.id));
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(String(v.id));
      v.error
        ? p.reject(new Fault("mcp_error", "MCP tool refused request"))
        : p.resolve(v.result);
    });
    child.stdout.on("data", (b) => {
      try {
        lines.push(b);
      } catch {
        child.kill();
      }
    });
    child.stderr.resume();
    child.on("error", abort);
    child.on("exit", abort);
    child.stdin.on("error", abort);
    try {
      const init = await this.request("initialize", {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "herdr-homepage", version: "0.1.0" },
      });
      if (!init?.protocolVersion)
        fail("mcp_protocol", "Missing protocol version");
      child.stdin.write(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        }) + "\n",
      );
      const found: any[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 20; page++) {
        const tools = await this.request(
          "tools/list",
          cursor ? { cursor } : {},
        );
        if (!Array.isArray(tools.tools))
          fail("mcp_response_schema", "Missing tools list");
        found.push(...tools.tools);
        cursor = tools.nextCursor;
        if (!cursor) break;
      }
      if (cursor)
        fail(
          "mcp_response_schema",
          "Tool listing exceeds supported page limit",
        );
      for (const name of [this.config.generateTool, this.config.statusTool])
        if (!found.some((t) => t.name === name))
          fail("mcp_tool_missing", `Configured tool not exposed: ${name}`);
      this.ready = true;
    } catch (e) {
      this.close();
      throw e;
    }
  }

  request(method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.child) {
        reject(new Fault("mcp_unavailable", "MCP not connected"));
        return;
      }
      const id = randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Fault("mcp_timeout", "MCP outcome unknown"));
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
      );
    });
  }
  async call(name: string, args: any) {
    await this.connect();
    const result = await this.request("tools/call", { name, arguments: args });
    if (result?.isError) fail("mcp_tool_error", "MCP returned isError");
    if (result?.structuredContent) return result.structuredContent;
    const text = result?.content
      ?.filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n");
    try {
      return JSON.parse(text);
    } catch {
      fail("mcp_response_schema", "Expected structured JSON tool result");
    }
  }
  async generate(args: any) {
    return this.call(this.config.generateTool, args);
  }
  async status(id: string) {
    return this.call(this.config.statusTool, {
      [this.config.statusArgument]: id,
    });
  }
  close() {
    this.ready = false;
    this.child?.kill();
  }
}
export function field(value: any, accessor: string) {
  return accessor.split(".").reduce((v, k) => v?.[k], value);
}
