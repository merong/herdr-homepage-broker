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
      $("mcp-summary").textContent = checking
        ? "접속 검사 중"
        : data.higgsfield.available
          ? "Higgsfield 사용 가능"
          : "Higgsfield 확인 필요";
      $("mcp-summary").className =
        `badge ${checking ? "starting" : data.higgsfield.available ? "completed" : "waiting_input"}`;
      $("mcp-primary").className = `help${checking ? " skeleton" : ""}`;
      $("mcp-primary").textContent =
        `Higgsfield · ${data.stale && data.checked_at ? "이전 검사: " : ""}${labels[data.higgsfield.status] ?? "확인 불가"}${checking ? " · 서버 목록과 연결을 확인하고 있습니다" : ""}`;
      $("mcp-count").textContent =
        `MCP 서버 목록 · ${data.servers.length}개${data.stale && data.checked_at ? " (이전 검사)" : ""}`;
      const rows = [...data.servers]
        .sort((a, b) => Number(b.higgsfield) - Number(a.higgsfield))
        .map((server) => {
          const row = el(
            "div",
            `mcp-server${server.higgsfield ? " required-server" : ""}`,
          );
          row.append(
            el("strong", "", server.name),
            el(
              "span",
              "",
              server.higgsfield
                ? "홈페이지 이미지 생성"
                : "조회만 · 홈페이지 작업에서 사용 안 함",
            ),
            el(
              "span",
              `badge ${server.status === "connected" ? "completed" : "waiting_input"}`,
              labels[server.status] ?? "확인 불가",
            ),
          );
          return row;
        });
      $("mcp-servers").replaceChildren(...rows);
      if (!rows.length)
        $("mcp-servers").append(
          el(
            "p",
            "help",
            checking
              ? "서버 목록 로딩 중…"
              : data.error
                ? "서버 목록을 확인하지 못했습니다."
                : "등록된 MCP 서버가 없습니다.",
          ),
        );
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
      $("mcp-summary").textContent = "상태 확인 불가";
      $("mcp-summary").className = "badge waiting_input";
      $("mcp-primary").className = "help";
      $("mcp-primary").textContent =
        "브로커 응답 없음 · 이전 연결 상태는 현재 사용 가능 여부를 보장하지 않습니다.";
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
