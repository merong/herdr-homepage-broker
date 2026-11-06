const $ = (id) => document.getElementById(id);
// Run status wording and tone follow the DS status table.
const names = {
  queued: "큐 대기",
  starting: "시작 중",
  running: "실행 중",
  waiting_input: "입력 필요",
  retrying: "재시도 중",
  paused: "일시정지",
  cancelling: "취소 중",
  review_pending: "검토 대기",
  failed: "실패",
  cancelled: "취소됨",
  superseded: "대체됨",
};
const tones = {
  waiting_input: "warn",
  retrying: "warn",
  review_pending: "ok",
  failed: "danger",
};
const outlined = new Set(["paused", "cancelling", "cancelled", "superseded"]);
const taskNames = {
  pending: "대기",
  running: "진행 중",
  waiting_input: "입력 대기",
  retrying: "재시도",
  completed: "완료",
  failed: "실패",
  cancelled: "취소됨",
};
const runtimeNames = {
  working: "working",
  busy: "working",
  idle: "idle",
  done: "done",
  blocked: "blocked",
  stopped: "정지",
  unknown: "알 수 없음",
};
const roles = { pm: "PM", developer: "개발자", designer: "디자이너" };
const reasons = {
  broker_restarted:
    "브로커가 재시작되었습니다. 실행 준비를 확인한 뒤 작업을 재개하세요.",
  operation_unknown: "외부 요청의 접수 여부를 확인해야 합니다.",
  resource_missing: "에이전트 실행 자원을 찾을 수 없습니다.",
  resource_owner_mismatch: "실행 자원의 소유 정보가 일치하지 않습니다.",
  studio_plugin_missing:
    "homepage-studio 플러그인을 찾을 수 없습니다. 플러그인을 다시 설치한 뒤 작업을 재개하세요.",
};
const groups = [
  [
    "active",
    "진행 중",
    ["starting", "running", "retrying", "cancelling", "waiting_input"],
  ],
  ["queued", "큐 대기", ["queued"]],
  ["paused", "일시정지", ["paused"]],
  ["review", "검토 대기", ["review_pending"]],
  ["ended", "종료", ["failed", "cancelled", "superseded"]],
];
const groupOf = (p) =>
  groups.find((g) => g[2].includes(p.status))?.[0] ?? "ended";
const filters = {
  all: () => true,
  active: (p) => groupOf(p) === "active",
  queued: (p) => p.status === "queued",
  review: (p) => p.status === "review_pending",
};
let snapshot,
  filter = "all",
  inspectorTab = "run",
  busy = false,
  offline = true,
  signature = "",
  lastSuccess = 0,
  transport = "poll";

// All broker-provided strings become text nodes, never markup.
function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}
function icon(name, cls = "icon icon-sm") {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", cls);
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const [tag, attrs] of window.BrokerIcons?.[name] ?? []) {
    const child = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) child.setAttribute(k, v);
    svg.append(child);
  }
  return svg;
}
function button(label, cls, iconName, onclick) {
  const b = el("button", cls);
  if (iconName) b.append(icon(iconName));
  b.append(label);
  b.onclick = onclick;
  return b;
}
function dot(state) {
  const d = el("span", "dot");
  if (state) d.dataset.state = state;
  return d;
}
function badge(text, tone, cls = "badge") {
  const b = el("span", cls);
  if (tone) b.dataset.tone = tone;
  b.append(text);
  return b;
}
function statusBadge(p) {
  if (p.stall) {
    const b = badge("", "warn");
    b.replaceChildren(
      icon("alert", "icon icon-xs"),
      `응답 없음 ${p.stall.minutes}분`,
    );
    return b;
  }
  const b = el("span", outlined.has(p.status) ? "badge badge-muted" : "badge");
  if (tones[p.status]) b.dataset.tone = tones[p.status];
  if (["starting", "running"].includes(p.status)) b.append(dot("running"));
  b.append(names[p.status] ?? p.status);
  return b;
}
function section(title, end, ...children) {
  const s = el("section", "section");
  const head = el("div", "section-head");
  head.append(el("span", "", title), el("span", "", end ?? ""));
  s.append(head, ...children);
  return s;
}
function groupBox(rows) {
  const g = el("div", "group");
  for (const [k, v] of rows) {
    if (v === undefined) continue;
    const row = el("div", "group-row");
    const value = el("div", "v");
    value.append(v instanceof Node ? v : String(v ?? "—"));
    row.append(el("span", "k", k), value);
    g.append(row);
  }
  return g;
}
const mono = (text) => el("span", "mono", text);
const shortId = (id) => (id ? String(id).slice(0, 8) : "—");
function minutesSince(iso) {
  const t = Date.parse(iso ?? "");
  return Number.isFinite(t)
    ? Math.max(0, Math.floor((Date.now() - t) / 60000))
    : null;
}
function duration(min) {
  if (min === null) return "—";
  if (min < 60) return `${min}분`;
  if (min < 2880) return `${Math.floor(min / 60)}시간 ${min % 60}분`;
  return `${Math.floor(min / 1440)}일 ${Math.floor((min % 1440) / 60)}시간`;
}
const clock = (iso) =>
  new Date(iso).toLocaleTimeString("ko-KR", { hour12: false });
const hm = (iso) =>
  new Date(iso).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
const day = (iso) =>
  new Date(iso).toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
const done = (p) => p.tasks.filter((t) => t.status === "completed").length;
const openQuestions = (p) =>
  p.input_requests.filter((q) => q.status !== "answered");
const currentTask = (p) =>
  p.tasks.find((t) =>
    ["running", "retrying", "waiting_input"].includes(t.status),
  );
const executionReady = () => !offline && Date.now() - lastSuccess <= 10000;

// React parts mount into persistent containers keyed by `key`, so a re-render
// of the plain DOM moves them instead of remounting (terminal scroll survives).
function slot(key, name, props, cls = "") {
  const ui = window.BrokerUI;
  if (!ui)
    return el(
      "div",
      "ui-missing",
      "화면 구성 요소(ui/components.js)를 불러오지 못했습니다. npm run build 후 브로커를 다시 시작하세요.",
    );
  return ui.slot(key, name, props, cls);
}

function route() {
  const hash = location.hash;
  if (hash === "#/structure") return { view: "structure" };
  const m = hash.match(/^#\/p\/(.+)$/) ?? hash.match(/^#([a-zA-Z0-9_-]+)$/);
  if (m) {
    try {
      return { view: "detail", id: decodeURIComponent(m[1]) };
    } catch {
      /* Invalid fragments fall back to the overview. */
    }
  }
  return { view: "overview" };
}
const go = (hash) => {
  if (location.hash !== hash) location.hash = hash;
  else render();
};

function render() {
  if (!snapshot) return;
  const focusKey = document.activeElement?.dataset?.focus;
  const r = route();
  const project =
    r.view === "detail"
      ? snapshot.projects.find((p) => p.project_id === r.id)
      : null;
  document.body.dataset.view =
    r.view === "structure" ? "structure" : "dashboard";
  document.querySelectorAll("[data-view]").forEach((a) => {
    a.setAttribute(
      "aria-selected",
      String(
        a.dataset.view === (r.view === "structure" ? "structure" : "dashboard"),
      ),
    );
  });
  window.BrokerUI?.begin();
  renderToolbar();
  renderList(project?.project_id);
  renderBanners(r.view === "detail" ? project : null, r.view);
  if (r.view === "structure") renderStructure(project);
  else if (r.view === "detail" && project) renderDetail(project);
  else if (r.view === "detail") renderMissing(r.id);
  else renderOverview();
  renderInspector(r.view === "detail" ? project : null);
  window.BrokerUI?.end();
  if (focusKey)
    [...document.querySelectorAll("[data-focus]")]
      .find((n) => n.dataset.focus === focusKey)
      ?.focus({ preventScroll: true });
}

function renderToolbar() {
  const waiting = snapshot.projects.filter((p) => openQuestions(p).length);
  $("attn-open").hidden = !waiting.length;
  $("attn-count").textContent = waiting.length;
  $("attn-open").onclick = () =>
    waiting[0] && go(`#/p/${encodeURIComponent(waiting[0].project_id)}`);
  $("revision").textContent =
    `broker v${window.homepageBoot?.version ?? "—"} · revision ${snapshot.revision}`;
}

function listSub(p) {
  const sub = el("span", "list-sub");
  const g = groupOf(p);
  if (p.stall) {
    sub.dataset.tone = "warn";
    sub.append(dot("warn"), `응답 없음 ${p.stall.minutes}분`);
  } else if (openQuestions(p).length) {
    sub.dataset.tone = "warn";
    sub.append(dot("warn"), `입력 필요 ${openQuestions(p).length}건`);
  } else if (g === "active") {
    const t = currentTask(p);
    sub.append(
      dot("running"),
      `${t ? t.task_id : names[p.status]} · 작업 ${done(p)}/${p.tasks.length}`,
    );
  } else if (g === "review") {
    const port = p.preview.url ? new URL(p.preview.url).port : "";
    sub.append(dot("ok"), port ? `미리보기 :${port}` : "검토 대기");
  } else if (g === "queued") {
    sub.append(
      dot(),
      p.execution_requested ? "큐 대기 · 시작 요청됨" : "큐 대기",
    );
  } else if (g === "paused") {
    sub.append(dot(), `일시정지${p.reason ? ` · ${p.reason}` : ""}`);
  } else
    sub.append(dot(p.status === "failed" ? "danger" : ""), names[p.status]);
  return sub;
}
function listEnd(p) {
  const g = groupOf(p);
  if (g === "active") return duration(minutesSince(p.created_at));
  if (!p.created_at) return "";
  const today =
    new Date().toDateString() === new Date(p.created_at).toDateString();
  return today ? hm(p.created_at) : day(p.created_at);
}
function renderList(selectedId) {
  const term = $("search").value.trim().toLocaleLowerCase();
  const ps = snapshot.projects;
  for (const key of Object.keys(filters))
    document.querySelector(`[data-count="${key}"]`).textContent = ps.filter(
      filters[key],
    ).length;
  const visible = ps.filter(
    (p) =>
      filters[filter](p) && p.project_id.toLocaleLowerCase().includes(term),
  );
  const list = $("project-list");
  list.replaceChildren();
  for (const [key, title, statuses] of groups) {
    const items = visible
      .filter((p) => statuses.includes(p.status))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    if (!items.length) continue;
    const head = el("div", "list-head");
    head.append(el("span", "", title), el("span", "num", items.length));
    const box = el("div", "list");
    for (const p of items) {
      const row = el("a", "list-row");
      row.href = `#/p/${encodeURIComponent(p.project_id)}`;
      row.dataset.focus = `project:${p.project_id}`;
      row.setAttribute("aria-selected", String(p.project_id === selectedId));
      const thumb =
        key === "active" || key === "review"
          ? slot(
              `thumb:${p.project_id}`,
              "ListThumb",
              {
                projectId: p.project_id,
                runId: p.run_id,
                revision: p.revision,
              },
              "list-thumb",
            )
          : el("span", "list-thumb");
      const main = el("span", "list-main");
      main.append(el("span", "list-title", p.project_id), listSub(p));
      row.append(thumb, main, el("span", "list-end", listEnd(p)));
      box.append(row);
    }
    list.append(head, box);
  }
  if (!list.children.length)
    list.append(
      el(
        "p",
        "list-empty",
        ps.length
          ? "검색 조건에 맞는 프로젝트가 없습니다."
          : "접수된 프로젝트가 없습니다.",
      ),
    );
}

function banner(tone, iconName, title, body, action) {
  const b = el("div", "banner");
  b.dataset.tone = tone;
  b.setAttribute("role", tone === "danger" ? "alert" : "status");
  const text = el("div", "banner-text");
  if (title) text.append(el("b", "", title), " ");
  text.append(body);
  b.append(icon(iconName, "icon"), text);
  if (action) b.append(action);
  return b;
}
function stallText(p) {
  const s = p.stall;
  return `${s.task_id} 태스크가 진행 중이지만 Herdr 상태가 ${runtimeNames[s.status] ?? s.status}입니다(${hm(s.since)}부터). 멈춤을 감지하면 Herdr 알림을 한 번 보냅니다. 터미널을 확인하세요.`;
}
function focusButton(p, cls = "btn btn-sm") {
  const b = button("Herdr에서 열기", cls, "external", () =>
    window.homepage?.focusProject(p.project_id),
  );
  b.disabled = !p.workspace_id;
  b.title = p.workspace_id
    ? `workspace ${p.workspace_id}`
    : "아직 Herdr workspace가 없습니다";
  return b;
}
function renderBanners(project, view) {
  const out = [];
  if (!snapshot.execution_enabled)
    out.push(
      banner(
        "warn",
        "pause",
        "",
        "관리자 설정에 따라 모델 실행이 중지되어 있습니다.",
      ),
    );
  if (snapshot.runtime_error)
    out.push(
      banner(
        "warn",
        "alert",
        "Herdr 상태 확인이 필요합니다.",
        `오류 코드: ${snapshot.runtime_error}`,
      ),
    );
  if (snapshot.projection_pending)
    out.push(
      banner(
        "warn",
        "alert",
        "",
        "프로젝트 JSON 파일 반영이 지연되고 있습니다. 화면은 브로커 상태를 그대로 표시합니다.",
      ),
    );
  if (snapshot.storage_fault)
    out.push(
      banner(
        "danger",
        "fail",
        "상태 저장에 문제가 생겼습니다.",
        "CLI에서 브로커 상태를 확인하세요.",
      ),
    );
  if (view !== "structure")
    for (const p of project ? [project] : snapshot.projects)
      if (p.stall)
        out.push(
          banner(
            "warn",
            "alert",
            `${p.project_id} · PM이 ${p.stall.minutes}분째 응답이 없습니다.`,
            stallText(p),
            focusButton(p),
          ),
        );
  $("banners").replaceChildren(...out);
}

function head(titleNodes, meta, actions = []) {
  $("page-title").replaceChildren(...titleNodes);
  $("page-meta").textContent = meta;
  $("page-actions").replaceChildren(...actions);
}

function stat(label, value, sub, tone, iconName) {
  const s = el("div", "stat");
  if (tone) s.dataset.tone = tone;
  const l = el("span", "stat-label");
  if (iconName) l.append(icon(iconName, "icon icon-xs"));
  l.append(label);
  s.append(l, el("span", "stat-value", value), el("span", "stat-sub", sub));
  return s;
}

function stageBar(p, size) {
  return slot(`stages:${size}:${p.project_id}`, "StageBar", { project: p });
}

function liveCard(p) {
  const card = el("article", "live-card");
  if (p.stall || openQuestions(p).length) card.dataset.tone = "warn";
  const top = el("div", "card-head");
  const title = el("div", "card-title");
  const row = el("div", "card-title-row");
  row.append(el("h2", "", p.project_id), statusBadge(p));
  const meta = el("div", "card-meta");
  meta.append(
    `접수 후 ${duration(minutesSince(p.created_at))} · ${p.slot ? "슬롯 사용" : "슬롯 없음"} · 작업 ${done(p)}/${p.tasks.length} · run `,
    mono(shortId(p.run_id)),
  );
  title.append(row, meta);
  const actions = el("div", "button-row");
  const detail = el("a", "btn btn-sm", "상세 보기");
  detail.href = `#/p/${encodeURIComponent(p.project_id)}`;
  actions.append(focusButton(p), detail);
  top.append(title, actions);
  const stages = el("div", "card-section");
  stages.append(stageBar(p, "card"));
  const split = el("div", "card-split");
  split.append(
    slot(
      `term:card:${p.project_id}`,
      "TerminalMirror",
      {
        projectId: p.project_id,
        size: "compact",
        interval: 2000,
        agents: p.agents,
      },
      "term-slot",
    ),
    slot(
      `shots:card:${p.project_id}`,
      "ShotStrip",
      {
        projectId: p.project_id,
        runId: p.run_id,
        revision: p.revision,
      },
      "shots-slot",
    ),
  );
  card.append(top, stages, split);
  if (openQuestions(p).length) {
    const q = el("div", "card-section");
    const note = el("div", "note");
    note.dataset.tone = "warn";
    const main = el("div", "note-main");
    main.append(
      el(
        "span",
        "note-title",
        `사용자 확인이 필요합니다 · ${openQuestions(p).length}건`,
      ),
      el("span", "note-body", openQuestions(p)[0].question),
    );
    note.append(icon("question", "icon"), main);
    q.append(note);
    card.append(q);
  }
  return card;
}

function executeButton(p) {
  const b = button(
    p.status === "paused" ? "작업 재개" : "제작 시작",
    "btn btn-sm",
    "play",
    () => {
      if (!executionReady()) return;
      window.homepage?.executeProject(p.project_id, p.run_id);
    },
  );
  b.dataset.executionControl = "true";
  b.dataset.focus = `execute:${p.project_id}`;
  b.disabled = offline || !snapshot.execution_enabled;
  return b;
}
function rowCard(p, sub, actions) {
  const row = el("div", "row-card");
  const main = el("div", "row-main");
  const title = el("a", "row-title", p.project_id);
  title.href = `#/p/${encodeURIComponent(p.project_id)}`;
  const line = el("span", "row-sub", sub);
  main.append(title, line);
  row.append(main, statusBadge(p), ...actions);
  return row;
}
function previewLink(p, cls = "btn btn-sm") {
  if (!p.preview.url) return null;
  const a = el("a", cls);
  a.append(icon("globe"), "미리보기");
  a.href = p.preview.url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.onclick = (e) => {
    if (!executionReady()) e.preventDefault();
  };
  return a;
}

function renderOverview() {
  const ps = snapshot.projects;
  head(
    [el("h1", "", "홈페이지 제작 현황")],
    `homepage 세션 · 프로젝트 ${ps.length}개 · 마지막 수신 ${snapshot.observed_at ? clock(snapshot.observed_at) : "—"}`,
    [window.homepageMcpBadge?.() ?? el("span")],
  );
  const view = $("view");
  if (!ps.length) {
    const empty = el("div", "empty-state");
    empty.append(
      el("p", "display", "첫 번째 홈페이지를 기다립니다"),
      el(
        "p",
        "muted",
        "툴바의 제작 요청에서 샘플을 채우거나 PRD와 디자인 문서를 작성해 접수하세요.",
      ),
    );
    view.replaceChildren(empty);
    return;
  }
  const by = (g) => ps.filter((p) => groupOf(p) === g);
  const active = by("active"),
    queued = by("queued"),
    paused = by("paused"),
    review = by("review"),
    ended = by("ended");
  const stalled = ps.filter((p) => p.stall);
  const waiting = ps.filter((p) => openQuestions(p).length);
  const slots = ps.filter((p) => p.slot).length;
  const stats = el("div", "stats");
  stats.append(
    stat(
      "실행 슬롯",
      `${slots}/2`,
      slots >= 2 ? "빈 슬롯 없음" : `빈 슬롯 ${2 - slots}개`,
    ),
    stat(
      "큐 대기",
      queued.length,
      queued[0]?.project_id ?? "대기 중인 요청 없음",
    ),
    stat(
      "입력 필요",
      waiting.length,
      waiting[0]?.project_id ?? "답할 질문 없음",
      waiting.length ? "warn" : null,
      waiting.length ? "question" : null,
    ),
    stat(
      "응답 없음",
      stalled.length,
      stalled.length
        ? `${stalled[0].project_id} · ${stalled[0].stall.minutes}분`
        : "멈춘 작업 없음",
      stalled.length ? "warn" : null,
      stalled.length ? "alert" : null,
    ),
    stat(
      "검토 대기",
      review.length,
      `미리보기 ${review.filter((p) => p.preview.url).length}개 켜짐`,
    ),
  );
  const parts = [stats];
  if (active.length) {
    const list = el("div", "stack");
    list.append(...active.map(liveCard));
    parts.push(
      section(`진행 중 · ${active.length}`, `슬롯 ${slots}/2 사용 중`, list),
    );
  }
  if (queued.length) {
    const g = el("div", "group");
    g.append(
      ...queued.map((p) =>
        rowCard(
          p,
          p.execution_requested
            ? "시작 요청 접수됨 · 슬롯과 큐 순서를 기다립니다."
            : "제작 시작을 누르면 실행 준비를 확인하고 큐에 올립니다.",
          p.execution_requested ? [] : [executeButton(p)],
        ),
      ),
    );
    parts.push(section(`큐 대기 · ${queued.length}`, "최대 2개 동시 제작", g));
  }
  if (paused.length) {
    const g = el("div", "group");
    g.append(
      ...paused.map((p) =>
        rowCard(
          p,
          reasons[p.reason] ?? p.reason ?? "명시적인 재개가 필요합니다.",
          [executeButton(p)],
        ),
      ),
    );
    parts.push(
      section(`일시정지 · ${paused.length}`, "재개해야 진행합니다", g),
    );
  }
  if (review.length) {
    const grid = el("div", "review-grid");
    for (const p of review) {
      const card = el("article", "review-card");
      const title = el("a", "row-title", p.project_id);
      title.href = `#/p/${encodeURIComponent(p.project_id)}`;
      const sub = el("div", "row-sub");
      sub.append(
        el("span", "", p.created_at ? day(p.created_at) : ""),
        statusBadge(p),
      );
      const actions = el("div", "button-row");
      const link = previewLink(p);
      if (link) actions.append(link);
      const more = el("a", "btn btn-sm", "상세 보기");
      more.href = title.href;
      actions.append(more);
      card.append(
        slot(`cover:${p.project_id}`, "ShotCover", {
          projectId: p.project_id,
          runId: p.run_id,
          revision: p.revision,
        }),
        title,
        sub,
        actions,
      );
      grid.append(card);
    }
    parts.push(
      section(`검토 대기 · ${review.length}`, "결과 스크린샷 · 미리보기", grid),
    );
  }
  if (ended.length) {
    const g = el("div", "group");
    g.append(
      ...ended.map((p) => rowCard(p, reasons[p.reason] ?? p.reason ?? "", [])),
    );
    parts.push(section(`종료 · ${ended.length}`, "", g));
  }
  $("view").replaceChildren(...parts);
}

function renderMissing(id) {
  head([el("h1", "", "프로젝트를 찾을 수 없습니다")], "", []);
  const empty = el("div", "empty-state");
  const back = el("a", "btn", "대시보드로");
  back.href = "#/";
  empty.append(
    el("p", "display", id),
    el("p", "muted", "이 브로커 상태에 없는 프로젝트입니다."),
    back,
  );
  $("view").replaceChildren(empty);
}

function renderDetail(p) {
  const back = el("a", "icon-btn");
  back.href = "#/";
  back.setAttribute("aria-label", "대시보드로");
  back.append(icon("back", "icon"));
  const stateButton = button("상태 JSON", "btn btn-sm", "braces", () =>
    window.homepage?.inspectProject(p.project_id),
  );
  stateButton.dataset.focus = "json-state";
  head(
    [back, el("h1", "", p.project_id), statusBadge(p)],
    `작업 ${done(p)}/${p.tasks.length} · 접수 ${p.created_at ? `${day(p.created_at)} ${hm(p.created_at)}` : "—"}`,
    [previewLink(p), stateButton, focusButton(p)].filter(Boolean),
  );
  const parts = [];
  if (
    ["queued", "paused"].includes(p.status) &&
    !(p.status === "queued" && p.execution_requested)
  ) {
    const note = el("div", "note");
    const main = el("div", "note-main");
    main.append(
      el(
        "span",
        "note-title",
        p.status === "paused"
          ? "중단된 작업을 이어서 진행합니다"
          : "홈페이지 제작을 시작합니다",
      ),
      el(
        "span",
        "note-body",
        snapshot.execution_enabled
          ? `${p.status === "paused" && p.reason ? `${reasons[p.reason] ?? p.reason}\n` : ""}문서와 플러그인 준비를 확인한 뒤 시작·재개합니다. 최대 2개까지 동시에 진행합니다.`
          : "관리자 설정에서 실행이 중지되어 있습니다.",
      ),
    );
    note.append(icon("play", "icon"), main, executeButton(p));
    parts.push(note);
  } else if (p.reason || p.resume_required || p.unknown_operations.length) {
    const note = el("div", "note");
    note.dataset.tone = p.status === "failed" ? "danger" : "warn";
    const main = el("div", "note-main");
    main.append(
      el(
        "span",
        "note-body",
        [
          reasons[p.reason] ?? p.reason,
          p.resume_required ? "명시적인 재개 요청이 필요합니다." : "",
          p.unknown_operations.length
            ? `접수 확인이 필요한 외부 요청 ${p.unknown_operations.length}건`
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
      ),
    );
    note.append(icon("alert", "icon"), main);
    parts.push(note);
  }
  const questions = openQuestions(p);
  if (questions.length) {
    const note = el("div", "note");
    note.dataset.tone = "warn";
    const main = el("div", "note-main");
    main.append(
      el(
        "span",
        "note-title",
        `사용자 확인이 필요합니다 · ${questions.length}건`,
      ),
    );
    for (const q of questions) {
      const item = el("div", "question");
      const meta = el("span", "meta muted");
      meta.append(`작업 ${q.task_id} · 요청 `, mono(shortId(q.request_id)));
      item.append(el("span", "note-body", q.question), meta);
      main.append(item);
    }
    main.append(
      el(
        "span",
        "help",
        "답변은 브로커 CLI의 answer --file 명령으로 전달합니다. 문서 변경이 필요하면 prd.md와 design.md를 갱신한 뒤 apply-inputs로 전달합니다.",
      ),
    );
    note.append(icon("question", "icon"), main);
    parts.push(note);
  }
  const tasks = el("div", "group task-list");
  for (const t of p.tasks) {
    const row = el("div", "group-row");
    const main = el("div", "task-main");
    const title = el("span", "ui", t.title);
    const meta = el("span", "meta muted");
    meta.append(
      mono(t.task_id),
      ` · ${roles[t.role] ?? t.role} · 실행 ${t.attempt}회${t.updated_at ? ` · 최근 보고 ${clock(t.updated_at)}` : ""}`,
    );
    main.append(title, meta);
    if (t.result) main.append(el("span", "task-result", t.result));
    const b = badge(
      taskNames[t.status] ?? t.status,
      {
        completed: "ok",
        failed: "danger",
        waiting_input: "warn",
        retrying: "warn",
      }[t.status],
    );
    if (t.status === "running") b.prepend(dot("running"));
    row.append(main, b);
    tasks.append(row);
  }
  if (!p.tasks.length)
    tasks.append(
      groupBox([["계획", "PM이 계획을 등록하면 작업이 표시됩니다."]])
        .firstChild,
    );
  const stages = el("div", "stack");
  stages.append(stageBar(p, "detail"), tasks);
  parts.push(section("진행 단계", `작업 ${done(p)}/${p.tasks.length}`, stages));
  parts.push(
    section(
      "터미널",
      "1초마다 갱신 · 읽기 전용",
      slot(`term:detail:${p.project_id}`, "TerminalMirror", {
        projectId: p.project_id,
        size: "large",
        interval: 1000,
        agents: p.agents,
      }),
    ),
  );
  parts.push(
    section(
      "결과 스크린샷",
      "look.py 회차별",
      slot(`gallery:${p.project_id}`, "ShotGallery", {
        projectId: p.project_id,
        runId: p.run_id,
        revision: p.revision,
      }),
    ),
  );
  parts.push(
    section(
      "활동",
      "events.jsonl · 이 run",
      slot(`timeline:${p.project_id}`, "Timeline", {
        projectId: p.project_id,
        runId: p.run_id,
        revision: p.revision,
      }),
    ),
  );
  $("view").replaceChildren(...parts);
}

function renderStructure(project) {
  head([el("h1", "", "서비스 구조")], "시스템 · 제작 흐름 · 실행 상태", []);
  const selected =
    project ??
    snapshot.projects.find((p) => groupOf(p) === "active") ??
    snapshot.projects[0] ??
    null;
  $("view").replaceChildren(
    slot("structure", "Structure", {
      project: selected,
      projects: snapshot.projects,
    }),
  );
}

function renderInspector(p) {
  document.querySelectorAll("[data-tab]").forEach((t) => {
    t.setAttribute("aria-selected", String(t.dataset.tab === inspectorTab));
    t.disabled = !p && t.dataset.tab === "ids";
  });
  const body = $("inspector-body");
  if (!p) {
    const boot = window.homepageBoot;
    body.replaceChildren(
      section(
        "세션",
        "",
        groupBox([
          ["세션", mono("homepage")],
          ["버전", boot ? `v${boot.version}` : "—"],
          ["모델 실행", snapshot.execution_enabled ? "허용" : "중지됨"],
          [
            "응답 없음 기준",
            boot?.stall_after_minutes ? `${boot.stall_after_minutes}분` : "—",
          ],
          [
            "상태 수신",
            transport === "stream" ? "실시간(SSE)" : "2초 간격 조회",
          ],
          ["revision", el("span", "num", snapshot.revision)],
        ]),
      ),
      section(
        "프로젝트",
        "",
        groupBox(
          groups
            .map(([key, title]) => [
              title,
              snapshot.projects.filter((x) => groupOf(x) === key).length,
            ])
            .filter(([, n]) => n),
        ),
      ),
      el(
        "p",
        "help",
        "목록에서 프로젝트를 고르면 실행 상세와 식별 정보를 표시합니다.",
      ),
    );
    return;
  }
  if (inspectorTab === "ids") {
    body.replaceChildren(
      section(
        "경로",
        "",
        groupBox([
          ["디렉터리", mono(p.directory)],
          ["소스", mono(`${p.directory}/app`)],
          ["run", mono(p.run_id)],
        ]),
      ),
      section(
        "Herdr",
        "",
        groupBox([
          ["workspace", mono(p.workspace_id ?? "배정 전")],
          ...p.agents.flatMap((a) => [
            [`${roles[a.role] ?? a.role} pane`, mono(a.pane_id ?? "배정 전")],
            [
              `${roles[a.role] ?? a.role} terminal`,
              mono(a.terminal_id ?? "배정 전"),
            ],
          ]),
        ]),
      ),
      section(
        "상태",
        "",
        groupBox([["revision", el("span", "num", p.revision)]]),
      ),
    );
    return;
  }
  const parts = [
    section(
      "실행",
      "",
      groupBox([
        ["상태", statusBadge(p)],
        ["run", mono(shortId(p.run_id))],
        [
          "모드",
          p.orchestration?.mode === "claude-native"
            ? "claude-native · PM 1명"
            : (p.orchestration?.mode ?? "legacy"),
        ],
        ["슬롯", p.slot ? "사용 중" : "없음"],
        ["재개 필요", p.resume_required ? "예" : "아니요"],
        [
          "접수",
          p.created_at ? `${day(p.created_at)} ${clock(p.created_at)}` : "—",
        ],
      ]),
    ),
  ];
  for (const a of p.agents) {
    const herdr = el("span", "");
    herdr.append(
      dot(
        !a.runtime.fresh
          ? ""
          : ["working", "busy"].includes(a.runtime.status)
            ? "running"
            : a.runtime.status === "blocked"
              ? "warn"
              : "",
      ),
      " ",
      a.runtime.fresh
        ? (runtimeNames[a.runtime.status] ?? a.runtime.status)
        : "갱신 대기",
    );
    const since = minutesSince(a.runtime.changed_at);
    parts.push(
      section(
        `에이전트 · ${roles[a.role] ?? a.role}`,
        a.model,
        groupBox([
          ["업무 상태", a.status],
          ["Herdr 상태", herdr],
          ["상태 유지", since === null ? "—" : `${duration(since)}째`],
          ["담당 작업", a.task_id ? mono(a.task_id) : "—"],
          ["pane", mono(a.pane_id ?? "배정 전")],
          ["입력 가능", a.runtime.interactive_ready ? "예" : "아니요"],
        ]),
      ),
    );
  }
  parts.push(
    section(
      "미리보기",
      "",
      groupBox([
        ["상태", p.preview.status],
        ["주소", p.preview.url ? mono(p.preview.url) : "—"],
        ["오류", p.preview.error ?? undefined],
      ]),
    ),
  );
  if (p.active_operations.length || p.unknown_operations.length)
    parts.push(
      section(
        "외부 작업",
        "",
        groupBox([
          ...p.active_operations.map((o) => ["진행 중", mono(o.kind)]),
          ...p.unknown_operations.map((o) => ["확인 필요", mono(o.kind)]),
        ]),
      ),
    );
  body.replaceChildren(...parts);
}

function acceptSnapshot(data, via) {
  if (data.session !== "homepage" || !Array.isArray(data.projects))
    throw new Error("세션 불일치");
  if (snapshot && data.revision < snapshot.revision) return;
  const next = JSON.stringify({
    ...data,
    observed_at: undefined,
    revision: undefined,
    projects: data.projects.map((p) => ({
      ...p,
      agents: p.agents.map((a) => ({
        ...a,
        runtime: { ...a.runtime, observed_at: undefined },
      })),
    })),
  });
  snapshot = data;
  transport = via;
  lastSuccess = Date.now();
  offline = false;
  document.querySelectorAll("[data-execution-control]").forEach((b) => {
    b.disabled = !snapshot.execution_enabled;
  });
  document.body.dataset.offline = "false";
  const c = $("connection");
  c.replaceChildren(
    dot("ok"),
    via === "stream" ? "실시간 연결" : "자동 갱신 중",
  );
  $("error").hidden = true;
  if (next !== signature) {
    signature = next;
    render();
  }
}
function markOffline() {
  offline = true;
  document
    .querySelectorAll("[data-execution-control]")
    .forEach((b) => (b.disabled = true));
  document.body.dataset.offline = "true";
  $("connection").replaceChildren(dot("danger"), "상태 갱신 지연");
  $("error").hidden = false;
  $("error-text").textContent = snapshot
    ? "최신 상태를 가져오지 못했습니다. 아래는 마지막 수신 기록이며 자동으로 다시 연결합니다."
    : "브로커 연결을 기다리고 있습니다. 자동으로 다시 연결합니다.";
}
async function refresh() {
  if (busy) return;
  busy = true;
  try {
    const res = await fetch("/api/status", {
      cache: "no-store",
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) throw new Error("상태 조회 지연");
    acceptSnapshot(await res.json(), "poll");
  } catch {
    markOffline();
  } finally {
    busy = false;
  }
}
window.homepageRefresh = refresh;
window.homepageRender = render;

document.querySelectorAll("[data-icon]").forEach((node) => {
  node.prepend(
    icon(
      node.dataset.icon,
      node.classList.contains("icon-btn") ? "icon" : "icon icon-sm",
    ),
  );
});
$("search").oninput = render;
document.querySelectorAll("[data-filter]").forEach((b) => {
  b.onclick = () => {
    filter = b.dataset.filter;
    document
      .querySelectorAll("[data-filter]")
      .forEach((x) => x.setAttribute("aria-checked", String(x === b)));
    render();
  };
});
document.querySelectorAll("[data-tab]").forEach((t) => {
  t.onclick = () => {
    inspectorTab = t.dataset.tab;
    render();
  };
});
$("inspector-toggle").onclick = () => {
  const on = document.body.dataset.inspector === "off";
  document.body.dataset.inspector = on ? "on" : "off";
  $("inspector-toggle").setAttribute("aria-pressed", String(on));
  try {
    localStorage.setItem("homepage-inspector", on ? "on" : "off");
  } catch {}
};
try {
  if (localStorage.getItem("homepage-inspector") === "off")
    $("inspector-toggle").click();
} catch {}
window.addEventListener("hashchange", () => {
  render();
  $("content").scrollTop = 0;
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void refresh();
});
void refresh();
setInterval(() => {
  if (!document.hidden && !window.homepageStreamFresh?.()) void refresh();
  if (!document.hidden && lastSuccess && Date.now() - lastSuccess > 10000)
    markOffline();
}, 2000);
// Elapsed labels ("접수 후 47분") age without a new snapshot.
setInterval(() => {
  if (!document.hidden) render();
}, 30000);
