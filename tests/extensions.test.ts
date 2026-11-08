import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  Extension,
  extensions,
  extensionStatus,
  extensionStore,
  projectExtensions,
  readExtensionLock,
  syncExtensions,
} from "../src/agents/extensions.js";
import { treeHash } from "../src/agents/studio.js";
import { hash } from "../src/storage/store.js";
import "./helpers.js";

const exec = promisify(execFile);
const seams = { ...extensions };
const OLD = "a".repeat(40),
  NEW = "b".repeat(40);

// A fake upstream repository at one commit, packed like a GitHub archive.
async function upstream(
  root: string,
  commit: string,
  body = "Demo skill body",
  warmup?: string[],
) {
  const src = path.join(root, `src-${commit.slice(0, 4)}`);
  const top = path.join(src, `demo-repo-${commit}`);
  const skill = path.join(top, "skills/demo");
  await fs.mkdir(path.join(skill, "scripts"), { recursive: true });
  await fs.writeFile(
    path.join(skill, "SKILL.md"),
    `---\nname: demo-skill\ndescription: test\n---\n${body}\n`,
  );
  await fs.writeFile(
    path.join(skill, "scripts/warm.sh"),
    'if [ "$1" = fail ]; then echo boom >&2; exit 3; fi\npwd > "$TMPDIR_WARM"\n',
  );
  await fs.writeFile(path.join(top, "LICENSE"), "MIT demo");
  await fs.writeFile(path.join(top, "README.md"), "not extracted");
  const tree = await treeHash(skill);
  const archive = path.join(root, `demo-${commit.slice(0, 4)}.tar.gz`);
  await exec("tar", ["-czf", archive, "-C", src, `demo-repo-${commit}`], {
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
  const ext: Extension = {
    name: "demo",
    version: "1.0.0",
    repository: "https://github.com/acme/demo-repo",
    commit,
    license: "MIT",
    files: [{ path: "LICENSE", sha256: hash("MIT demo") }],
    skills: [
      {
        name: "demo-skill",
        path: "skills/demo",
        files: tree.files,
        tree_sha256: tree.sha256,
        ...(warmup ? { warmup } : {}),
      },
    ],
  };
  return { archive, ext };
}

async function setup(t: any) {
  const root = await fs.mkdtemp("/private/tmp/hp-ext-");
  extensions.root = path.join(root, "store");
  extensions.lockFile = path.join(root, "extensions.lock.json");
  const downloads: string[] = [];
  let archive = "";
  extensions.download = async (e, file) => {
    downloads.push(e.commit);
    await fs.copyFile(archive, file);
  };
  t.after(async () => {
    Object.assign(extensions, seams);
    await fs.rm(root, { recursive: true, force: true });
  });
  return {
    root,
    downloads,
    serve: async (pack: { archive: string; ext: Extension }) => {
      archive = pack.archive;
      await fs.writeFile(
        extensions.lockFile,
        JSON.stringify({ schema_version: 1, extensions: [pack.ext] }),
      );
      return pack.ext;
    },
  };
}
const exists = (file: string) =>
  fs.lstat(file).then(
    () => true,
    () => false,
  );
const staging = async (store: string) =>
  (await fs.readdir(store).catch(() => [])).filter((n) =>
    n.startsWith(".staging-"),
  );

test("X01 the tracked lock pins impeccable and taste-skill by commit; malformed locks are rejected", async (t) => {
  const lock = await readExtensionLock();
  assert.deepEqual(
    lock.extensions.map((e) => [e.name, e.skills.map((s) => s.name)]),
    [
      ["impeccable", ["impeccable"]],
      ["taste-skill", ["design-taste-frontend"]],
    ],
  );
  for (const e of lock.extensions) {
    assert.match(e.commit, /^[0-9a-f]{40}$/);
    assert.match(e.repository, /^https:\/\/github\.com\//);
    for (const s of e.skills) assert.match(s.tree_sha256, /^[0-9a-f]{64}$/);
  }

  const { root } = await setup(t);
  const { ext } = await upstream(root, OLD);
  const bad: [string, (e: any) => void][] = [
    ["short commit", (e) => (e.commit = "abc")],
    ["other host", (e) => (e.repository = "https://example.com/a/b")],
    ["path escape", (e) => (e.skills[0].path = "../outside")],
    ["file escape", (e) => (e.files[0].path = "/etc/passwd")],
    ["shell warmup", (e) => (e.skills[0].warmup = ["bash", "x.sh"])],
    ["warmup args", (e) => (e.skills[0].warmup = ["sh", "x.sh", "$(id)"])],
    ["no skills", (e) => (e.skills = [])],
    ["duplicate skill", (e) => e.skills.push({ ...e.skills[0] })],
  ];
  for (const [why, change] of bad) {
    const e = structuredClone(ext);
    change(e);
    await fs.writeFile(
      extensions.lockFile,
      JSON.stringify({ schema_version: 1, extensions: [e] }),
    );
    await assert.rejects(
      readExtensionLock(),
      (err: any) => err.code === "invalid_extension_lock",
      why,
    );
  }
});

test("X02 sync installs the pinned archive once, keeps only the listed paths and runs warmup in the skill folder", async (t) => {
  const s = await setup(t);
  const marker = path.join(s.root, "warm.txt");
  process.env.TMPDIR_WARM = marker;
  t.after(() => delete process.env.TMPDIR_WARM);
  const ext = await s.serve(
    await upstream(s.root, OLD, undefined, ["sh", "scripts/warm.sh", "ok"]),
  );
  const before = await extensionStatus();
  assert.deepEqual(before.missing, ["demo"]);
  assert.match(before.warning!, /demo.*extensions sync/);

  const first = await syncExtensions();
  assert.equal(first.store, extensionStore());
  assert.deepEqual(first.results, [
    {
      name: "demo",
      version: "1.0.0",
      commit: OLD,
      status: "installed",
      warnings: [],
    },
  ]);
  const dir = path.join(extensions.root!, "demo", OLD);
  assert.deepEqual((await fs.readdir(dir)).sort(), [
    "LICENSE",
    "install.json",
    "skills",
  ]);
  assert.deepEqual(await treeHash(path.join(dir, "skills/demo-skill")), {
    files: ext.skills[0].files,
    sha256: ext.skills[0].tree_sha256,
  });
  assert.equal(
    (await fs.readFile(marker, "utf8")).trim(),
    await fs.realpath(path.join(dir, "skills/demo-skill")),
  );
  const record = JSON.parse(
    await fs.readFile(path.join(dir, "install.json"), "utf8"),
  );
  assert.equal(record.commit, OLD);
  assert.deepEqual(await staging(extensions.root!), []);

  const again = await syncExtensions();
  assert.equal(again.results[0].status, "present");
  assert.deepEqual(s.downloads, [OLD], "a present install is not downloaded");
  const after = await extensionStatus();
  assert.deepEqual(after.missing, []);
  assert.equal(after.warning, null);

  // A failing warmup is a warning; the install stays usable.
  await s.serve(
    await upstream(s.root, NEW, undefined, ["sh", "scripts/warm.sh", "fail"]),
  );
  const warned = await syncExtensions();
  assert.equal(warned.results[0].status, "installed");
  assert.match(warned.results[0].warnings![0], /boom/);
  assert.deepEqual((await extensionStatus()).missing, []);
});

test("X03 a changed, incomplete or unreachable archive installs nothing", async (t) => {
  const s = await setup(t);
  const good = await upstream(s.root, OLD);
  const tampered = await upstream(s.root, NEW, "Changed upstream body");
  await s.serve({
    archive: tampered.archive,
    ext: { ...good.ext, commit: NEW },
  });
  const mismatch = await syncExtensions();
  assert.equal(mismatch.results[0].status, "failed");
  assert.equal(mismatch.results[0].code, "extension_hash_mismatch");
  assert.equal(await exists(path.join(extensions.root!, "demo", NEW)), false);
  assert.deepEqual((await extensionStatus()).missing, ["demo"]);

  const missing = structuredClone(good.ext);
  missing.skills[0].path = "skills/absent";
  await s.serve({ archive: good.archive, ext: missing });
  const absent = await syncExtensions();
  assert.equal(absent.results[0].code, "extension_archive_invalid");

  await s.serve(good);
  extensions.download = async () => {
    throw Object.assign(new Error("offline"), {
      code: "extension_download_failed",
    });
  };
  const offline = await syncExtensions();
  assert.equal(offline.results[0].code, "extension_download_failed");
  assert.deepEqual(await staging(extensions.root!), []);
});

test("X04 project .claude gets hooks off and extension links; stale links move and foreign entries stay", async (t) => {
  const s = await setup(t);
  await s.serve(await upstream(s.root, OLD));
  await syncExtensions();
  await s.serve(await upstream(s.root, NEW));
  await syncExtensions();
  const project = path.join(s.root, "project");
  const claude = path.join(project, ".claude");
  await fs.mkdir(path.join(claude, "skills/mine"), { recursive: true });
  await fs.mkdir(path.join(claude, "agents"), { recursive: true });
  await fs.writeFile(
    path.join(claude, "settings.json"),
    JSON.stringify({ permissions: { allow: ["Read"] } }),
  );
  const store = extensions.root!;
  const link = path.join(claude, "skills/demo-skill");
  await fs.symlink(path.join(store, "demo", OLD, "skills/demo-skill"), link);

  const result = await projectExtensions(project);
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(claude, "settings.json"), "utf8")),
    { permissions: { allow: ["Read"] }, disableAllHooks: true },
  );
  assert.equal(
    await fs.readlink(link),
    path.join(store, "demo", NEW, "skills/demo-skill"),
  );
  assert.match(
    await fs.readFile(path.join(link, "SKILL.md"), "utf8"),
    /name: demo-skill/,
  );
  assert.deepEqual(result.skills, [
    {
      extension: "demo",
      version: "1.0.0",
      commit: NEW,
      name: "demo-skill",
      tree_sha256: result.skills[0].tree_sha256,
    },
  ]);
  assert.deepEqual([...result.unmanaged].sort(), [
    ".claude/agents",
    ".claude/skills/mine",
  ]);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(await projectExtensions(project), result, "idempotent");

  // A same-named entry the broker did not create is never replaced.
  await fs.rm(link);
  await fs.mkdir(link);
  const foreign = await projectExtensions(project);
  assert.deepEqual(foreign.skills, []);
  assert.match(foreign.warnings[0], /demo-skill/);
  assert.ok(foreign.unmanaged.includes(".claude/skills/demo-skill"));
  assert.equal((await fs.lstat(link)).isDirectory(), true);

  await fs.writeFile(path.join(claude, "settings.json"), "{not json");
  await assert.rejects(
    projectExtensions(project),
    (e: any) => e.code === "project_settings_invalid",
  );
  await fs.writeFile(path.join(claude, "settings.json"), "[]");
  await assert.rejects(
    projectExtensions(project),
    (e: any) => e.code === "project_settings_invalid",
  );
});

test("X05 without an installed store the project still launches with hooks off and stale links removed", async (t) => {
  const s = await setup(t);
  await s.serve(await upstream(s.root, OLD));
  const project = path.join(s.root, "project");
  const link = path.join(project, ".claude/skills/demo-skill");
  await fs.mkdir(path.dirname(link), { recursive: true });
  await fs.symlink(
    path.join(extensions.root!, "demo", OLD, "skills/demo-skill"),
    link,
  );
  const result = await projectExtensions(project);
  assert.deepEqual(result.skills, []);
  assert.match(result.warnings[0], /demo/);
  assert.equal(await exists(link), false);
  assert.deepEqual(
    JSON.parse(
      await fs.readFile(path.join(project, ".claude/settings.json"), "utf8"),
    ),
    { disableAllHooks: true },
  );

  extensions.root = undefined;
  const env = process.env.HOMEPAGE_EXTENSIONS_DIR;
  process.env.HOMEPAGE_EXTENSIONS_DIR = "relative/store";
  try {
    assert.throws(extensionStore, (e: any) => e.code === "invalid_config");
  } finally {
    process.env.HOMEPAGE_EXTENSIONS_DIR = env;
  }
});
