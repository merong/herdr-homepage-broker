import net from "node:net";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { Preview, Project, Run, fail, now } from "../contracts/types.js";
import { processStart } from "../storage/store.js";
const exec = promisify(execFile);
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
export async function freePort() {
  return new Promise<number>((resolve, reject) => {
    const s = net.createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
}
export async function ownsPort(pid: number, port: number) {
  try {
    const { stdout } = await exec("lsof", [
      "-nP",
      `-iTCP:${port}`,
      "-sTCP:LISTEN",
      "-t",
    ]);
    const pids = [...new Set(stdout.trim().split(/\s+/))];
    if (!pids.length) return false;
    for (const p of pids) {
      const pgid = (await exec("ps", ["-p", p, "-o", "pgid="])).stdout.trim();
      if (pgid !== String(pid)) return false;
    }
    return true;
  } catch {
    return false;
  }
}
async function groupMembers(pgid: number) {
  const { stdout } = await exec("ps", ["-axo", "pid=,pgid="]);
  return stdout
    .trim()
    .split("\n")
    .map((s) => s.trim().split(/\s+/))
    .filter((parts) => parts[1] === String(pgid))
    .map((parts) => Number(parts[0]));
}
export async function verifyPreview(preview: Preview) {
  if (!preview.pid || !preview.port || !preview.url) return false;
  const identity = await processStart(preview.pid);
  if (identity !== preview.process_start || !identity) return false;
  if (!(await ownsPort(preview.pid, preview.port))) return false;
  try {
    const r = await fetch(preview.url, {
      redirect: "manual",
      signal: AbortSignal.timeout(1000),
    });
    await r.body?.cancel();
    return r.status >= 200 && r.status < 400;
  } catch {
    return false;
  }
}
export async function stopPreview(preview: Preview) {
  if (preview.status === "stopped") return;
  if (!preview.pid) {
    preview.status = "stopped";
    return;
  }
  const start = await processStart(preview.pid);
  if (!start) {
    if ((await groupMembers(preview.pid)).length)
      fail(
        "preview_owner_unknown",
        "Leader exited but descendants remain; reconcile manually",
      );
    preview.status = "stopped";
    return;
  }
  if (start !== preview.process_start)
    fail("preview_owner_unknown", "PID was reused; refusing to signal");
  process.kill(-preview.pid, "SIGTERM");
  for (let i = 0; i < 30; i++) {
    if (!(await groupMembers(preview.pid)).length) {
      preview.status = "stopped";
      return;
    }
    await delay(100);
  }
  fail("preview_stop_pending", "Preview process still running");
}
export async function startPreview(
  p: Project,
  r: Run,
  argv: unknown,
  onSpawn: () => Promise<void>,
) {
  if (
    !Array.isArray(argv) ||
    !argv.length ||
    argv.some((x) => typeof x !== "string") ||
    !argv.some((x) => x.includes("{port}"))
  )
    fail(
      "invalid_preview",
      "argv must contain strings and an explicit {port} placeholder",
    );
  if (
    !["node", "npm", "npx", "pnpm", "bun", "python3"].includes(
      path.basename(argv[0]),
    )
  )
    fail("invalid_preview", "Unsupported preview executable");
  if (!(await fs.readdir(path.join(p.directory, "app"))).length)
    fail("source_missing", "app/ is empty");
  const port = await freePort();
  const actual = argv.map((x) => x.replaceAll("{port}", String(port)));
  const log = await fs.open(
    path.join(p.directory, ".herdr/runs", r.run_id, "preview.log"),
    "a",
    0o600,
  );
  const child = spawn(actual[0], actual.slice(1), {
    cwd: path.join(p.directory, "app"),
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1" },
    detached: true,
    stdio: ["ignore", log.fd, log.fd],
  });
  let error: Error | undefined;
  child.on("error", (e) => {
    error = e;
  });
  child.unref();
  await log.close();
  await delay(50);
  if (error || !child.pid)
    fail("preview_start_failed", error?.message ?? "No PID");
  r.preview = {
    status: "starting",
    run_id: r.run_id,
    url: `http://127.0.0.1:${port}`,
    pid: child.pid,
    process_start: await processStart(child.pid),
    port,
    argv: actual,
    started_at: now(),
  };
  await onSpawn();
  for (let i = 0; i < 80; i++) {
    if (!(await processStart(child.pid))) break;
    try {
      if (await ownsPort(child.pid, port)) {
        const res = await fetch(r.preview.url!, {
          redirect: "manual",
          signal: AbortSignal.timeout(1000),
        });
        await res.body?.cancel();
        if (res.status >= 200 && res.status < 400) {
          r.preview.status = "ready";
          return r.preview;
        }
      }
    } catch {}
    await delay(100);
  }
  r.preview.status = "failed";
  r.preview.error = "No owned localhost HTTP response";
  try {
    await stopPreview(r.preview);
    r.preview.status = "failed";
  } catch {}
  fail("preview_unverified", "No owned localhost HTTP response");
}
