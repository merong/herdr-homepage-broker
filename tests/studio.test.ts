import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import { AddressInfo } from "node:net";
import path from "node:path";
import zlib from "node:zlib";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { Ajv2020 } from "ajv/dist/2020.js";
import { Broker } from "../src/broker/broker.js";
import { current, validatePlan } from "../src/domain/engine.js";
import { claudeArgs, rolePrompt } from "../src/agents/prompts.js";
import { nativePrompt, shellQuote } from "../src/agents/native.js";
import {
  lookScript,
  studio,
  studioDoctor,
  studioPlugin,
  studioTools,
  treeHash,
} from "../src/agents/studio.js";
import { brokerSocket, config, injectedSkills } from "../src/config.js";
import { command } from "../src/contracts/validate.js";
import { hash } from "../src/storage/store.js";
import { Agent, Run } from "../src/contracts/types.js";
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
const exec = promisify(execFile);
// The nth task file the broker handed to the PM through "agent prompt".
async function taskText(h: FakeHerdr, n: number) {
  const prompt = h.calls.filter((c) => c[0] === "agent" && c[1] === "prompt")[
    n
  ][3];
  return fs.readFile(
    JSON.parse(/Then read ("[^"]+")/.exec(prompt)![1]),
    "utf8",
  );
}
const blocks = (text: string) =>
  [...text.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => JSON.parse(m[1]));
// What the PM does with an example: fresh UUIDs, its token, maybe a sequence.
function filled(value: any, token: string, sequence?: number) {
  const copy = structuredClone(value);
  if (sequence !== undefined) copy.payload.sequence = sequence;
  return JSON.stringify(copy)
    .replace(/REPLACE_WITH_UUID/g, () => randomUUID())
    .replaceAll("TOKEN_FROM_ASSIGNMENT_FILE", token);
}
// Runs a command line exactly as a shell would read it; never throws.
async function shell(sh: string, line: string, env: NodeJS.ProcessEnv) {
  try {
    const { stdout, stderr } = await exec(sh, ["-c", line], { env });
    return { code: 0, stdout, stderr };
  } catch (e: any) {
    return { code: e.code, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}
// The broker CLI reads a config; an empty one keeps the user's out of tests.
async function cliEnv(root: string) {
  const file = path.join(root, "cli-config.json");
  await fs.writeFile(file, "{}");
  return { ...process.env, HOMEPAGE_CONFIG: file };
}
// Where each color shows in a screenshot: pixel count and first/last row.
// Decodes the 8-bit non-interlaced RGB(A) PNGs Chromium writes.
async function colors(file: string, palette: Record<string, number[]>) {
  const buf = await fs.readFile(file);
  const idat: Buffer[] = [];
  let i = 8,
    width = 0,
    height = 0,
    ch = 0;
  while (i < buf.length) {
    const length = buf.readUInt32BE(i);
    const type = buf.toString("ascii", i + 4, i + 8);
    const chunk = buf.subarray(i + 8, i + 8 + length);
    if (type === "IHDR") {
      [width, height] = [chunk.readUInt32BE(0), chunk.readUInt32BE(4)];
      assert.deepEqual(
        [chunk[8], chunk[12]],
        [8, 0],
        `${file}: 8-bit, not interlaced`,
      );
      ch = chunk[9] === 6 ? 4 : 3;
    } else if (type === "IDAT") idat.push(chunk);
    i += 12 + length;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const px = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1);
    const row = px.subarray(y * stride);
    const up = y ? px.subarray((y - 1) * stride) : undefined;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? row[x - ch] : 0;
      const b = up ? up[x] : 0;
      const c = up && x >= ch ? up[x - ch] : 0;
      const p = a + b - c;
      const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
      const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      row[x] = (src[x] + [0, a, b, (a + b) >> 1, paeth][filter]) & 255;
    }
  }
  const found: Record<string, { n: number; top: number; bottom: number }> = {};
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const o = y * stride + x * ch;
      for (const [name, [r, g, b]] of Object.entries(palette)) {
        if (px[o] !== r || px[o + 1] !== g || px[o + 2] !== b) continue;
        const f = (found[name] ??= { n: 0, top: y, bottom: y });
        f.n++;
        f.bottom = y;
      }
    }
  return found;
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

test("S01 homepage-studio plugin ships the lean skill, vendored design skills, the design-taste excerpt and look.py without helpers", async () => {
  const manifest = JSON.parse(
    await fs.readFile(
      path.join(repoPlugin, ".claude-plugin/plugin.json"),
      "utf8",
    ),
  );
  assert.equal(manifest.name, "homepage-studio");
  assert.equal(typeof manifest.version, "string");
  assert.equal((await studioPlugin()).version, manifest.version);
  const skills = (await fs.readdir(path.join(repoPlugin, "skills"))).sort();
  assert.deepEqual(skills, [
    "design-taste",
    "frontend-design",
    "high-end-visual-design",
    "homepage-studio",
  ]);
  for (const skill of skills)
    assert.match(
      await fs.readFile(
        path.join(repoPlugin, "skills", skill, "SKILL.md"),
        "utf8",
      ),
      new RegExp(`^---\\nname: ${skill}\\n`),
      `${skill} frontmatter name matches its folder`,
    );
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
  for (const file of ["SKILL.md", "LICENSE"])
    assert.ok(
      notices.includes(
        hash(
          await fs.readFile(
            path.join(repoPlugin, "skills/high-end-visual-design", file),
          ),
        ),
      ),
      `high-end-visual-design ${file} stays byte for byte`,
    );
  const tasteDir = path.join(repoPlugin, "skills/design-taste");
  assert.ok(
    notices.includes(hash(await fs.readFile(path.join(tasteDir, "LICENSE")))),
    "design-taste LICENSE stays byte for byte",
  );
  const taste = await fs.readFile(path.join(tasteDir, "SKILL.md"), "utf8");
  assert.equal(
    notices.includes(hash(taste)),
    false,
    "the adapted excerpt's own hash is not pinned",
  );
  assert.ok(Buffer.byteLength(taste) <= 25_000, "design-taste stays <= 25KB");
  const provenance = taste.slice(
    taste.indexOf("## 출처"),
    taste.indexOf("\n> "),
  );
  assert.match(provenance, /b482f7a970abb98c4108d4a9f761e458c64cefc8/);
  assert.match(provenance, /\[adapted\]/);
  for (const external of [
    /picsum\.photos/,
    /simpleicons/,
    /unsplash/,
    /fonts\.googleapis/,
    /next\/font/,
    /next\/image/,
  ])
    assert.doesNotMatch(taste, external);
  // The pre-flight check must not fail one CTA repeated in nav, hero and footer.
  assert.match(taste, /the same CTA may repeat in nav, hero and footer/);
  const lean = await fs.readFile(
    path.join(repoPlugin, "skills/homepage-studio/SKILL.md"),
    "utf8",
  );
  assert.match(
    lean,
    /이 스킬과 references → design-taste → high-end-visual-design·frontend-design/,
  );
  assert.match(
    lean,
    /high-end-visual-design`\(first-screen 시작에 로드\): [^\n]*선택지이며 모든 항목을 의무로 적용하지 않는다/,
  );
  assert.match(
    lean,
    /한 회차는 design-taste 14절 사전 점검으로 보고[^\n]*별도 문서나 회차는 더하지 않는다/,
  );
  // Each design skill is loaded at a named stage, and unloaded skills are not cited.
  assert.match(lean, /로드하지 않은 스킬의 기법은 verdict에 적지 않는다/);
  assert.match(
    lean,
    /## 1\. direction \(pm\)\n\n시작할 때 `homepage-studio:design-taste`를 로드한다/,
  );
  assert.match(
    lean,
    /## 2\. first-screen \(developer\)\n\n시작할 때 `homepage-studio:high-end-visual-design`과 `homepage-studio:frontend-design`을 로드한다/,
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
  // Sticky/fixed are laid out for the full pages only, after the viewport shot.
  const shot = (s: string) => look.indexOf(s);
  assert.ok(shot('f"{name}.png"') > 0);
  assert.ok(shot('f"{name}.png"') < shot("page.evaluate(FULL_PAGE_JS"));
  assert.ok(shot("page.evaluate(FULL_PAGE_JS") < shot('f"{name}-full.png"'));
  assert.match(look, /behavior: "instant"/);
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
      for (const file of [
        "skills/frontend-design/SKILL.md",
        "skills/design-taste/SKILL.md",
        "skills/high-end-visual-design/SKILL.md",
        lookScript,
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

test("S04 PM instructions: one builder, three tasks, the look loop and the media rule", async () => {
  const root = await fs.mkdtemp("/private/tmp/hp-claude-");
  const refs = path.join(root, "skills/higgsfield-websites/references");
  await fs.mkdir(refs, { recursive: true });
  const run = await withClaudeRoot(root, () => launch());
  try {
    const pm = await run.read("pm-instructions.md");
    const guide = await run.read("homepage-orchestration.md");
    assert.ok(pm.includes(guide), "PM instructions embed the shared guide");
    assert.equal(pm.split(guide).length, 2, "the guide appears exactly once");
    assert.equal(
      pm.includes(path.join(run.dir, "homepage-orchestration.md")),
      false,
      "PM is never pointed at the copy it already has",
    );
    assert.match(pm, /do not open its copy homepage-orchestration\.md/);
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
    assert.match(
      guide,
      /for visual craft load homepage-studio:design-taste, homepage-studio:high-end-visual-design and homepage-studio:frontend-design at the stages the homepage-studio skill names, and on conflict follow the priority set in the homepage-studio skill/,
    );
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
        `Run: python3 ${shellQuote(look)} <preview URL> ${shellQuote(path.join(run.dir, "reports/look"))}/<round> (`,
      ),
    );
    assert.match(guide, /first-screen: at most 2 rounds/);
    assert.match(guide, /build-out: at most 3 rounds/);
    assert.match(
      guide,
      /then one final run with final as <round>, as delivery evidence/,
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
    assert.match(
      pm,
      /PM alone starts preview: '\S+\/broker-cli' preview start --file <json> with type preview-start and argv/,
    );
    assert.match(pm, /Broker decides overall review_pending/);
    const r = current(run.p);
    const broker = await nativePrompt(
      { ...run.f.config, mcp: {} as any },
      run.p,
      r,
      "",
      await studioPlugin(),
    );
    assert.match(
      broker,
      /only PM calls media-request \('\S+\/broker-cli' media request --file <json>\)/,
    );
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

test("S09 native task files carry complete report envelopes sent through one broker-cli path", async () => {
  const run = await launch();
  try {
    const cli = path.join(run.dir, "broker-cli");
    assert.equal((await fs.stat(cli)).mode & 0o777, 0o700);
    const wrapper = await fs.readFile(cli, "utf8");
    assert.ok(
      wrapper.startsWith(
        `#!/bin/sh\nexec '${process.execPath}' '${path.resolve("dist/src/cli.js")}' --socket '${brokerSocket(run.f.config)}' "$@"`,
      ),
    );
    const agent = () => current(run.b.store.state.projects.A).agents[0];
    const token = agent().token;
    assert.equal(wrapper.includes(token), false);
    const pm = await run.read("pm-instructions.md");
    assert.ok(
      pm.includes(`${shellQuote(cli)} report --file <JSON command file>`),
    );
    assert.ok(pm.includes(`${shellQuote(cli)} preview start --file <json>`));
    assert.match(pm, /do not keep a multi-word command in one shell variable/);

    const fill = (value: any) => filled(value, token);
    const env = await cliEnv(run.f.root);
    const send = async (value: any, name: string) => {
      const file = path.join(run.f.root, name);
      await fs.writeFile(file, fill(value));
      return exec(cli, ["report", "--file", file], { env });
    };

    const planText = await taskText(run.h, 0);
    assert.equal(planText.includes(token), false, "token stays out");
    assert.ok(planText.includes(`    ${shellQuote(cli)} report --file <file>`));
    const [progress, plan] = blocks(planText);
    const skill = await fs.readFile(
      path.join(studio.dir, "skills/homepage-studio/SKILL.md"),
      "utf8",
    );
    const skillPlan = JSON.parse(
      /## plan[\s\S]*?```json\n([\s\S]*?)\n```/.exec(skill)![1],
    );
    assert.deepEqual(plan.payload.tasks, skillPlan, "same plan as the skill");
    assert.deepEqual(
      validatePlan(plan.payload.tasks, "claude-native").map((t) => t.task_id),
      ["direction", "first-screen", "build-out"],
    );
    for (const value of [progress, plan]) {
      command(value);
      assert.equal(value.payload.token, "TOKEN_FROM_ASSIGNMENT_FILE");
      assert.equal(value.payload.task_id, "plan");
    }
    assert.equal(progress.payload.kind, "progress");
    assert.equal(plan.payload.kind, "plan");
    assert.equal(plan.payload.sequence, progress.payload.sequence + 1);
    const template = JSON.parse(await run.read("pm-assignment.json"));
    assert.equal(template.payload.token, token);
    assert.deepEqual(template.payload.tasks, skillPlan);

    await send(plan, "plan.json");
    assert.deepEqual(
      current(run.b.store.state.projects.A).tasks.map((t) => t.task_id),
      ["plan", "direction", "first-screen", "build-out"],
    );
    await run.b.tick();
    const directionText = await taskText(run.h, 1);
    assert.equal(directionText.includes(token), false);
    const [step, done, preview] = blocks(directionText);
    for (const value of [step, done, preview]) command(value);
    assert.equal(step.payload.task_id, "direction");
    assert.equal(step.payload.kind, "progress");
    assert.ok(step.payload.sequence > plan.payload.sequence);
    assert.equal(done.payload.kind, "completed");
    assert.equal(done.payload.sequence, step.payload.sequence + 1);
    assert.equal(preview.type, "preview-start");
    assert.ok(preview.payload.argv.some((x: string) => x.includes("{port}")));
    await send(step, "progress.json");
    await send(done, "done.json");
    const r = current(run.b.store.state.projects.A);
    assert.equal(
      r.tasks.find((t) => t.task_id === "direction")!.status,
      "completed",
    );
  } finally {
    await run.close();
  }
});

test("S10 PM command lines run in sh and zsh when the project path holds spaces, quotes and $", async () => {
  const odd = "it's $HOME a dir";
  const run = await launch(async (f) => {
    const submit = f.submit;
    f.submit = (id = "A") => {
      const c = submit(id);
      c.payload.directory = path.join(f.root, "projects", odd, id);
      return c;
    };
  });
  try {
    assert.ok(run.dir.includes(odd));
    const cli = path.join(run.dir, "broker-cli");
    const env = await cliEnv(run.f.root);
    const shells: string[] = [];
    for (const sh of ["/bin/sh", "/bin/zsh"])
      if (
        await fs.access(sh).then(
          () => true,
          () => false,
        )
      )
        shells.push(sh);
    const pm = await run.read("pm-instructions.md");
    const media = await nativePrompt(
      { ...run.f.config, mcp: {} as any },
      run.p,
      current(run.p),
      "",
      await studioPlugin(),
    );
    const plan = await taskText(run.h, 0);
    // Every command line starts with the wrapper path as one quoted word; the
    // bare path, which a shell would split, is never shown.
    const lines = new Map<string, string>();
    for (const text of [pm, media, plan]) {
      assert.equal(text.includes(cli), false);
      for (const m of text.matchAll(
        /((?:'[^']*'|\\')+) (report|preview start|media request) --file <[^>]+>/g,
      )) {
        assert.equal(m[1], shellQuote(cli));
        lines.set(m[2], m[0]);
      }
    }
    assert.deepEqual([...lines.keys()].sort(), [
      "media request",
      "preview start",
      "report",
    ]);
    for (const sh of shells) {
      const help = await shell(sh, `${shellQuote(cli)} help`, env);
      assert.equal(help.code, 0, `${sh}: ${help.stderr}`);
      assert.match(help.stdout, /homepage session broker/);
    }

    // The report line from the task file, with only <file> replaced, sends the
    // plan; the same file again is an idempotent re-check, not a second plan.
    const line = /^ {4}(.+ report --file <file>)$/m.exec(plan)![1];
    const token = current(run.b.store.state.projects.A).agents[0].token;
    const file = path.join(run.f.root, `${odd} plan.json`);
    await fs.writeFile(file, filled(blocks(plan)[1], token));
    const results = [];
    for (const sh of shells) {
      const sent = await shell(
        sh,
        line.replace("<file>", shellQuote(file)),
        env,
      );
      assert.equal(sent.code, 0, `${sh}: ${sent.stderr}`);
      results.push(JSON.parse(sent.stdout));
    }
    for (const result of results) assert.equal(result.accepted, true);
    // Sent once: one plan, and the sequence is the plan's.
    assert.equal(current(run.b.store.state.projects.A).tasks.length, 4);
    assert.equal(
      current(run.b.store.state.projects.A).agents[0].seq,
      blocks(plan)[1].payload.sequence,
    );

    // preview start and media request reach the CLI with their subcommand and
    // file intact: a report file is refused as the wrong type, not as a path.
    for (const kind of ["preview start", "media request"])
      for (const sh of shells) {
        const sent = await shell(
          sh,
          lines.get(kind)!.replace(/<[^>]+>$/, shellQuote(file)),
          env,
        );
        assert.equal(sent.code, 2, `${sh} ${kind}: ${sent.stderr}`);
        assert.match(sent.stderr, /command_mismatch/);
      }
  } finally {
    await run.close();
  }
});

test("S11 report sequences count up across progress counts, a stale completed and a resumed assignment", async () => {
  const run = await launch();
  let b = run.b;
  try {
    const cli = shellQuote(path.join(run.dir, "broker-cli"));
    const env = await cliEnv(run.f.root);
    const state = () => current(b.store.state.projects.A);
    const token = state().agents[0].token;
    const status = (id: string) =>
      state().tasks.find((t) => t.task_id === id)!.status;
    let sent = 0;
    const send = async (value: any, sequence?: number) => {
      const file = path.join(run.f.root, `report-${++sent}.json`);
      await fs.writeFile(file, filled(value, token, sequence));
      return shell("/bin/sh", `${cli} report --file ${shellQuote(file)}`, env);
    };
    const accepted = async (value: any, sequence?: number) => {
      const r = await send(value, sequence);
      assert.equal(r.code, 0, r.stderr);
      assert.equal(JSON.parse(r.stdout).accepted, true);
    };
    let prompts = 0;
    const next = async () => blocks(await taskText(run.h, prompts++));

    // No progress: the plan and completed examples go out as written.
    await accepted((await next())[1]);
    await b.tick();
    await accepted((await next())[1]);
    assert.equal(status("direction"), "completed");
    await b.tick();
    // One progress, then the completed example as written.
    const [step, done] = await next();
    await accepted(step);
    await accepted(done);
    assert.equal(status("first-screen"), "completed");
    await b.tick();

    // A broker restart and resume re-dispatch build-out with a new assignment
    // whose examples start above the last accepted sequence, not from 1.
    const [before] = await next();
    await accepted(before);
    const last = state().agents[0].seq;
    await b.close();
    b = new Broker(run.f.config, run.h);
    await b.start(false);
    clearInterval(b.timer);
    assert.equal(state().reason, "broker_restarted");
    await b.tick();
    await b.handle(cmd("resume", b.store.state.projects.A));
    for (let i = 0; i < 3; i++) await b.tick();
    const [again, finish] = await next();
    assert.notEqual(again.payload.assignment_id, before.payload.assignment_id);
    assert.equal(again.payload.sequence, last + 1);
    assert.equal(finish.payload.sequence, last + 2);
    const template = JSON.parse(await run.read("pm-assignment.json"));
    assert.equal(template.payload.sequence, last + 1);

    // Several progress reports: the completed example's number is now stale
    // and refused; one above the last accepted report is taken.
    await accepted(again);
    await accepted(again, last + 2);
    const stale = await send(finish);
    assert.equal(stale.code, 2);
    assert.match(stale.stderr, /stale_sequence/);
    assert.equal(status("build-out"), "running");
    await accepted(finish, state().agents[0].seq + 1);
    assert.equal(status("build-out"), "completed");
  } finally {
    await b.close();
    await fs.rm(run.f.root, { recursive: true, force: true });
  }
});

test("S12 look.py keeps a fixed CTA inside a transformed section, names hidden bars and drawers and restores styles when its fix fails", async (t) => {
  // Skips name the python3 that was tried; only a missing python3, Playwright
  // or Chromium skips.
  const info = await exec("python3", [
    "-c",
    "import sys; print(sys.executable, sys.version.split()[0])",
  ]).then(
    (r) => ({ missing: false, text: `python3 ${r.stdout.trim()}` }),
    (e) => ({
      missing: e.code === "ENOENT",
      text: `python3 (${e.stderr || e.message})`.trim(),
    }),
  );
  if (info.missing) return t.skip("python3 is not installed");
  const python = info.text;
  const imported = await exec("python3", [
    "-c",
    "import playwright.sync_api",
  ]).then(
    () => "",
    (e) => (e.stderr as string) || String(e.message),
  );
  if (/ModuleNotFoundError: No module named 'playwright'/.test(imported))
    return t.skip(`Python Playwright is not installed for ${python}`);
  assert.equal(
    imported,
    "",
    `${python} cannot import Playwright:\n${imported}`,
  );
  const html = await fs.readFile(
    path.resolve("tests/fixtures/look-fixed.html"),
  );
  // #fail-states pages send the style attributes they see after the restore.
  const styles: { width: number; before: unknown; after: unknown }[] = [];
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith("/styles?")) {
      styles.push(JSON.parse(decodeURIComponent(req.url.slice(8))));
      res.writeHead(204);
      return res.end();
    }
    const ok = req.url === "/look-fixed.html";
    res.writeHead(ok ? 200 : 404, {
      "content-type": "text/html; charset=utf-8",
    });
    res.end(ok ? html : "");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const root = await fs.mkdtemp("/private/tmp/hp-look-");
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/look-fixed.html`;
    // The fixture's hash picks the mode: #fail-fix makes the fix throw,
    // #fail-undo also blocks restoring the saved inline styles.
    const look = async (mode: string, ...args: string[]) => {
      const out = path.join(root, mode);
      const run = await exec("python3", [
        path.join(repoPlugin, lookScript),
        `${url}#${mode}`,
        out,
        ...args,
      ]).then(
        (r) => ({ code: 0, stdout: r.stdout, stderr: r.stderr }),
        (e) => ({
          code: e.code as number,
          stdout: (e.stdout as string) ?? "",
          stderr: (e.stderr as string) ?? "",
        }),
      );
      const report =
        run.code === 0
          ? JSON.parse(await fs.readFile(path.join(out, "issues.json"), "utf8"))
          : undefined;
      return { ...run, out, report };
    };
    const [normal, reduced, fix, undo, states, late] = await Promise.all([
      look("normal"),
      look("reduced", "--reduced-motion"),
      look("fail-fix"),
      look("fail-undo"),
      look("fail-states"),
      look("timeout"),
    ]);
    // Exit 3 skips only when Playwright says its browser is not downloaded;
    // any other launch failure fails with look.py's message.
    if (normal.code === 3 && /Executable doesn't exist/.test(normal.stderr))
      return t.skip(`Playwright Chromium is not installed for ${python}`);
    assert.notEqual(normal.code, 3, `${python}: ${normal.stderr}`);
    const palette = {
      cta: [176, 0, 32],
      bar: [0, 160, 80],
      dock: [23, 55, 145],
      drawer: [255, 136, 0],
    };
    const shot = (run: typeof normal, file: string) =>
      colors(path.join(run.out, file), palette);

    for (const run of [normal, reduced]) {
      assert.equal(run.code, 0, run.stdout + run.stderr);
      assert.deepEqual(run.report.issues, []);
      assert.match(
        run.stdout,
        /hidden in full\/parts: div#dock \(appears after scrolling, in no screenshot\), aside#drawer \(not observed on screen while scrolling\)/,
      );
      assert.doesNotMatch(run.stdout, /closed:|never on screen/);
      for (const name of ["desktop", "mobile"]) {
        const fixed = run.report.viewports[name].full_page_positions;
        const by = Object.fromEntries(
          fixed.elements.map((e: any) => [e.selector, e]),
        );
        assert.equal(fixed.elements_total, 7);
        assert.equal(by["button#local-cta"].action, "left_as_is");
        assert.equal(
          by["button#local-cta"].reason,
          "placed in section.panel (transform), not in the viewport",
        );
        // preserve-3d is not in the ancestor scan: offsetParent alone, or the
        // two signals naming different ancestors, is recorded as unclear.
        assert.deepEqual(
          [by["b#tail-3d"], by["b#panel-3d"]].map((e) => [e.action, e.reason]),
          [
            [
              "left_as_is",
              "unclear whether it is fixed to the viewport: offsetParent div.flat3d, nearest ancestor with a containing property none",
            ],
            [
              "left_as_is",
              "unclear whether it is fixed to the viewport: offsetParent div.flat3d, nearest ancestor with a containing property section.panel (transform)",
            ],
          ],
        );
        assert.equal(by["div#dock"].action, "hidden");
        assert.equal(by["div#dock"].seen_while_scrolling, true);
        assert.equal(by["aside#drawer"].action, "hidden");
        assert.equal(by["aside#drawer"].seen_while_scrolling, false);
        assert.match(
          by["aside#drawer"].reason,
          /not observed on screen at the scroll positions checked/,
        );
        assert.equal(by["div#call-bar"].action, "page_bottom");
        assert.equal(by.header.action, "in_flow");
        assert.ok((await shot(run, `${name}-full.png`)).cta.n > 5000, name);
      }
    }
    for (const name of ["desktop", "mobile"]) {
      const v = normal.report.viewports[name];
      // The first viewport is the page as the visitor sees it.
      const first = await shot(normal, `${name}.png`);
      assert.ok(first.bar && !first.dock && !first.drawer && !first.cta, name);
      // Full page: the CTA stays in its section, the call bar sits at the
      // bottom, the dock and drawer are left out; parts slice the same page.
      const full = await shot(normal, `${name}-full.png`);
      assert.ok(full.cta.n > 5000 && !full.dock && !full.drawer, name);
      assert.ok(full.bar.top > v.page_height - 100, name);
      const parts = await Promise.all(
        v.screenshots.parts.map((f: string) => shot(normal, f)),
      );
      assert.equal(
        parts.reduce((n, p) => n + (p.cta?.n ?? 0), 0),
        full.cta.n,
      );
      assert.ok(parts.every((p) => !p.dock && !p.drawer));
    }

    // The fix throws at its first hide: the saved styles go back, so the call
    // bar is where the visitor sees it, and both outputs say so.
    assert.equal(fix.code, 0, fix.stdout);
    assert.match(
      fix.stdout,
      /full\/parts: WARNING layout fix failed, restored to the page as is/,
    );
    // Restoring is blocked too: the partly changed page is flagged unreliable.
    assert.equal(undo.code, 0, undo.stdout);
    assert.match(
      undo.stdout,
      /full\/parts: WARNING layout fix failed, full and parts are unreliable/,
    );
    for (const name of ["desktop", "mobile"]) {
      const restored = fix.report.viewports[name];
      assert.equal(restored.full_page_positions.restored, true);
      assert.match(
        restored.full_page_positions.error,
        /injected layout fix failure/,
      );
      assert.ok(
        (await shot(fix, `${name}-full.png`)).bar.bottom < restored.height,
        name,
      );
      const broken = undo.report.viewports[name];
      assert.equal(broken.full_page_positions.restored, false);
      assert.match(
        broken.full_page_positions.restore_error,
        /injected restore failure/,
      );
      assert.ok(
        (await shot(undo, `${name}-full.png`)).bar.top >
          broken.page_height - 100,
        name,
      );
    }
    assert.deepEqual(
      fix.report.issues.map((i: string) => i.split(":")[0]),
      ["desktop", "mobile"],
    );
    assert.match(
      fix.report.issues[0],
      /full\/parts layout fix failed \(injected layout fix failure\); styles were restored/,
    );
    assert.match(
      undo.report.issues[1],
      /could not be undone \(injected restore failure\); full and parts show a partly changed page, do not trust them/,
    );

    // The restore seen from the page: an absent, an empty and a set style
    // attribute are each back as they were, in both viewports.
    assert.equal(states.code, 0, states.stdout + states.stderr);
    const seen = new Map(styles.map((s) => [s.width, s]));
    assert.deepEqual(
      [...seen.keys()].sort((a, b) => a - b),
      [390, 1440],
    );
    for (const s of seen.values()) {
      assert.deepEqual(s.before, [null, "", "position: sticky; bottom: 0"]);
      assert.deepEqual(s.after, s.before);
    }
    for (const v of Object.values(states.report.viewports) as any[])
      assert.equal(v.full_page_positions.restored, true);

    // A scroll that ran out of time: not seen is reported as incomplete.
    assert.equal(late.code, 0, late.stdout + late.stderr);
    assert.match(
      late.stdout,
      /aside#drawer \(not observed while scrolling; scroll timed out, incomplete\)/,
    );
    for (const v of Object.values(late.report.viewports) as any[]) {
      assert.equal(v.scroll.timed_out, true);
      const drawer = v.full_page_positions.elements.find(
        (e: any) => e.selector === "aside#drawer",
      );
      assert.match(
        drawer.reason,
        /the scroll ran out of time, so this observation is incomplete/,
      );
    }
  } finally {
    server.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("S13 the look line and the legacy CLI sentence run in sh and zsh when paths hold spaces, quotes and $", async (t) => {
  const odd = "it's $HOME a dir";
  const before = studio.dir;
  let plugin = "";
  let run: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    // The plugin copy (look.py) and the project both sit under the odd path.
    run = await launch(async (f) => {
      plugin = path.join(f.root, odd, "plugin");
      await fs.cp(repoPlugin, plugin, { recursive: true });
      studio.dir = plugin;
      const submit = f.submit;
      f.submit = (id = "A") => {
        const c = submit(id);
        c.payload.directory = path.join(f.root, "projects", odd, id);
        return c;
      };
    });
    assert.ok(run.dir.includes(odd));
    const env = await cliEnv(run.f.root);
    const shells: string[] = [];
    for (const sh of ["/bin/sh", "/bin/zsh"])
      if (
        await fs.access(sh).then(
          () => true,
          () => false,
        )
      )
        shells.push(sh);

    // The look line: both paths quoted, the PM fills in only the URL and the
    // round, which stay outside the quotes.
    const guide = await run.read("homepage-orchestration.md");
    const look = path.join(plugin, lookScript);
    const out = path.join(run.dir, "reports/look");
    const line = /Run: (python3 .+\/<round>) \(add --reduced-motion/.exec(
      guide,
    )![1];
    assert.equal(
      line,
      `python3 ${shellQuote(look)} <preview URL> ${shellQuote(out)}/<round>`,
    );
    assert.equal(guide.includes(look), false);
    const url = "http://127.0.0.1:9/";
    const filled = (round: string) =>
      line.replace("<preview URL>", url).replace("<round>", round);
    // A stand-in for python3 prints the words it got: the script, the URL and
    // the round's directory arrive as three intact arguments.
    const sink = path.join(run.f.root, "argv-sink");
    await fs.writeFile(sink, '#!/bin/sh\nprintf "%s\\n" "$@"\n', {
      mode: 0o700,
    });
    for (const sh of shells)
      for (const round of ["1", "final"]) {
        const sent = await shell(
          sh,
          filled(round).replace(/^python3 /, `${shellQuote(sink)} `),
          env,
        );
        assert.equal(sent.code, 0, `${sh}: ${sent.stderr}`);
        assert.deepEqual(sent.stdout.trimEnd().split("\n"), [
          look,
          url,
          path.join(out, round),
        ]);
      }
    // The real python3 finds the quoted look.py; --help only prints usage.
    const python = await exec("python3", ["--version"]).then(
      () => true,
      () => false,
    );
    if (!python) t.diagnostic("python3 not found: look.py --help not run");
    else
      for (const sh of shells) {
        const help = await shell(sh, `${filled("1")} --help`, env);
        assert.equal(help.code, 0, `${sh}: ${help.stderr}`);
        assert.match(help.stdout, /usage: look\.py/);
      }

    // Legacy pm-led runs: node, cli.js and the socket are each one quoted
    // word. Only stateRoot can move in a test; it puts the odd path in the
    // socket.
    const c = { ...run.f.config, stateRoot: path.join(run.f.root, odd, "st") };
    const legacy = await rolePrompt(
      c,
      run.p,
      {
        ...current(run.p),
        run_id: "legacy",
        orchestration: {
          mode: "pm-led",
          team_requested: false,
          requested_by: null,
          requested_at: null,
        },
      },
      { role: "pm" } as Agent,
    );
    const cli = /The available CLI is (.+?)\. Use --socket (.+?)\. Each/.exec(
      legacy,
    )!;
    assert.ok(brokerSocket(c).includes(odd));
    assert.deepEqual(
      [cli[1], cli[2]],
      [
        `${shellQuote(process.execPath)} ${shellQuote(fileURLToPath(new URL("../src/cli.js", import.meta.url)))}`,
        shellQuote(brokerSocket(c)),
      ],
    );
    for (const sh of shells) {
      const help = await shell(sh, `${cli[1]} --socket ${cli[2]} help`, env);
      assert.equal(help.code, 0, `${sh}: ${help.stderr}`);
      assert.match(help.stdout, /homepage session broker/);
    }
  } finally {
    studio.dir = before;
    await run?.close();
  }
});
