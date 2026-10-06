#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { config, brokerSocket, actionGuard, stateDir } from "./config.js";
import { Broker } from "./broker/broker.js";
import { request } from "./broker/client.js";
import { command } from "./contracts/validate.js";
import { Fault, fail } from "./contracts/types.js";
import { recoverLock, processStart } from "./storage/store.js";
import {
  initializeProject,
  initializedRequest,
  projectFiles,
  sample,
} from "./projects/manage.js";
import { Herdr } from "./herdr/transport.js";
import { detectMcp, Mcp } from "./media/mcp.js";
import { board } from "./ui/board.js";
const exec = promisify(execFile);
export async function main(argv = process.argv.slice(2)) {
  const opt = (name: string) => {
    const i = argv.indexOf(name);
    if (i < 0) return undefined;
    if (!argv[i + 1]) fail("usage", `${name} requires value`);
    const v = argv[i + 1];
    argv.splice(i, 2);
    return v;
  };
  const configPath = opt("--config") ?? process.env.HOMEPAGE_CONFIG;
  const c = await config(configPath);
  const socket = opt("--socket") ?? brokerSocket(c);
  const file = opt("--file");
  const id = opt("--project");
  const projectsRoot = opt("--projects-root");
  if (projectsRoot) {
    if (!path.isAbsolute(projectsRoot))
      fail("usage", "--projects-root must be absolute");
    c.projectsRoot = path.resolve(projectsRoot);
  }
  const mode = argv[0] ?? "help";
  const output = (v: any) => console.log(JSON.stringify(v, null, 2));
  if (mode === "project") {
    if (argv[1] === "sample") {
      output(sample);
      return;
    }
    if (argv[1] === "init") {
      if (!file)
        fail("usage", "project init --file init.json (or - for stdin)");
      const input =
        file === "-" ? await stdin() : await fs.readFile(file, "utf8");
      output(await initializeProject(c, JSON.parse(input)));
      return;
    }
    if (!id) fail("usage", "project submit|state requires --project ID");
    if (argv[1] === "submit") {
      output(await request(socket, await initializedRequest(c, id)));
      return;
    }
    if (argv[1] === "state") {
      const status = await request(socket, {
        schema_version: 1,
        command_id: randomUUID(),
        type: "status",
        project_id: id,
        payload: {},
      });
      output(await projectFiles(status.projects[0]));
      return;
    }
    fail("usage", "project init|submit|state|sample");
  }
  if (["broker", "plugin"].includes(mode) && argv[1] === "stop") {
    if (mode === "plugin") actionGuard(c);
    const status = await request(socket, {
      schema_version: 1,
      command_id: randomUUID(),
      type: "status",
      payload: {},
    });
    if (
      status.projects.some(
        (p: any) =>
          p.slot ||
          ![
            "review_pending",
            "failed",
            "cancelled",
            "superseded",
            "queued",
            "paused",
          ].includes(p.status) ||
          p.agents.some(
            (a: any) =>
              a.herdr.pane_id &&
              !["idle", "done", "stopped"].includes(a.runtime.status),
          ),
      )
    )
      fail(
        "broker_busy",
        "Active work must be settled before stopping for an update",
      );
    if (socket !== brokerSocket(c))
      fail("socket_mismatch", "Stop requires the configured broker socket");
    const owner = JSON.parse(
      await fs.readFile(path.join(stateDir(c), "lock/owner.json"), "utf8"),
    );
    if (!owner.start || (await processStart(owner.pid)) !== owner.start)
      fail("owner_mismatch", "Broker process identity changed");
    process.kill(owner.pid, "SIGTERM");
    for (let i = 0; i < 100; i++) {
      try {
        await fs.stat(path.join(stateDir(c), "lock"));
      } catch (e: any) {
        if (e.code === "ENOENT") {
          output({ stopped: true });
          return;
        }
        throw e;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    fail(
      "stop_pending",
      "Broker shutdown is still pending; no force kill was sent",
    );
  }
  if (mode === "help" || mode === "--help") {
    console.log(
      `herdr-webjobs — homepage session broker\n\nbroker start|ensure|stop|status|recover [--config file]\nproject init --file init.json | submit|state --project ID | sample\nsubmit|answer|apply-inputs|feedback|resume|cancel|report --file command.json\nmedia request|status --file command.json\npreview start|stop --file command.json\nreconcile --file command.json\nstatus [--project id] [--socket path]\nweb open|status\nboard | doctor | plugin start|stop|board|status|web|web-status\n\nAll writes require schema_version:1, command_id, type, payload and explicit target IDs.\nSubmit additionally requires project_id, payload.directory and payload.inputs.prd/design {path,sha256}.\nNo shell interpolation, model fallback, automatic auth approval or non-homepage session fallback.`,
    );
    return;
  }
  if (mode === "doctor") {
    let host: any;
    try {
      host = await new Herdr(c).doctor();
    } catch (e: any) {
      host = { available: false, code: e.code };
    }
    let claude: any;
    try {
      claude = {
        version: (await exec("claude", ["--version"])).stdout.trim(),
        model: c.model,
        effort: c.effort,
        provider_execution_verified: false,
      };
    } catch {
      claude = { available: false };
    }
    let mcp: any = { configured: !!c.mcp, usable: false };
    if (c.mcp) {
      const transport = new Mcp(c.mcp);
      try {
        await transport.connect();
        mcp.usable = true;
      } catch (e: any) {
        mcp.code = e.code ?? "mcp_unavailable";
      } finally {
        transport.close();
      }
    }
    output({
      node: process.version,
      node24_verified: process.versions.node.startsWith("24."),
      herdr: host,
      claude,
      higgsfield: { registration: await detectMcp(), broker: mcp },
      state_dir: stateDir(c),
      execution_enabled: c.allowExecution,
    });
    return;
  }
  if (mode === "broker" && argv[1] === "recover") {
    await recoverLock(c);
    output({ recovered: true });
    return;
  }
  if (mode === "broker" && argv[1] === "start") {
    const b = new Broker(c);
    await b.start();
    output({ ready: true, socket, pid: process.pid, web: b.status().web });
    const close = () => {
      void b.close().then(
        () => process.exit(0),
        () => process.exit(1),
      );
    };
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
    return;
  }
  if (mode === "plugin") actionGuard(c);
  if (
    mode === "web" ||
    (mode === "plugin" && ["web", "web-status"].includes(argv[1]))
  ) {
    const open = mode === "web" ? argv[1] === "open" : argv[1] === "web";
    if (mode === "web" && !["open", "status"].includes(argv[1]))
      fail("usage", "Use web open|status");
    const status = await request(socket, {
      schema_version: 1,
      command_id: randomUUID(),
      type: "status",
      payload: {},
    });
    if (status.session !== "homepage")
      fail("session_mismatch", "Expected homepage broker");
    const web = status.web ?? {
      enabled: false,
      url: null,
      error: "broker_upgrade_required",
    };
    if (open) {
      if (!web.url)
        fail(
          "web_unavailable",
          `Web UI unavailable (${web.error ?? "disabled"}); check web settings and broker version`,
        );
      const url = new URL(web.url);
      if (
        url.protocol !== "http:" ||
        url.hostname !== "127.0.0.1" ||
        !url.port ||
        url.username ||
        url.password ||
        url.pathname !== "/" ||
        url.search ||
        url.hash
      )
        fail("invalid_web_url", "Expected the local broker Web UI address");
      await exec("open", [url.href]);
    }
    output(web);
    return;
  }
  if (
    (mode === "broker" && argv[1] === "ensure") ||
    (mode === "plugin" && argv[1] === "start")
  ) {
    try {
      output(
        await request(socket, {
          schema_version: 1,
          command_id: randomUUID(),
          type: "status",
          payload: {},
        }),
      );
      return;
    } catch (e: any) {
      if (!["ENOENT", "ECONNREFUSED"].includes(e.code)) throw e;
    }
    await fs.mkdir(stateDir(c), { recursive: true, mode: 0o700 });
    const log = await fs.open(path.join(stateDir(c), "broker.log"), "a", 0o600);
    const args = [fileURLToPath(import.meta.url), "broker", "start"];
    if (configPath) args.push("--config", path.resolve(configPath));
    const child = spawn(process.execPath, args, {
      detached: true,
      stdio: ["ignore", log.fd, log.fd],
      env: process.env,
    });
    child.unref();
    await log.close();
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 100));
      try {
        const status = await request(socket, {
          schema_version: 1,
          command_id: randomUUID(),
          type: "status",
          payload: {},
        });
        if (status.web?.enabled && !status.web.url && !status.web.error)
          continue;
        output(status);
        return;
      } catch {}
    }
    fail(
      "broker_start_failed",
      "Broker did not become ready; inspect broker.log",
    );
  }
  if (mode === "plugin" && argv[1] === "board") {
    const workspace = process.env.HERDR_WORKSPACE_ID,
      pane = process.env.HERDR_PANE_ID;
    if (!workspace || !pane) fail("missing_context", "Open from a workspace");
    const h = new Herdr(c);
    const result = await h.cli(["pane", "list", "--workspace", workspace]);
    const existing = result.panes?.find(
      (p: any) => p.label === "Homepage jobs",
    );
    if (existing) {
      await h.cli(["tab", "focus", existing.tab_id]);
      await h.cli(["plugin", "pane", "focus", existing.pane_id]);
    } else
      await h.cli([
        "plugin",
        "pane",
        "open",
        "--plugin",
        "herdr-homepage-broker",
        "--entrypoint",
        "board",
        "--placement",
        "split",
        "--target-pane",
        pane,
        "--focus",
      ]);
    return;
  }
  if (mode === "board") {
    await board(socket, c);
    return;
  }
  if (
    mode === "status" ||
    (mode === "broker" && argv[1] === "status") ||
    (mode === "plugin" && argv[1] === "status")
  ) {
    output(
      await request(socket, {
        schema_version: 1,
        command_id: randomUUID(),
        type: "status",
        ...(id ? { project_id: id } : {}),
        payload: {},
      }),
    );
    return;
  }
  if (!file) fail("usage", "A JSON command --file is required for mutations");
  const text =
    file === "-"
      ? await new Promise<string>((resolve) => {
          let input = "";
          process.stdin.setEncoding("utf8");
          process.stdin.on("data", (s) => (input += s));
          process.stdin.on("end", () => resolve(input));
        })
      : await fs.readFile(file, "utf8");
  const value = command(JSON.parse(text));
  const expected = ["media", "preview"].includes(mode)
    ? `${mode}-${argv[1]}`
    : mode;
  if (value.type !== expected)
    fail("command_mismatch", "Subcommand and JSON type differ");
  output(await request(socket, value));
}
async function stdin() {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > 256 * 1024)
      fail("input_too_large", "Input exceeds 256 KiB");
  }
  return input;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((e) => {
    console.error(
      JSON.stringify({
        error: { code: e.code ?? "error", message: e.message },
      }),
    );
    process.exitCode = e instanceof Fault ? 2 : 1;
  });
