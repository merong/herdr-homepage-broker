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
export const lookScript = "skills/homepage-studio/scripts/look.py";
const required = [
  ".claude-plugin/plugin.json",
  "skills/homepage-studio/SKILL.md",
  "skills/frontend-design/SKILL.md",
  lookScript,
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

// The PM pane starts Claude from the user's interactive login shell, whose
// profile may put a different python3 first than the broker's inherited PATH.
// Resolve tools the same way; fall back to PATH when the shell gives no answer.
const shellCache = new Map<string, { at: number; tools: ShellTools }>();
type ShellTools = { python3?: string; cwebp?: string };
async function loginShellTools(env: NodeJS.ProcessEnv) {
  const shell = env.SHELL;
  if (!shell || !path.isAbsolute(shell)) return;
  const key = [shell, env.HOME, env.PATH].join("\0");
  const hit = shellCache.get(key);
  if (hit && Date.now() - hit.at < 600_000) return hit.tools;
  try {
    const run = exec(
      shell,
      [
        "-l",
        "-i",
        "-c",
        // Leading newline: profile output without one must not hide the marker.
        'printf "\\n%s\\n" "__homepage_python3=$(command -v python3)" "__homepage_cwebp=$(command -v cwebp)"',
      ],
      { cwd: env.HOME || "/", env, timeout: 5000 },
    );
    run.child.stdin?.end();
    const { stdout } = await run;
    const found = (name: string) =>
      new RegExp(`^__homepage_${name}=(/.*)$`, "m").exec(stdout)?.[1].trim();
    if (!/^__homepage_python3=/m.test(stdout)) return;
    const tools = { python3: found("python3"), cwebp: found("cwebp") };
    shellCache.set(key, { at: Date.now(), tools });
    return tools;
  } catch {}
}

// Advisory only: never installs or blocks. look.py needs Python Playwright;
// cwebp is optional because images.md falls back to macOS sips.
export async function studioTools(env = process.env) {
  const shell = await loginShellTools(env);
  const python = shell ? shell.python3 : await onPath("python3", env);
  const cwebp = shell ? shell.cwebp : await onPath("cwebp", env);
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
  const missing = playwright ? [] : ["python3 playwright"];
  const resolved_by = shell ? "login-shell" : "path";
  const where = shell
    ? `PM pane과 같은 로그인 셸(${env.SHELL})에서 확인한 python3: ${python ?? "없음"}.`
    : `브로커 PATH에서 확인한 python3: ${python ?? "없음"}. PM pane의 로그인 셸 환경과 결과가 다를 수 있습니다.`;
  return {
    python3: python ?? null,
    resolved_by,
    missing,
    optional_missing: cwebp ? [] : ["cwebp"],
    warning: missing.length
      ? `homepage-studio 보조 도구가 없습니다: ${missing.join(", ")}. ${where} 실행은 막지 않지만 PM이 look.py로 화면을 캡처하지 못해 스크린샷 확인 단계가 생략될 수 있습니다. 도구는 자동으로 설치하지 않습니다. 설치 예: python3 -m pip install playwright && python3 -m playwright install chromium`
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
