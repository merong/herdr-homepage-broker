#!/usr/bin/env python3
"""Copy a web font package's @font-face rules and woff2 files into the site, trimmed.

Usage:
  python3 font_css.py --out <fonts_dir> --weights 400,700 [--name fonts.css]
                      [--license LICENSE_FILE] <package.css> [<package.css> ...]

For each @font-face block in the input CSS files:
- keeps the block only if its font-weight (or weight range) includes a requested weight;
- keeps only woff2 url() sources and drops local() (screenshots must use the shipped file);
- forces font-display: swap;
- copies each referenced woff2 file into <fonts_dir> and rewrites the url to ./<file>.
A leading copyright/license comment in an input CSS is kept.
Writes <fonts_dir>/<name> (default fonts.css) and copies each --license file (repeatable).
Prints a JSON summary. Exit 2 on bad arguments or a missing referenced file.
"""

import argparse
import json
import re
import shutil
import sys
from pathlib import Path

FACE = re.compile(r"@font-face\s*\{[^}]*\}", re.S)
URL = re.compile(r"url\(\s*['\"]?([^'\")]+)['\"]?\s*\)\s*format\(\s*['\"]?([\w-]+)['\"]?\s*\)")


def weight_ok(block, weights):
    m = re.search(r"font-weight\s*:\s*(\d+)(?:\s+(\d+))?", block)
    if not m:
        return 400 in weights
    lo = int(m.group(1))
    hi = int(m.group(2) or lo)
    return any(lo <= w <= hi for w in weights)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--weights", required=True, help="comma separated, e.g. 400,700")
    ap.add_argument("--name", default="fonts.css")
    ap.add_argument("--license", action="append", default=[])
    ap.add_argument("css", nargs="+")
    args = ap.parse_args()

    try:
        weights = [int(w) for w in args.weights.split(",") if w.strip()]
    except ValueError:
        print(f"bad --weights: {args.weights}", file=sys.stderr)
        return 2
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    kept, dropped, copied, total = [], 0, set(), 0

    for css_path in map(Path, args.css):
        if not css_path.is_file():
            print(f"missing css: {css_path}", file=sys.stderr)
            return 2
        text = css_path.read_text(encoding="utf-8")
        head = re.match(r"\s*(/\*.*?\*/)", text, re.S)
        if head and re.search(r"copyright|license", head.group(1), re.I) and head.group(1) not in kept:
            kept.append(head.group(1))
        for block in FACE.findall(text):
            if not weight_ok(block, weights):
                dropped += 1
                continue
            urls = [u for u, fmt in URL.findall(block) if fmt.lower() == "woff2"]
            if not urls:
                dropped += 1
                continue
            for u in urls:
                src = (css_path.parent / u).resolve()
                if not src.is_file():
                    print(f"missing font file: {src}", file=sys.stderr)
                    return 2
                if src.name not in copied:
                    shutil.copy2(src, out / src.name)
                    copied.add(src.name)
                    total += src.stat().st_size
            src_decl = "src: " + ", ".join(f"url('./{Path(u).name}') format('woff2')" for u in urls) + ";"
            body = re.sub(r"src\s*:[^;]*;", src_decl, block, count=1)
            body = re.sub(r"\s*font-display\s*:[^;]*;", "", body)
            body = body.replace(src_decl, "font-display: swap;\n  " + src_decl, 1)
            kept.append(body)

    (out / args.name).write_text("\n".join(kept) + "\n", encoding="utf-8")
    for lic in args.license:
        shutil.copy2(lic, out / Path(lic).name)

    print(json.dumps({
        "css": str(out / args.name),
        "faces_kept": sum(1 for k in kept if k.startswith("@font-face")),
        "faces_dropped": dropped,
        "files_copied": len(copied),
        "bytes_copied": total,
        "licenses": [Path(lic).name for lic in args.license],
    }, ensure_ascii=False, indent=2))
    return 0 if any(k.startswith("@font-face") for k in kept) else 2


if __name__ == "__main__":
    sys.exit(main())
