#!/usr/bin/env python3
"""WCAG 2.x contrast ratios for colour pairs.

Usage: python3 contrast.py <fg> <bg> [<fg> <bg> ...]
Colours are #RGB or #RRGGBB (opaque only; flatten rgba() onto its real background first).
Prints ratio and AA verdicts: normal text 4.5, large text (24px, or 18.66px bold) and UI 3.0.
"""

import sys


def channel(v):
    v /= 255
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4


def luminance(hex_colour):
    h = hex_colour.strip().lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    if len(h) != 6:
        raise ValueError(hex_colour)
    r, g, b = (channel(int(h[i : i + 2], 16)) for i in (0, 2, 4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def main(argv):
    pairs = argv[1:]
    if not pairs or len(pairs) % 2:
        print("usage: contrast.py <fg> <bg> [<fg> <bg> ...]", file=sys.stderr)
        return 2
    for fg, bg in zip(pairs[::2], pairs[1::2]):
        try:
            a, b = sorted((luminance(fg), luminance(bg)))
        except ValueError:
            print(f"bad colour in pair {fg} {bg}", file=sys.stderr)
            return 2
        ratio = (b + 0.05) / (a + 0.05)
        text = "pass" if ratio >= 4.5 else "FAIL"
        large = "pass" if ratio >= 3.0 else "FAIL"
        print(f"{fg} on {bg}: {ratio:.2f}:1  text {text}  large/UI {large}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
