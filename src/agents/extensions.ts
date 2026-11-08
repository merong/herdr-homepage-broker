import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { fail } from "../contracts/types.js";
import { atomic, hash } from "../storage/store.js";
import { treeHash } from "./studio.js";

const exec = promisify(execFile);
type Skill = {
  name: string;
  path: string;
  files: number;
  tree_sha256: string;
  warmup?: string[];
};
export type Extension = {
  name: string;
  version: string;
  repository: string;
  commit: string;
  license: string;
  files: { path: string; sha256: string }[];
  skills: Skill[];
};
export type SyncResult = {
  name: string;
  version: string;
  commit: string;
  status: "present" | "installed" | "failed";
  warnings?: string[];
  code?: string;
  detail?: string;
};

// Quality extensions are upstream skills pinned by commit and tree hash. They
// are downloaded once into a shared store and linked into each project's
// .claude/skills, which native PMs load through --setting-sources=project.
export const extensions = {
  lockFile: fileURLToPath(
    new URL("../../../claude-plugin/extensions.lock.json", import.meta.url),
  ),
  root: undefined as string | undefined,
  // Test seam: writes the GitHub archive (.tar.gz) of the pinned commit to file.
  download: async (e: Extension, file: string) => {
    const [, owner, repo] = githubRepo(e.repository);
    const url = `https://codeload.github.com/${owner}/${repo}/tar.gz/${e.commit}`;
    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(300_000) });
    } catch (err: any) {
      fail(
        "extension_download_failed",
        `${e.name}을 내려받지 못했습니다(${url}): ${err?.message ?? err}. 네트워크를 확인한 뒤 extensions sync를 다시 실행하세요.`,
      );
    }
    if (!res.ok || !res.body)
      fail(
        "extension_download_failed",
        `${e.name}을 내려받지 못했습니다(${url}): HTTP ${res.status}.`,
      );
    await pipeline(Readable.fromWeb(res.body as any), createWriteStream(file));
  },
};

export function extensionStore() {
  const root =
    extensions.root ??
    process.env.HOMEPAGE_EXTENSIONS_DIR ??
    path.join(
      process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local/share"),
      "herdr-homepage/extensions",
    );
  if (!path.isAbsolute(root))
    fail(
      "invalid_config",
      `HOMEPAGE_EXTENSIONS_DIR는 절대 경로여야 합니다: ${root}`,
    );
  return path.resolve(root);
}

const githubRepo = (url: string) =>
  /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(url) ??
  fail("invalid_extension_lock", `GitHub 저장소 주소가 아닙니다: ${url}`);
const relative = (p: unknown) =>
  typeof p === "string" &&
  /^[A-Za-z0-9._/-]+$/.test(p) &&
  p.split("/").every((s) => s && s !== "." && s !== "..");
const sha = (v: unknown) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);

export async function readExtensionLock(file = extensions.lockFile) {
  let lock: any;
  try {
    lock = JSON.parse(await fs.readFile(file, "utf8"));
  } catch (e: any) {
    fail(
      "invalid_extension_lock",
      `품질 확장 잠금 파일을 읽지 못했습니다: ${file} (${e.message})`,
    );
  }
  const bad = (why: string) =>
    fail("invalid_extension_lock", `품질 확장 잠금 파일 오류(${file}): ${why}`);
  if (lock?.schema_version !== 1 || !Array.isArray(lock.extensions))
    bad("schema_version 1과 extensions 배열이 필요합니다.");
  const names = new Set<string>();
  for (const e of lock.extensions as Extension[]) {
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(e?.name) || names.has(e.name))
      bad(`확장 이름이 올바르지 않거나 중복입니다: ${e?.name}`);
    names.add(e.name);
    githubRepo(e.repository);
    if (!/^[0-9a-f]{40}$/.test(e.commit))
      bad(`${e.name}: commit은 40자리 SHA여야 합니다.`);
    if (typeof e.version !== "string" || typeof e.license !== "string")
      bad(`${e.name}: version과 license가 필요합니다.`);
    if (
      !Array.isArray(e.files) ||
      !e.files.every((f) => relative(f?.path) && sha(f?.sha256))
    )
      bad(`${e.name}: files 항목이 올바르지 않습니다.`);
    if (!Array.isArray(e.skills) || !e.skills.length)
      bad(`${e.name}: skills가 비어 있습니다.`);
    for (const s of e.skills) {
      if (
        !/^[a-z0-9][a-z0-9-]{0,63}$/.test(s?.name) ||
        names.has(`skill:${s.name}`)
      )
        bad(`${e.name}: 스킬 이름이 올바르지 않거나 중복입니다: ${s?.name}`);
      names.add(`skill:${s.name}`);
      if (
        !relative(s.path) ||
        !sha(s.tree_sha256) ||
        !Number.isInteger(s.files) ||
        s.files < 1
      )
        bad(
          `${e.name}/${s.name}: path, files, tree_sha256이 올바르지 않습니다.`,
        );
      if (
        s.warmup !== undefined &&
        !(
          Array.isArray(s.warmup) &&
          ["sh", "node"].includes(s.warmup[0]) &&
          relative(s.warmup[1]) &&
          s.warmup.slice(2).every((a) => /^[A-Za-z0-9._=-]+$/.test(a))
        )
      )
        bad(
          `${e.name}/${s.name}: warmup은 [sh|node, 스킬 안의 스크립트, 인자...]여야 합니다.`,
        );
    }
  }
  return lock as { schema_version: 1; extensions: Extension[] };
}

const installDir = (e: Extension) =>
  path.join(extensionStore(), e.name, e.commit);
// install.json is written only after every hash matched; checks trust it.
async function installed(e: Extension) {
  try {
    const record = JSON.parse(
      await fs.readFile(path.join(installDir(e), "install.json"), "utf8"),
    );
    return (
      record.commit === e.commit &&
      e.skills.every((s) =>
        record.skills?.some(
          (r: any) => r.name === s.name && r.tree_sha256 === s.tree_sha256,
        ),
      )
    );
  } catch {
    return false;
  }
}

async function install(e: Extension) {
  const root = extensionStore();
  const staging = path.join(root, `.staging-${e.name}-${randomUUID()}`);
  await fs.mkdir(path.join(staging, "x"), { recursive: true, mode: 0o700 });
  try {
    const archive = path.join(staging, "archive.tar.gz");
    await extensions.download(e, archive);
    const top = `${githubRepo(e.repository)[2]}-${e.commit}`;
    const members = [
      ...e.skills.map((s) => s.path),
      ...e.files.map((f) => f.path),
    ];
    try {
      await exec(
        "tar",
        [
          "-xzf",
          archive,
          "-C",
          path.join(staging, "x"),
          ...members.map((m) => `${top}/${m}`),
        ],
        { timeout: 300_000, maxBuffer: 16 * 1024 * 1024 },
      );
    } catch (err: any) {
      fail(
        "extension_archive_invalid",
        `${e.name} 압축 파일에서 필요한 경로를 찾지 못했습니다: ${members.join(", ")} (${String(err.stderr ?? err.message).trim()})`,
      );
    }
    const from = path.join(staging, "x", top);
    const out = path.join(staging, "out");
    await fs.mkdir(path.join(out, "skills"), { recursive: true });
    for (const s of e.skills) {
      const dir = path.join(from, s.path);
      const head = await fs
        .readFile(path.join(dir, "SKILL.md"), "utf8")
        .catch(() => "");
      const name = /^---\n[\s\S]*?^name:\s*["']?([^"'\s]+)/m.exec(head)?.[1];
      if (name !== s.name)
        fail(
          "extension_hash_mismatch",
          `${e.name}/${s.path}/SKILL.md의 name(${name ?? "없음"})이 잠금 파일의 ${s.name}과 다릅니다.`,
        );
      const tree = await treeHash(dir);
      if (tree.sha256 !== s.tree_sha256 || tree.files !== s.files)
        fail(
          "extension_hash_mismatch",
          `${e.name}/${s.name} 내용이 잠금 파일과 다릅니다(파일 ${tree.files}개, ${tree.sha256}). 받은 파일을 쓰지 않았습니다.`,
        );
      await fs.rename(dir, path.join(out, "skills", s.name));
    }
    for (const f of e.files) {
      const file = path.join(from, f.path);
      if (hash(await fs.readFile(file)) !== f.sha256)
        fail(
          "extension_hash_mismatch",
          `${e.name}/${f.path} 내용이 잠금 파일과 다릅니다. 받은 파일을 쓰지 않았습니다.`,
        );
      await fs.mkdir(path.dirname(path.join(out, f.path)), { recursive: true });
      await fs.rename(file, path.join(out, f.path));
    }
    await atomic(
      path.join(out, "install.json"),
      JSON.stringify(
        {
          name: e.name,
          version: e.version,
          repository: e.repository,
          commit: e.commit,
          license: e.license,
          installed_at: new Date().toISOString(),
          skills: e.skills.map(({ name, files, tree_sha256 }) => ({
            name,
            files,
            tree_sha256,
          })),
        },
        null,
        2,
      ),
      0o644,
    );
    const target = installDir(e);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.rm(target, { recursive: true, force: true });
    await fs.rename(out, target);
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

// Optional first-run step of an upstream tool (impeccable fetches its
// checksum-verified engine). Failure is a warning; the skill still loads.
async function warmup(e: Extension, s: Skill) {
  if (!s.warmup) return null;
  const dir = path.join(installDir(e), "skills", s.name);
  const [program, script, ...args] = s.warmup;
  try {
    await exec(
      program === "node" ? process.execPath : "/bin/sh",
      [path.join(dir, script), ...args],
      { cwd: dir, timeout: 180_000 },
    );
    return null;
  } catch (err: any) {
    return `${e.name}/${s.name} 준비 단계(${s.warmup.join(" ")})가 실패했습니다: ${String(
      err.stderr || err.message,
    )
      .trim()
      .slice(0, 300)}. 스킬은 쓸 수 있고, 처음 쓸 때 다시 시도합니다.`;
  }
}

export async function syncExtensions() {
  const lock = await readExtensionLock();
  const results: SyncResult[] = [];
  for (const e of lock.extensions) {
    const base = { name: e.name, version: e.version, commit: e.commit };
    try {
      const present = await installed(e);
      if (!present) await install(e);
      const warnings = [];
      for (const s of e.skills) {
        const w = await warmup(e, s);
        if (w) warnings.push(w);
      }
      results.push({
        ...base,
        status: present ? "present" : "installed",
        warnings,
      });
    } catch (err: any) {
      results.push({
        ...base,
        status: "failed",
        code: err.code ?? "extension_sync_failed",
        detail: err.message,
      });
    }
  }
  return { store: extensionStore(), results };
}

export async function extensionStatus() {
  let lock;
  try {
    lock = await readExtensionLock();
  } catch (e: any) {
    return { available: false, code: e.code, warning: e.message };
  }
  const items = [];
  for (const e of lock.extensions)
    items.push({
      name: e.name,
      version: e.version,
      commit: e.commit,
      installed: await installed(e),
      skills: e.skills.map((s) => s.name),
    });
  const missing = items.filter((i) => !i.installed).map((i) => i.name);
  return {
    available: true,
    store: extensionStore(),
    extensions: items,
    missing,
    warning: missing.length
      ? `품질 확장이 설치되지 않았습니다: ${missing.join(", ")}. 실행은 막지 않지만 PM 세션에서 이 스킬을 쓸 수 없습니다. 플러그인 폴더에서 node dist/src/cli.js extensions sync를 실행하세요.`
      : null,
  };
}

// The native PM reads <project>/.claude: hooks stay off there, and installed
// extension skills are linked by name. Entries the broker did not create are
// left alone and reported.
export async function projectExtensions(directory: string) {
  const lock = await readExtensionLock();
  const root = extensionStore();
  const claude = path.join(directory, ".claude");
  const skillsDir = path.join(claude, "skills");
  await fs.mkdir(skillsDir, { recursive: true, mode: 0o700 });
  const settingsFile = path.join(claude, "settings.json");
  let settings: any = {};
  try {
    settings = JSON.parse(await fs.readFile(settingsFile, "utf8"));
  } catch (e: any) {
    if (e.code !== "ENOENT")
      fail(
        "project_settings_invalid",
        `프로젝트 Claude 설정을 읽지 못했습니다: ${settingsFile}. JSON을 고치거나 파일을 지운 뒤 다시 실행하세요.`,
      );
  }
  if (!settings || typeof settings !== "object" || Array.isArray(settings))
    fail(
      "project_settings_invalid",
      `프로젝트 Claude 설정이 JSON 객체가 아닙니다: ${settingsFile}`,
    );
  if (settings.disableAllHooks !== true) {
    settings.disableAllHooks = true;
    await atomic(settingsFile, JSON.stringify(settings, null, 2) + "\n", 0o644);
  }
  const wanted = new Map<string, string>();
  const skills: {
    extension: string;
    version: string;
    commit: string;
    name: string;
    tree_sha256: string;
  }[] = [];
  const warnings: string[] = [];
  for (const e of lock.extensions) {
    if (!(await installed(e))) {
      warnings.push(`${e.name}이 설치되지 않아 연결하지 않았습니다.`);
      continue;
    }
    for (const s of e.skills) {
      wanted.set(s.name, path.join(installDir(e), "skills", s.name));
      skills.push({
        extension: e.name,
        version: e.version,
        commit: e.commit,
        name: s.name,
        tree_sha256: s.tree_sha256,
      });
    }
  }
  const managed = async (file: string) => {
    const target = path.resolve(skillsDir, await fs.readlink(file));
    return target.startsWith(root + path.sep);
  };
  for (const entry of await fs.readdir(skillsDir, { withFileTypes: true })) {
    const file = path.join(skillsDir, entry.name);
    if (
      entry.isSymbolicLink() &&
      (await managed(file)) &&
      wanted.get(entry.name) !== (await fs.readlink(file))
    )
      await fs.rm(file);
  }
  for (const [name, target] of wanted) {
    const file = path.join(skillsDir, name);
    const st = await fs.lstat(file).catch(() => undefined);
    if (st?.isSymbolicLink() && (await fs.readlink(file)) === target) continue;
    if (st) {
      warnings.push(
        `.claude/skills/${name}이 이미 있어 확장 스킬을 연결하지 않았습니다.`,
      );
      const i = skills.findIndex((s) => s.name === name);
      if (i >= 0) skills.splice(i, 1);
      continue;
    }
    await fs.symlink(target, file, "dir");
  }
  const unmanaged = [
    ...(await fs.readdir(claude))
      .filter((n) => !["settings.json", "skills"].includes(n))
      .map((n) => `.claude/${n}`),
    ...(await fs.readdir(skillsDir))
      .filter((n) => !skills.some((s) => s.name === n))
      .map((n) => `.claude/skills/${n}`),
  ];
  return {
    setting_sources: "project",
    hooks: "disabled",
    store: root,
    skills,
    unmanaged,
    warnings,
  };
}
