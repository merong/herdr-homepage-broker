import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Config } from "../contracts/types.js";
import { Mcp } from "./mcp.js";

const exec = promisify(execFile);
export type ServerHealth = {
  name: string;
  status:
    | "connected"
    | "needs_auth"
    | "pending_approval"
    | "disabled"
    | "failed"
    | "unknown";
  higgsfield: boolean;
};
export type McpProbe = {
  servers: ServerHealth[];
  error: string | null;
};

// Keep only names and an allowlisted status. Commands, URLs, headers and stderr
// may contain credentials and must never reach the dashboard.
export function parseMcpList(output: string): ServerHealth[] {
  return output
    .replace(/\x1b\[[0-9;]*m/g, "")
    .split(/\r?\n/)
    .flatMap((line) => {
      const match = line.match(/^\s*([^:]+):\s+(.+?)\s+-\s+(.+)$/);
      if (!match) return [];
      const [, rawName, address, rawStatus] = match;
      const name = rawName
        .replace(/[\x00-\x1f\x7f]/g, "")
        .trim()
        .slice(0, 100);
      const status: ServerHealth["status"] =
        /needs? (?:auth|login)|unauthorized/i.test(rawStatus)
          ? "needs_auth"
          : /pending approval/i.test(rawStatus)
            ? "pending_approval"
            : /disabled/i.test(rawStatus)
              ? "disabled"
              : /disconnected|failed|error/i.test(rawStatus)
                ? "failed"
                : /\bconnected\b/i.test(rawStatus)
                  ? "connected"
                  : "unknown";
      // Accept the actual hostname, never a substring in a query or foreign host.
      let host = "";
      try {
        host = new URL(address.split(/\s/)[0]).hostname;
      } catch {}
      return [
        {
          name,
          status,
          higgsfield:
            /\b(?:higgs?field|higs)\b/i.test(name) ||
            host === "mcp.higgsfield.ai",
        },
      ];
    })
    .slice(0, 100);
}

export async function probeInstalledMcp(
  signal?: AbortSignal,
): Promise<McpProbe> {
  try {
    const { stdout } = await exec(
      "claude",
      ["--setting-sources", "", "mcp", "list"],
      {
        timeout: 25000,
        maxBuffer: 1024 * 1024,
        signal,
      },
    );
    const servers = parseMcpList(stdout);
    return {
      servers,
      error:
        servers.length || /no mcp servers|no servers configured/i.test(stdout)
          ? null
          : "unrecognized_response",
    };
  } catch (e: any) {
    return {
      servers: [],
      error:
        e.code === "ENOENT"
          ? "claude_not_found"
          : e.killed
            ? "check_timeout"
            : "check_unavailable",
    };
  }
}

export class McpHealth {
  private value: McpProbe = { servers: [], error: null };
  private checkedAt: number | null = null;
  private startedAt = -Infinity;
  private pending?: Promise<void>;
  private controller = new AbortController();
  private closed = false;
  constructor(
    private config?: Config["mcp"],
    private probe?: (signal: AbortSignal) => Promise<McpProbe>,
    private clock = Date.now,
  ) {}

  snapshot(force = false) {
    const now = this.clock();
    const stale = this.checkedAt === null || now - this.checkedAt >= 60000;
    if (
      !this.closed &&
      !this.pending &&
      (stale || force) &&
      now - this.startedAt >= 10000
    ) {
      this.startedAt = now;
      this.pending = this.check()
        .then((value) => {
          this.value = value;
          this.checkedAt = this.clock();
        })
        .catch(() => {
          this.value = { servers: [], error: "check_unavailable" };
          this.checkedAt = this.clock();
        })
        .finally(() => {
          this.pending = undefined;
        });
    }
    const higgs = this.value.servers.filter((s) => s.higgsfield);
    return {
      transport: this.config ? "broker-stdio" : "claude-installed",
      source: this.config ? "MCP initialize + tools/list" : "claude mcp list",
      checking: !!this.pending,
      checked_at:
        this.checkedAt === null ? null : new Date(this.checkedAt).toISOString(),
      stale,
      servers: this.value.servers,
      error: this.value.error,
      higgsfield: {
        status:
          this.checkedAt === null
            ? "checking"
            : this.value.error
              ? "unknown"
              : higgs.some((s) => s.status === "connected")
                ? "connected"
                : (higgs[0]?.status ?? "missing"),
        available:
          !stale &&
          !this.value.error &&
          higgs.some((s) => s.status === "connected"),
      },
      scope:
        "접속 검사 결과입니다. 각 에이전트의 도구 로딩·이미지 생성 성공은 실제 작업 보고로 확인합니다.",
    };
  }
  private async check(): Promise<McpProbe> {
    if (this.probe) return this.probe(this.controller.signal);
    if (!this.config) return probeInstalledMcp(this.controller.signal);
    const mcp = new Mcp(this.config);
    const abort = () => mcp.close();
    const timeout = setTimeout(abort, 30000);
    this.controller.signal.addEventListener("abort", abort, { once: true });
    try {
      await mcp.connect();
      return {
        servers: [
          {
            name: "Higgsfield (broker stdio)",
            status: "connected",
            higgsfield: true,
          },
        ],
        error: null,
      };
    } catch {
      return {
        servers: [
          {
            name: "Higgsfield (broker stdio)",
            status: "failed",
            higgsfield: true,
          },
        ],
        error: "connection_or_tools_unavailable",
      };
    } finally {
      clearTimeout(timeout);
      this.controller.signal.removeEventListener("abort", abort);
      mcp.close();
    }
  }
  async settled() {
    await this.pending;
  }
  close() {
    this.closed = true;
    this.controller.abort();
  }
}
