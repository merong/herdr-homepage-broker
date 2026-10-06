import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Config, Fault } from "../contracts/types.js";
import { brokerSocket } from "../config.js";
// Only fixed broker subcommands are executable. Browser input never becomes
// a shell command or a Herdr prompt. Actual model dispatch stays in the broker.
export function projectCli(
  c: Config,
  action: "init" | "submit" | "readiness" | "execute",
  input: any,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const args = [
      fileURLToPath(new URL("../cli.js", import.meta.url)),
      ...(action === "execute" ? ["execute"] : ["project", action]),
      "--socket",
      brokerSocket(c),
      "--projects-root",
      c.projectsRoot!,
    ];
    if (["init", "execute"].includes(action)) args.push("--file", "-");
    else args.push("--project", input.project_id);
    const child = spawn(process.execPath, args, {
      env: {
        ...process.env,
        HOMEPAGE_CONFIG: "",
        HOMEPAGE_STATE_DIR: c.stateRoot,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "",
      settled = false;
    const finish = (e?: Error, value?: any) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      e ? reject(e) : resolve(value);
    };
    const timer = setTimeout(
      () => {
        child.kill("SIGTERM");
        finish(
          new Fault(
            "receipt_unknown",
            "CLI response timed out. Retry the same request; do not create a new ID.",
          ),
        );
      },
      action === "execute" ? 60000 : 15000,
    );
    child.on("error", (e) => finish(e));
    child.stdin.on("error", () => {});
    child.stdout.on("data", (b) => {
      stdout += b;
      if (stdout.length > 1024 * 1024) {
        child.kill();
        finish(new Fault("receipt_unknown", "CLI output exceeded limit"));
      }
    });
    child.stderr.on("data", (b) => {
      stderr = (stderr + b).slice(0, 65536);
    });
    child.on("close", (code) => {
      try {
        if (code !== 0) {
          let err;
          try {
            err = JSON.parse(stderr).error;
          } catch {}
          finish(
            new Fault(
              err?.code ?? "cli_failed",
              err?.message ?? "Broker CLI failed",
            ),
          );
        } else finish(undefined, JSON.parse(stdout));
      } catch {
        finish(
          new Fault(
            "receipt_unknown",
            "Invalid CLI receipt; retry the same request",
          ),
        );
      }
    });
    child.stdin.end(
      ["init", "execute"].includes(action) ? JSON.stringify(input) : undefined,
    );
  });
}
