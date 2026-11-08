import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize2 } from "lucide-react";
import { parseAnsi, type Line } from "./ansi";
import { getJson, projectApi } from "./data";
import { TerminalMirror } from "./TerminalMirror";

interface Agent {
  agent_id: string;
  role: string;
  pane_id: string | null;
  runtime: { status: string; fresh: boolean };
}
export interface ThumbProject {
  project_id: string;
  status: string;
  resume_required: boolean;
  stall: unknown;
  agents: Agent[];
  input_requests: { status: string }[];
}

const idleWords: Record<string, string> = {
  starting: "시작 중",
  queued: "큐 대기",
  paused: "멈춤",
  cancelling: "취소 중",
  review_pending: "완료",
  failed: "실패",
  cancelled: "종료",
  superseded: "종료",
};

// "Running" means the run is running/retrying and Herdr sees the PM working.
// Everything else stops the shimmer and the refresh and names the state.
export function thumbState(p: ThumbProject): {
  live: boolean;
  word: string;
  tone?: string;
} {
  const pm = p.agents.find((a) => a.role === "pm") ?? p.agents[0];
  const fresh = !!pm?.runtime.fresh;
  const working = fresh && ["working", "busy"].includes(pm.runtime.status);
  const running = ["running", "retrying"].includes(p.status);
  if (running && working)
    return { live: true, word: "진행 중", tone: "running" };
  if (p.stall) return { live: false, word: "응답 없음", tone: "warn" };
  if (
    p.status === "waiting_input" ||
    p.input_requests.some((q) => q.status !== "answered")
  )
    return { live: false, word: "입력 필요", tone: "warn" };
  if (running)
    return pm?.runtime.status === "blocked" && fresh
      ? { live: false, word: "확인 필요", tone: "warn" }
      : { live: false, word: fresh ? "대기" : "갱신 대기" };
  if (p.status === "queued" && p.resume_required)
    return { live: false, word: "멈춤" };
  return {
    live: false,
    word: idleWords[p.status] ?? p.status,
    tone:
      p.status === "review_pending"
        ? "ok"
        : p.status === "failed"
          ? "danger"
          : undefined,
  };
}

// One small store per project: the sidebar, the overview card and the detail
// summary can show the same project at once and still cost one request.
interface Screen {
  text: string;
  lines: Line[];
}
interface Sub {
  live: boolean;
  seen: boolean;
  notify: () => void;
}
interface Entry {
  screen: Screen | null;
  seq: number;
  fault: string | null;
  read: number;
  busy: boolean;
  kicked: boolean;
  due: number | null;
  timer?: ReturnType<typeof setTimeout>;
  subs: Set<Sub>;
}
const entries = new Map<string, Entry>();
const GAP = 1500;

function entry(id: string) {
  let e = entries.get(id);
  if (!e) {
    e = {
      screen: null,
      seq: 0,
      fault: null,
      read: 0,
      busy: false,
      kicked: false,
      due: null,
      subs: new Set(),
    };
    entries.set(id, e);
  }
  return e;
}

// 5–10 s, kept GAP ms away from every other project's next swap so two
// thumbnails never change on the same beat.
function pickDue() {
  const now = Date.now();
  const others = [...entries.values()].flatMap((e) =>
    e.due === null ? [] : [e.due],
  );
  let t = now + 5000 + Math.random() * 5000;
  for (let i = 0; i < 8 && others.some((d) => Math.abs(d - t) < GAP); i++)
    t = now + 5000 + Math.random() * 5000;
  return t;
}

const wanted = (e: Entry) =>
  !document.hidden && [...e.subs].some((s) => s.live && s.seen);

function plan(id: string) {
  const e = entry(id);
  if (!wanted(e)) {
    clearTimeout(e.timer);
    e.timer = undefined;
    e.due = null;
    return;
  }
  if (e.timer) return;
  e.due = pickDue();
  // The next beat is planned before this read, so a slow read never
  // stretches the 5–10 s interval.
  e.timer = setTimeout(() => {
    e.timer = undefined;
    e.due = null;
    plan(id);
    void load(id);
  }, e.due - Date.now());
}

// Trailing blank rows would push the last output off the bottom-anchored view.
function trim(lines: Line[]) {
  let n = lines.length;
  while (n > 0 && lines[n - 1].every((s) => !s.text.trim())) n--;
  return lines.slice(0, n);
}

// A failed read keeps the last screen; only the small fault marker changes.
async function load(id: string) {
  const e = entry(id);
  if (e.busy) return;
  e.busy = true;
  e.read = Date.now();
  try {
    const body = await getJson(projectApi(id, "terminal"), 800);
    if (body.available && typeof body.text === "string") {
      e.fault = null;
      if (body.text !== e.screen?.text) {
        e.screen = { text: body.text, lines: trim(parseAnsi(body.text)) };
        e.seq++;
      }
    } else e.fault = body.reason ?? "read_failed";
  } catch {
    e.fault = "offline";
  } finally {
    e.busy = false;
  }
  for (const s of e.subs) s.notify();
}

// Immediate reads (back on screen, tab visible again, a live edge) are also
// spaced GAP ms apart, so thumbnails that wake together change one by one.
let lastKick = 0;
function kick(id: string) {
  const e = entry(id);
  if (e.kicked) return;
  e.kicked = true;
  const at = Math.max(Date.now(), lastKick + GAP);
  lastKick = at;
  setTimeout(() => {
    e.kicked = false;
    void load(id).then(() => plan(id));
  }, at - Date.now());
}

document.addEventListener("visibilitychange", () => {
  for (const [id, e] of entries) {
    if (wanted(e) && Date.now() - e.read > 10000) kick(id);
    else plan(id);
  }
});

function useTerminal(
  id: string,
  live: boolean,
  node: React.RefObject<HTMLDivElement | null>,
) {
  const [, bump] = useState(0);
  const sub = useRef<Sub | null>(null);
  useEffect(() => {
    const e = entry(id);
    const s: Sub = { live, seen: false, notify: () => bump((n) => n + 1) };
    sub.current = s;
    e.subs.add(s);
    // Idle thumbnails still read once so the last screen shows.
    const show = () => {
      if (Date.now() - e.read > (s.live ? 5000 : 60000)) kick(id);
      else plan(id);
    };
    let io: IntersectionObserver | undefined;
    if (node.current && "IntersectionObserver" in window) {
      io = new IntersectionObserver((list) => {
        const seen = list.at(-1)!.isIntersecting;
        if (seen === s.seen) return;
        s.seen = seen;
        if (seen) show();
        else plan(id);
      });
      io.observe(node.current);
    } else {
      s.seen = true;
      show();
    }
    return () => {
      io?.disconnect();
      e.subs.delete(s);
      plan(id);
    };
  }, [id]);
  // Read once more on every live edge: the dimmed screen is the last one, and
  // a resumed run shows its current screen right away.
  const was = useRef(live);
  useEffect(() => {
    const s = sub.current;
    if (!s) return;
    s.live = live;
    if (was.current !== live && s.seen) kick(id);
    was.current = live;
    plan(id);
  }, [id, live]);
  return entry(id);
}

// The pane screen at its own width, scaled to the box and anchored to the
// bottom so the latest output (Claude Code's input box) stays in view.
function Layer(props: { lines: Line[]; fade: boolean; onShown: () => void }) {
  const pre = useRef<HTMLPreElement>(null);
  useLayoutEffect(() => {
    const el = pre.current;
    const box = el?.parentElement?.parentElement;
    if (!el || !box) return;
    const fit = () => {
      if (!box.clientWidth || !el.offsetWidth) return;
      const s = Math.min(1, box.clientWidth / el.offsetWidth);
      const y = Math.min(0, box.clientHeight - el.offsetHeight * s);
      el.style.transform = `translate(0, ${y}px) scale(${s})`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    return () => ro.disconnect();
  }, [props.lines]);
  return (
    <span
      className="tthumb-layer"
      data-fade={props.fade || undefined}
      onAnimationEnd={props.onShown}
    >
      <pre className="tthumb-text ansi" ref={pre}>
        {props.lines.map((line, i) => (
          <span key={i}>
            {line.map((s, j) => (
              <span
                key={j}
                className={s.classes.length ? s.classes.join(" ") : undefined}
                style={
                  s.fg || s.bg
                    ? { color: s.fg, backgroundColor: s.bg }
                    : undefined
                }
              >
                {s.text}
              </span>
            ))}
            {"\n"}
          </span>
        ))}
      </pre>
    </span>
  );
}

const faults: Record<string, string> = {
  offline: "연결 끊김",
  read_failed: "읽기 실패",
  pane_not_found: "pane 없음",
};

// Shows that the PM is working, not what it types: a scaled-down screen that
// swaps every 5–10 s under a shimmer. `openable` thumbnails open the 1 s
// mirror in a dialog; the mirror polls only while that dialog is open.
export function TerminalThumb(props: {
  project: ThumbProject;
  size: "list" | "card" | "detail";
  openable?: boolean;
}) {
  const p = props.project;
  const state = thumbState(p);
  const node = useRef<HTMLDivElement>(null);
  const e = useTerminal(p.project_id, state.live, node);
  // Two layers at most: the new screen fades in over the old one. A finished
  // fade drops the old layer and the new one's flag, because the shell
  // re-inserts slot containers and would replay the fade over an empty box.
  const [layers, setLayers] = useState<
    { seq: number; lines: Line[]; fade: boolean }[]
  >(() =>
    e.screen ? [{ seq: e.seq, lines: e.screen.lines, fade: false }] : [],
  );
  useEffect(() => {
    const screen = e.screen;
    if (!screen) return;
    setLayers((l) =>
      l.at(-1)?.seq === e.seq
        ? l
        : [
            ...l.slice(-1),
            { seq: e.seq, lines: screen.lines, fade: !!l.length },
          ],
    );
  }, [e.seq]);
  const [open, setOpen] = useState(false);
  const small = props.size === "list";
  const fault = e.fault && e.fault !== "no_pane" ? e.fault : null;
  const label = `${p.project_id} PM 터미널 · ${state.word}`;
  return (
    <div
      className="tthumb"
      ref={node}
      data-size={props.size}
      data-live={state.live || undefined}
      data-dim={!state.live || undefined}
      role={props.openable ? undefined : "img"}
      aria-label={props.openable ? undefined : label}
    >
      <span className="tthumb-screen">
        {layers.map((l, i) => (
          <Layer
            key={l.seq}
            lines={l.lines}
            fade={l.fade && i === layers.length - 1}
            onShown={() =>
              setLayers((x) => x.slice(-1).map((y) => ({ ...y, fade: false })))
            }
          />
        ))}
        {!layers.length && e.read > 0 && !e.busy && (
          <span className="tthumb-empty">
            {fault
              ? (faults[fault] ?? "읽기 실패")
              : small
                ? "화면 없음"
                : ["queued", "starting"].includes(p.status)
                  ? "아직 PM 화면이 없습니다"
                  : "PM 화면이 닫혀 있습니다"}
          </span>
        )}
      </span>
      {state.live && <span className="tthumb-shimmer" aria-hidden="true" />}
      <span className="tthumb-state" aria-hidden="true">
        <span className="dot" data-state={state.tone} />
        {state.word}
      </span>
      {fault && layers.length > 0 && (
        <span
          className="tthumb-fault"
          title={`${faults[fault] ?? "읽기 실패"} · 마지막 화면을 보이고 있습니다`}
        >
          <span className="dot" data-state="warn" />
          {!small && (faults[fault] ?? "읽기 실패")}
        </span>
      )}
      {props.openable && (
        <>
          <button
            type="button"
            className="tthumb-open"
            aria-label={`${label} · 크게 보기`}
            aria-haspopup="dialog"
            onClick={() => setOpen(true)}
          />
          <span className="tthumb-zoom" aria-hidden="true">
            <Maximize2 className="icon icon-xs" />
            크게 보기
          </span>
        </>
      )}
      {open &&
        createPortal(
          <TerminalDialog project={p} onClose={() => setOpen(false)} />,
          document.body,
        )}
    </div>
  );
}

// Rendered into <body>: the shell re-inserts slot containers on every
// snapshot, and a modal <dialog> that leaves the document loses its top layer.
function TerminalDialog(props: { project: ThumbProject; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="term-dialog"
      aria-label={`${props.project.project_id} PM 터미널`}
      onClose={props.onClose}
      onClick={(e) => e.target === ref.current && ref.current?.close()}
    >
      <div className="dialog-head">
        <span className="heading">{props.project.project_id} · PM 터미널</span>
        <span className="grow" />
        <span className="muted">1초마다 갱신</span>
        <button
          className="btn btn-sm"
          type="button"
          onClick={() => ref.current?.close()}
        >
          닫기
        </button>
      </div>
      <TerminalMirror
        projectId={props.project.project_id}
        interval={1000}
        agents={props.project.agents}
      />
    </dialog>
  );
}
