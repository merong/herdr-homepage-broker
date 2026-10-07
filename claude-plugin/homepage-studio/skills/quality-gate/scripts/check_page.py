#!/usr/bin/env python3
"""Model-free page check for a localhost homepage preview.

Usage: python3 check_page.py <url> <out_dir>

Writes <out_dir>/auto-check.json plus full-page screenshots
(screenshot-desktop-1440.png, screenshot-mobile-390.png).
Exits 0 when the check ran, even if issues were found. Exits 2 for bad
arguments or a URL that is not http://127.0.0.1 or http://localhost.
"""
import json
import os
import sys
import time
from datetime import datetime, timezone
from urllib.parse import urlsplit

VIEWPORTS = [("desktop", 1440, 900), ("mobile", 390, 844)]
CAP = 20
LOCAL_HOSTS = {"127.0.0.1", "localhost"}

COLLECT_JS = r"""
(cap) => {
  const describe = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += "#" + el.id;
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 3) : [];
    if (cls.length) s += "." + cls.join(".");
    return s;
  };
  const vw = window.innerWidth;
  const clipped = (el) => {
    for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      if (getComputedStyle(p).overflowX !== "visible") return true;
    }
    return false;
  };
  const offenders = [];
  const marked = new Set();
  for (const el of document.body ? document.body.querySelectorAll("*") : []) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || (r.right <= vw + 1 && r.left >= -1)) continue;
    if (getComputedStyle(el).position === "fixed" || clipped(el)) continue;
    marked.add(el);
    if (el.parentElement && marked.has(el.parentElement)) continue;
    offenders.push({ element: describe(el), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) });
  }
  const images = Array.from(document.images);
  const broken = images
    .filter((i) => (i.currentSrc || i.getAttribute("src")) && (!i.complete || i.naturalWidth === 0))
    .map((i) => ({ src: i.currentSrc || i.getAttribute("src"), complete: i.complete }));
  const noAlt = images.filter((i) => !i.hasAttribute("alt")).map((i) => i.currentSrc || i.getAttribute("src") || describe(i));
  const ids = new Set(Array.from(document.querySelectorAll("[id]")).map((e) => e.id));
  const anchors = Array.from(document.querySelectorAll("a[href^='#']")).map((a) => a.getAttribute("href"));
  const missingTargets = [...new Set(anchors.filter((h) => h.length > 1 && !ids.has(decodeURIComponent(h.slice(1)))))];
  const emptyHash = anchors.filter((h) => h === "#").length;
  const sig = (el, depth) => {
    const cs = getComputedStyle(el);
    let s = el.tagName.toLowerCase() + ":" + cs.display;
    if (cs.display.includes("grid")) s += "/" + cs.gridTemplateColumns.split(" ").filter(Boolean).length;
    if (cs.display.includes("flex")) s += "/" + cs.flexDirection;
    if (depth > 0) s += "[" + Array.from(el.children).map((c) => sig(c, depth - 1)).join(",") + "]";
    return s;
  };
  const sections = Array.from(document.querySelectorAll("section")).filter((s) => !s.parentElement.closest("section"));
  const signatures = sections.map((s) => ({ element: describe(s), signature: sig(s, 2) }));
  const repeated = [];
  for (let i = 1; i < signatures.length; i++)
    if (signatures[i].signature === signatures[i - 1].signature)
      repeated.push([signatures[i - 1].element, signatures[i].element]);
  const families = {};
  for (const el of document.body ? document.body.querySelectorAll("*") : []) {
    if (!Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const f = getComputedStyle(el).fontFamily;
    families[f] = (families[f] || 0) + 1;
  }
  const meta = (sel) => { const m = document.querySelector(sel); return m ? m.getAttribute("content") : null; };
  return {
    title: document.title || null,
    meta_description: meta("meta[name='description']"),
    og: Array.from(document.querySelectorAll("meta[property^='og:']")).map((m) => m.getAttribute("property")),
    lang: document.documentElement.getAttribute("lang"),
    h1_count: document.querySelectorAll("h1").length,
    overflow: {
      scroll_width: document.documentElement.scrollWidth,
      inner_width: vw,
      overflowing: document.documentElement.scrollWidth > vw,
      elements: offenders.slice(0, cap),
      elements_total: offenders.length,
    },
    broken_images: broken.slice(0, cap),
    broken_images_total: broken.length,
    images_total: images.length,
    images_missing_alt: noAlt.slice(0, cap),
    images_missing_alt_total: noAlt.length,
    anchors: { missing_targets: missingTargets.slice(0, cap), empty_hash: emptyHash },
    sections: signatures.length,
    repeated_section_layouts: repeated.slice(0, cap),
    computed_font_families: Object.entries(families).sort((a, b) => b[1] - a[1]).slice(0, cap).map(([family, elements]) => ({ family, elements })),
    webfonts_loaded: [...new Set(Array.from(document.fonts).filter((f) => f.status === "loaded").map((f) => f.family.replace(/^["']|["']$/g, "")))],
  };
}
"""

SETTLE_JS = r"""
async () => {
  const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
  for (let y = 0; y < document.documentElement.scrollHeight && y < 60000; y += step) {
    window.scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 60));
  }
  window.scrollTo(0, 0);
  await Promise.all(Array.from(document.images).filter((i) => !i.complete).map((i) =>
    new Promise((r) => { i.addEventListener("load", r, { once: true }); i.addEventListener("error", r, { once: true }); setTimeout(r, 5000); })));
  if (document.fonts && document.fonts.ready) await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 3000))]);
}
"""

MARK_TEXT_JS = r"""
(cap) => {
  let n = 0;
  for (const el of document.body ? document.body.querySelectorAll("*") : []) {
    if (n >= cap) break;
    if (Array.from(el.childNodes).some((c) => c.nodeType === 3 && c.textContent.trim())) {
      el.setAttribute("data-hp-check-text", "");
      n++;
    }
  }
  return n;
}
"""


def write(out_dir, data):
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "auto-check.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def allowed(url):
    try:
        u = urlsplit(url)
        u.port
    except ValueError:
        return False
    return (
        u.scheme == "http"
        and u.hostname in LOCAL_HOSTS
        and u.username is None
        and u.password is None
    )


def rendered_fonts(page):
    """Platform fonts Chromium actually used for text nodes (CDP)."""
    try:
        count = page.evaluate(MARK_TEXT_JS, 400)
        cdp = page.context.new_cdp_session(page)
        cdp.send("DOM.enable")
        cdp.send("CSS.enable")
        root = cdp.send("DOM.getDocument", {"depth": 0})["root"]["nodeId"]
        nodes = cdp.send(
            "DOM.querySelectorAll",
            {"nodeId": root, "selector": "[data-hp-check-text]"},
        )["nodeIds"]
        totals = {}
        for node in nodes:
            for font in cdp.send("CSS.getPlatformFontsForNode", {"nodeId": node})[
                "fonts"
            ]:
                key = font["familyName"]
                entry = totals.setdefault(
                    key, {"family": key, "glyphs": 0, "custom": font.get("isCustomFont", False)}
                )
                entry["glyphs"] += font.get("glyphCount", 0)
        cdp.detach()
        return {
            "sampled_elements": count,
            "families": sorted(totals.values(), key=lambda e: -e["glyphs"]),
        }
    except Exception as e:  # CDP is best effort; computed stacks remain.
        return {"error": str(e)[:300]}


def check_viewport(browser, url, out_dir, name, width, height):
    ctx = browser.new_context(viewport={"width": width, "height": height})
    page = ctx.new_page()
    console_errors, page_errors, failed, http_errors, external = [], [], [], [], set()

    def on_console(m):
        if m.type == "error":
            console_errors.append({"text": m.text[:500], "location": m.location})

    def on_request(r):
        host = urlsplit(r.url).hostname
        if host and host not in LOCAL_HOSTS:
            external.add(host)

    page.on("console", on_console)
    page.on("pageerror", lambda e: page_errors.append(str(e)[:500]))
    page.on("request", on_request)
    page.on(
        "requestfailed",
        lambda r: failed.append({"url": r.url[:300], "error": r.failure}),
    )
    page.on(
        "response",
        lambda r: r.status >= 400
        and http_errors.append({"url": r.url[:300], "status": r.status}),
    )
    result = {"width": width, "height": height}
    started = time.monotonic()
    try:
        response = page.goto(url, wait_until="load", timeout=30000)
        result["status"] = response.status if response else None
        try:
            page.wait_for_load_state("networkidle", timeout=8000)
        except Exception:
            result["networkidle"] = False
        page.evaluate(SETTLE_JS)
        page.wait_for_timeout(300)
        result["load_ms"] = round((time.monotonic() - started) * 1000)
        result.update(page.evaluate(COLLECT_JS, CAP))
        shot = f"screenshot-{name}-{width}.png"
        page.screenshot(path=os.path.join(out_dir, shot), full_page=True)
        result["screenshot"] = shot
        if name == "desktop":
            result["rendered_fonts"] = rendered_fonts(page)
    except Exception as e:
        result["navigation_error"] = (str(e).strip().splitlines() or [""])[0][:500]
    result["console_errors"] = console_errors[:CAP]
    result["console_errors_total"] = len(console_errors)
    result["page_errors"] = page_errors[:CAP]
    result["page_errors_total"] = len(page_errors)
    result["failed_requests"] = failed[:CAP]
    result["failed_requests_total"] = len(failed)
    result["http_errors"] = http_errors[:CAP]
    result["http_errors_total"] = len(http_errors)
    result["external_hosts"] = sorted(external)
    ctx.close()
    return result


def hoist(report):
    """Page-level facts come from the desktop pass; viewports keep layout facts."""
    seo_keys = ("title", "meta_description", "og", "lang", "h1_count")
    font_keys = ("computed_font_families", "webfonts_loaded", "rendered_fonts")
    desktop = report["viewports"].get("desktop", {})
    report["seo"] = {k: desktop.get(k) for k in seo_keys}
    report["fonts"] = {k: desktop.get(k) for k in font_keys}
    for v in report["viewports"].values():
        for k in seo_keys + font_keys:
            v.pop(k, None)


def summarize(report):
    issues = []
    for name, v in report["viewports"].items():
        if "navigation_error" in v:
            issues.append(f"{name}: page did not load ({v['navigation_error'][:120]})")
            continue
        for key, label in [
            ("console_errors_total", "console errors"),
            ("page_errors_total", "page errors"),
            ("failed_requests_total", "failed requests"),
            ("http_errors_total", "HTTP >= 400 responses"),
            ("broken_images_total", "broken or unloaded images"),
            ("images_missing_alt_total", "images without alt"),
        ]:
            if v.get(key):
                issues.append(f"{name}: {v[key]} {label}")
        if v.get("overflow", {}).get("overflowing"):
            o = v["overflow"]
            issues.append(
                f"{name}: horizontal overflow {o['scroll_width']}px > {o['inner_width']}px"
            )
        if v.get("anchors", {}).get("missing_targets"):
            issues.append(f"{name}: in-page links without targets")
        if v.get("repeated_section_layouts"):
            issues.append(f"{name}: consecutive sections share a layout signature")
        if v.get("external_hosts"):
            hosts = v["external_hosts"]
            issues.append(
                f"{name}: {len(hosts)} external host(s) requested "
                f"({', '.join(hosts[:5])}); the static build must not use CDNs"
            )
    d = report["seo"]
    if "navigation_error" not in report["viewports"].get("desktop", {}):
        if not d.get("title"):
            issues.append("missing <title>")
        if not d.get("meta_description"):
            issues.append("missing meta description")
        missing_og = [
            k for k in ("og:title", "og:description", "og:image") if k not in d.get("og", [])
        ]
        if missing_og:
            issues.append("missing " + ", ".join(missing_og))
        if d.get("h1_count") != 1:
            issues.append(f"h1 count is {d.get('h1_count')} (expected 1)")
        if not d.get("lang"):
            issues.append("missing <html lang>")
    return issues


def main(argv):
    if len(argv) != 3:
        print("usage: check_page.py <url> <out_dir>", file=sys.stderr)
        return 2
    url, out_dir = argv[1], os.path.abspath(argv[2])
    if not allowed(url):
        print("refused: only http://127.0.0.1 or http://localhost URLs", file=sys.stderr)
        return 2
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        write(out_dir, {"skipped": "playwright unavailable"})
        return 0
    os.makedirs(out_dir, exist_ok=True)
    report = {
        "tool": "homepage-studio/check_page.py",
        "version": 1,
        "url": url,
        "checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "viewports": {},
    }
    with sync_playwright() as p:
        try:
            browser = p.chromium.launch()
        except Exception as e:
            write(out_dir, {"skipped": "chromium unavailable", "detail": str(e)[:500]})
            return 0
        try:
            for name, width, height in VIEWPORTS:
                report["viewports"][name] = check_viewport(
                    browser, url, out_dir, name, width, height
                )
        finally:
            browser.close()
    hoist(report)
    report["issues"] = summarize(report)
    report["issue_count"] = len(report["issues"])
    write(out_dir, report)
    print(f"auto-check: {report['issue_count']} issue(s) -> {os.path.join(out_dir, 'auto-check.json')}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
