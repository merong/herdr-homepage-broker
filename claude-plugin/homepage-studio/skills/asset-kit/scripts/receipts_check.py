#!/usr/bin/env python3
"""Check assets/media-receipts.json against the files on disk.

Usage: python3 receipts_check.py <assets_dir>

Reports (JSON on stdout):
- budget use: images and videos counted the same way as the asset-kit skill;
- jobs whose outcome is open (submitting, submitted, unknown);
- listed files that are missing or whose sha256 differs;
- prompt files whose sha256 differs from prompt_sha256;
- files under web/ that no receipt entry lists.
Exit 0 when the check ran (read "problems"), 2 when the receipts file is missing or not JSON.
"""

import hashlib
import json
import sys
from pathlib import Path

SCHEMA = "homepage-studio/media-receipts@1"
STATUSES = {"submitting", "submitted", "completed", "failed", "unknown"}
OPEN = {"submitting", "submitted", "unknown"}


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main(argv):
    if len(argv) != 2:
        print("usage: receipts_check.py <assets_dir>", file=sys.stderr)
        return 2
    root = Path(argv[1])
    path = root / "media-receipts.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        print(f"cannot read {path}: {e}", file=sys.stderr)
        return 2

    problems, listed = [], set()
    if data.get("schema") != SCHEMA:
        problems.append(f"schema is {data.get('schema')!r}, expected {SCHEMA!r}")

    def check_file(entry, where):
        p = entry.get("path")
        if not p:
            problems.append(f"{where}: entry without path")
            return
        listed.add(Path(p).as_posix())
        f = root / p
        if not f.is_file():
            problems.append(f"{where}: missing file {p}")
        elif entry.get("sha256") != sha256(f):
            problems.append(f"{where}: sha256 mismatch for {p}")

    used = {"images": 0, "videos": 0}
    open_jobs = []
    for i, job in enumerate(data.get("jobs", [])):
        where = f"jobs[{i}] {job.get('asset_id', '?')}"
        status = job.get("status")
        if status not in STATUSES:
            problems.append(f"{where}: status {status!r} is not one of {sorted(STATUSES)}")
        if status in OPEN:
            open_jobs.append({"asset_id": job.get("asset_id"), "status": status,
                              "provider_job_id": job.get("provider_job_id")})
        if status == "completed":
            if not job.get("provider_job_id"):
                problems.append(f"{where}: completed without provider_job_id")
            if not job.get("outputs"):
                problems.append(f"{where}: completed without outputs")
        if job.get("counts_toward_budget", True) and status != "failed":
            key = "videos" if job.get("kind") == "video" else "images"
            used[key] += int(job.get("count") or 1)
        for out in job.get("outputs", []):
            check_file(out, where)
        pf, ps = job.get("prompt_file"), job.get("prompt_sha256")
        if pf:
            if not (root / pf).is_file():
                problems.append(f"{where}: missing prompt file {pf}")
            elif ps and ps != sha256(root / pf):
                problems.append(f"{where}: prompt_sha256 mismatch for {pf}")

    for i, d in enumerate(data.get("derivatives", [])):
        check_file(d, f"derivatives[{i}]")
    for i, a in enumerate(data.get("local_assets", [])):
        for f in a.get("files", []):
            check_file(f, f"local_assets[{i}] {a.get('asset_id', '?')}")

    budget = data.get("budget", {})
    for key in ("images", "videos"):
        limit = budget.get(key)
        if isinstance(limit, int) and used[key] > limit:
            problems.append(f"budget: {used[key]} {key} used, limit {limit}")

    web = root / "web"
    unlisted = sorted(
        p.relative_to(root).as_posix()
        for p in web.rglob("*")
        if p.is_file() and p.name != ".DS_Store" and p.relative_to(root).as_posix() not in listed
    ) if web.is_dir() else []
    if unlisted:
        problems.append(f"web/: {len(unlisted)} file(s) not listed in receipts")

    print(json.dumps({
        "receipts": str(path),
        "budget": budget,
        "used": used,
        "open_jobs": open_jobs,
        "unlisted_web_files": unlisted[:50],
        "problems": problems,
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
