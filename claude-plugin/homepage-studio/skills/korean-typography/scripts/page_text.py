#!/usr/bin/env python3
"""Collect the characters a static build renders, for font subsetting and coverage checks.

Usage:
  python3 page_text.py <dist_dir> [--extra FILE ...] [--out chars.txt] [--check FONT ...]

- Reads every *.html under <dist_dir>: text nodes (script/style/template skipped) and
  the attributes alt, title, placeholder, aria-label, value.
- --extra adds the raw text of other files (for example reports/copy-deck.md).
- --out writes the unique characters as one UTF-8 line (pyftsubset --text-file input).
  Printable ASCII (U+0020-007E) is always included.
- --check loads one or more font files (all slices of one family/weight) with fontTools
  and lists characters none of them map. Exit status stays 0; read the printed counts.
"""

import argparse
import json
import sys
import unicodedata
from html.parser import HTMLParser
from pathlib import Path

SKIP = {"script", "style", "template"}
ATTRS = {"alt", "title", "placeholder", "aria-label", "value"}


class Collector(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.depth = 0
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag in SKIP:
            self.depth += 1
        for name, value in attrs:
            if name in ATTRS and value:
                self.parts.append(value)

    def handle_endtag(self, tag):
        if tag in SKIP and self.depth:
            self.depth -= 1

    def handle_data(self, data):
        if not self.depth:
            self.parts.append(data)


def visible(ch):
    return not unicodedata.category(ch).startswith(("C", "Z")) or ch == " "


def collect(dist, extras):
    chars = {chr(c) for c in range(0x20, 0x7F)}
    pages = sorted(Path(dist).rglob("*.html"))
    for page in pages:
        parser = Collector()
        parser.feed(page.read_text(encoding="utf-8", errors="replace"))
        chars.update(ch for part in parser.parts for ch in part if visible(ch))
    for extra in extras:
        text = Path(extra).read_text(encoding="utf-8", errors="replace")
        chars.update(ch for ch in text if visible(ch))
    return pages, chars


def coverage(fonts, chars):
    try:
        from fontTools.ttLib import TTFont
    except ImportError:
        return {"skipped": "fontTools unavailable"}
    mapped = set()
    for font in fonts:
        mapped.update(TTFont(font, lazy=True).getBestCmap().keys())
    missing = sorted(ch for ch in chars if ord(ch) not in mapped and ch != " ")
    hangul = [ch for ch in missing if 0xAC00 <= ord(ch) <= 0xD7A3]
    return {
        "fonts": len(fonts),
        "missing_total": len(missing),
        "missing_hangul": "".join(hangul),
        "missing_other": " ".join(f"U+{ord(ch):04X}" for ch in missing if ch not in hangul),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dist_dir")
    ap.add_argument("--extra", nargs="*", default=[])
    ap.add_argument("--out")
    ap.add_argument("--check", nargs="*", default=[])
    args = ap.parse_args()
    if not Path(args.dist_dir).is_dir():
        print(f"not a directory: {args.dist_dir}", file=sys.stderr)
        return 2
    pages, chars = collect(args.dist_dir, args.extra)
    summary = {
        "pages": len(pages),
        "chars": len(chars),
        "hangul_syllables": sum(1 for ch in chars if 0xAC00 <= ord(ch) <= 0xD7A3),
    }
    if args.out:
        Path(args.out).write_text("".join(sorted(chars)) + "\n", encoding="utf-8")
        summary["out"] = args.out
    if args.check:
        summary["coverage"] = coverage(args.check, chars)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
