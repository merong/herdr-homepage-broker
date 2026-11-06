import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { Config, fail } from "../contracts/types.js";
import { projectDirectory, projectFiles, sample } from "../projects/manage.js";
import { projectCli } from "./actions.js";
import { Herdr } from "../herdr/transport.js";
import { defaultConfigFile } from "../config.js";
import type { AddressInfo } from "node:net";
import type { Broker } from "../broker/broker.js";
import { McpHealth } from "../media/health.js";
import { VERSION } from "../version.js";
import { readEvents } from "../storage/events.js";
import { DEFAULT_STALL_MINUTES } from "../domain/stall.js";
import { listAssets, listShots, resolveImage, runDir } from "./files.js";

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
      execution_requested: p.execution_requested,
      reason: p.reason ?? null,
      workspace_id: p.herdr.workspace_id,
      orchestration: p.orchestration ?? null,
      input_required: p.input_required,
      created_at: p.created_at,
      stall: p.stall,
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
          changed_at: a.runtime.changed_at ?? null,
          interactive_ready: a.runtime.interactive_ready === true,
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
        updated_at: t.updated_at ?? null,
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
      active_operations: p.operations
        .filter((o) => ["prepared", "dispatching"].includes(o.status))
        .map((o) => ({ kind: o.kind, created_at: o.created_at })),
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
  private streams = new Set<http.ServerResponse>();
  private streamTimer?: NodeJS.Timeout;
  private broadcasting = false;
  private mcp: McpHealth;
  private herdr?: Herdr;
  private panes = new Map<string, { at: number; read: Promise<string> }>();
  constructor(
    private read: () => Promise<Snapshot>,
    private config?: Config,
    mcp?: McpHealth,
    herdr?: Herdr,
  ) {
    this.mcp = mcp ?? new McpHealth(config?.mcp);
    this.herdr = herdr ?? (config ? new Herdr(config) : undefined);
  }

  // Several viewers (list thumbnail + detail mirror, more tabs) share one
  // `pane read` per pane per ~second instead of each spawning the Herdr CLI.
  private paneText(pane: string) {
    const hit = this.panes.get(pane);
    if (hit && Date.now() - hit.at < 900) return hit.read;
    const read = this.herdr!.text([
      "pane",
      "read",
      pane,
      "--source",
      "visible",
      "--format",
      "ansi",
    ]);
    this.panes.set(pane, { at: Date.now(), read });
    read.catch(() => this.panes.delete(pane));
    for (const [key, value] of this.panes)
      if (Date.now() - value.at > 60000) this.panes.delete(key);
    return read;
  }

  private async snapshot() {
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
      return await Promise.race([
        this.pending,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("busy")), 5000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async broadcast() {
    if (this.broadcasting || !this.streams.size) return;
    this.broadcasting = true;
    let event;
    try {
      event = `event: status\ndata: ${JSON.stringify(await this.snapshot())}\n\n`;
    } catch {
      event = 'event: unavailable\ndata: {"error":"status_unavailable"}\n\n';
    }
    for (const res of this.streams) {
      if (res.writableLength > 256 * 1024) res.destroy();
      else res.write(event);
    }
    this.broadcasting = false;
  }

  async start(port: number) {
    const assets = new Map<string, { body: Buffer; type: string }>();
    const js = "text/javascript; charset=utf-8",
      css = "text/css; charset=utf-8";
    for (const [route, name, type] of [
      ["/", "index.html", "text/html; charset=utf-8"],
      ["/theme.js", "theme.js", js],
      ["/icons.js", "icons.js", js],
      ["/app.js", "app.js", js],
      ["/actions.js", "actions.js", js],
      ["/live.js", "live.js", js],
      ["/tokens.css", "tokens.css", css],
      ["/bundle.css", "bundle.css", css],
      ["/app.css", "app.css", css],
      ["/ui/components.js", "ui/components.js", js],
    ])
      try {
        assets.set(route, {
          body: await fs.readFile(new URL(`./public/${name}`, import.meta.url)),
          type,
        });
      } catch (e: any) {
        // The Vite bundle is optional: the shell renders without React parts.
        if (e.code !== "ENOENT" || route !== "/ui/components.js") throw e;
      }
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
        "/api/projects/focus",
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
        if (route === "/api/projects/focus") {
          if (Object.keys(input).some((key) => key !== "project_id"))
            fail("invalid_request", "focus accepts only project_id");
          const p = (await this.read()).projects.find(
            (p) => p.project_id === input.project_id,
          );
          if (!p) fail("unknown_project", "프로젝트를 찾을 수 없습니다.");
          const workspace = p.herdr.workspace_id;
          if (!workspace)
            fail("no_workspace", "아직 Herdr workspace가 없습니다.");
          // Display only: switches the Herdr client view, never business state.
          try {
            await this.herdr!.cli(["workspace", "focus", workspace], 5000);
          } catch (e: any) {
            json(502, {
              error: e.code ?? "focus_failed",
              message: "Herdr에서 workspace를 열지 못했습니다.",
            });
            return;
          }
          json(200, { ok: true, workspace_id: workspace, session: "homepage" });
          return;
        }
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
        version: VERSION,
      });
      return;
    }
    if (route === "/api/bootstrap") {
      json(200, {
        session: "homepage",
        version: VERSION,
        projects_root: this.config?.projectsRoot ?? null,
        config_file: process.env.HOMEPAGE_CONFIG || defaultConfigFile(),
        can_submit: !!this.config,
        csrf: this.config ? this.csrf : null,
        stall_after_minutes:
          this.config?.stallAfterMinutes ?? DEFAULT_STALL_MINUTES,
        sample,
        repository: "merong/herdr-homepage-broker",
      });
      return;
    }
    if (route === "/api/mcp" || route === "/api/mcp?refresh=1") {
      json(
        200,
        this.mcp.snapshot(req.method === "GET" && route.endsWith("refresh=1")),
      );
      return;
    }
    if (route === "/api/events") {
      if (this.streams.size >= 20) {
        json(503, { error: "stream_limit" });
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      res.flushHeaders();
      res.write("retry: 2000\n\n");
      this.streams.add(res);
      res.on("close", () => {
        this.streams.delete(res);
        if (!this.streams.size) {
          clearInterval(this.streamTimer);
          this.streamTimer = undefined;
        }
      });
      if (!this.streamTimer)
        this.streamTimer = setInterval(() => {
          void this.broadcast();
        }, 1000);
      void this.broadcast();
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
            version: VERSION,
            session: "homepage",
            broker: {
              available: true,
              execution_enabled: s.execution_enabled,
              storage_fault: s.storage_fault,
              projection_pending: s.projection_pending,
            },
            herdr,
            projects_root: c.projectsRoot,
            mcp: this.mcp.snapshot(),
            skills_count: c.skills.length,
            model: c.model,
            effort: c.effort,
            execution_configured: !!(
              s.execution_enabled &&
              herdr.available &&
              !s.storage_fault
            ),
            note: "MCP 검사는 메인 화면에서 자동 갱신됩니다. 접속 검사로 실제 생성 성공을 보장하지 않습니다.",
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
    if (await this.projectRoute(route ?? "", req, res, json)) return;
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
    try {
      const data = await this.snapshot();
      json(200, data);
    } catch {
      json(503, { error: "status_unavailable" });
    }
  }

  // Per-project read routes: terminal mirror, timeline, screenshots, images.
  private async projectRoute(
    route: string,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    json: (code: number, body: unknown) => void,
  ) {
    const m = route.match(
      /^\/api\/projects\/([a-zA-Z0-9_-]+)\/(terminal|events|shots|assets)(\/[^?]*)?(?:\?(.*))?$/,
    );
    if (!m) return false;
    const [, id, kind, rest = "", query = ""] = m;
    const params = new URLSearchParams(query);
    const p = (await this.read()).projects.find((p) => p.project_id === id);
    if (!p) {
      json(404, { error: "unknown_project" });
      return true;
    }
    const r = { run_id: p.run_id, directory: p.directory };
    if (kind === "terminal" && !rest) {
      if (!this.herdr || [...params.keys()].some((k) => k !== "agent")) {
        json(404, { error: "not_found" });
        return true;
      }
      const agent =
        p.agents.find((a) => a.agent_id === params.get("agent")) ??
        p.agents.find((a) => a.role === "pm") ??
        p.agents[0];
      const pane = agent?.herdr.pane_id;
      const base = {
        project_id: id,
        run_id: r.run_id,
        agent_id: agent?.agent_id ?? null,
        pane_id: pane ?? null,
        panes: p.agents
          .filter((a) => a.herdr.pane_id)
          .map((a) => ({ agent_id: a.agent_id, role: a.role })),
      };
      if (!pane || agent.runtime.status === "stopped") {
        json(200, { ...base, available: false, reason: "no_pane" });
        return true;
      }
      try {
        const text = await this.paneText(pane);
        json(200, {
          ...base,
          available: true,
          text: text.slice(-256 * 1024),
          read_at: new Date().toISOString(),
        });
      } catch (e: any) {
        json(200, {
          ...base,
          available: false,
          reason: e.code ?? "read_failed",
        });
      }
      return true;
    }
    if (kind === "events" && !rest) {
      const before = params.get("before"),
        limit = params.get("limit");
      if (
        [...params.keys()].some((k) => !["before", "limit"].includes(k)) ||
        (before !== null && !/^\d{1,9}$/.test(before)) ||
        (limit !== null && !/^\d{1,3}$/.test(limit))
      ) {
        json(400, { error: "invalid_query" });
        return true;
      }
      json(200, {
        project_id: id,
        run_id: r.run_id,
        ...(await readEvents(r.directory, {
          run_id: r.run_id,
          before: before === null ? undefined : Number(before),
          limit: Math.min(Math.max(Number(limit ?? 200), 1), 500),
        })),
      });
      return true;
    }
    if (kind === "shots" && !rest && !query) {
      json(200, {
        project_id: id,
        run_id: r.run_id,
        rounds: await listShots(r.directory, r.run_id),
        assets: await listAssets(r.directory, r.run_id),
      });
      return true;
    }
    // Images: /shots/<run>/<round>/<file> and /assets/<run>/<file>. A `v`
    // cache-buster is the only accepted query.
    const segments = rest.split("/").slice(1);
    if (
      rest &&
      [...params.keys()].every((k) => k === "v") &&
      segments.length === (kind === "shots" ? 3 : 2)
    ) {
      const [run, ...file] = segments;
      const image = /^[a-zA-Z0-9_-]{1,128}$/.test(run)
        ? await resolveImage(
            path.join(
              runDir(r.directory, run),
              kind === "shots" ? "reports/look" : "assets",
            ),
            file,
          )
        : null;
      if (image) {
        res.writeHead(200, {
          "Content-Type": image.type,
          "Content-Length": image.size,
          // URLs carry ?v=<mtime>, so a cached copy is never stale.
          "Cache-Control": params.has("v")
            ? "private, max-age=86400, immutable"
            : "no-store",
        });
        res.end(
          req.method === "HEAD" ? undefined : await fs.readFile(image.file),
        );
        return true;
      }
    }
    json(404, { error: "not_found" });
    return true;
  }

  async close() {
    this.url = null;
    this.mcp.close();
    clearInterval(this.streamTimer);
    for (const res of this.streams) res.end();
    this.streams.clear();
    if (!this.server?.listening) return;
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
  }
}
