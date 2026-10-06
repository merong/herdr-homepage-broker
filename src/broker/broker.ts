import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { randomUUID } from "node:crypto";
import {
  Store,
  canonical,
  hash,
  atomic,
  readInputs,
} from "../storage/store.js";
import {
  Command,
  Config,
  Checkpoint,
  Project,
  Run,
  Operation,
  Fault,
  fail,
  terminal,
  now,
} from "../contracts/types.js";
import { command, required } from "../contracts/validate.js";
import {
  current,
  target,
  mutate,
  readyTasks,
  canAssign,
  quiescent,
  unknown,
  authenticate,
  validateReplacement,
} from "../domain/engine.js";
import { Herdr, HerdrRejected, Lines, Observer } from "../herdr/transport.js";
import { rolePrompt, claudeArgs, assignment } from "../agents/prompts.js";
import { Mcp, field } from "../media/mcp.js";
import {
  startPreview,
  stopPreview,
  verifyPreview,
} from "../preview/manager.js";
import { syncTsk } from "../herdr/tsk.js";
import { brokerSocket } from "../config.js";
import { Dashboard } from "../web/server.js";
import { executionReadiness } from "./execution.js";
import { prepareRuntime } from "../projects/runtime.js";
export class Broker {
  store: Store;
  herdr: Herdr;
  mcp?: Mcp;
  server?: net.Server;
  observer?: Observer;
  timer?: NodeJS.Timeout;
  tail: Promise<any> = Promise.resolve();
  busy = false;
  closing = false;
  runtimeError: string | null = null;
  dashboard?: Dashboard;
  webError: string | null = null;
  clients = new Set<net.Socket>();
  constructor(
    public config: Config,
    herdr?: Herdr,
  ) {
    this.store = new Store(config);
    this.herdr = herdr ?? new Herdr(config);
    if (config.mcp) this.mcp = new Mcp(config.mcp);
  }
  serial<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn);
    this.tail = result.catch(() => {});
    return result;
  }
  async start(observe = true) {
    await this.store.acquire();
    try {
      await this.store.load();
      const s = structuredClone(this.store.state);
      for (const p of Object.values(s.projects)) {
        if (!terminal.has(current(p).status))
          await prepareRuntime(this.config, p.directory);
        for (const r of p.runs) {
          for (const a of r.agents) a.runtime.fresh = false;
          for (const op of r.operations)
            if (op.status === "dispatching") op.status = "unknown";
          if (["ready", "starting"].includes(r.preview.status))
            r.preview.status = "unknown";
          if (!terminal.has(r.status)) {
            r.resume_required = true;
            r.status = "paused";
            r.reason = "broker_restarted";
            p.revision++;
          }
        }
      }
      await this.store.commit(s);
      const socket = brokerSocket(this.config);
      try {
        await fs.lstat(socket);
        fail(
          "stale_socket",
          "Use broker recover before removing a stale socket",
        );
      } catch (e: any) {
        if (e.code !== "ENOENT") throw e;
      }
      this.server = net.createServer((client) => {
        this.clients.add(client);
        client.on("error", () => {});
        client.on("close", () => this.clients.delete(client));
        client.setTimeout(60000, () => client.destroy());
        let count = 0;
        const lines = new Lines((v) => {
          if (++count > 1) {
            client.destroy();
            return;
          }
          const input = command(v);
          const response =
            input.type === "status"
              ? Promise.resolve(
                  this.status(input.project_id, this.store.published),
                )
              : this.serial(() => this.handle(input));
          void response.then(
            (result) => client.end(JSON.stringify({ ok: true, result }) + "\n"),
            (e) =>
              client.end(
                JSON.stringify({
                  ok: false,
                  error: {
                    code: e.code ?? "internal_error",
                    message: e.message,
                  },
                }) + "\n",
              ),
          );
        });
        client.on("data", (b) => {
          try {
            lines.push(b);
          } catch (e: any) {
            client.end(
              JSON.stringify({
                ok: false,
                error: { code: e.code ?? "invalid_json", message: e.message },
              }) + "\n",
            );
          }
        });
      });
      await new Promise<void>((resolve, reject) => {
        this.server!.once("error", reject);
        this.server!.listen(socket, () => resolve());
      });
      await fs.chmod(socket, 0o600);
      if (this.config.web?.enabled) {
        this.dashboard = new Dashboard(
          async () =>
            structuredClone(this.status(undefined, this.store.published)),
          this.config,
        );
        try {
          await this.dashboard.start(this.config.web.port);
        } catch (e: any) {
          this.webError = e.code ?? "web_start_failed";
          await this.dashboard.close();
        }
      }
      if (observe) {
        this.observer = new Observer(
          this.herdr,
          (snapshot) => this.serial(() => this.observe(snapshot)),
          () => {
            void this.serial(async () => {
              for (const p of Object.values(this.store.state.projects))
                for (const a of current(p).agents) a.runtime.fresh = false;
              this.runtimeError = "session_unavailable";
            });
          },
        );
        this.observer.start();
      }
      this.timer = setInterval(() => {
        if (this.busy || this.closing) return;
        this.busy = true;
        void this.serial(() => this.tick())
          .catch((e) => {
            this.runtimeError = e.code ?? e.message;
          })
          .finally(() => {
            this.busy = false;
          });
      }, 500);
    } catch (e) {
      await this.store.release();
      throw e;
    }
  }
  async save(p?: Project) {
    if (p) p.revision++;
    await this.store.commit(this.store.state);
  }
  async handle(c: Command): Promise<any> {
    c = command(c);
    if (c.type === "status") return this.status(c.project_id);
    if (c.type === "execution-status")
      return this.executionStatus(required(c, "project_id"));
    if (this.store.failed)
      fail(
        "storage_unknown",
        "Writer stopped after a storage failure; restart and reconcile",
      );
    const digest = hash(canonical(c));
    const old = this.store.state.commands[c.command_id];
    if (old) {
      if (old.hash !== digest)
        fail("command_conflict", "command_id reused with different content");
      if (old.result?.receipt === "pending")
        fail(
          "command_indeterminate",
          "Prior dispatch outcome requires reconciliation; it will not be resent",
        );
      return { ...old.result, projection_pending: this.store.pending };
    }
    let result: any;
    if (c.type === "execute") {
      const { r } = target(this.store.state, c);
      if (r.herdr.workspace_id) await this.observe(await this.herdr.snapshot());
      const readiness = await this.executionStatus(required(c, "project_id"));
      if (readiness.action !== c.payload.action)
        fail(
          "execution_state_changed",
          "프로젝트 상태가 변경됐습니다. 실행 준비를 다시 확인하세요.",
        );
      if (!readiness.ready)
        fail(
          "execution_not_ready",
          [
            ...readiness.blockers.map((v) => v.detail),
            ...readiness.checks
              .filter((v) => !v.ok)
              .map((v) => `${v.label}: ${v.detail}`),
          ].join("\n"),
        );
      await this.mcp?.connect();
      await prepareRuntime(
        this.config,
        this.store.state.projects[c.project_id!].directory,
      );
      const next = structuredClone(this.store.state);
      if (c.payload.action === "resume")
        await mutate(next, { ...c, type: "resume", payload: {} }, this.config);
      const project = next.projects[c.project_id!];
      current(project).execution_requested = true;
      project.revision++;
      result = {
        project_id: c.project_id,
        run_id: c.run_id,
        status: "queued",
        action: c.payload.action,
        execution_requested: true,
      };
      next.commands[c.command_id] = { hash: digest, result };
      await this.store.commit(next);
      return {
        ...result,
        projection_pending: this.store.pending,
        revision: this.store.state.revision,
      };
    }
    if (["resume", "feedback", "apply-inputs"].includes(c.type)) {
      const { r } = target(this.store.state, c);
      if (r.herdr.workspace_id) await this.observe(await this.herdr.snapshot());
    }
    if (["feedback", "apply-inputs"].includes(c.type)) {
      const { p, r } = target(this.store.state, c);
      validateReplacement(r, c);
      await readInputs(c.payload.inputs);
      // Terminate the settled old role panes before a replacement can create three new agents.
      for (const a of r.agents) {
        if (!a.herdr.pane_id || a.runtime.status === "stopped") continue;
        await this.operation(
          p,
          r,
          "pane.close-for-replacement",
          { pane_id: a.herdr.pane_id },
          () => this.herdr.cli(["pane", "close", a.herdr.pane_id]),
          () => {
            a.status = "stopped";
            a.task_id = null;
            a.runtime = { status: "stopped", fresh: true };
          },
        );
      }
    }
    if (
      [
        "preview-start",
        "preview-stop",
        "media-request",
        "media-status",
        "reconcile",
      ].includes(c.type)
    ) {
      const { p, r } = target(this.store.state, c);
      // Reserve the command before any external effect. A lost receipt never triggers an implicit resend.
      this.store.state.commands[c.command_id] = {
        hash: digest,
        result: { receipt: "pending" },
      };
      await this.save();
      if (c.payload.agent_id) {
        const a = authenticate(r, c.payload);
        if (
          ["preview-start", "preview-stop"].includes(c.type) &&
          a.role !== "pm"
        )
          fail("report_owner", "Only PM manages preview");
        if (c.type === "media-request" && a.role !== "designer")
          fail("report_owner", "Only designer requests media");
      }
      if (c.type === "preview-stop") {
        await stopPreview(r.preview);
        await this.save(p);
        result = r.preview;
      } else if (c.type === "preview-start") {
        if (
          !["running", "review_pending"].includes(r.status) ||
          r.resume_required
        )
          fail("run_closed", "Preview needs active or review run");
        if (["ready", "starting", "unknown"].includes(r.preview.status))
          fail("preview_exists", "Stop or reconcile existing preview");
        await this.previewCapacity(r);
        result = await this.operation(
          p,
          r,
          "preview.start",
          { argv: c.payload.argv },
          async () => startPreview(p, r, c.payload.argv, () => this.save(p)),
          () => {},
        );
      } else if (c.type === "media-request") {
        if (!["running", "retrying"].includes(r.status) || r.resume_required)
          fail("run_closed", "Media needs active run");
        if (!this.mcp || !this.config.mcp)
          fail("mcp_unconfigured", "Configure broker MCP connection and tools");
        await this.mcp.connect();
        const item: any = { operation_id: "", status: "pending" };
        result = await this.operation(
          p,
          r,
          "media.generate",
          { arguments: c.payload.arguments },
          () => this.mcp!.generate(c.payload.arguments),
          (data, op) => {
            const job = field(data, this.config.mcp!.jobIdPath);
            if (typeof job !== "string" || !job)
              fail("mcp_response_schema", "Missing provider job ID");
            Object.assign(item, {
              operation_id: op.operation_id,
              job_id: job,
              status: "pending",
              agent_id: c.payload.agent_id ?? null,
              task_id:
                r.agents.find((a) => a.agent_id === c.payload.agent_id)
                  ?.task_id ?? null,
            });
            r.media.push(item);
          },
        );
      } else if (c.type === "media-status") {
        await this.pollMedia(p, r);
        result = r.media;
      } else {
        await this.observe(await this.herdr.snapshot());
        if (r.preview.status === "unknown" && (await verifyPreview(r.preview)))
          r.preview.status = "ready";
        if (c.payload.operation_id) {
          const op = r.operations.find(
            (o) => o.operation_id === c.payload.operation_id,
          );
          if (!op || op.status !== "unknown")
            fail("invalid_operation", "Unknown operation not found");
          if (c.payload.confirm_not_executed !== true)
            fail(
              "reconcile_required",
              "Inspect provider/Herdr first; explicitly confirm not executed",
            );
          op.status = "settled";
          op.error = "User confirmed external operation was not executed";
        }
        await this.save(p);
        result = {
          status: r.status,
          unknown_operations: r.operations.filter(
            (o) => o.status === "unknown",
          ),
        };
      }
      const next = structuredClone(this.store.state);
      next.commands[c.command_id] = { hash: digest, result };
      await this.store.commit(next);
    } else {
      // Validate and mutate a clone so a refused command cannot leak partial state changes.
      const next = structuredClone(this.store.state);
      result = await mutate(next, c, this.config);
      if (["submit", "feedback", "apply-inputs"].includes(c.type))
        await prepareRuntime(
          this.config,
          next.projects[c.project_id!].directory,
        );
      next.commands[c.command_id] = { hash: digest, result };
      await this.store.commit(next);
    }
    return {
      ...result,
      projection_pending: this.store.pending,
      revision: this.store.state.revision,
    };
  }
  async executionStatus(project: string) {
    const p = this.store.state.projects[project];
    if (!p) fail("unknown_project", "Project not found");
    return executionReadiness(this.config, p, current(p), this.herdr, {
      storage_fault: this.store.failed,
      projection_pending: this.store.pending,
      slots: Object.values(this.store.state.projects).filter(
        (p) => current(p).slot,
      ).length,
    });
  }
  status(project?: string, state: Checkpoint = this.store.state) {
    const ps = project
      ? [state.projects[project]].filter(Boolean)
      : Object.values(state.projects);
    if (project && !ps.length) fail("unknown_project", "Project not found");
    return {
      schema_version: 1,
      session: "homepage",
      revision: state.revision,
      projection_pending: this.store.pending,
      runtime_error: this.runtimeError,
      storage_fault: this.store.failed,
      execution_enabled: this.config.allowExecution,
      web: {
        enabled: this.config.web?.enabled ?? false,
        url: this.dashboard?.url ?? null,
        error: this.webError,
      },
      projects: ps.map((p) => {
        const r = current(p);
        return {
          project_id: p.project_id,
          directory: p.directory,
          revision: p.revision,
          run_id: r.run_id,
          status: r.status,
          slot: r.slot,
          resume_required: r.resume_required,
          execution_requested: !!r.execution_requested,
          reason: r.reason,
          input_required: r.questions.some((q) => q.status !== "answered"),
          input_requests: r.questions,
          herdr: r.herdr,
          preview: r.preview,
          tasks: r.tasks,
          agents: r.agents.map(({ token, ...a }) => a),
          operations: r.operations.map(({ request, ...o }) => o),
        };
      }),
    };
  }
  async operation(
    p: Project,
    r: Run,
    kind: string,
    request: any,
    send: () => Promise<any>,
    apply: (value: any, op: Operation) => void,
  ) {
    const op: Operation = {
      operation_id: randomUUID(),
      kind,
      status: "prepared",
      request,
      created_at: now(),
    };
    r.operations.push(op);
    await this.save(p);
    op.status = "dispatching";
    await this.save(p);
    try {
      const result = await send();
      apply(result, op);
      op.result = result;
      op.status = "settled";
      await this.save(p);
      return result;
    } catch (e: any) {
      op.status = e instanceof HerdrRejected ? "settled" : "unknown";
      op.error = e.code ?? "dispatch_unknown";
      if (!terminal.has(r.status)) r.status = "paused";
      r.resume_required = true;
      r.reason = e instanceof HerdrRejected ? e.code : "operation_unknown";
      await this.save(p);
      throw e;
    }
  }
  async observe(snapshot: any) {
    this.runtimeError = null;
    let changed = false;
    for (const p of Object.values(this.store.state.projects)) {
      const r = current(p);
      for (const a of r.agents) {
        if (!a.herdr.pane_id) continue;
        const live =
          snapshot.agents?.find((x: any) => x.pane_id === a.herdr.pane_id) ??
          snapshot.panes.find((x: any) => x.pane_id === a.herdr.pane_id);
        if (!live) {
          a.runtime = { status: "stopped", fresh: true, observed_at: now() };
          if (
            a.herdr.started &&
            !terminal.has(r.status) &&
            r.status !== "cancelling"
          ) {
            r.status = "paused";
            r.resume_required = true;
            r.reason = "resource_missing";
          }
          changed = true;
          continue;
        }
        if (
          live.terminal_id !== a.herdr.terminal_id ||
          live.workspace_id !== r.herdr.workspace_id
        ) {
          a.runtime = { status: "unknown", fresh: false, observed_at: now() };
          if (!terminal.has(r.status)) {
            r.resume_required = true;
            r.status = "paused";
            r.reason = "resource_owner_mismatch";
          }
          changed = true;
          continue;
        }
        a.runtime = {
          status: live.agent_status,
          fresh: true,
          observed_at: now(),
          interactive_ready: live.interactive_ready ?? false,
        };
        if (!a.herdr.started && live.agent_status === "unknown") {
          try {
            if (await this.herdr.shellReady(a.herdr.pane_id))
              a.runtime.status = "idle";
          } catch {
            /* Keep unknown until the foreground process is verified. */
          }
        }
        changed = true;
        if (
          live.agent_status === "blocked" &&
          !terminal.has(r.status) &&
          !r.questions.some(
            (q) =>
              q.agent_id === a.agent_id &&
              q.kind === "terminal_action" &&
              q.status !== "answered",
          )
        ) {
          r.questions.push({
            request_id: randomUUID(),
            run_id: r.run_id,
            agent_id: a.agent_id,
            task_id: a.task_id ?? "plan",
            kind: "terminal_action",
            question:
              "해당 pane의 권한·인증 요청을 직접 처리한 뒤 완료를 알려주세요. 비밀값을 응답에 넣지 마세요.",
            response_schema: { type: "string" },
            status: "open",
          });
        }
      }
      if (changed) p.revision++;
    }
    if (changed) await this.save();
  }
  async setup(p: Project, r: Run) {
    if (!this.config.allowExecution) return;
    await this.herdr.doctor();
    await prepareRuntime(this.config, p.directory);
    // Explicit stdio remains supported; otherwise Claude reuses its installed MCP.
    await this.mcp?.connect();
    if (!r.herdr.workspace_id) {
      const label = `homepage:${p.project_id}:${r.run_id}`;
      await this.operation(
        p,
        r,
        "workspace.create",
        { label, cwd: p.directory },
        () =>
          this.herdr.cli([
            "workspace",
            "create",
            "--cwd",
            p.directory,
            "--label",
            label,
            "--no-focus",
          ]),
        (v) => {
          if (!v.workspace?.workspace_id || !v.root_pane?.terminal_id)
            fail("invalid_response", "Missing workspace/root pane IDs");
          r.herdr.workspace_id = v.workspace.workspace_id;
          r.agents[0].herdr = { ...v.root_pane, session_name: "homepage" };
        },
      );
    }
    for (const a of r.agents) {
      if (!a.herdr.pane_id) {
        await this.operation(
          p,
          r,
          "pane.split",
          { role: a.role },
          () =>
            this.herdr.cli([
              "pane",
              "split",
              r.agents[0].herdr.pane_id,
              "--direction",
              "down",
              "--cwd",
              p.directory,
              "--no-focus",
            ]),
          (v) => {
            if (
              !v.pane?.terminal_id ||
              v.pane.workspace_id !== r.herdr.workspace_id
            )
              fail("invalid_response", "Missing or wrong pane");
            a.herdr = { ...v.pane, session_name: "homepage" };
          },
        );
      }
    }
    for (const a of r.agents) {
      if (a.herdr.started) continue;
      const prompt = await rolePrompt(this.config, p, r, a);
      const name = `hp-${hash(a.agent_id).slice(0, 12)}-${a.role}`;
      await this.operation(
        p,
        r,
        "agent.start",
        {
          agent_id: a.agent_id,
          herdr_name: name,
          pane_id: a.herdr.pane_id,
          model: a.model,
          effort: a.effort,
        },
        () =>
          this.herdr.cli([
            "agent",
            "start",
            name,
            "--kind",
            "claude",
            "--pane",
            a.herdr.pane_id,
            "--timeout",
            "30000",
            "--",
            ...claudeArgs(prompt, !this.config.mcp),
          ]),
        (v) => {
          if (
            !v.agent?.terminal_id ||
            v.agent.terminal_id !== a.herdr.terminal_id
          )
            fail("invalid_response", "Agent terminal mismatch");
          a.herdr = {
            ...a.herdr,
            ...v.agent,
            started: true,
            launch_argv: v.argv,
          };
          a.runtime = {
            status: v.agent.agent_status,
            fresh: true,
            observed_at: now(),
          };
        },
      );
    }
    r.status = "running";
    r.reason = undefined;
    await this.save(p);
  }
  async previewCapacity(run: Run) {
    const busy = Object.values(this.store.state.projects)
      .map((p) => ({ p, r: current(p) }))
      .filter((x) =>
        ["ready", "starting", "unknown"].includes(x.r.preview.status),
      );
    if (busy.length < this.config.maxPreviews) return;
    const candidate = busy
      .filter(
        (x) =>
          x.r !== run &&
          x.r.status === "review_pending" &&
          x.r.preview.status === "ready",
      )
      .sort((a, b) =>
        (a.r.preview.started_at ?? "").localeCompare(
          b.r.preview.started_at ?? "",
        ),
      )[0];
    if (!candidate) fail("preview_capacity", "No evictable review preview");
    await stopPreview(candidate.r.preview);
    await this.save(candidate.p);
  }
  async pollMedia(p: Project, r: Run) {
    if (!this.mcp || !this.config.mcp) return;
    for (const job of r.media) {
      if (
        ["succeeded", "failed", "unknown"].includes(job.status) ||
        Date.now() - (job.last_checked ?? 0) < 5000
      )
        continue;
      job.last_checked = Date.now();
      try {
        const data = await this.mcp.status(job.job_id);
        const status = field(data, this.config.mcp.statusPath);
        if (!["pending", "running", "succeeded", "failed"].includes(status))
          fail("mcp_response_schema", "Unsupported media status");
        if (status === "succeeded") {
          const asset = field(data, this.config.mcp.assetPath);
          if (typeof asset !== "string" || !asset)
            fail("mcp_response_schema", "Missing asset");
          job.asset = asset;
        }
        job.status = status;
        delete job.poll_error;
        job.updated_at = now();
      } catch (e: any) {
        job.poll_error = e.code ?? "mcp_unavailable";
      }
    }
    await this.save(p);
  }
  async tick() {
    if (this.closing || this.store.failed) return;
    if (this.store.pending) await this.store.projectAll();
    const entries = Object.values(this.store.state.projects).map((p) => ({
      p,
      r: current(p),
    }));
    // No external dispatch can bypass the durable two-slot reservation.
    for (const { p, r } of entries) {
      if (
        r.preview.status === "ready" &&
        Date.now() - ((r.preview as any).checked_at ?? 0) > 5000
      ) {
        (r.preview as any).checked_at = Date.now();
        if (!(await verifyPreview(r.preview))) {
          r.preview.status = "unknown";
          r.preview.error = "Preview no longer verified";
          await this.save(p);
        }
      }
      if (r.status === "cancelling") {
        if (r.media.some((m) => ["pending", "running"].includes(m.status)))
          await this.pollMedia(p, r);
        if (unknown(r)) continue;
        try {
          if (r.herdr.workspace_id)
            await this.observe(await this.herdr.snapshot());
          for (const a of r.agents) {
            if (!a.herdr.pane_id || a.runtime.status === "stopped") continue;
            if (!a.runtime.fresh)
              fail("resource_owner_mismatch", "Cannot close unverified pane");
            await this.operation(
              p,
              r,
              "pane.close",
              { pane_id: a.herdr.pane_id },
              () => this.herdr.cli(["pane", "close", a.herdr.pane_id]),
              () => {
                a.runtime = { status: "stopped", fresh: true };
                a.status = "stopped";
              },
            );
          }
          await stopPreview(r.preview);
          r.status = "cancelled";
          r.slot = false;
          r.tasks
            .filter((t) => t.status !== "completed")
            .forEach((t) => (t.status = "cancelled"));
          await this.save(p);
        } catch (e: any) {
          r.reason = e.code ?? "cancel_pending";
        }
        continue;
      }
      if (r.herdr.workspace_id && r.reason !== "resource_owner_mismatch") {
        const display = JSON.stringify({
          status: r.status,
          input: r.questions.some((q) => q.status !== "answered"),
        });
        if ((r as any).metadata_signature !== display) {
          try {
            await this.herdr.api("workspace.report_metadata", {
              workspace_id: r.herdr.workspace_id,
              source: "homepage-broker",
              seq: p.revision,
              tokens: {
                homepage_status: r.status,
                input_required: String(
                  r.questions.some((q) => q.status !== "answered"),
                ),
                project_id: p.project_id,
              },
              ttl_ms: 30000,
            });
            (r as any).metadata_signature = display;
          } catch {
            /* Display failure does not alter business state. */
          }
        }
      }
      if (terminal.has(r.status) || r.resume_required || !r.slot) continue;
      if (r.media.some((m) => ["pending", "running"].includes(m.status)))
        await this.pollMedia(p, r);
      if (r.status === "starting") {
        try {
          await this.setup(p, r);
        } catch (e: any) {
          r.status = "paused";
          r.resume_required = true;
          r.reason = e.code ?? "preflight_failed";
          if (!r.herdr.workspace_id && !unknown(r)) r.slot = false;
          await this.save(p);
        }
        continue;
      }
      if (!["running", "retrying"].includes(r.status)) continue;
      // An API observation is required before reusing a settled agent after its report.
      try {
        await this.observe(await this.herdr.snapshot());
      } catch {
        continue;
      }
      if (
        r.tasks.every((t) => t.status === "completed") &&
        r.preview.status === "ready" &&
        quiescent(r)
      ) {
        r.status = "review_pending";
        r.slot = false;
        await this.save(p);
        continue;
      }
      for (const job of r.media) {
        if (
          !["succeeded", "failed"].includes(job.status) ||
          job.notified ||
          !job.agent_id
        )
          continue;
        const a = r.agents.find((a) => a.agent_id === job.agent_id);
        if (
          !a ||
          a.task_id !== job.task_id ||
          !["idle", "done"].includes(a.runtime.status) ||
          !a.runtime.fresh
        )
          continue;
        try {
          await this.operation(
            p,
            r,
            "agent.media-result",
            { agent_id: a.agent_id, job_id: job.job_id },
            () =>
              this.herdr.cli([
                "agent",
                "prompt",
                a.herdr.pane_id,
                `Higgsfield job ${job.job_id}: ${job.status}. Asset: ${job.asset ?? "none"}. Continue your current assignment and report its result. No new generation without a new explicit need.`,
              ]),
            () => {
              job.notified = true;
              a.runtime = { status: "working", fresh: false };
            },
          );
        } catch {
          break;
        }
      }
      if (r.resume_required) continue;
      const ready = readyTasks(r);
      if (
        !ready.length &&
        !r.tasks.some((t) => t.status === "running") &&
        r.questions.some((q) => q.status !== "answered") &&
        quiescent(r)
      ) {
        r.status = "waiting_input";
        r.slot = false;
        await this.save(p);
        continue;
      }
      for (const t of ready) {
        if (
          !canAssign(r, t) ||
          r.questions.some(
            (q) => q.task_id === t.task_id && q.status !== "answered",
          )
        )
          continue;
        const a = r.agents.find((a) => a.role === t.role)!;
        if (t.attempt === 0 || t.status === "retrying") t.attempt++;
        t.assignment_id = randomUUID();
        t.status = "running";
        a.task_id = t.task_id;
        a.status = "working";
        a.waiting_reason = null;
        r.status = "running";
        await this.save(p);
        const text = await assignment(this.config, p, r, a, t);
        try {
          await this.operation(
            p,
            r,
            "agent.prompt",
            { agent_id: a.agent_id, assignment_id: t.assignment_id },
            () => this.herdr.cli(["agent", "prompt", a.herdr.pane_id, text]),
            () => {
              a.runtime = { status: "working", fresh: false };
            },
          );
        } catch {
          break;
        }
      }
    }
    if (this.config.allowExecution) {
      let slots = entries.filter((x) => x.r.slot).length;
      for (const { p, r } of entries
        .filter(
          (x) =>
            x.r.status === "queued" &&
            !x.r.resume_required &&
            (this.config.autoStart || x.r.execution_requested),
        )
        .sort((a, b) => a.r.queue_seq - b.r.queue_seq)) {
        if (slots >= 2) break;
        r.slot = true;
        r.status = r.agents.every((a) => a.herdr.started)
          ? "running"
          : "starting";
        slots++;
        await this.save(p);
      }
    }
    for (const { p, r } of entries) {
      if (this.config.tsk) {
        try {
          const signature = hash(
            canonical({ status: r.status, run: r.run_id }),
          );
          if ((r as any).tsk_signature !== signature) {
            (r as any).tsk = await syncTsk(this.config, p, r);
            (r as any).tsk_signature = signature;
            await this.save(p);
          }
        } catch {
          (r as any).tsk_sync_pending = true;
        }
      }
    }
  }
  async close() {
    this.closing = true;
    if (this.timer) clearInterval(this.timer);
    this.observer?.close();
    await this.dashboard?.close();
    await this.tail;
    this.mcp?.close();
    for (const client of this.clients) client.destroy();
    if (this.server)
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    await fs.rm(brokerSocket(this.config), { force: true });
    await this.store.release();
  }
}
