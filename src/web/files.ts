import fs from "node:fs/promises";
import path from "node:path";

// Only plain names: no separators, no leading dot (so no "." / ".." / dotfiles).
const segment = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/;
const imageTypes: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
};
const MAX_IMAGE = 16 * 1024 * 1024;
const shotFiles = [
  "desktop.png",
  "mobile.png",
  "desktop-full.png",
  "mobile-full.png",
];

export const runDir = (directory: string, runId: string) =>
  path.join(directory, ".herdr/runs", runId);

// look.py rounds per SKILL.md: first-screen 1–2, build-out 3+, then final.
export const shotStage = (round: string) =>
  round === "final"
    ? "final"
    : Number(round) <= 2
      ? "first-screen"
      : "build-out";
const order = (round: string) => (round === "final" ? Infinity : Number(round));

async function stat(file: string) {
  try {
    const s = await fs.stat(file);
    return s.isFile() ? s : null;
  } catch {
    return null;
  }
}

async function names(dir: string) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

// Screenshots are the ones look.py already writes to reports/look/<round>/,
// so runs started before the dashboard existed get thumbnails too.
export async function listShots(directory: string, runId: string) {
  const base = path.join(runDir(directory, runId), "reports/look");
  const rounds = (await names(base))
    .filter((d) => d.isDirectory() && /^(?:\d{1,3}|final)$/.test(d.name))
    .map((d) => d.name)
    .sort((a, b) => order(a) - order(b));
  const out = [];
  for (const round of rounds) {
    const files = [];
    for (const name of shotFiles) {
      const s = await stat(path.join(base, round, name));
      if (s)
        files.push({
          name,
          path: `${runId}/${round}/${name}`,
          viewport: name.startsWith("desktop") ? "desktop" : "mobile",
          full: name.includes("-full"),
          size: s.size,
          mtime: s.mtime.toISOString(),
        });
    }
    if (!files.length) continue;
    let verdict: string | null = null;
    try {
      verdict = (
        await fs.readFile(path.join(base, round, "verdict.md"), "utf8")
      )
        .trim()
        .slice(0, 1200);
    } catch {}
    out.push({
      round,
      stage: shotStage(round),
      at: files
        .map((f) => f.mtime)
        .sort()
        .at(-1)!,
      verdict,
      files,
    });
  }
  return out;
}

// Generated images live in the run's assets/ write root.
export async function listAssets(directory: string, runId: string) {
  const base = path.join(runDir(directory, runId), "assets");
  const out = [];
  for (const d of await names(base)) {
    if (!d.isFile() || !segment.test(d.name)) continue;
    if (!imageTypes[path.extname(d.name).toLowerCase()]) continue;
    const s = await stat(path.join(base, d.name));
    if (s)
      out.push({
        name: d.name,
        path: `${runId}/${d.name}`,
        size: s.size,
        mtime: s.mtime.toISOString(),
      });
  }
  return out.sort((a, b) => a.mtime.localeCompare(b.mtime));
}

// Resolves a whitelisted image strictly inside root. Symlinks that escape the
// root, non-image extensions, odd names and oversized files all resolve to null.
export async function resolveImage(root: string, segments: string[]) {
  if (!segments.length || segments.some((s) => !segment.test(s))) return null;
  const type = imageTypes[path.extname(segments.at(-1)!).toLowerCase()];
  if (!type) return null;
  try {
    const realRoot = await fs.realpath(root);
    const real = await fs.realpath(path.join(root, ...segments));
    if (!real.startsWith(realRoot + path.sep)) return null;
    const s = await stat(real);
    if (!s || s.size > MAX_IMAGE) return null;
    return { file: real, type, size: s.size };
  } catch {
    return null;
  }
}
