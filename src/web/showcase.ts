import fs from "node:fs/promises";
import path from "node:path";
import { listShots } from "./files.js";

// What the landing needs from a project. Only these fields are read, and the
// response below is built field by field, so no path, token, receipt or
// document content beyond the display name reaches the browser.
export interface ShowcaseProject {
  project_id: string;
  directory: string;
  run_id: string;
  status: string;
  created_at: string;
  preview: { status: string; url?: string };
}

const ACTIVE = [
  "starting",
  "running",
  "retrying",
  "cancelling",
  "waiting_input",
];
const ENDED = ["failed", "cancelled", "superseded"];
const runName = /^[a-zA-Z0-9_-]{1,128}$/;

// The PRD's first "# " heading without its subtitle or a trailing
// "홈페이지"/"PRD" word: "한결 식탁공방 — 공방 소개 홈페이지" → "한결 식탁공방".
export function displayName(prd: string, fallback: string) {
  const heading = prd
    .split("\n", 40)
    .map((l) => l.trim())
    .find((l) => /^#\s+\S/.test(l));
  if (!heading) return fallback;
  let name = heading
    .replace(/^#\s+/, "")
    .split(/\s+[—–·|-]\s+/)[0]
    .replace(/[*_`\u0000-\u001f\u007f]/g, "")
    .trim();
  for (let before = ""; before !== name; ) {
    before = name;
    name = name
      .replace(/\s*(?:홈페이지|웹사이트|랜딩\s*페이지|기업용|PRD)$/i, "")
      .trim();
  }
  return name ? name.slice(0, 48) : fallback;
}

async function nameOf(p: ShowcaseProject) {
  try {
    const file = await fs.open(path.join(p.directory, "prd.md"), "r");
    try {
      const { buffer, bytesRead } = await file.read({
        buffer: Buffer.alloc(4096),
      });
      return displayName(
        buffer.subarray(0, bytesRead).toString("utf8"),
        p.project_id,
      );
    } finally {
      await file.close();
    }
  } catch {
    return p.project_id;
  }
}

// Runs to look in: the current run first, then earlier runs on disk, so a
// project keeps its delivered screens while a feedback run is starting.
async function runsOf(p: ShowcaseProject) {
  let names: string[] = [];
  try {
    names = (
      await fs.readdir(path.join(p.directory, ".herdr/runs"), {
        withFileTypes: true,
      })
    )
      .filter((d) => d.isDirectory() && runName.test(d.name))
      .map((d) => d.name);
  } catch {}
  return [p.run_id, ...names.filter((n) => n !== p.run_id)];
}

// Cover = the newest `final` round of any run, else the newest round at all.
async function coverOf(p: ShowcaseProject) {
  type Round = Awaited<ReturnType<typeof listShots>>[number];
  let best: { run_id: string; rounds: number; round: Round } | null = null;
  const final = (r: Round) => r.round === "final";
  for (const run of await runsOf(p)) {
    const rounds = await listShots(p.directory, run);
    const pick = rounds.find(final) ?? rounds.at(-1);
    if (!pick) continue;
    if (
      !best ||
      (final(pick) && !final(best.round)) ||
      (final(pick) === final(best.round) && pick.at > best.round.at)
    )
      best = { run_id: run, rounds: rounds.length, round: pick };
  }
  return best;
}

export async function showcase(
  projects: ShowcaseProject[],
  preview: (status: string, url?: string) => string | null,
) {
  const items = [];
  for (const p of projects) {
    const cover = await coverOf(p);
    if (!cover) continue;
    const delivered = cover.round.round === "final";
    if (!delivered && ENDED.includes(p.status)) continue;
    const shot = (viewport: string, full: boolean) => {
      const f = cover.round.files.find(
        (x) => x.viewport === viewport && x.full === full,
      );
      return f ? { path: f.path, mtime: f.mtime } : null;
    };
    items.push({
      project_id: p.project_id,
      name: await nameOf(p),
      status: p.status,
      created_at: p.created_at,
      run_id: cover.run_id,
      round: cover.round.round,
      stage: cover.round.stage,
      at: cover.round.at,
      rounds: cover.rounds,
      delivered,
      shots: {
        desktop: shot("desktop", false),
        mobile: shot("mobile", false),
        desktop_full: shot("desktop", true),
        mobile_full: shot("mobile", true),
      },
      preview_url:
        cover.run_id === p.run_id
          ? preview(p.preview.status, p.preview.url)
          : null,
    });
  }
  // Delivered pages first, newest first within each group.
  items.sort(
    (a, b) =>
      Number(b.delivered) - Number(a.delivered) || b.at.localeCompare(a.at),
  );
  return {
    schema_version: 1,
    observed_at: new Date().toISOString(),
    summary: {
      projects: projects.length,
      showcased: items.length,
      delivered: items.filter((i) => i.delivered).length,
      active: projects.filter((p) => ACTIVE.includes(p.status)).length,
      queued: projects.filter((p) => p.status === "queued").length,
      review: projects.filter((p) => p.status === "review_pending").length,
      // Fixed by config.ts (maxProjects); repeated here for read-only servers.
      max_parallel: 2,
    },
    projects: items,
  };
}
