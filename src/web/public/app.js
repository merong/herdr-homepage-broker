const $ = (id) => document.getElementById(id);
const names = {
  queued: "큐 대기",
  starting: "준비 중",
  running: "진행 중",
  waiting_input: "입력 대기",
  retrying: "재시도",
  paused: "일시 정지",
  cancelling: "취소 중",
  review_pending: "검토 대기",
  failed: "실패",
  cancelled: "취소됨",
  superseded: "이전 실행",
  pending: "대기",
  completed: "완료",
  ready: "준비됨",
  working: "작업 중",
  waiting: "대기",
  stopped: "정지",
  unknown: "확인 필요",
  idle: "유휴",
  busy: "작업 중",
  blocked: "입력 필요",
  open: "답변 대기",
  awaiting_documents: "문서 갱신 대기",
  answered: "답변 수신",
};
const roles = { pm: "총괄 PM", developer: "개발자", designer: "디자이너" };
const initials = { pm: "PM", developer: "DEV", designer: "DES" };
const reasons = {
  broker_restarted:
    "브로커가 재시작되었습니다. 실행 준비를 확인한 후 작업을 재개하세요.",
  operation_unknown: "외부 요청의 접수 여부를 확인해야 합니다.",
  resource_missing: "에이전트 실행 자원을 찾을 수 없습니다.",
  resource_owner_mismatch: "실행 자원의 소유 정보가 일치하지 않습니다.",
};
let snapshot,
  filter = "all",
  selected = "",
  busy = false,
  offline = true,
  signature = "",
  lastSuccess = 0;
const expanded = new Set();
try {
  selected = decodeURIComponent(location.hash.slice(1));
} catch {
  /* Invalid fragments do not affect the broker. */
}

// All broker-provided strings are text nodes, including titles and questions.
function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = String(text);
  return node;
}
function badge(status) {
  return el(
    "span",
    `badge ${Object.hasOwn(names, status) ? status : "unknown"}`,
    names[status] ?? status,
  );
}
function section(title, note) {
  const row = el("div", "section-head");
  row.append(el("h3", "", title), el("span", "", note));
  return row;
}
function empty(title, description) {
  const node = el("div", "empty");
  node.append(
    el("span", "empty-icon", "◫"),
    el("h2", "", title),
    el("p", "", description),
  );
  return node;
}
function visibleProjects() {
  const term = $("search").value.toLocaleLowerCase();
  return snapshot.projects.filter(
    (p) =>
      p.project_id.toLocaleLowerCase().includes(term) &&
      (filter === "all" ||
        (filter === "input" && p.input_required) ||
        (filter === "review" && p.status === "review_pending") ||
        (filter === "active" &&
          ["starting", "running", "retrying", "cancelling"].includes(
            p.status,
          ))),
  );
}
function render() {
  if (!snapshot) return;
  const focusKey = document.activeElement?.dataset.focus;
  const ps = snapshot.projects,
    visible = visibleProjects();
  if (!visible.some((p) => p.project_id === selected))
    selected = visible[0]?.project_id ?? "";
  $("slots").textContent = ps.filter((p) => p.slot).length;
  $("queued").textContent = ps.filter((p) => p.status === "queued").length;
  $("waiting").textContent = ps.filter((p) => p.input_required).length;
  $("review").textContent = ps.filter(
    (p) => p.status === "review_pending",
  ).length;
  $("total").textContent = ps.length;
  $("nav-count").textContent = ps.length;
  $("revision").textContent = `revision ${snapshot.revision}`;
  const notices = [];
  if (!snapshot.execution_enabled)
    notices.push("관리자 설정에 따라 모델 실행이 중지되어 있습니다.");
  if (snapshot.runtime_error)
    notices.push(`Herdr 상태 확인 필요: ${snapshot.runtime_error}`);
  if (snapshot.projection_pending)
    notices.push(
      "프로젝트 JSON 파일 반영이 지연되고 있습니다. 현재 화면은 브로커 상태를 표시합니다.",
    );
  if (snapshot.storage_fault)
    notices.push(
      "상태 저장에 문제가 발생했습니다. CLI에서 브로커 상태를 확인하세요.",
    );
  $("notice").textContent = notices.join("\n");
  $("notice").hidden = !notices.length;
  const list = $("project-list");
  list.replaceChildren();
  for (const p of visible) {
    const button = el("button", "project");
    button.dataset.focus = `project:${p.project_id}`;
    button.setAttribute("aria-pressed", String(p.project_id === selected));
    const top = el("span", "project-top");
    top.append(el("span", "project-title", p.project_id), badge(p.status));
    button.append(
      top,
      el(
        "div",
        "project-sub",
        `${p.tasks.filter((t) => t.status === "completed").length} / ${p.tasks.length} 작업 완료 · ${p.slot ? "슬롯 사용 중" : "슬롯 미사용"}`,
      ),
    );
    if (p.input_required)
      button.append(el("div", "project-hint", "● 사용자 입력이 필요합니다"));
    button.onclick = () => {
      selected = p.project_id;
      history.replaceState(null, "", `#${encodeURIComponent(selected)}`);
      render();
    };
    list.append(button);
  }
  if (!visible.length)
    list.append(
      el(
        "p",
        "empty-list",
        ps.length
          ? "검색 조건에 맞는 프로젝트가 없습니다."
          : "접수된 프로젝트가 없습니다.",
      ),
    );
  const p = visible.find((p) => p.project_id === selected);
  $("detail").replaceChildren(
    p
      ? projectDetail(p)
      : empty(
          ps.length
            ? "다른 프로젝트를 찾아보세요"
            : "첫 번째 홈페이지를 기다립니다",
          ps.length
            ? "검색어나 상태 필터를 변경해보세요."
            : "제작 요청에서 샘플을 선택하거나\nPRD와 디자인 문서를 작성해 접수하세요.",
        ),
  );
  if (focusKey)
    [...document.querySelectorAll("[data-focus]")]
      .find((n) => n.dataset.focus === focusKey)
      ?.focus({ preventScroll: true });
}
function projectDetail(p) {
  const root = el("div");
  const header = el("div", "detail-top"),
    title = el("div");
  title.append(
    el("p", "eyebrow", "PROJECT OVERVIEW"),
    el("h2", "detail-title", p.project_id),
    badge(p.status),
  );
  const actions = el("div", "detail-actions");
  const stateButton = el("button", "button small", "JSON 상태 확인");
  stateButton.dataset.focus = "json-state";
  stateButton.onclick = () => window.homepage?.inspectProject(p.project_id);
  actions.append(stateButton);
  if (p.preview.url) {
    const link = el("a", "button primary preview-link", "미리보기 열기 ↗");
    const u = new URL(p.preview.url);
    if (
      u.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)
    ) {
      link.href = u.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.dataset.focus = "preview";
      link.onclick = (e) => {
        if (offline || Date.now() - lastSuccess > 10000) e.preventDefault();
      };
      actions.append(link);
    }
  } else
    actions.append(
      el(
        "span",
        "badge",
        `미리보기 ${names[p.preview.status] ?? p.preview.status}`,
      ),
    );
  header.append(title, actions);
  root.append(header);
  if (["queued", "paused"].includes(p.status)) {
    const controls = el("section", "execution-panel");
    const text = el("div");
    text.append(
      el(
        "h3",
        "",
        p.status === "paused"
          ? "중단된 작업을 이어서 진행"
          : "홈페이지 제작 시작",
      ),
    );
    text.append(
      el(
        "p",
        "help",
        snapshot.execution_enabled
          ? "문서와 플러그인 준비를 확인하고 시작·재개합니다. 실행 구성은 자동 준비되며 최대 2개까지 진행합니다."
          : "관리자 설정에서 실행이 중지되어 있습니다.",
      ),
    );
    const start = el(
      "button",
      "button primary",
      p.status === "paused" ? "작업 재개" : "제작 시작",
    );
    start.dataset.focus = "execute-project";
    start.dataset.executionControl = "true";
    start.disabled = offline;
    start.onclick = () => {
      if (offline || Date.now() - lastSuccess > 10000) return;
      window.homepage?.executeProject(p.project_id, p.run_id);
    };
    controls.append(text, start);
    root.append(controls);
  }
  const done = p.tasks.filter((t) => t.status === "completed").length;
  const ph = el("div", "progress-heading");
  ph.append(
    el("span", "", "작업 진행"),
    el(
      "span",
      "",
      p.tasks.length
        ? `${done} / ${p.tasks.length} 완료`
        : "PM의 작업 계획을 기다리는 중",
    ),
  );
  const progress = el("progress");
  progress.max = p.tasks.length || 1;
  progress.value = done;
  progress.setAttribute("aria-label", "완료한 작업 수");
  root.append(ph, progress);
  if (p.reason || p.resume_required || p.unknown_operations.length) {
    const info = el("p", "notice");
    info.textContent = [
      reasons[p.reason] ?? p.reason,
      p.resume_required ? "명시적인 재개 요청이 필요합니다." : "",
      p.unknown_operations.length
        ? `접수 확인이 필요한 외부 요청 ${p.unknown_operations.length}건`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
    root.append(info);
  }
  root.append(section("담당 에이전트", "Claude Opus 5.5 · High"));
  const agents = el("div", "agents");
  for (const a of p.agents) {
    const card = el("article", "agent"),
      top = el("div", "agent-top");
    top.append(
      el("span", `avatar ${a.role}`, initials[a.role] ?? "—"),
      el("span", "agent-name", roles[a.role] ?? a.role),
    );
    card.append(top, badge(a.status));
    card.append(
      el(
        "p",
        "",
        a.runtime.fresh
          ? `실행 상태: ${names[a.runtime.status] ?? a.runtime.status}`
          : "실행 상태: 갱신 대기",
      ),
    );
    const task = p.tasks.find((t) => t.task_id === a.task_id);
    if (a.waiting_reason) card.append(el("p", "", a.waiting_reason));
    if (task) card.append(el("p", "task-name", task.title));
    agents.append(card);
  }
  root.append(agents);
  const questions = p.input_requests.filter((q) => q.status !== "answered");
  if (questions.length) {
    const box = el("section", "questions");
    box.append(
      el("h3", "", `사용자 확인이 필요합니다 · ${questions.length}건`),
    );
    for (const q of questions) {
      const item = el("div", "question");
      item.append(
        badge(q.status),
        el("p", "", q.question),
        el("small", "", `요청 ${q.request_id} · 작업 ${q.task_id}`),
      );
      box.append(item);
    }
    box.append(
      el(
        "p",
        "help",
        "답변은 브로커 CLI의 answer --file 명령으로 전달하세요.\n문서 변경이 필요하면 prd.md와 design.md를 갱신한 뒤 apply-inputs로 전달합니다.",
      ),
    );
    root.append(box);
  }
  root.append(section("작업 목록", `${p.tasks.length} TASKS`));
  const tasks = el("div", "tasks");
  for (const t of p.tasks) {
    const row = el("div", "task"),
      text = el("div");
    text.append(
      el("div", "task-title", t.title),
      el(
        "small",
        "",
        `${roles[t.role] ?? t.role} · ${t.task_id} · 실행 ${t.attempt}회`,
      ),
    );
    if (t.depends_on.length)
      text.append(el("small", "", `선행 작업: ${t.depends_on.join(", ")}`));
    if (t.result) text.append(el("small", "", t.result));
    row.append(
      el(
        "span",
        "task-mark",
        t.status === "completed" ? "✓" : t.status === "running" ? "◉" : "○",
      ),
      text,
      badge(t.status),
    );
    tasks.append(row);
  }
  if (!p.tasks.length)
    tasks.append(
      el("p", "help", "PM이 계획을 등록하면 작업과 담당자가 표시됩니다."),
    );
  root.append(tasks);
  const details = el("details"),
    summary = el("summary", "", "프로젝트 경로와 실행 식별 정보");
  summary.dataset.focus = "identifiers";
  details.open = expanded.has(p.project_id);
  details.ontoggle = () => {
    if (details.isConnected)
      details.open ? expanded.add(p.project_id) : expanded.delete(p.project_id);
  };
  const dl = el("dl");
  for (const [key, value] of [
    ["소스", `${p.directory}/app`],
    ["Run", p.run_id],
    ["Workspace", p.workspace_id ?? "배정 전"],
    ["상태 revision", p.revision],
    ...p.agents.map((a) => [
      roles[a.role],
      `pane ${a.pane_id ?? "배정 전"} / terminal ${a.terminal_id ?? "배정 전"}`,
    ]),
  ])
    dl.append(el("dt", "", key), el("dd", "", value));
  details.append(summary, dl);
  root.append(details);
  return root;
}
async function refresh() {
  if (busy) return;
  busy = true;
  $("refresh").disabled = true;
  try {
    const res = await fetch("/api/status", {
      cache: "no-store",
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) throw new Error("상태 조회 지연");
    const data = await res.json();
    if (data.session !== "homepage" || !Array.isArray(data.projects))
      throw new Error("세션 불일치");
    const next = JSON.stringify({ ...data, observed_at: undefined });
    snapshot = data;
    lastSuccess = Date.now();
    offline = false;
    document
      .querySelectorAll("[data-execution-control]")
      .forEach((b) => (b.disabled = false));
    document.body.dataset.offline = "false";
    $("connection").textContent = "● 브로커 연결됨";
    $("connection").className = "live";
    $("updated").textContent =
      `마지막 수신 ${new Date(data.observed_at).toLocaleTimeString("ko-KR")}`;
    $("error").hidden = true;
    if (next !== signature) {
      signature = next;
      render();
    }
  } catch {
    offline = true;
    document
      .querySelectorAll("[data-execution-control]")
      .forEach((b) => (b.disabled = true));
    document.body.dataset.offline = "true";
    $("connection").textContent = "● 상태 갱신 지연";
    $("connection").className = "offline";
    $("error").hidden = false;
    $("error").textContent = snapshot
      ? "최신 상태를 가져오지 못했습니다. 아래는 마지막 수신 기록이며 자동으로 다시 연결합니다."
      : "브로커 상태를 가져오지 못했습니다. 브로커 실행 상태를 확인하세요. 자동으로 다시 연결합니다.";
    if (!snapshot) {
      $("detail").replaceChildren(
        empty(
          "상태를 확인할 수 없습니다",
          "브로커가 응답하면 프로젝트 목록이 자동으로 표시됩니다.",
        ),
      );
      $("project-list").replaceChildren(
        el("p", "empty-list", "연결을 기다리고 있습니다."),
      );
    }
  } finally {
    busy = false;
    $("refresh").disabled = false;
  }
}
$("refresh").onclick = refresh;
$("search").oninput = render;
document.querySelectorAll("[data-filter]").forEach((button) => {
  button.onclick = () => {
    filter = button.dataset.filter;
    document
      .querySelectorAll("[data-filter]")
      .forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
    render();
  };
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void refresh();
});
void refresh();
setInterval(() => {
  if (!document.hidden) void refresh();
}, 2000);
