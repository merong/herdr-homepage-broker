(() => {
  const $ = (id) => document.getElementById(id);
  const fields = ["request-project", "request-prd", "request-design"];
  let boot,
    draft,
    acting = false;
  const key = "homepage-request-v2";
  const node = (tag, text, cls) => {
    const n = document.createElement(tag);
    n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  const message = (text) => {
    $("request-result").hidden = false;
    $("request-result").textContent = text;
  };
  function save() {
    try {
      sessionStorage.setItem(key, JSON.stringify(draft));
    } catch {}
  }
  function directory() {
    $("request-directory").value = boot?.projects_root
      ? `${boot.projects_root}/${$("request-project").value || "프로젝트-ID"}`
      : "설정을 확인하세요";
  }
  function lock(value) {
    for (const id of fields) $(id).disabled = value;
    $("sample-fill").disabled = value;
  }
  function newDraft(sample = false) {
    draft = null;
    try {
      sessionStorage.removeItem(key);
    } catch {}
    lock(false);
    $("request-result").hidden = true;
    $("request-project").value = sample
      ? `sample-company-${Date.now().toString(36)}`
      : "";
    $("request-prd").value = sample ? boot.sample.prd : "";
    $("request-design").value = sample ? boot.sample.design : "";
    $("request-send").textContent = "초기화 후 homepage로 전송";
    directory();
  }
  async function api(url, payload) {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
      ...(payload
        ? {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Homepage-Token": boot.csrf,
            },
            body: JSON.stringify(payload),
          }
        : {}),
    });
    const data = await res.json();
    if (!res.ok)
      throw new Error(`${data.message ?? data.error} (${data.error})`);
    return data;
  }
  async function create(send) {
    if (acting) return;
    if (!draft) {
      const project_id = $("request-project").value.trim(),
        prd = $("request-prd").value,
        design = $("request-design").value;
      if (
        !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(project_id) ||
        !prd.trim() ||
        !design.trim()
      ) {
        message("프로젝트 ID, 요구사항, 디자인 지침을 입력하세요.");
        return;
      }
      draft = {
        project_id,
        prd,
        design,
        request_id: crypto.randomUUID(),
        root: boot.projects_root,
        initialized: false,
      };
      save();
      lock(true);
    }
    if (draft.root !== boot.projects_root) {
      message(
        "저장 경로 설정이 변경되었습니다. 기존 요청 경로를 확인한 뒤 새 요청을 작성하세요.",
      );
      return;
    }
    acting = true;
    for (const id of ["request-init", "request-send", "request-reset"])
      $(id).disabled = true;
    try {
      if (!draft.initialized) {
        message("디렉터리와 문서, 요청 JSON을 준비하고 있습니다…");
        const { project_id, prd, design, request_id } = draft;
        draft.receipt = await api("/api/projects/init", {
          project_id,
          prd,
          design,
          request_id,
        });
        draft.initialized = true;
        save();
      }
      $("request-send").textContent = "homepage로 전송 · 동일 요청 재사용";
      if (send) {
        message("브로커 CLI를 통해 homepage 큐에 접수하고 있습니다…");
        const receipt = await api("/api/projects/submit", {
          project_id: draft.project_id,
        });
        const status = await api("/api/status");
        message(
          `접수 완료 · ${draft.project_id}\n상태: ${receipt.status} · run: ${receipt.run_id}\n경로: ${draft.receipt.directory}\n${status.execution_enabled ? "실행 준비와 진행 상황은 프로젝트 상태에서 확인하세요." : "현재 실행 비활성 모드입니다. 큐에 접수했으며 에이전트는 아직 시작하지 않았습니다."}`,
        );
        draft.submitted = true;
        save();
        document.getElementById("refresh").click();
      } else
        message(
          `초기화 완료 · 아직 큐에 전송하지 않았습니다.\n경로: ${draft.receipt.directory}\n문서: prd.md, design.md\n요청: ${draft.receipt.request_file}`,
        );
    } catch (e) {
      message(
        `요청 확인 필요: ${e.message}\n같은 버튼으로 재시도하면 기존 요청 ID를 재사용합니다. 기존 파일은 덮어쓰지 않습니다.`,
      );
    } finally {
      acting = false;
      for (const id of ["request-init", "request-send", "request-reset"])
        $(id).disabled = false;
    }
  }
  async function inspect(title, url, note) {
    $("inspect-title").textContent = title;
    $("inspect-note").textContent = note;
    $("inspect-data").textContent = "확인 중…";
    $("inspect-dialog").showModal();
    try {
      $("inspect-data").textContent = JSON.stringify(await api(url), null, 2);
    } catch (e) {
      $("inspect-data").textContent = e.message;
    }
  }
  window.homepage = {
    inspectProject: (id) =>
      inspect(
        `${id} · JSON 상태`,
        `/api/projects/${encodeURIComponent(id)}/state`,
        "프로젝트의 meta.json, task.json, agents.json을 직접 읽고 run·revision을 대조합니다. 화면에 필요한 필드만 표시합니다.",
      ),
  };
  document
    .querySelectorAll("[data-close]")
    .forEach((b) => (b.onclick = () => $(b.dataset.close).close()));
  $("request-open").onclick = () => $("request-dialog").showModal();
  $("sample-fill").onclick = () => newDraft(true);
  $("request-reset").onclick = () => newDraft(false);
  $("request-project").oninput = directory;
  $("request-init").onclick = () => create(false);
  $("request-send").onclick = () => create(true);
  $("checks-open").onclick = () =>
    inspect(
      "실행 환경 상태 체크",
      "/api/checks",
      "브로커·homepage 세션·실행 설정을 확인합니다. MCP 접속이나 모델 호출은 수행하지 않습니다.",
    );
  $("help-open").onclick = () => $("help-dialog").showModal();
  function help() {
    const target = $("help-content");
    target.replaceChildren();
    const section = (title, body, command) => {
      const d = document.createElement("details");
      d.open = true;
      d.append(node("summary", title), node("p", body, "help"));
      if (command) {
        d.append(node("pre", command, "json-output"));
        const b = node("button", "명령 복사", "button small");
        b.onclick = async () => {
          try {
            await navigator.clipboard.writeText(command);
            b.textContent = "복사됨";
          } catch {
            b.textContent = "명령을 선택해 복사하세요";
          }
        };
        d.append(b);
      }
      target.append(d);
    };
    section(
      "1. 프로젝트 초기화와 샘플 요청",
      "제작 요청 → 샘플 요청 채우기 → 문서와 경로 검토 → 초기화만 또는 초기화 후 전송. 초기화는 새 폴더와 문서·요청 JSON을 만들며 기존 프로젝트를 삭제하지 않습니다. 웹 버튼은 broker CLI로 접수하고, 스케줄러가 Herdr CLI의 homepage 세션에서 실행합니다.",
    );
    section(
      "2. 프로젝트 경로와 지속 설정",
      `최종 프로젝트 경로는 필수이며 ${boot.projects_root}/프로젝트-ID로 자동 결정됩니다. 소스는 app/에 생성합니다. 아래 내용은 전체 설정 예시가 아니라 병합할 항목입니다. ${boot.config_file}에 저장하거나 HOMEPAGE_CONFIG로 별도 설정을 지정하세요. 재시작해야 반영됩니다.`,
      JSON.stringify(
        {
          projectsRoot: boot.projects_root,
          web: { enabled: true, port: 7318 },
        },
        null,
        2,
      ),
    );
    section(
      "3. 상태와 사용자 입력",
      "진행 상태는 broker-checkpoint.json을 기반으로 갱신합니다. 프로젝트의 JSON 상태 확인은 meta/task/agents 파일의 revision·run 일치를 검사합니다. queued=접수 대기, running=제작 중, waiting_input=입력 필요, paused=명시적 재개 필요, review_pending=사용자 검토 대기입니다. 에이전트 유휴는 제작 완료와 다릅니다. 질문 답변은 answer --file, 문서 갱신은 apply-inputs로 전달합니다.",
    );
    section(
      "4. 상태 체크와 실행 전제",
      "상태 체크에서 homepage 연결과 실행 허용 여부를 확인하세요. allowExecution=false면 접수만 수행합니다. 실제 실행에는 Claude Opus 5.5 high, 승인한 홈페이지 스킬 경로, 브로커의 Higgsfield MCP 설정이 필요합니다. Claude에 설치된 MCP와 브로커 연결은 별도입니다.",
    );
    section(
      "5. 공개 GitHub에서 플러그인 설치",
      `Node 24+, Herdr 0.8.0+가 필요합니다. homepage 세션을 연 뒤 설치합니다. 설치 명령은 저장소의 릴리스를 내려받아 의존성과 UI를 빌드합니다. 버전 ${boot.version}.`,
      `herdr --session homepage\nherdr --session homepage plugin install ${boot.repository} --ref v${boot.version} --yes`,
    );
    section(
      "6. 플러그인 시작과 웹 UI",
      "homepage 작업공간 안에서 실행하세요. 기본 웹 주소는 http://127.0.0.1:7318입니다. 시작만으로 실행 설정을 자동 활성화하지 않습니다.",
      "herdr --session homepage plugin action invoke start --plugin herdr-homepage-broker\nherdr --session homepage plugin action invoke open-web --plugin herdr-homepage-broker\nherdr --session homepage plugin action invoke web-status --plugin herdr-homepage-broker",
    );
    section(
      "7. 플러그인 업데이트",
      "진행 작업을 먼저 확인합니다. Stop homepage broker 액션은 활성 작업이 있으면 중지를 거부합니다. Herdr 0.9.3에는 plugin update가 없으므로 원하는 태그로 다시 install합니다. localhost 상태·프로젝트는 설치 폴더 밖에 보존됩니다. 재시작 후 미완료 run은 명시적으로 resume해야 합니다. 로컬 link에서 전환 시 link만 해제한 뒤 설치합니다.",
      `herdr --session homepage plugin action invoke stop --plugin herdr-homepage-broker\nherdr --session homepage plugin install ${boot.repository} --ref v${boot.version} --yes\nherdr --session homepage plugin action invoke start --plugin herdr-homepage-broker`,
    );
    section(
      "8. Herdr 자체 업데이트와 문제 해결",
      "플러그인 업데이트와 Herdr 프로그램 업데이트는 별도입니다. Herdr 자체 업데이트가 필요할 때만 herdr update를 사용하세요. 포트 충돌은 web.port를 바꾸고 브로커를 재시작합니다. JSON 불일치는 잠시 후 재조회합니다. 기존 프로젝트 파일·상태 JSON을 직접 삭제하여 초기화하지 마세요.",
      "herdr --version\nherdr --session homepage plugin list --json\nherdr --session homepage plugin log list --plugin herdr-homepage-broker",
    );
    const a = node("a", "GitHub 소스와 설치 문서 ↗", "button");
    a.href = `https://github.com/${boot.repository}`;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    target.append(a);
  }
  api("/api/bootstrap")
    .then((data) => {
      boot = data;
      $("request-open").disabled = !data.can_submit;
      directory();
      help();
      try {
        const saved = JSON.parse(sessionStorage.getItem(key));
        if (saved?.request_id) {
          draft = saved;
          $("request-project").value = saved.project_id;
          $("request-prd").value = saved.prd;
          $("request-design").value = saved.design;
          lock(true);
          directory();
          message(
            "이전 요청이 보존되어 있습니다. 동일 요청으로 재시도하거나 새 요청 작성을 선택하세요.",
          );
        }
      } catch {}
    })
    .catch(() => {
      $("help-content").textContent =
        "초기 설정을 불러오지 못했습니다. 페이지를 새로고침하거나 브로커 버전을 확인하세요.";
    });
})();
