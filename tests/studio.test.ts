import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { Broker } from "../src/broker/broker.js";
import { current } from "../src/domain/engine.js";
import { claudeArgs } from "../src/agents/prompts.js";
import {
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

test("S01 homepage-studio plugin ships its manifest, three bounded helpers and the page check", async () => {
  const manifest = JSON.parse(
    await fs.readFile(
      path.join(repoPlugin, ".claude-plugin/plugin.json"),
      "utf8",
    ),
  );
  assert.equal(manifest.name, "homepage-studio");
  assert.equal(typeof manifest.version, "string");
  assert.equal((await studioPlugin()).version, manifest.version);
  const skills = {
    developer: ["frontend-design", "korean-typography", "seo-basics"],
    designer: ["asset-kit", "frontend-design"],
    copywriter: ["korean-copywriting"],
  };
  for (const [role, uses] of Object.entries(skills)) {
    const file = path.join(repoPlugin, "agents", `homepage-${role}.md`);
    const text = await fs.readFile(file, "utf8");
    assert.ok(Buffer.byteLength(text) < 2500, `${role} stays short`);
    assert.match(
      text,
      new RegExp(
        `^---\\nname: homepage-${role}\\ndescription: .+\\nmodel: inherit\\neffort: high\\n---\\n`,
      ),
    );
    assert.match(text, /run guide path \(`homepage-orchestration\.md`\)/);
    assert.match(text, /\*-assignment\.json/);
    assert.match(text, /never submit broker commands/);
    assert.match(text, /no Herdr panes, no separate model sessions/);
    assert.match(text, /Preserve others' work/);
    for (const skill of uses)
      assert.ok(text.includes(`homepage-studio:${skill}`), `${role} ${skill}`);
  }
  assert.ok(
    (
      await fs.stat(
        path.join(repoPlugin, "skills/quality-gate/scripts/check_page.py"),
      )
    ).isFile(),
  );
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
    assert.deepEqual(runtime.orchestration.native_agents, [
      "homepage-studio:homepage-developer",
      "homepage-studio:homepage-designer",
      "homepage-studio:homepage-copywriter",
    ]);
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
      for (const file of [
        "skills/korean-copywriting/SKILL.md",
        "skills/quality-gate/scripts/check_page.py",
      ]) {
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

test("S04 PM instructions route through homepage-studio with one quality gate and the media budget", async () => {
  const root = await fs.mkdtemp("/private/tmp/hp-claude-");
  const refs = path.join(root, "skills/higgsfield-websites/references");
  await fs.mkdir(refs, { recursive: true });
  const run = await withClaudeRoot(root, () => launch());
  try {
    const pm = await run.read("pm-instructions.md");
    const guide = await run.read("homepage-orchestration.md");
    const guidePath = path.join(run.dir, "homepage-orchestration.md");
    assert.ok(pm.includes(guide), "PM instructions embed the shared guide");
    for (const gone of [
      /Minimal final verification/,
      /No separate QA role or repeated QA loops/,
      /Selected homepage skill excerpts/,
    ])
      assert.doesNotMatch(pm, gone);
    assert.match(pm, /Load skill homepage-studio:homepage-studio first/);
    assert.match(guide, /follows its stage order and artifact paths/);
    for (const agent of ["developer", "designer", "copywriter"])
      assert.ok(pm.includes(`homepage-studio:homepage-${agent}`));
    assert.ok(
      pm.includes(
        `include the run guide path ${guidePath} in every delegation`,
      ),
    );
    assert.match(guide, /At most two helpers at a time/);
    const script = path.join(
      studio.dir,
      "skills/quality-gate/scripts/check_page.py",
    );
    assert.ok(
      guide.includes(
        `python3 ${script} <preview URL> ${run.dir}/reports/auto-check`,
      ),
    );
    assert.ok(guide.includes(`resolve under ${studio.dir}/skills/<skill>/`));
    assert.match(guide, /homepage-studio:quality-gate once/);
    assert.match(guide, /reports\/self-check\.md, then at most one fix pass/);
    assert.ok(
      guide.includes(
        `close task may run the same script once more into ${run.dir}/reports/auto-check/final as final evidence only; it starts no further fixes`,
      ),
    );
    assert.match(
      guide,
      /Apart from that single final capture: no separate QA agent and no repeated check or fix loops/,
    );
    assert.match(guide, /PRD states explicit image or video counts/);
    assert.match(guide, /at most 12 images plus 1 hero video/);
    assert.match(guide, /logo draft when no logo is supplied/);
    assert.match(guide, /one image owner/);
    assert.match(guide, /media-receipts\.json/);
    assert.match(guide, /resubmit an unknown job outcome/);
    assert.ok(guide.includes(`- higgsfield-websites: ${refs}`));
    assert.match(guide, /- higgsfield-brandkit: not installed/);
    assert.match(pm, /strictly increasing sequence/);
    assert.match(pm, /Kinds: plan \(initial plan task only\)/);
    assert.match(pm, /PM alone starts preview: preview-start with argv/);
    assert.match(pm, /Broker decides overall review_pending/);
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

test("S08 missing studio tools warn in doctor and readiness without blocking execution", async () => {
  const bin = await fs.mkdtemp("/private/tmp/hp-bin-");
  const stub = async (name: string, script: string, mode = 0o755) => {
    await fs.writeFile(path.join(bin, name), `#!/bin/sh\n${script}\n`);
    await fs.chmod(path.join(bin, name), mode);
  };
  const probe = path.join(bin, "python-args");
  try {
    for (const name of ["ffmpeg", "ffprobe", "cwebp"])
      await stub(name, "exit 0");
    await stub("magick", "exit 0", 0o644);
    await stub("python3", `printf '%s ' "$@" > ${probe}; exit 1`);
    const partial = await studioTools({ PATH: bin });
    assert.deepEqual(partial.missing, [
      "python3 playwright",
      "avifenc",
      "magick",
      "rsvg-convert",
      "pyftsubset",
    ]);
    assert.equal(
      await fs.readFile(probe, "utf8"),
      "-c import playwright.sync_api ",
    );
    assert.match(
      partial.warning!,
      /^homepage-studio 보조 도구가 없습니다: python3 playwright, avifenc, magick, rsvg-convert, pyftsubset\. 실행은 막지 않지만/,
    );
    assert.deepEqual((await studioTools({ PATH: "" })).missing.length, 8);
    await stub("python3", "exit 0");
    for (const name of ["avifenc", "magick", "rsvg-convert", "pyftsubset"])
      await stub(name, "exit 0");
    const complete = await studioDoctor({ PATH: bin });
    assert.deepEqual(complete.tools, { missing: [], warning: null });
    assert.equal(complete.plugin.available, true);
    assert.equal(complete.plugin.name, "homepage-studio");

    await fs.rm(path.join(bin, "avifenc"));
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
      assert.match(ready.warnings[0].detail, /보조 도구가 없습니다: avifenc\./);
    } finally {
      process.env.PATH = before;
      await b.close();
      await fs.rm(f.root, { recursive: true, force: true });
    }
  } finally {
    await fs.rm(bin, { recursive: true, force: true });
  }
});
