import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  Checkpoint,
  Config,
  Project,
  Inputs,
  fail,
} from "../contracts/types.js";
import { checkpoint } from "../contracts/validate.js";
import { stateDir, brokerSocket } from "../config.js";
const exec = promisify(execFile);
export const hash = (v: string | Buffer) =>
  createHash("sha256").update(v).digest("hex");
export function canonical(v: any): string {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v && typeof v === "object")
    return (
      "{" +
      Object.keys(v)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonical(v[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(v);
}
export async function atomic(file: string, value: string | Buffer) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  try {
    if ((await fs.lstat(file)).isSymbolicLink())
      fail("unsafe_path", "Refuse symlink target");
  } catch (e: any) {
    if (e.code !== "ENOENT") throw e;
  }
  const tmp = file + "." + randomUUID() + ".tmp";
  const f = await fs.open(tmp, "wx", 0o600);
  try {
    await f.writeFile(value);
    await f.sync();
  } finally {
    await f.close();
  }
  try {
    await fs.rename(tmp, file);
    const d = await fs.open(path.dirname(file), "r");
    try {
      await d.sync();
    } finally {
      await d.close();
    }
  } finally {
    await fs.rm(tmp, { force: true });
  }
}
export async function realDirectory(dir: string) {
  const absolute = path.resolve(dir);
  await fs.mkdir(absolute, { recursive: true, mode: 0o700 });
  const real = await fs.realpath(absolute);
  if (real !== absolute)
    fail("unsafe_path", "Symlink/aliased directories are not supported");
  return real;
}
export async function processStart(pid: number) {
  try {
    return (
      await exec("ps", ["-p", String(pid), "-o", "lstart="])
    ).stdout.trim();
  } catch {
    try {
      process.kill(pid, 0);
    } catch (e: any) {
      if (e.code === "ESRCH") return "";
    }
    fail("process_identity_unknown", "Cannot establish process identity");
  }
}
export class Store {
  state: Checkpoint = {
    schema_version: 1,
    revision: 0,
    queue_seq: 0,
    projects: {},
    commands: {},
  };
  published = structuredClone(this.state);
  lockToken = randomUUID();
  locked = false;
  executionLocked = false;
  pending = false;
  failed = false;
  constructor(public config: Config) {}
  get dir() {
    return stateDir(this.config);
  }
  get executionLock() {
    return path.join(
      path.dirname(this.config.socketPath),
      "homepage-broker-execution.lock",
    );
  }
  async acquire() {
    await realDirectory(this.dir);
    try {
      await fs.mkdir(path.join(this.dir, "lock"), { mode: 0o700 });
    } catch {
      fail(
        "broker_locked",
        "Broker lock exists; use broker recover after checking the owner",
      );
    }
    this.locked = true;
    await atomic(
      path.join(this.dir, "lock/owner.json"),
      JSON.stringify({
        pid: process.pid,
        start: await processStart(process.pid),
        token: this.lockToken,
      }),
    );
    if (this.config.allowExecution) {
      try {
        await fs.mkdir(this.executionLock, { mode: 0o700 });
        this.executionLocked = true;
        await atomic(
          path.join(this.executionLock, "owner.json"),
          JSON.stringify({
            pid: process.pid,
            start: await processStart(process.pid),
            token: this.lockToken,
            state_dir: this.dir,
          }),
        );
      } catch (e) {
        await this.release();
        fail(
          "execution_broker_locked",
          "Another execution broker or stale lock owns the homepage session; reconcile before starting",
        );
      }
    }
  }
  async load() {
    try {
      this.state = checkpoint(
        JSON.parse(
          await fs.readFile(
            path.join(this.dir, "broker-checkpoint.json"),
            "utf8",
          ),
        ),
      );
      this.published = structuredClone(this.state);
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  async commit(next: Checkpoint) {
    if (this.failed)
      fail(
        "storage_unknown",
        "Writer stopped after a storage failure; restart and reconcile",
      );
    next.revision = this.state.revision + 1;
    checkpoint(next);
    const serialized = JSON.stringify(next, null, 2);
    try {
      await atomic(path.join(this.dir, "broker-checkpoint.json"), serialized);
    } catch {
      this.failed = true;
      fail(
        "storage_unknown",
        "Checkpoint outcome unknown; writer stopped, restart and reconcile",
      );
    }
    this.state = next;
    this.published = JSON.parse(serialized);
    await this.projectAll();
  }
  async projectAll() {
    this.pending = false;
    for (const p of Object.values(this.state.projects))
      try {
        await this.project(p);
      } catch {
        this.pending = true;
      }
  }
  async project(p: Project) {
    const r = p.runs.find((r) => r.run_id === p.current_run_id)!;
    const common = {
      schema_version: 1,
      revision: p.revision,
      project_id: p.project_id,
      run_id: r.run_id,
    };
    const projections: any = {
      "meta.json": {
        ...common,
        status: r.status,
        input_required: r.questions.some((q) => q.status !== "answered"),
        input_requests: r.questions,
        reason: r.reason ?? null,
        herdr: r.herdr,
        artifacts: {
          source: path.join(p.directory, "app"),
          preview: r.preview,
          media: r.media,
        },
        inputs: r.inputs,
        resume_required: r.resume_required,
        execution_requested: !!r.execution_requested,
        orchestration: r.orchestration ?? null,
        slot_reserved: r.slot,
        operations: r.operations.map(({ request, ...op }) => op),
      },
      "task.json": { ...common, tasks: r.tasks },
      "agents.json": {
        ...common,
        orchestration_mode: r.orchestration?.mode ?? "legacy",
        agents: r.agents.map(({ token, seq, ...a }) => ({
          ...a,
          project_id: p.project_id,
          run_id: r.run_id,
        })),
      },
    };
    for (const [name, data] of Object.entries(projections))
      await atomic(path.join(p.directory, name), JSON.stringify(data, null, 2));
    await atomic(
      path.join(p.directory, ".herdr/runs", r.run_id, "run.json"),
      JSON.stringify(
        { ...r, agents: r.agents.map(({ token, ...a }) => a) },
        null,
        2,
      ),
    );
  }
  async release() {
    if (this.executionLocked) {
      const owner = JSON.parse(
        await fs.readFile(path.join(this.executionLock, "owner.json"), "utf8"),
      );
      if (owner.token === this.lockToken)
        await fs.rm(this.executionLock, { recursive: true });
      this.executionLocked = false;
    }
    if (!this.locked) return;
    const owner = JSON.parse(
      await fs.readFile(path.join(this.dir, "lock/owner.json"), "utf8"),
    );
    if (owner.token === this.lockToken)
      await fs.rm(path.join(this.dir, "lock"), { recursive: true });
    this.locked = false;
  }
}
export async function recoverLock(c: Config) {
  const dir = stateDir(c);
  const owner = JSON.parse(
    await fs.readFile(path.join(dir, "lock/owner.json"), "utf8"),
  );
  if (await processStart(owner.pid))
    fail(
      "owner_alive",
      "PID exists; refusing lock recovery even if the PID was reused",
    );
  const connected = await new Promise<boolean>((resolve) => {
    const s = net.connect(brokerSocket(c));
    s.setTimeout(500);
    s.once("connect", () => {
      s.destroy();
      resolve(true);
    });
    s.once("error", () => resolve(false));
    s.once("timeout", () => {
      s.destroy();
      resolve(true);
    });
  });
  if (connected) fail("owner_alive", "Socket is serving or indeterminate");
  const executionLock = path.join(
    path.dirname(c.socketPath),
    "homepage-broker-execution.lock",
  );
  try {
    const globalOwner = JSON.parse(
      await fs.readFile(path.join(executionLock, "owner.json"), "utf8"),
    );
    if (globalOwner.state_dir === dir) {
      if (await processStart(globalOwner.pid))
        fail("owner_alive", "Execution owner exists");
      await fs.rename(
        executionLock,
        executionLock + ".recovered-" + randomUUID(),
      );
    }
  } catch (e: any) {
    if (e.code !== "ENOENT") throw e;
  }
  await fs.rename(
    path.join(dir, "lock"),
    path.join(dir, "recovered-lock-" + randomUUID()),
  );
  await fs.rm(brokerSocket(c), { force: true });
}
export async function readInputs(
  inputs: Inputs,
): Promise<Record<string, Buffer>> {
  const buffers: Record<string, Buffer> = {};
  for (const key of ["prd", "design"] as const) {
    const item = inputs?.[key];
    if (
      !item ||
      typeof item.path !== "string" ||
      !path.isAbsolute(item.path) ||
      !/^[a-f0-9]{64}$/.test(item.sha256)
    )
      fail(
        "invalid_inputs",
        "Absolute document paths and SHA-256 are required",
      );
    const real = await fs.realpath(item.path);
    if (real !== path.resolve(item.path))
      fail("unsafe_path", "Document symlink/alias refused");
    const b = await fs.readFile(real);
    if (b.length === 0 || b.length > 2 * 1024 * 1024)
      fail("invalid_inputs", "Document must contain 1..2 MiB");
    if (hash(b) !== item.sha256) fail("input_hash_mismatch", key);
    buffers[key] = b;
  }
  return buffers;
}
export async function snapshotInputs(
  directory: string,
  runId: string,
  inputs: Inputs,
  prepared?: Record<string, Buffer>,
): Promise<Inputs> {
  const buffers = prepared ?? (await readInputs(inputs));
  const result: any = {};
  for (const key of ["prd", "design"] as const) {
    result[key] = {
      path: path.join(directory, ".herdr/runs", runId, "inputs", key + ".md"),
      sha256: hash(buffers[key]),
    };
    await atomic(result[key].path, buffers[key]);
  }
  return result;
}
