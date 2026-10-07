import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { Broker } from "../src/broker/broker.js";
import { current } from "../src/domain/engine.js";
import { claudeArgs } from "../src/agents/prompts.js";
import { nativePrompt } from "../src/agents/native.js";
import {
  lookScript,
  studio,
  studioDoctor,
  studioPlugin,
  studioTools,
  treeHash,
} from "../src/agents/studio.js";
import { config, injectedSkills } from "../src/config.js";
import { hash } from "../src/storage/store.js";
import { Run } from "../src/contracts/types.js";
import { fixture, FakeHerdr, cmd, legacyTeam } from "./helpers.js";

const repoPlugin = studio.dir;
async function launch(
  configure?: (f: Awaited<ReturnType<typeof fixture>>) => Promise<void>,
  mutate?: (r: Run) => void,
) {
  const f = await fixture();
  f.config.allowExecution = true;
  await configure?.(f);
  const h = new FakeHerdr(f.config),
    b = new Broker(f.config, h);
  await b.start(false);
  clearInterval(b.timer);
  await b.handle(f.submit());
  if (mutate) {
    mutate(current(b.store.state.projects.A));
    await b.save();
  }
  for (let i = 0; i < 3; i++) await b.tick();
  const p = b.store.state.projects.A;
  const dir = path.join(p.directory, ".herdr/runs", p.current_run_id);
  return {
    f,
    h,
    b,
    p,
    dir,
    read: (name: string) => fs.readFile(path.join(dir, name), "utf8"),
    starts: () => h.calls.filter((c) => c[0] === "agent" && c[1] === "start"),
    close: async () => {
      await b.close();
      await fs.rm(f.root, { recursive: true, force: true });
    },
  };
}
async function withClaudeRoot<T>(root: string, fn: () => Promise<T>) {
  const before = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = root;
  try {
    return await fn();
  } finally {
    if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = before;
  }
}

test("S01 homepage-studio plugin ships the lean skill, vendored frontend-design and look.py without helpers", async () => {
  const manifest = JSON.parse(
    await fs.readFile(
      path.join(repoPlugin, ".claude-plugin/plugin.json"),
      "utf8",
    ),
  );
  assert.equal(manifest.name, "homepage-studio");
  assert.equal(typeof manifest.version, "string");
  assert.equal((await studioPlugin()).version, manifest.version);
  assert.deepEqual((await fs.readdir(path.join(repoPlugin, "skills"))).sort(), [
    "frontend-design",
    "homepage-studio",
  ]);
  for (const gone of [
    "agents",
    "skills/asset-kit",
    "skills/korean-copywriting",
    "skills/korean-typography",
    "skills/quality-gate",
    "skills/seo-basics",
  ])
    await assert.rejects(fs.stat(path.join(repoPlugin, gone)), /ENOENT/);
  const notices = await fs.readFile(
    path.join(repoPlugin, "THIRD_PARTY_NOTICES.md"),
    "utf8",
  );
  for (const file of ["SKILL.md", "LICENSE.txt"])
    assert.ok(
      notices.includes(
        hash(
          await fs.readFile(
            path.join(repoPlugin, "skills/frontend-design", file),
          ),
        ),
      ),
      `frontend-design ${file} stays byte for byte`,
    );
  const look = await fs.readFile(path.join(repoPlugin, lookScript), "utf8");
  assert.match(look, /^#!\/usr\/bin\/env python3\n/);
  assert.match(
    look,
    /Usage: python3 look\.py <url> <outdir> \[--reduced-motion\]/,
  );
  for (const output of [
    "desktop.png",
    "desktop-full.png",
    "mobile.png",
    "mobile-full.png",
    "issues.json",
  ])
    assert.ok(look.includes(output), output);
  assert.match(look, /reduced_motion="reduce"/);
});

test("S02 native PM launch adds --plugin-dir; pm-led launches stay unchanged", async () => {
  assert.deepEqual(claudeArgs(undefined, true, "/plugin").slice(-3), [
    "--setting-sources=",
    "--plugin-dir",
    "/plugin",
  ]);
  assert.equal(claudeArgs("/system.md", true).includes("--plugin-dir"), false);
  const native = await launch();
  try {
    const [start] = native.starts();
    const argv = start.slice(start.indexOf("--") + 1);
    assert.equal(argv[argv.indexOf("--plugin-dir") + 1], studio.dir);
    assert.equal(argv.includes("--append-system-prompt-file"), false);
    const runtime = JSON.parse(
      await fs.readFile(
        path.join(native.p.directory, "homepage-runtime.json"),
        "utf8",
      ),
    );
    assert.equal(runtime.orchestration.plugin.path, studio.dir);
    assert.equal(runtime.orchestration.builder, "pm");
    assert.equal(runtime.orchestration.native_agents, undefined);
    assert.equal(runtime.orchestration.helper_limit, undefined);
  } finally {
    await native.close();
  }
  const led = await launch(undefined, legacyTeam);
  try {
    const starts = led.starts();
    assert.equal(starts.length, 1, "pm-led starts only its PM first");
    assert.equal(starts[0].includes("--plugin-dir"), false);
    assert.ok(starts[0].includes("--append-system-prompt-file"));
    assert.match(await led.read("pm-system.md"), /MAIN ORCHESTRATOR/);
  } finally {
    await led.close();
  }
});

test("S03 missing plugin blocks readiness and fails before any Herdr dispatch", async () => {
  const f = await fixture();
  studio.dir = path.join(f.root, "missing-plugin");
  try {
    f.config.allowExecution = true;
    f.config.autoStart = false;
    const h = new FakeHerdr(f.config),
      b = new Broker(f.config, h);
    await b.start(false);
    clearInterval(b.timer);
    try {
      await b.handle(f.submit());
      let p = b.store.state.projects.A;
      const ready = await b.handle(cmd("execution-status", p));
      assert.equal(ready.ready, false);
      assert.match(ready.checks[1].detail, /homepage-studio 플러그인 파일이/);
      f.config.autoStart = true;
      for (let i = 0; i < 3; i++) await b.tick();
      let r = current(b.store.state.projects.A);
      assert.equal(r.status, "paused");
      assert.equal(r.reason, "studio_plugin_missing");
      assert.equal(r.slot, false);
      assert.equal(h.calls.length, 0, "no workspace or agent is dispatched");
      await fs.cp(repoPlugin, studio.dir, { recursive: true });
      await fs.rm(path.join(studio.dir, "skills/homepage-studio/SKILL.md"));
      await assert.rejects(
        studioPlugin(),
        /skills\/homepage-studio\/SKILL\.md/,
      );
      await fs.cp(
        path.join(repoPlugin, "skills/homepage-studio/SKILL.md"),
        path.join(studio.dir, "skills/homepage-studio/SKILL.md"),
      );
      for (const file of ["skills/frontend-design/SKILL.md", lookScript]) {
        await fs.rm(path.join(studio.dir, file));
        await assert.rejects(studioPlugin(), (e: any) => {
          assert.equal(e.code, "studio_plugin_missing");
          assert.ok(e.message.includes(file));
          return true;
        });
        await fs.cp(path.join(repoPlugin, file), path.join(studio.dir, file));
      }
      await fs.writeFile(
        path.join(studio.dir, ".claude-plugin/plugin.json"),
        '{"name":"other"}',
      );
      await assert.rejects(studioPlugin(), (e: any) => {
        assert.equal(e.code, "studio_plugin_missing");
        assert.match(e.message, /name 또는 version/);
        return true;
      });
      await fs.cp(
        path.join(repoPlugin, ".claude-plugin/plugin.json"),
        path.join(studio.dir, ".claude-plugin/plugin.json"),
      );
      p = b.store.state.projects.A;
      await b.handle(cmd("resume", p));
      for (let i = 0; i < 3; i++) await b.tick();
      r = current(b.store.state.projects.A);
      const start = h.calls.find((c) => c[0] === "agent" && c[1] === "start")!;
      assert.equal(start[start.indexOf("--plugin-dir") + 1], studio.dir);
      assert.equal(r.status, "running");
    } finally {
      await b.close();
    }
  } finally {
    studio.dir = repoPlugin;
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

test("S04 PM instructions: one builder, three tasks, the look loop and the media rule", async () => {
  const root = await fs.mkdtemp("/private/tmp/hp-claude-");
  const refs = path.join(root, "skills/higgsfield-websites/references");
  await fs.mkdir(refs, { recursive: true });
  const run = await withClaudeRoot(root, () => launch());
  try {
    const pm = await run.read("pm-instructions.md");
    const guide = await run.read("homepage-orchestration.md");
    assert.ok(pm.includes(guide), "PM instructions embed the shared guide");
    for (const gone of [
      /homepage-studio:homepage-(developer|designer|copywriter)/,
      /quality-gate|check_page|auto-check|self-check/,
      /stage order/,
      /helper/i,
      /hero video/,
      /Selected homepage skill excerpts/,
    ])
      assert.doesNotMatch(pm, gone);
    assert.match(pm, /Load skill homepage-studio:homepage-studio first/);
    assert.match(guide, /homepage-studio:frontend-design for visual craft/);
    assert.match(
      guide,
      /design, write the copy, generate images and build the site yourself in this one session/,
    );
    assert.match(guide, /Do not hand design, copy or build work to subagents/);
    assert.match(
      guide,
      /only to run independent image generations in parallel: you write every prompt and review every result/,
    );
    assert.match(
      guide,
      /Wait for every subagent to finish before a completed, failed or question report/,
    );
    const look = path.join(studio.dir, lookScript);
    assert.ok(
      guide.includes(
        `python3 ${look} <preview URL> ${run.dir}/reports/look/<round>`,
      ),
    );
    assert.match(guide, /first-screen: at most 2 rounds/);
    assert.match(guide, /build-out: at most 3 rounds/);
    assert.ok(
      guide.includes(
        `one final run into ${run.dir}/reports/look/final as delivery evidence`,
      ),
    );
    assert.match(guide, /No separate QA agent/);
    assert.match(guide, /Playwright is missing, do not install it/);
    assert.match(
      guide,
      /Start the preview in the first-screen task as soon as the first screen renders/,
    );
    assert.ok(guide.includes(`resolve under ${studio.dir}/skills/<skill>/`));
    assert.match(
      guide,
      /Explicit image or video counts in the PRD or design win/,
    );
    assert.match(
      guide,
      /placement and job on the page are decided, at most 12/,
    );
    assert.match(guide, /no video unless the PRD or design asks for one/);
    assert.ok(
      guide.includes(
        `${run.dir}/assets/media-receipts.json (file, purpose, placement, model, job_id, status, sha256)`,
      ),
    );
    assert.match(guide, /resubmit a job whose outcome is unknown/);
    assert.match(guide, /installed\/authenticated Higgsfield MCP directly/);
    assert.doesNotMatch(guide, /media-request/);
    assert.ok(guide.includes(`- higgsfield-websites: ${refs}`));
    assert.match(guide, /- higgsfield-brandkit: not installed/);
    assert.match(pm, /Do not send team-create/);
    assert.match(pm, /strictly increasing sequence/);
    assert.match(pm, /Kinds: plan \(initial plan task only\)/);
    assert.match(pm, /\(direction, first-screen, build-out\)/);
    assert.match(
      pm,
      /any task may write under app\/, assets\/ or reports\/; roles are display labels/,
    );
    assert.match(pm, /one at a time; do only the current assignment/);
    assert.match(
      pm,
      /direction set, image job accepted\/completed with the actual job ID, first screen visible, each look round result, preview ready/,
    );
    assert.match(pm, /PM alone starts preview: preview-start with argv/);
    assert.match(pm, /Broker decides overall review_pending/);
    const r = current(run.p);
    const broker = await nativePrompt(
      { ...run.f.config, mcp: {} as any },
      run.p,
      r,
      "",
      await studioPlugin(),
    );
    assert.match(broker, /only PM calls media-request/);
    assert.match(broker, /After acceptance do not poll/);
    assert.doesNotMatch(broker, /installed\/authenticated Higgsfield MCP/);
  } finally {
    await run.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("S05 native runs inject only explicit skills; discovered skills stay legacy-only", async () => {
  const root = await fs.mkdtemp("/private/tmp/hp-claude-");
  const discovered = path.join(root, "skills/higgsfield-websites/SKILL.md");
  await fs.mkdir(path.dirname(discovered), { recursive: true });
  await fs.writeFile(discovered, "DISCOVERED-HOSTING-SKILL");
  try {
    await withClaudeRoot(root, async () => {
      const file = path.join(root, "config.json");
      await fs.writeFile(file, "{}");
      const auto = await config(file);
      assert.deepEqual(auto.skills, []);
      assert.deepEqual(auto.discoveredSkills, [discovered]);
      assert.deepEqual(injectedSkills(auto, "claude-native"), []);
      assert.deepEqual(injectedSkills(auto, "pm-led"), [discovered]);
      assert.deepEqual(injectedSkills(auto, "legacy"), [discovered]);
      await fs.writeFile(
        file,
        JSON.stringify({ skills: ["/x/SKILL.md"], discoveredSkills: ["/y"] }),
      );
      const explicit = await config(file);
      assert.deepEqual(explicit.discoveredSkills, []);
      assert.deepEqual(injectedSkills(explicit, "claude-native"), [
        "/x/SKILL.md",
      ]);
      assert.deepEqual(injectedSkills(explicit, "pm-led"), ["/x/SKILL.md"]);
    });
    const discover = async (f: any) => {
      f.config.discoveredSkills = [discovered];
    };
    const native = await launch(discover);
    try {
      assert.doesNotMatch(
        await native.read("homepage-orchestration.md"),
        /DISCOVERED-HOSTING-SKILL|Configured skill files/,
      );
      assert.deepEqual(
        JSON.parse(await native.read("skills-lock.json")).skills,
        [],
      );
    } finally {
      await native.close();
    }
    const led = await launch(discover, legacyTeam);
    try {
      assert.match(await led.read("pm-system.md"), /DISCOVERED-HOSTING-SKILL/);
      assert.deepEqual(JSON.parse(await led.read("skills-lock.json")), [
        { path: discovered, sha256: hash("DISCOVERED-HOSTING-SKILL") },
      ]);
    } finally {
      await led.close();
    }
    const configured = await launch(async (f) => {
      const skill = path.join(f.root, "operator-SKILL.md");
      await fs.writeFile(skill, "OPERATOR-SKILL-BODY");
      f.config.skills = [skill];
      f.config.discoveredSkills = [discovered];
    });
    try {
      const guide = await configured.read("homepage-orchestration.md");
      assert.match(guide, /## Configured skill files/);
      assert.match(guide, /OPERATOR-SKILL-BODY/);
      assert.doesNotMatch(guide, /DISCOVERED-HOSTING-SKILL/);
      const lock = JSON.parse(await configured.read("skills-lock.json"));
      assert.deepEqual(
        lock.skills.map((s: any) => s.sha256),
        [hash("OPERATOR-SKILL-BODY")],
      );
    } finally {
      await configured.close();
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("S06 skills-lock pins plugin version and a deterministic tree hash", async () => {
  const root = await fs.mkdtemp("/private/tmp/hp-tree-");
  try {
    const a = path.join(root, "a"),
      b = path.join(root, "b");
    await fs.mkdir(path.join(a, "x/y"), { recursive: true });
    await fs.writeFile(path.join(a, "x/y/z.md"), "z");
    await fs.writeFile(path.join(a, "top.md"), "top");
    await fs.writeFile(path.join(a, ".DS_Store"), "junk");
    await fs.mkdir(path.join(b, "x/y"), { recursive: true });
    await fs.writeFile(path.join(b, "top.md"), "top");
    await fs.writeFile(path.join(b, "x/y/z.md"), "z");
    const expected = hash(`${hash("top")}  top.md\n${hash("z")}  x/y/z.md\n`);
    assert.deepEqual(await treeHash(a), { files: 2, sha256: expected });
    assert.deepEqual(await treeHash(b), { files: 2, sha256: expected });
    await fs.writeFile(path.join(b, "x/y/z.md"), "z2");
    assert.notEqual((await treeHash(b)).sha256, expected);
    await fs.symlink("/etc/hosts", path.join(b, "link"));
    await assert.rejects(treeHash(b), (e: any) => e.code === "unsafe_path");

    const copy = path.join(root, "plugin");
    await fs.cp(repoPlugin, copy, { recursive: true });
    studio.dir = copy;
    const run = await launch();
    try {
      const lock = JSON.parse(await run.read("skills-lock.json"));
      const manifest = JSON.parse(
        await fs.readFile(
          path.join(copy, ".claude-plugin/plugin.json"),
          "utf8",
        ),
      );
      const files = (
        await fs.readdir(copy, { recursive: true, withFileTypes: true })
      )
        .filter(
          (e) =>
            e.isFile() &&
            e.name !== ".DS_Store" &&
            !path.relative(copy, e.parentPath).includes("__pycache__"),
        )
        .map((e) => path.relative(copy, path.join(e.parentPath, e.name)))
        .sort();
      let listing = "";
      for (const file of files)
        listing += `${hash(await fs.readFile(path.join(copy, file)))}  ${file}\n`;
      assert.deepEqual(lock.plugin, {
        name: "homepage-studio",
        version: manifest.version,
        path: copy,
        tree_sha256: hash(listing),
        files: files.length,
      });
      assert.equal(lock.schema_version, 1);
    } finally {
      await run.close();
    }
  } finally {
    studio.dir = repoPlugin;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("S07 generated projection schemas accept native and pm-led runs and reject mixed shapes", async () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const load = async (name: string) =>
    ajv.compile(
      JSON.parse(
        await fs.readFile(path.resolve(`schemas/${name}.schema.json`), "utf8"),
      ),
    );
  const schemas = {
    "meta.json": await load("meta"),
    "task.json": await load("task"),
    "agents.json": await load("agents"),
  };
  const projections = async (directory: string) => {
    const out: Record<string, any> = {};
    for (const name of Object.keys(schemas))
      out[name] = JSON.parse(
        await fs.readFile(path.join(directory, name), "utf8"),
      );
    return out;
  };
  const valid = (files: Record<string, any>) => {
    for (const [name, check] of Object.entries(schemas))
      assert.ok(check(files[name]), `${name}: ${ajv.errorsText(check.errors)}`);
  };
  const native = await launch();
  let nativeFiles: Record<string, any>;
  try {
    nativeFiles = await projections(native.p.directory);
    assert.deepEqual(nativeFiles["meta.json"].orchestration, {
      mode: "claude-native",
    });
    assert.equal(
      nativeFiles["agents.json"].orchestration_mode,
      "claude-native",
    );
    assert.equal(nativeFiles["agents.json"].agents.length, 1);
    valid(nativeFiles);
  } finally {
    await native.close();
  }
  const led = await launch(undefined, legacyTeam);
  let ledFiles: Record<string, any>;
  try {
    ledFiles = await projections(led.p.directory);
    assert.equal(ledFiles["meta.json"].orchestration.mode, "pm-led");
    assert.equal(ledFiles["agents.json"].agents.length, 3);
    valid(ledFiles);
  } finally {
    await led.close();
  }
  const agents = schemas["agents.json"],
    meta = schemas["meta.json"];
  const { orchestration_mode, ...unmarked } = nativeFiles["agents.json"];
  assert.ok(agents(unmarked), "pre-0.8 projections without a mode still pass");
  assert.equal(
    agents({ ...ledFiles["agents.json"], orchestration_mode: "claude-native" }),
    false,
  );
  assert.equal(
    agents({ ...nativeFiles["agents.json"], orchestration_mode: "pm-led" }),
    false,
  );
  assert.equal(
    agents({
      ...ledFiles["agents.json"],
      agents: ledFiles["agents.json"].agents.slice(0, 2),
    }),
    false,
  );
  assert.equal(
    agents({
      ...nativeFiles["agents.json"],
      agents: [{ ...nativeFiles["agents.json"].agents[0], role: "designer" }],
    }),
    false,
  );
  assert.equal(
    meta({
      ...nativeFiles["meta.json"],
      orchestration: { mode: "claude-native", team_requested: false },
    }),
    false,
  );
  assert.equal(
    meta({ ...nativeFiles["meta.json"], orchestration: { mode: "pm-led" } }),
    false,
  );
  assert.ok(meta({ ...nativeFiles["meta.json"], orchestration: null }));
});

test("S08 look.py tools are resolved like the PM pane's login shell and only warn", async () => {
  const bin = await fs.mkdtemp("/private/tmp/hp-bin-");
  const login = path.join(bin, "login");
  await fs.mkdir(login);
  const stub = async (dir: string, name: string, script: string) => {
    await fs.writeFile(path.join(dir, name), `#!/bin/sh\n${script}\n`);
    await fs.chmod(path.join(dir, name), 0o755);
  };
  const probe = path.join(bin, "python-args");
  try {
    await stub(bin, "python3", `printf '%s ' "$@" > ${probe}; exit 1`);
    const partial = await studioTools({ PATH: bin });
    assert.equal(partial.resolved_by, "path");
    assert.equal(partial.python3, path.join(bin, "python3"));
    assert.deepEqual(partial.missing, ["python3 playwright"]);
    assert.deepEqual(partial.optional_missing, ["cwebp"]);
    assert.equal(
      await fs.readFile(probe, "utf8"),
      "-c import playwright.sync_api ",
    );
    assert.match(
      partial.warning!,
      /^homepage-studio 보조 도구가 없습니다: python3 playwright\. 브로커 PATH에서 확인한 python3: .+\. PM pane의 로그인 셸 환경과 결과가 다를 수 있습니다\. 실행은 막지 않지만/,
    );
    const none = await studioTools({ PATH: "" });
    assert.equal(none.python3, null);
    assert.deepEqual(none.missing, ["python3 playwright"]);

    // A login profile that puts another python3 (with Playwright) first wins.
    await stub(login, "python3", "exit 0");
    await stub(login, "cwebp", "exit 0");
    const shell = path.join(bin, "shell");
    await stub(
      bin,
      "shell",
      `[ "$1 $2 $3" = "-l -i -c" ] || exit 9\nprintf 'profile noise'\nPATH=${login}:$PATH exec /bin/sh -c "$4"`,
    );
    assert.deepEqual(
      await studioTools({ PATH: bin, SHELL: shell, HOME: bin }),
      {
        python3: path.join(login, "python3"),
        resolved_by: "login-shell",
        missing: [],
        optional_missing: [],
        warning: null,
      },
    );
    await stub(login, "python3", "exit 1");
    const noPlaywright = await studioTools({
      PATH: bin,
      SHELL: shell,
      HOME: bin,
    });
    assert.ok(
      noPlaywright.warning!.includes(
        `PM pane과 같은 로그인 셸(${shell})에서 확인한 python3: ${path.join(login, "python3")}.`,
      ),
    );
    await stub(bin, "broken-shell", "exit 1");
    const fallback = await studioTools({
      PATH: bin,
      SHELL: path.join(bin, "broken-shell"),
    });
    assert.equal(fallback.resolved_by, "path");
    assert.equal(fallback.python3, path.join(bin, "python3"));

    await stub(login, "python3", "exit 0");
    const complete = await studioDoctor({ PATH: login });
    assert.deepEqual(complete.tools.missing, []);
    assert.deepEqual(complete.tools.optional_missing, []);
    assert.equal(complete.tools.warning, null);
    assert.equal(complete.plugin.available, true);
    assert.equal(complete.plugin.name, "homepage-studio");

    const f = await fixture();
    f.config.allowExecution = true;
    f.config.autoStart = false;
    const h = new FakeHerdr(f.config),
      b = new Broker(f.config, h);
    await b.start(false);
    clearInterval(b.timer);
    const before = process.env.PATH;
    try {
      await b.handle(f.submit());
      process.env.PATH = bin;
      const ready = await b.handle(
        cmd("execution-status", b.store.state.projects.A),
      );
      process.env.PATH = before;
      assert.equal(ready.ready, true, "missing tools never block execution");
      assert.equal(ready.checks.length, 2);
      assert.deepEqual(
        ready.warnings.map((w: any) => w.code),
        ["studio_tools_missing"],
      );
      assert.match(
        ready.warnings[0].detail,
        /보조 도구가 없습니다: python3 playwright\./,
      );
    } finally {
      process.env.PATH = before;
      await b.close();
      await fs.rm(f.root, { recursive: true, force: true });
    }
  } finally {
    await fs.rm(bin, { recursive: true, force: true });
  }
});
