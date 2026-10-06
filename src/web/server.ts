import http from "node:http";
import fs from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { Config, fail } from "../contracts/types.js";
import { projectDirectory, projectFiles, sample } from "../projects/manage.js";
import { projectCli } from "./actions.js";
import { Herdr } from "../herdr/transport.js";
import { defaultConfigFile } from "../config.js";
import type { AddressInfo } from "node:net";
import type { Broker } from "../broker/broker.js";

type Snapshot = ReturnType<Broker["status"]>;

// HTTP gets only display fields. Never forward operation receipts, credentials,
// agent capabilities, arbitrary files or broker command envelopes to the browser.
export function webSnapshot(s: Snapshot) {
  return {
    schema_version: 1,
    source: "broker-checkpoint.json",
    session: s.session,
    revision: s.revision,
    observed_at: new Date().toISOString(),
    execution_enabled: s.execution_enabled,
    projection_pending: s.projection_pending,
    storage_fault: s.storage_fault,
    runtime_error: s.runtime_error,
    projects: s.projects.map((p) => ({
      project_id: p.project_id,
      run_id: p.run_id,
      revision: p.revision,
      directory: p.directory,
      status: p.status,
      slot: p.slot,
      resume_required: p.resume_required,
      reason: p.reason ?? null,
      workspace_id: p.herdr.workspace_id,
      input_required: p.input_required,
      preview: {
        status: p.preview.status,
        url: previewUrl(p.preview.status, p.preview.url),
        error: p.preview.error ?? null,
      },
      agents: p.agents.map((a) => ({
        agent_id: a.agent_id,
        role: a.role,
        model: a.model,
        effort: a.effort,
        status: a.status,
        waiting_reason: a.waiting_reason,
        task_id: a.task_id,
        pane_id: a.herdr.pane_id ?? null,
        terminal_id: a.herdr.terminal_id ?? null,
        runtime: {
          status: a.runtime.status ?? "unknown",
          fresh: a.runtime.fresh === true,
          observed_at: a.runtime.observed_at ?? null,
        },
      })),
      tasks: p.tasks.map((t) => ({
        task_id: t.task_id,
        title: t.title,
        role: t.role,
        status: t.status,
        attempt: t.attempt,
        depends_on: t.depends_on,
        writes: t.writes,
        result: t.result ?? null,
      })),
      input_requests: p.input_requests.map((q) => ({
        request_id: q.request_id,
        agent_id: q.agent_id,
        task_id: q.task_id,
        kind: q.kind,
        question: q.question,
        status: q.status,
      })),
      unknown_operations: p.operations
        .filter((o) => o.status === "unknown")
        .map((o) => ({ operation_id: o.operation_id, kind: o.kind })),
    })),
  };
}

export function previewUrl(status: string, raw?: string): string | null {
  if (status !== "ready" || !raw) return null;
  try {
    const u = new URL(raw);
    if (
      u.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname) ||
      u.username ||
      u.password
    )
      return null;
    return u.href;
  } catch {
    return null;
  }
}

export class Dashboard {
  private server?: http.Server;
  private pending?: Promise<ReturnType<typeof webSnapshot>>;
  url: string | null = null;
  private csrf = randomBytes(32).toString("hex");
  private checks?: Promise<any>;
  constructor(
    private read: () => Promise<Snapshot>,
    private config?: Config,
  ) {}

  async start(port: number) {
    const assets = new Map<string, { body: Buffer; type: string }>();
    for (const [route, name, type] of [
      ["/", "index.html", "text/html; charset=utf-8"],
      ["/app.js", "app.js", "text/javascript; charset=utf-8"],
      ["/actions.js", "actions.js", "text/javascript; charset=utf-8"],
      ["/style.css", "style.css", "text/css; charset=utf-8"],
    ])
      assets.set(route, {
        body: await fs.readFile(new URL(`./public/${name}`, import.meta.url)),
        type,
      });
    this.server = http.createServer((req, res) => {
      void this.handle(req, res, assets).catch(() => {
        if (!res.headersSent)
          res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "status_unavailable" }));
      });
    });
    this.server.requestTimeout = 10000;
    this.server.headersTimeout = 10000;
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(port, "127.0.0.1", () => {
        this.server!.off("error", reject);
        resolve();
      });
    });
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  private async handle(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    assets: Map<string, { body: Buffer; type: string }>,
  ) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    const json = (code: number, body: unknown) => {
      res.writeHead(code, {
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(req.method === "HEAD" ? undefined : JSON.stringify(body));
    };
    const port = (this.server!.address() as AddressInfo | null)?.port;
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (
      !hosts.includes(req.headers.host ?? "") ||
      (req.headers.origin &&
        req.headers.origin !== `http://${req.headers.host}`) ||
      req.headers["sec-fetch-site"] === "cross-site"
    ) {
      json(403, { error: "local_origin_required" });
      return;
    }
    const route = req.url;
    if (
      req.method === "POST" &&
      this.config &&
      [
        "/api/projects/init",
        "/api/projects/submit",
        "/api/projects/execute",
      ].includes(route ?? "")
    ) {
      if (
        req.headers.origin !== `http://${req.headers.host}` ||
        req.headers["x-homepage-token"] !== this.csrf ||
        req.headers["content-type"]?.split(";")[0] !== "application/json"
      ) {
        json(403, { error: "action_token_required" });
        return;
      }
      try {
        let text = "";
        req.setEncoding("utf8");
        for await (const chunk of req) {
          text += chunk;
          if (Buffer.byteLength(text) > 160 * 1024)
            fail("input_too_large", "Request exceeds 160 KiB");
        }
        const input = JSON.parse(text);
        if (!input || typeof input.project_id !== "string")
          fail("invalid_project", "project_id is required");
        projectDirectory(this.config, input.project_id);
        if (route === "/api/projects/execute") {
          if (
            Object.keys(input).some(
              (k) =>
                !["project_id", "run_id", "command_id", "action"].includes(k),
            ) ||
            typeof input.run_id !== "string" ||
            !input.run_id ||
            input.run_id.length > 128 ||
            typeof input.command_id !== "string" ||
            !/^[a-zA-Z0-9_-]{8,128}$/.test(input.command_id) ||
            !["start", "resume"].includes(input.action)
          )
            fail(
              "invalid_request",
              "execute requires project_id, run_id, command_id and action:start|resume",
            );
          const result = await projectCli(this.config, "execute", {
            schema_version: 1,
            command_id: input.command_id,
            type: "execute",
            project_id: input.project_id,
            run_id: input.run_id,
            payload: { action: input.action },
          });
          json(200, {
            ...result,
            transport: "broker-cli",
            execution_transport: "herdr-cli",
            session: "homepage",
          });
          return;
        }
        if (
          route === "/api/projects/submit" &&
          Object.keys(input).some((key) => key !== "project_id")
        )
          fail("invalid_request", "submit accepts only project_id");
        const result = await projectCli(
          this.config,
          route === "/api/projects/init" ? "init" : "submit",
          input,
        );
        json(200, {
          ...result,
          transport: "broker-cli",
          execution_transport: "herdr-cli",
          session: "homepage",
        });
      } catch (e: any) {
        json(e.code === "receipt_unknown" ? 502 : 409, {
          error: e.code ?? "invalid_request",
          message: e.code ? e.message : "Invalid JSON request",
        });
      }
      return;
    }
    if (!["GET", "HEAD"].includes(req.method ?? "")) {
      res.setHeader("Allow", "GET, HEAD");
      json(405, { error: "read_only" });
      return;
    }
    const asset = assets.get(route ?? "");
    if (asset) {
      res.writeHead(200, { "Content-Type": asset.type });
      res.end(req.method === "HEAD" ? undefined : asset.body);
      return;
    }
    if (route === "/api/health") {
      json(200, {
        service: "herdr-homepage-broker",
        session: "homepage",
        read_only: !this.config,
        version: "0.4.0",
      });
      return;
    }
    if (route === "/api/bootstrap") {
      json(200, {
        session: "homepage",
        version: "0.4.0",
        projects_root: this.config?.projectsRoot ?? null,
        config_file: process.env.HOMEPAGE_CONFIG || defaultConfigFile(),
        can_submit: !!this.config,
        csrf: this.config ? this.csrf : null,
        sample,
        repository: "merong/herdr-homepage-broker",
      });
      return;
    }
    if (route === "/api/checks" && this.config) {
      if (!this.checks) {
        const c = this.config;
        this.checks = (async () => {
          let herdr;
          try {
            herdr = { available: true, ...(await new Herdr(c).doctor()) };
          } catch (e: any) {
            herdr = { available: false, code: e.code ?? "unavailable" };
          }
          const s = await this.read();
          return {
            version: "0.4.0",
            session: "homepage",
            broker: {
              available: true,
              execution_enabled: s.execution_enabled,
              storage_fault: s.storage_fault,
              projection_pending: s.projection_pending,
            },
            herdr,
            projects_root: c.projectsRoot,
            mcp: {
              transport: c.mcp ? "broker-stdio" : "claude-installed",
              connection: "checked_on_use",
            },
            skills_count: c.skills.length,
            model: c.model,
            effort: c.effort,
            execution_configured: !!(
              s.execution_enabled &&
              herdr.available &&
              !s.storage_fault
            ),
            note: "프로젝트 실행 구성은 자동 준비됩니다. 모델 인증·MCP 연결은 실제 도구 사용 시 확인합니다.",
          };
        })();
        const pending = this.checks;
        void pending
          .finally(() => {
            if (this.checks === pending) this.checks = undefined;
          })
          .catch(() => {});
      }
      try {
        json(200, await this.checks);
      } catch {
        json(503, { error: "checks_unavailable" });
      }
      return;
    }
    const execution = route?.match(
      /^\/api\/projects\/([a-zA-Z0-9_-]+)\/execution$/,
    );
    if (execution && this.config) {
      try {
        const result = await projectCli(this.config, "readiness", {
          project_id: execution[1],
        });
        json(200, {
          ...result,
          config_file: process.env.HOMEPAGE_CONFIG || defaultConfigFile(),
        });
      } catch (e: any) {
        json(e.code === "unknown_project" ? 404 : 503, {
          error: e.code ?? "execution_check_failed",
          message: e.message,
        });
      }
      return;
    }
    const match = route?.match(/^\/api\/projects\/([a-zA-Z0-9_-]+)\/state$/);
    if (match) {
      try {
        const s = await this.read();
        const p = s.projects.find((p) => p.project_id === match[1]);
        if (!p) {
          json(404, { error: "unknown_project" });
          return;
        }
        json(200, await projectFiles(p));
      } catch (e: any) {
        json(409, {
          error: e.code ?? "projection_unavailable",
          message:
            "프로젝트 JSON이 최신 상태와 일치하지 않습니다. 잠시 후 다시 확인하세요.",
        });
      }
      return;
    }
    if (route !== "/api/status") {
      json(404, { error: "not_found" });
      return;
    }
    // Coalesce readers while the broker is doing an external operation. A hung
    // operation must not accumulate a new queued read on every browser poll.
    if (!this.pending) {
      const pending = this.read().then(webSnapshot);
      this.pending = pending;
      void pending
        .finally(() => {
          if (this.pending === pending) this.pending = undefined;
        })
        .catch(() => {});
    }
    let timer: NodeJS.Timeout | undefined;
    try {
      const data = await Promise.race([
        this.pending,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("busy")), 5000);
        }),
      ]);
      json(200, data);
    } catch {
      json(503, { error: "status_unavailable" });
    } finally {
      clearTimeout(timer);
    }
  }

  async close() {
    this.url = null;
    if (!this.server?.listening) return;
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
  }
}
