(() => {
  let stream,
    received = 0,
    mcpBusy = false;
  window.homepageStreamFresh = () =>
    stream?.readyState === EventSource.OPEN && Date.now() - received < 5000;
  function connect() {
    stream?.close();
    if (document.hidden || !window.EventSource) return;
    stream = new EventSource("/api/events");
    stream.addEventListener("status", (event) => {
      try {
        acceptSnapshot(JSON.parse(event.data), "stream");
        received = Date.now();
      } catch {
        markOffline();
      }
    });
    stream.addEventListener("unavailable", () => {
      received = 0;
      markOffline();
    });
    stream.onerror = () => {
      received = 0;
      if (Date.now() - lastSuccess > 5000) markOffline();
    };
  }
  const labels = {
    connected: "연결됨",
    needs_auth: "로그인 필요",
    pending_approval: "승인 대기",
    disabled: "비활성",
    failed: "연결 실패",
    unknown: "확인 불가",
    missing: "미등록",
    checking: "확인 중",
  };
  // One persistent badge node; the overview header re-inserts it each render.
  const mcpBadge = el("button", "badge");
  mcpBadge.type = "button";
  mcpBadge.append("MCP 확인 중");
  mcpBadge.onclick = () => $("mcp-dialog").showModal();
  window.homepageMcpBadge = () => mcpBadge;
  function setBadge(tone, iconName, text) {
    if (tone) mcpBadge.dataset.tone = tone;
    else delete mcpBadge.dataset.tone;
    mcpBadge.replaceChildren(icon(iconName, "icon icon-xs"), text);
  }
  async function checkMcp(force = false) {
    if (mcpBusy) return;
    mcpBusy = true;
    const button = $("mcp-refresh");
    button.disabled = true;
    try {
      const res = await fetch(force ? "/api/mcp?refresh=1" : "/api/mcp", {
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error("unavailable");
      const data = await res.json();
      const checking = data.checking;
      if (checking) setBadge(null, "refresh", "Higgsfield MCP 확인 중");
      else if (data.higgsfield.available)
        setBadge("ok", "check", "Higgsfield MCP 연결됨");
      else
        setBadge(
          "warn",
          "alert",
          `Higgsfield MCP ${labels[data.higgsfield.status] ?? "확인 필요"}`,
        );
      $("mcp-primary").textContent =
        `Higgsfield · ${data.stale && data.checked_at ? "이전 검사: " : ""}${labels[data.higgsfield.status] ?? "확인 불가"}${checking ? " · 서버 목록과 연결을 확인하고 있습니다" : ""}`;
      const rows = [...data.servers]
        .sort((a, b) => Number(b.higgsfield) - Number(a.higgsfield))
        .map((server) => {
          const row = el("div", "group-row");
          const main = el("div", "v");
          main.append(
            el("div", "ui", server.name),
            el(
              "div",
              "meta muted",
              server.higgsfield
                ? "홈페이지 이미지 생성"
                : "조회만 · 홈페이지 작업에서 사용 안 함",
            ),
          );
          const state = el(
            "span",
            "badge",
            labels[server.status] ?? "확인 불가",
          );
          state.dataset.tone = server.status === "connected" ? "ok" : "warn";
          row.append(main, state);
          return row;
        });
      $("mcp-servers").replaceChildren(...rows);
      if (!rows.length) {
        const row = el(
          "div",
          "group-row muted",
          checking
            ? "서버 목록을 불러오고 있습니다."
            : data.error
              ? "서버 목록을 확인하지 못했습니다."
              : "등록된 MCP 서버가 없습니다.",
        );
        $("mcp-servers").append(row);
      }
      const remedy =
        data.higgsfield.available || checking
          ? ""
          : data.higgsfield.status === "needs_auth"
            ? "Claude Code에서 Higgsfield에 로그인한 뒤 다시 확인하세요. "
            : "Claude Code에 설치된 Higgsfield 연결을 확인하세요. ";
      $("mcp-note").textContent =
        `${remedy}${data.checked_at ? `최근 검사 ${new Date(data.checked_at).toLocaleTimeString("ko-KR")} · ` : ""}${data.source} · ${data.scope}${data.error ? ` (${data.error})` : ""}`;
      button.disabled = checking;
      button.textContent = checking ? "MCP 확인 중…" : "MCP 다시 확인";
    } catch {
      setBadge("warn", "alert", "MCP 상태 확인 불가");
      $("mcp-primary").textContent =
        "브로커 응답이 없습니다. 이전 연결 상태가 지금도 유효하다고 보장하지 않습니다.";
      $("mcp-note").textContent = "연결이 복구되면 자동으로 다시 확인합니다.";
      button.disabled = false;
      button.textContent = "MCP 다시 확인";
    } finally {
      mcpBusy = false;
    }
  }
  $("mcp-refresh").onclick = () => void checkMcp(true);
  document.addEventListener("visibilitychange", () => {
    connect();
    if (!document.hidden) void checkMcp();
  });
  window.addEventListener("pagehide", () => stream?.close());
  connect();
  void checkMcp();
  setInterval(() => {
    if (!document.hidden) void checkMcp();
  }, 2000);
})();
