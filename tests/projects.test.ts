import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { fixture, FakeHerdr } from "./helpers.js";
import {
  initializeProject,
  initializedRequest,
  projectFiles,
  sample,
} from "../src/projects/manage.js";
import { Broker } from "../src/broker/broker.js";
import { config, discoverHomepageSkills } from "../src/config.js";
const exec = promisify(execFile);
const draft = (id = "sample-company") => ({
  project_id: id,
  request_id: randomUUID(),
  ...sample,
});

test("P01 project initialization is non-destructive, repeatable and preserves request ID", async () => {
  const f = await fixture();
  try {
    const d = draft(),
      first = await initializeProject(f.config, d),
      second = await initializeProject(f.config, d);
    assert.deepEqual(first, second);
    const runtime = JSON.parse(await fs.readFile(first.runtime.file, "utf8"));
    assert.equal(runtime.session, "homepage");
    assert.equal(runtime.model, "claude-opus-5-5");
    assert.deepEqual(runtime.roles, ["pm", "developer", "designer"]);
    assert.equal(runtime.higgsfield.transport, "claude-installed");
    assert.equal(
      first.directory,
      path.join(f.config.projectsRoot!, d.project_id),
    );
    const req = await initializedRequest(f.config, d.project_id);
    assert.equal(req.command_id, `init-${d.request_id}`);
    assert.equal(
      await fs.readFile(req.payload.inputs.prd.path, "utf8"),
      sample.prd,
    );
    await assert.rejects(
      () => initializeProject(f.config, { ...d, prd: "changed" }),
      /different request/,
    );
    await fs.writeFile(req.payload.inputs.prd.path, "external edit");
    await assert.rejects(
      () => initializeProject(f.config, d),
      /will not be overwritten/,
    );
    assert.equal(
      await fs.readFile(req.payload.inputs.prd.path, "utf8"),
      "external edit",
    );
  } finally {
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

test("P02 path traversal, symlinks and existing unrelated folders are refused", async () => {
  const f = await fixture();
  try {
    for (const id of ["../escape", "/absolute", "--file", "constructor"])
      await assert.rejects(
        () => initializeProject(f.config, draft(id)),
        /Project ID/,
      );
    await fs.mkdir(path.join(f.config.projectsRoot!, "existing"), {
      recursive: true,
    });
    await assert.rejects(
      () => initializeProject(f.config, draft("existing")),
      /not owned/,
    );
    await fs.symlink(f.root, path.join(f.config.projectsRoot!, "alias"));
    await assert.rejects(
      () => initializeProject(f.config, draft("alias")),
      /Symlink/,
    );
    await assert.rejects(
      () =>
        initializeProject(f.config, { ...draft(), directory: "/tmp/wrong" }),
      /Expected/,
    );
  } finally {
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

async function setup() {
  const f = await fixture();
  f.config.web = { enabled: true, port: 0 };
  const h = new FakeHerdr(f.config),
    b = new Broker(f.config, h);
  await b.start(false);
  clearInterval(b.timer);
  return {
    ...f,
    b,
    h,
    url: b.dashboard!.url!,
    close: async () => {
      await b.close();
      await fs.rm(f.root, { recursive: true, force: true });
    },
  };
}
async function send(
  url: string,
  csrf: string,
  route: string,
  input: any,
  extra: Record<string, string> = {},
) {
  return fetch(url + route, {
    method: "POST",
    headers: {
      Origin: url,
      "Content-Type": "application/json",
      "X-Homepage-Token": csrf,
      ...extra,
    },
    body: JSON.stringify(input),
  });
}

test("P03 web buttons execute real broker CLI initialization/submission, deduplicate, and read JSON projections", async () => {
  const f = await setup();
  try {
    const boot = await (await fetch(f.url + "/api/bootstrap")).json();
    assert.equal(boot.can_submit, true);
    const d = draft();
    const init = await send(f.url, boot.csrf, "/api/projects/init", d);
    assert.equal(init.status, 200);
    assert.equal((await init.json()).transport, "broker-cli");
    const a = await (
      await send(f.url, boot.csrf, "/api/projects/submit", {
        project_id: d.project_id,
      })
    ).json();
    const b = await (
      await send(f.url, boot.csrf, "/api/projects/submit", {
        project_id: d.project_id,
      })
    ).json();
    assert.equal(a.status, "queued");
    assert.equal(a.run_id, b.run_id);
    assert.equal(Object.keys(f.b.store.state.projects).length, 1);
    assert.equal(f.h.calls.length, 0);
    const state = await (
      await fetch(f.url + `/api/projects/${d.project_id}/state`)
    ).json();
    assert.equal(state.consistent, true);
    assert.equal(state.files["meta.json"].status, "queued");
    assert.equal(state.files["agents.json"].agents.length, 3);
    assert.equal(JSON.stringify(state).includes('"token"'), false);
    assert.equal(
      new Set(Object.values<any>(state.files).map((x) => x.revision)).size,
      1,
    );
  } finally {
    await f.close();
  }
});

test("P04 mutation endpoints require same-origin token and reject arbitrary commands", async () => {
  const f = await setup();
  try {
    const boot = await (await fetch(f.url + "/api/bootstrap")).json();
    assert.equal(
      (await send(f.url, "wrong", "/api/projects/init", draft())).status,
      403,
    );
    assert.equal(
      (
        await send(f.url, boot.csrf, "/api/projects/init", draft(), {
          Origin: "https://evil.example",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await send(f.url, boot.csrf, "/api/projects/submit", {
          project_id: "safe",
          argv: ["touch", "/tmp/no"],
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await send(f.url, boot.csrf, "/api/projects/submit", {
          project_id: "../bad",
        })
      ).status,
      409,
    );
    assert.equal(
      (await send(f.url, boot.csrf, "/api/command", { type: "cancel" })).status,
      405,
    );
    assert.deepEqual(f.b.store.state.projects, {});
  } finally {
    await f.close();
  }
});

test("P05 JSON state rejects mixed revisions and symlinked projection files", async () => {
  const f = await setup();
  try {
    await f.b.handle(f.submit());
    const p = f.b.status().projects[0],
      file = path.join(p.directory, "task.json");
    const original = await fs.readFile(file, "utf8"),
      json = JSON.parse(original);
    json.revision++;
    await fs.writeFile(file, JSON.stringify(json));
    await assert.rejects(() => projectFiles(p), /revisions differ/);
    assert.equal((await fetch(f.url + "/api/projects/A/state")).status, 409);
    await fs.rm(file);
    await fs.symlink(path.join(f.root, "prd.md"), file);
    await assert.rejects(() => projectFiles(p), /regular file/);
    assert.equal(
      (await fetch(f.url + "/api/projects/not-registered/state")).status,
      404,
    );
  } finally {
    await f.close();
  }
});

test("P06 fragmented Korean request bodies retain exact UTF-8 document bytes", async () => {
  const f = await setup();
  try {
    const boot = await (await fetch(f.url + "/api/bootstrap")).json(),
      d = draft();
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        f.url + "/api/projects/init",
        {
          method: "POST",
          headers: {
            Origin: f.url,
            "Content-Type": "application/json",
            "X-Homepage-Token": boot.csrf,
          },
        },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode!));
        },
      );
      req.on("error", reject);
      for (const byte of Buffer.from(JSON.stringify(d)))
        req.write(Buffer.from([byte]));
      req.end();
    });
    assert.equal(status, 200);
    assert.equal(
      await fs.readFile(
        path.join(f.config.projectsRoot!, d.project_id, "prd.md"),
        "utf8",
      ),
      d.prd,
    );
  } finally {
    await f.close();
  }
});

test("P07 broker stop confirms owner and shuts down only the idle configured process", async () => {
  const f = await fixture(),
    cfg = path.join(f.root, "config.json");
  await fs.writeFile(cfg, JSON.stringify(f.config));
  const child = spawn(
    process.execPath,
    ["dist/src/cli.js", "broker", "start", "--config", cfg],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stderr.resume();
  const exited = new Promise((resolve) => child.once("exit", resolve));
  try {
    await new Promise<void>((resolve, reject) => {
      let out = "";
      const timer = setTimeout(
        () => reject(new Error("startup timed out")),
        6000,
      );
      child.stdout.on("data", (b) => {
        out += b;
        if (out.includes('"ready": true')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    const result = await exec(process.execPath, [
      "dist/src/cli.js",
      "broker",
      "stop",
      "--config",
      cfg,
    ]);
    assert.equal(JSON.parse(result.stdout).stopped, true);
    await exited;
    await assert.rejects(
      () => fs.stat(path.join(f.root, "sessions/homepage/lock")),
      { code: "ENOENT" },
    );
  } finally {
    if (child.exitCode === null) child.kill("SIGTERM");
    await exited;
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

test("P08 defaults need no execution switch and discover only the installed homepage skill", async () => {
  const f = await fixture();
  try {
    const claudeRoot = path.join(f.root, "claude");
    for (const name of ["higgsfield-websites", "unrelated-skill"]) {
      await fs.mkdir(path.join(claudeRoot, "skills", name), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(claudeRoot, "skills", name, "SKILL.md"),
        "# skill",
      );
    }
    const found = await discoverHomepageSkills(claudeRoot);
    assert.deepEqual(found, [
      path.join(claudeRoot, "skills/higgsfield-websites/SKILL.md"),
    ]);
    assert.deepEqual(
      await discoverHomepageSkills(path.join(f.root, "missing")),
      [],
    );
    const file = path.join(f.root, "minimal-config.json");
    await fs.writeFile(file, JSON.stringify({ skills: found }));
    const c = await config(file);
    assert.equal(c.allowExecution, true);
    assert.equal(c.autoStart, false);
    assert.equal(c.mcp, undefined);
    assert.deepEqual(c.skills, found);
    await fs.writeFile(
      file,
      JSON.stringify({ skills: found, allowExecution: false, autoStart: true }),
    );
    const custom = await config(file);
    assert.equal(
      custom.allowExecution,
      false,
      "explicit operator pause is preserved",
    );
    assert.equal(custom.autoStart, true);
  } finally {
    await fs.rm(f.root, { recursive: true, force: true });
  }
});
