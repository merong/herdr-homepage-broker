import net from "node:net";
import { Command, Fault } from "../contracts/types.js";
import { Lines } from "../herdr/transport.js";
export function request(
  socket: string,
  command: Command,
  timeout = 120000,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const s = net.connect(socket);
    let done = false;
    const finish = (err?: Error, v?: any) => {
      if (done) return;
      done = true;
      s.destroy();
      err ? reject(err) : resolve(v);
    };
    const lines = new Lines((v) =>
      v.ok
        ? finish(undefined, v.result)
        : finish(
            new Fault(
              v.error?.code ?? "broker_error",
              v.error?.message ?? "Broker refused",
            ),
          ),
    );
    s.setTimeout(timeout);
    s.on("connect", () => s.write(JSON.stringify(command) + "\n"));
    s.on("data", (b) => {
      try {
        lines.push(b);
      } catch (e) {
        finish(e as Error);
      }
    });
    s.on("error", (e) => finish(e));
    s.on("timeout", () =>
      finish(
        new Fault(
          "timeout",
          command.type === "status"
            ? "Status request timed out"
            : "Command receipt unknown; reuse the same command_id",
        ),
      ),
    );
    s.on("end", () =>
      finish(
        new Fault(
          "disconnected",
          "Receipt unknown; inspect status and reuse command_id",
        ),
      ),
    );
  });
}
