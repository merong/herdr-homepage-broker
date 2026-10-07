#!/usr/bin/env python3
"""Screenshots and cheap page facts for a localhost homepage preview.

Usage: python3 look.py <url> <outdir> [--reduced-motion]

Writes into <outdir>:
  desktop.png       1440x900 first viewport
  desktop-full.png  full page at 1440 wide
  mobile.png        390x844 first viewport (mobile emulation, 2x)
  mobile-full.png   full page at 390 wide (CSS pixels)
  parts/            the full pages cut into readable slices
  issues.json       horizontal overflow, console/page errors, failed or
                    HTTP >= 400 requests, broken images, non-local requests

Before the full-page capture the page is scrolled to the bottom in steps
(wakes lazy images and scroll reveals) and back to the top.
--reduced-motion emulates prefers-reduced-motion: reduce.

Exit codes: 0 when the page was captured, even with issues; 1 when the page
did not load; 2 for bad arguments or a URL that is not on this machine;
3 when Playwright or its Chromium is not installed.
"""
import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from urllib.parse import urlsplit

LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}
CAP = 20
MAX_FULL_HEIGHT = 16000  # CSS px; taller captures are cut and flagged.
PART_VIEWPORTS = 2  # each slice in parts/ is two viewport heights.
MOBILE_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
)
VIEWPORTS = [
    ("desktop", {"viewport": {"width": 1440, "height": 900}}),
    (
        "mobile",
        {
            "viewport": {"width": 390, "height": 844},
            "device_scale_factor": 2,
            "is_mobile": True,
            "has_touch": True,
            "user_agent": MOBILE_UA,
        },
    ),
]

SCROLL_JS = r"""
async (budgetMs) => {
  const started = Date.now();
  const step = Math.max(200, Math.floor(window.innerHeight * 0.75));
  let y = 0;
  while (Date.now() - started < budgetMs) {
    const bottom = document.documentElement.scrollHeight - window.innerHeight;
    if (y >= bottom) break;
    y = Math.min(y + step, bottom);
    window.scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 140));
  }
  await new Promise((r) => setTimeout(r, 500));
  const pending = Array.from(document.images).filter((i) => !i.complete);
  await Promise.race([
    Promise.all(pending.map((i) => new Promise((r) => {
      i.addEventListener("load", r, { once: true });
      i.addEventListener("error", r, { once: true });
    }))),
    new Promise((r) => setTimeout(r, 3000)),
  ]);
  window.scrollTo(0, 0);
  await new Promise((r) => setTimeout(r, 400));
  return { scrolled_to: y, timed_out: Date.now() - started >= budgetMs };
}
"""

COLLECT_JS = r"""
({ width, cap }) => {
  const describe = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += "#" + el.id;
    const cls = typeof el.className === "string"
      ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 3) : [];
    if (cls.length) s += "." + cls.join(".");
    return s;
  };
  const rendered = (el) => el.getClientRects().length > 0;
  const scrollWidth = document.documentElement.scrollWidth;
  const overflowing = scrollWidth > width;
  const offenders = [];
  if (overflowing && document.body) {
    const clipped = (el) => {
      for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement)
        if (getComputedStyle(p).overflowX !== "visible") return true;
      return false;
    };
    const marked = new Set();
    for (const el of document.body.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || (r.right <= width + 1 && r.left >= -1)) continue;
      if (getComputedStyle(el).position === "fixed" || clipped(el)) continue;
      marked.add(el);
      if (el.parentElement && marked.has(el.parentElement)) continue;
      offenders.push({ element: describe(el), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) });
    }
  }
  const src = (i) => i.currentSrc || i.getAttribute("src") || describe(i);
  const images = Array.from(document.images).filter(rendered);
  const broken = images.filter((i) => i.complete && i.naturalWidth === 0).map((i) => ({ src: src(i), alt: i.getAttribute("alt") }));
  const unloaded = images.filter((i) => !i.complete).map(src);
  return {
    title: document.title || null,
    page_height: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0),
    viewport_meta: !!document.querySelector("meta[name='viewport']"),
    overflow: { overflowing, scroll_width: scrollWidth, viewport_width: width, elements: offenders.slice(0, cap), elements_total: offenders.length },
    images_rendered: images.length,
    broken_images: broken.slice(0, cap),
    broken_images_total: broken.length,
    unloaded_images: unloaded.slice(0, cap),
    unloaded_images_total: unloaded.length,
  };
}
"""


def local(url):
    try:
        u = urlsplit(url)
        u.port
    except ValueError:
        return False
    return (
        u.scheme in ("http", "https")
        and u.hostname in LOCAL_HOSTS
        and u.username is None
        and u.password is None
    )


def first_line(e, limit=300):
    return ((str(e).strip().splitlines() or [""])[0])[:limit]


def capture(browser, name, options, url, out, reduced):
    ctx = browser.new_context(
        reduced_motion="reduce" if reduced else "no-preference", **options
    )
    page = ctx.new_page()
    width = options["viewport"]["width"]
    height = options["viewport"]["height"]
    console, page_errors, failed, http, external = [], [], [], [], {}

    def on_console(m):
        if m.type == "error":
            console.append({"text": m.text[:500], "location": m.location})

    def on_request(r):
        host = urlsplit(r.url).hostname
        if host and host not in LOCAL_HOSTS:
            external.setdefault(host, r.url[:300])

    def on_failed(r):
        error = r.failure or ""
        # Media elements cancel range requests on purpose.
        if r.resource_type == "media" and "ERR_ABORTED" in error:
            return
        failed.append({"url": r.url[:300], "error": error})

    def on_response(r):
        if r.status >= 400:
            http.append({"url": r.url[:300], "status": r.status})

    page.on("console", on_console)
    page.on("pageerror", lambda e: page_errors.append(first_line(e, 500)))
    page.on("request", on_request)
    page.on("requestfailed", on_failed)
    page.on("response", on_response)
    result = {"width": width, "height": height}
    started = time.monotonic()
    try:
        try:
            response = page.goto(url, wait_until="load", timeout=15000)
        except Exception as e:
            result["load_error"] = first_line(e)
            return result
        result["status"] = response.status if response else None
        if response is not None and response.status >= 400:
            result["load_error"] = f"HTTP {response.status}"
            return result
        try:
            page.wait_for_load_state("networkidle", timeout=3000)
        except Exception:
            result["networkidle"] = False
        page.evaluate(
            "() => document.fonts ? Promise.race([document.fonts.ready,"
            " new Promise((r) => setTimeout(r, 2000))]) : null"
        )
        page.wait_for_timeout(800)  # let entrance motion settle
        page.screenshot(path=os.path.join(out, f"{name}.png"))
        result["scroll"] = page.evaluate(SCROLL_JS, 8000)
        facts = page.evaluate(COLLECT_JS, {"width": width, "cap": CAP})
        result.update(facts)
        full_height = max(1, min(facts["page_height"], MAX_FULL_HEIGHT))
        result["full_page_truncated"] = facts["page_height"] > MAX_FULL_HEIGHT
        clip = {"x": 0, "y": 0, "width": width, "height": full_height}
        page.screenshot(
            path=os.path.join(out, f"{name}-full.png"),
            full_page=True,
            clip=clip,
            scale="css",
        )
        parts, part = [], height * PART_VIEWPORTS
        os.makedirs(os.path.join(out, "parts"), exist_ok=True)
        for i, y in enumerate(range(0, full_height, part), start=1):
            file = os.path.join("parts", f"{name}-{i:02d}.png")
            page.screenshot(
                path=os.path.join(out, file),
                full_page=True,
                clip={"x": 0, "y": y, "width": width, "height": min(part, full_height - y)},
                scale="css",
            )
            parts.append(file)
        result["screenshots"] = {
            "first": f"{name}.png",
            "full": f"{name}-full.png",
            "parts": parts,
        }
    except Exception as e:
        result["capture_error"] = first_line(e)
    finally:
        result["load_ms"] = round((time.monotonic() - started) * 1000)
        result["console_errors"] = console[:CAP]
        result["console_errors_total"] = len(console)
        result["page_errors"] = page_errors[:CAP]
        result["page_errors_total"] = len(page_errors)
        result["failed_requests"] = failed[:CAP]
        result["failed_requests_total"] = len(failed)
        result["http_errors"] = http[:CAP]
        result["http_errors_total"] = len(http)
        result["external_requests"] = [
            {"host": h, "example": u} for h, u in sorted(external.items())
        ]
        ctx.close()
    return result


def summarize(report):
    issues = []
    for name, v in report["viewports"].items():
        if "load_error" in v:
            issues.append(f"{name}: page did not load ({v['load_error'][:160]})")
            continue
        if "skipped" in v:
            continue
        if "capture_error" in v:
            issues.append(f"{name}: capture failed ({v['capture_error'][:160]})")
        o = v.get("overflow", {})
        if o.get("overflowing"):
            worst = ", ".join(e["element"] for e in o["elements"][:3])
            issues.append(
                f"{name}: horizontal overflow {o['scroll_width']}px > {o['viewport_width']}px"
                + (f" ({worst})" if worst else "")
            )
        for key, label in [
            ("console_errors_total", "console errors"),
            ("page_errors_total", "uncaught page errors"),
            ("failed_requests_total", "failed requests"),
            ("http_errors_total", "HTTP >= 400 responses"),
            ("broken_images_total", "broken images"),
        ]:
            if v.get(key):
                issues.append(f"{name}: {v[key]} {label}")
        if v.get("external_requests"):
            hosts = [e["host"] for e in v["external_requests"]]
            issues.append(
                f"{name}: requests to non-local hosts ({', '.join(hosts[:5])})"
            )
        if name == "mobile" and v.get("viewport_meta") is False:
            issues.append("mobile: missing <meta name=viewport>")
    return issues


def write(out, report):
    with open(os.path.join(out, "issues.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
        f.write("\n")


def main(argv):
    parser = argparse.ArgumentParser(
        prog="look.py",
        description="Capture desktop/mobile screenshots and page issues of a local preview.",
    )
    parser.add_argument("url", help="preview URL on 127.0.0.1 or localhost")
    parser.add_argument("outdir", help="directory for the screenshots and issues.json")
    parser.add_argument(
        "--reduced-motion",
        action="store_true",
        help="emulate prefers-reduced-motion: reduce",
    )
    args = parser.parse_args(argv[1:])
    if not local(args.url):
        print(
            "look.py: 이 컴퓨터의 미리보기 주소만 받습니다 / only http(s)://127.0.0.1 or localhost URLs are accepted",
            file=sys.stderr,
        )
        return 2
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        exe = sys.executable or "python3"
        print(
            f"look.py: 이 python3({exe})에 Playwright가 없습니다 / Playwright for Python is not installed for {exe}.\n"
            f"  설치 / install: {exe} -m pip install playwright && {exe} -m playwright install chromium",
            file=sys.stderr,
        )
        return 3
    out = os.path.abspath(args.outdir)
    os.makedirs(out, exist_ok=True)
    report = {
        "tool": "homepage-studio/look.py",
        "version": 1,
        "url": args.url,
        "checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "reduced_motion": args.reduced_motion,
        "viewports": {},
    }
    started = time.monotonic()
    with sync_playwright() as p:
        try:
            browser = p.chromium.launch()
        except Exception as e:
            print(
                "look.py: Playwright Chromium을 시작할 수 없습니다 / cannot launch Playwright Chromium: "
                f"{first_line(e)}\n  설치 / install: {sys.executable or 'python3'} -m playwright install chromium",
                file=sys.stderr,
            )
            return 3
        try:
            for name, options in VIEWPORTS:
                if any("load_error" in v for v in report["viewports"].values()):
                    report["viewports"][name] = {"skipped": "page did not load"}
                    continue
                report["viewports"][name] = capture(
                    browser, name, options, args.url, out, args.reduced_motion
                )
        finally:
            browser.close()
    report["seconds"] = round(time.monotonic() - started, 1)
    report["issues"] = summarize(report)
    report["issue_count"] = len(report["issues"])
    write(out, report)
    failed = [n for n, v in report["viewports"].items() if "load_error" in v]
    if failed:
        print(f"look: {args.url} did not load ({report['viewports'][failed[0]]['load_error']})")
        print(f"look: details -> {os.path.join(out, 'issues.json')}")
        return 1
    print(
        f"look: {args.url} in {report['seconds']}s"
        f" (reduced motion: {'on' if args.reduced_motion else 'off'})"
    )
    for name, v in report["viewports"].items():
        shots = v.get("screenshots", {})
        height = v.get("page_height")
        line = f"  {name} {v['width']}x{v['height']}: page {height}px"
        if v.get("full_page_truncated"):
            line += f" (full capture cut at {MAX_FULL_HEIGHT}px)"
        if shots:
            line += f", {shots['first']}, {shots['full']}, parts/{name}-01..{len(shots['parts']):02d}.png"
        print(line)
    print(f"  issues: {report['issue_count']}")
    for issue in report["issues"][:12]:
        print(f"   - {issue}")
    print(f"  -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
