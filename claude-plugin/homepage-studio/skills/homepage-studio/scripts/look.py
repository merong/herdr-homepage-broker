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

desktop.png and mobile.png keep sticky and fixed elements where the visitor
sees them. Only for the full pages and parts/ are they laid out once so they
do not land over other sections: sticky elements stay at their place in the
flow, fixed bars and buttons in the lower half of the first viewport sit at
the bottom of the page (where they are at the end of scrolling), and fixed
elements outside the first viewport are hidden. A fixed element placed in a
transformed, filtered or contained ancestor rather than the viewport (or
when that is unclear) is left as is. issues.json lists each element under
full_page_positions with the reason; hidden ones say whether they were seen
on screen at the scroll positions checked (a bar that slides in, then in no
screenshot) or not (a closed drawer, for example). Not seen is only what the
stepped scroll observed, and the reason says so when the scroll ran out of
time. If the fix throws, the changed inline styles are put back and the
failure is reported in issues and the summary.

Exit codes: 0 when the page was captured, even with issues; 1 when the page
did not load; 2 for bad arguments or a URL that is not on this machine;
3 when Playwright or its Chromium is not installed.
"""
import argparse
import json
import os
import shlex
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
  // Fixed elements on screen at some scroll position below the top. FULL_PAGE_JS
  // reads this to tell bars that slide in while scrolling from closed drawers.
  const seen = new Map();
  window[Symbol.for("look.py fixed seen while scrolling")] = seen;
  const fixedElements = () => Array.from(document.body ? document.body.querySelectorAll("*") : [])
    .filter((el) => getComputedStyle(el).position === "fixed");
  let fixed = fixedElements();
  const look = () => {
    for (const el of fixed) {
      if (seen.has(el) || !el.isConnected) continue;
      const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      if (s.position === "fixed" && s.visibility !== "hidden" && r.width && r.height
          && r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth)
        seen.set(el, Math.round(window.scrollY));
    }
  };
  let y = 0;
  while (Date.now() - started < budgetMs) {
    const bottom = document.documentElement.scrollHeight - window.innerHeight;
    if (y >= bottom) break;
    y = Math.min(y + step, bottom);
    // "instant" overrides CSS scroll-behavior: smooth, which would otherwise
    // leave the page mid-scroll when the full capture is taken.
    window.scrollTo({ top: y, behavior: "instant" });
    await new Promise((r) => setTimeout(r, 140));
    look();
  }
  await new Promise((r) => setTimeout(r, 500));
  if (y > 0) {
    fixed = fixedElements();  // also bars that were added while scrolling
    look();
  }
  const pending = Array.from(document.images).filter((i) => !i.complete);
  await Promise.race([
    Promise.all(pending.map((i) => new Promise((r) => {
      i.addEventListener("load", r, { once: true });
      i.addEventListener("error", r, { once: true });
    }))),
    new Promise((r) => setTimeout(r, 3000)),
  ]);
  window.scrollTo({ top: 0, behavior: "instant" });
  await new Promise((r) => setTimeout(r, 400));
  return { scrolled_to: y, timed_out: Date.now() - started >= budgetMs };
}
"""

# A full-page capture keeps the first viewport's size and scroll position, so
# sticky and fixed elements land over the middle of the page. Runs after the
# first-viewport shot; the page is closed after the full capture. Every inline
# style it touches is saved first and put back if anything throws.
FULL_PAGE_JS = r"""
async ({ cap, scroll }) => {
  const saved = new Map();
  const set = (el, props) => {
    if (!saved.has(el)) saved.set(el, el.getAttribute("style"));
    for (const k in props) el.style.setProperty(k, props[k], "important");
  };
  try {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    const vh = window.innerHeight, vw = window.innerWidth;
    const pageHeight = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
    const seen = window[Symbol.for("look.py fixed seen while scrolling")];
    const describe = (el) => {
      let s = el.tagName.toLowerCase();
      if (el.id) s += "#" + el.id;
      const cls = typeof el.className === "string"
        ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 3) : [];
      if (cls.length) s += "." + cls.join(".");
      return s;
    };
    // An ancestor with one of these makes the ancestor, not the viewport, the
    // box a fixed element is placed in (a CTA inside a transformed section).
    const boxProps = ["transform", "translate", "rotate", "scale", "perspective", "filter", "backdrop-filter", "offset-path"];
    const containingProp = (s) => {
      for (const p of boxProps) if (s.getPropertyValue(p) && s.getPropertyValue(p) !== "none") return p;
      if (/\b(paint|layout|strict|content)\b/.test(s.contain)) return `contain: ${s.contain}`;
      if (s.contentVisibility === "auto") return "content-visibility: auto";
      const wc = s.willChange.split(",").map((v) => v.trim());
      const hit = wc.find((v) => boxProps.includes(v) || v === "contain");
      return hit ? `will-change: ${hit}` : null;
    };
    const ancestorBox = (el) => {
      for (let a = el.parentElement; a; a = a.parentElement) {
        const p = containingProp(getComputedStyle(a));
        if (p) return [a, p];
      }
      return null;
    };
    const elements = [], counts = { sticky_in_flow: 0, fixed_to_page_bottom: 0, fixed_hidden: 0, fixed_hidden_seen_scrolling: 0, fixed_kept: 0, fixed_left_as_is: 0 };
    const record = (el, action, reason, extra) => elements.push({ selector: describe(el), action, reason, ...extra });
    const sticky = [], fixed = [];
    for (const el of document.body ? document.body.querySelectorAll("*") : []) {
      const position = getComputedStyle(el).position;
      if (position === "sticky") sticky.push(el);
      else if (position === "fixed" && el.getClientRects().length)
        // Measured before anything moves. offsetParent of a fixed element is
        // null unless an ancestor is its containing block.
        fixed.push([el, el.getBoundingClientRect(), el.offsetParent, ancestorBox(el)]);
    }
    // relative with auto offsets is the sticky element's place in the flow, and
    // unlike static it keeps z-index and the box absolute children are placed in.
    for (const el of sticky) {
      set(el, { position: "relative", top: "auto", bottom: "auto", left: "auto", right: "auto" });
      counts.sticky_in_flow++;
      record(el, "in_flow", "sticky: shown once at its place in the flow");
    }
    for (const [el, r, parent, box] of fixed) {
      if (parent || box) {
        // Placed in an ancestor, so it already scrolls with the page. Only when
        // both signals name the same ancestor is that what the record says;
        // otherwise it is unclear, and unclear stays as it is too.
        counts.fixed_left_as_is++;
        const why = parent && box && box[0] === parent
          ? `placed in ${describe(parent)} (${box[1]}), not in the viewport`
          : `unclear whether it is fixed to the viewport: offsetParent ${parent ? describe(parent) : "none"}, `
            + `nearest ancestor with a containing property ${box ? `${describe(box[0])} (${box[1]})` : "none"}`;
        record(el, "left_as_is", why);
      } else if (r.width && r.height && (r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw)) {
        set(el, { display: "none", transition: "none" });
        counts.fixed_hidden++;
        if (seen && seen.has(el)) {
          counts.fixed_hidden_seen_scrolling++;
          record(el, "hidden", "outside the first viewport, on screen after scrolling; in no screenshot",
            { seen_while_scrolling: true, first_seen_at_y: seen.get(el) });
        } else if (seen) {
          // Only the stepped scroll's positions were looked at: not seen there
          // is not proof that it never shows.
          record(el, "hidden", scroll && scroll.timed_out
            ? "outside the first viewport and not observed on screen while scrolling; the scroll ran out of time, so this observation is incomplete"
            : "outside the first viewport and not observed on screen at the scroll positions checked (a closed drawer, menu or dialog, for example)",
            { seen_while_scrolling: false });
        } else {
          record(el, "hidden", "outside the first viewport; not checked while scrolling", { seen_while_scrolling: null });
        }
      } else if (r.height > vh / 2 || r.top + r.height / 2 <= vh / 2) {
        counts.fixed_kept++;
        record(el, "kept", r.height > vh / 2
          ? "taller than half the viewport (background or overlay), left where it is"
          : "upper half of the first viewport, stays at the top of the page");
      } else {
        set(el, { position: "absolute", transition: "none", top: "0px", left: "0px", right: "auto", bottom: "auto", width: getComputedStyle(el).width });
        const n = el.getBoundingClientRect();
        set(el, { top: `${pageHeight - vh + r.top - n.top - window.scrollY}px`, left: `${r.left - n.left}px` });
        counts.fixed_to_page_bottom++;
        record(el, "page_bottom", "lower half of the first viewport, placed at the bottom of the page where it sits after scrolling");
      }
    }
    await new Promise((r) => setTimeout(r, 100));
    const rank = { hidden: 0, page_bottom: 1, left_as_is: 2, in_flow: 3, kept: 4 };
    elements.sort((a, b) => rank[a.action] - rank[b.action]);
    return { ...counts, scroll_y: Math.round(window.scrollY), elements: elements.slice(0, cap), elements_total: elements.length };
  } catch (e) {
    const failed = { error: String((e && e.message) || e).slice(0, 300), touched_elements: saved.size, restored: true };
    for (const [el, style] of saved) {
      try {
        // Reading first: Chromium leaves style="" when removing an attribute
        // that was only changed through el.style and never read back.
        el.getAttribute("style");
        if (style === null) el.removeAttribute("style");
        else el.setAttribute("style", style);
        if (el.getAttribute("style") !== style) throw new Error(`style of ${el.tagName.toLowerCase()} not restored`);
      } catch (r) {
        failed.restored = false;
        failed.restore_error = failed.restore_error || String((r && r.message) || r).slice(0, 300);
      }
    }
    return failed;
  }
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
        try:
            result["full_page_positions"] = page.evaluate(FULL_PAGE_JS, {"cap": CAP, "scroll": result["scroll"]})
        except Exception as e:  # capture anyway; summarize() flags it
            result["full_page_positions"] = {"error": first_line(e), "restored": None}
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


def normalization_warning(fix):
    error = fix["error"][:160]
    if fix.get("restored") is True:
        return (
            f"full/parts layout fix failed ({error}); styles were restored, so"
            " full and parts show the page as is (sticky and fixed elements may"
            " cover other sections)"
        )
    if fix.get("restored") is False:
        return (
            f"full/parts layout fix failed ({error}) and could not be undone"
            f" ({fix.get('restore_error', '')[:120]}); full and parts show a"
            " partly changed page, do not trust them"
        )
    return (
        f"full/parts layout fix failed ({error}); unknown whether styles were"
        " changed, full and parts may show a partly changed page"
    )


def hidden_note(e, scroll):
    if e.get("seen_while_scrolling"):
        return f"{e['selector']} (appears after scrolling, in no screenshot)"
    if e.get("seen_while_scrolling") is False:
        if scroll.get("timed_out"):
            return f"{e['selector']} (not observed while scrolling; scroll timed out, incomplete)"
        return f"{e['selector']} (not observed on screen while scrolling)"
    return f"{e['selector']} (not checked while scrolling)"


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
        fix = v.get("full_page_positions", {})
        if "error" in fix:
            issues.append(f"{name}: {normalization_warning(fix)}")
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
        exe = shlex.quote(sys.executable or "python3")  # pasted into a shell
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
                f"{first_line(e)}\n  설치 / install: {shlex.quote(sys.executable or 'python3')} -m playwright install chromium",
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
        fix = v.get("full_page_positions", {})
        moved = [
            f"{fix[key]} {label}"
            for key, label in [
                ("sticky_in_flow", "sticky in flow"),
                ("fixed_to_page_bottom", "fixed at page bottom"),
                ("fixed_hidden", "fixed hidden"),
                ("fixed_left_as_is", "fixed left as is (in a section or unclear)"),
            ]
            if fix.get(key)
        ]
        if "error" in fix:
            line += "; full/parts: WARNING layout fix failed, " + (
                "restored to the page as is"
                if fix.get("restored") is True
                else "full and parts are unreliable"
            )
        elif moved:
            line += f"; full/parts: {', '.join(moved)}"
        print(line)
        hidden = [e for e in fix.get("elements", []) if e["action"] == "hidden"]
        if hidden:
            notes = [hidden_note(e, v.get("scroll") or {}) for e in hidden]
            print(f"    hidden in full/parts: {', '.join(notes)}")
    print(f"  issues: {report['issue_count']}")
    for issue in report["issues"][:12]:
        print(f"   - {issue}")
    print(f"  -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
