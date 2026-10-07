import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fail } from "../contracts/types.js";
import { hash } from "../storage/store.js";

const exec = promisify(execFile);
// dist/src/agents → repository root; Herdr plugin install builds inside the clone.
export const studio = {
  dir: fileURLToPath(
    new URL("../../../claude-plugin/homepage-studio", import.meta.url),
  ),
};
export const studioAgents = [
  "homepage-developer",
  "homepage-designer",
  "homepage-copywriter",
].map((name) => `homepage-studio:${name}`);
const required = [
  ".claude-plugin/plugin.json",
  "agents/homepage-developer.md",
  "agents/homepage-designer.md",
  "agents/homepage-copywriter.md",
  "skills/homepage-studio/SKILL.md",
  "skills/frontend-design/SKILL.md",
  "skills/korean-copywriting/SKILL.md",
  "skills/korean-typography/SKILL.md",
  "skills/asset-kit/SKILL.md",
  "skills/quality-gate/SKILL.md",
  "skills/seo-basics/SKILL.md",
  "skills/quality-gate/scripts/check_page.py",
  "skills/quality-gate/scripts/contrast.py",
  "skills/korean-typography/scripts/page_text.py",
  "skills/korean-typography/scripts/font_css.py",
  "skills/asset-kit/scripts/receipts_check.py",
  "skills/asset-kit/scripts/make_web.sh",
  "skills/asset-kit/scripts/hero_video.sh",
  "skills/asset-kit/scripts/favicons.sh",
  "skills/asset-kit/scripts/contact_sheet.sh",
];

// Native PM launches never fall back to running without the plugin.
export async function studioPlugin(dir = studio.dir) {
  for (const file of required)
    try {
      if (!(await fs.stat(path.join(dir, file))).isFile())
        throw new Error("not a file");
    } catch {
      fail(
        "studio_plugin_missing",
        `homepage-studio 플러그인 파일이 없습니다: ${path.join(dir, file)}. 플러그인을 다시 설치하거나 저장소의 claude-plugin/ 폴더를 복구하세요.`,
      );
    }
  let manifest: any;
  try {
    manifest = JSON.parse(
      await fs.readFile(path.join(dir, required[0]), "utf8"),
    );
  } catch {}
  if (
    manifest?.name !== "homepage-studio" ||
    typeof manifest.version !== "string"
  )
    fail(
      "studio_plugin_missing",
      `homepage-studio 플러그인 설정(plugin.json)의 name 또는 version이 올바르지 않습니다: ${path.join(dir, required[0])}`,
    );
  return { name: "homepage-studio", version: manifest.version, path: dir };
}

// sha256 over sorted "<file sha256>  <relative path>" lines of every file.
export async function treeHash(root: string) {
  const files: string[] = [];
  const walk = async (dir: string) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if ([".DS_Store", "__pycache__"].includes(entry.name)) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile())
        files.push(path.relative(root, file).split(path.sep).join("/"));
      else
        fail(
          "unsafe_path",
          `플러그인 폴더에는 일반 파일과 폴더만 둘 수 있습니다: ${file}`,
        );
    }
  };
  await walk(root);
  const lines = [];
  for (const file of files.sort())
    lines.push(`${hash(await fs.readFile(path.join(root, file)))}  ${file}\n`);
  return { files: files.length, sha256: hash(lines.join("")) };
}

const tools = [
  "ffmpeg",
  "ffprobe",
  "cwebp",
  "avifenc",
  "magick",
  "rsvg-convert",
  "pyftsubset",
];
async function onPath(name: string, env: NodeJS.ProcessEnv) {
  for (const dir of (env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    const file = path.join(dir, name);
    try {
      if (!(await fs.stat(file)).isFile()) continue;
      await fs.access(file, fs.constants.X_OK);
      return file;
    } catch {}
  }
}

// Advisory only: skills degrade without these tools; never installs or blocks.
export async function studioTools(env = process.env) {
  const missing: string[] = [];
  const python = await onPath("python3", env);
  let playwright = false;
  if (python)
    try {
      await exec(python, ["-c", "import playwright.sync_api"], {
        cwd: "/",
        env,
        timeout: 5000,
      });
      playwright = true;
    } catch {}
  if (!playwright) missing.push("python3 playwright");
  for (const name of tools) if (!(await onPath(name, env))) missing.push(name);
  return {
    missing,
    warning: missing.length
      ? `homepage-studio 보조 도구가 없습니다: ${missing.join(", ")}. 실행은 막지 않지만 자동 검사나 이미지·영상·폰트 처리 단계가 생략되거나 품질이 낮아질 수 있습니다. 도구는 자동으로 설치하지 않습니다.`
      : null,
  };
}
export async function studioDoctor(env = process.env) {
  let plugin: any;
  try {
    plugin = { available: true, ...(await studioPlugin()) };
  } catch (e: any) {
    plugin = { available: false, code: e.code, detail: e.message };
  }
  return { plugin, tools: await studioTools(env) };
}
