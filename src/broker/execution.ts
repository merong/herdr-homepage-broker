import fs from "node:fs/promises";
import { Config, Project, Run } from "../contracts/types.js";
import { quiescent, unknown } from "../domain/engine.js";
import { readInputs } from "../storage/store.js";
import { Herdr } from "../herdr/transport.js";
export async function executionReadiness(
  config: Config,
  p: Project,
  r: Run,
  herdr: Herdr,
  state: { storage_fault: boolean; projection_pending: boolean; slots: number },
) {
  const action =
    r.status === "queued" && !r.resume_required
      ? "start"
      : r.status === "paused"
        ? "resume"
        : null;
  const checks: { code: string; label: string; ok: boolean; detail: string }[] =
    [];
  const check = (code: string, label: string, ok: boolean, detail: string) =>
    checks.push({ code, label, ok, detail });
  check(
    "project_state",
    "프로젝트 상태",
    !!action,
    action
      ? action === "start"
        ? "큐에서 실행을 시작할 수 있는 상태입니다."
        : "중단된 실행의 재개가 필요합니다."
      : "실행 중이거나 종료된 요청입니다. 입력 대기 요청은 먼저 답변해야 합니다.",
  );
  check(
    "execution_disabled",
    "모델 실행 허용",
    config.allowExecution,
    config.allowExecution
      ? "브로커의 모델 실행이 허용되어 있습니다."
      : "설정 파일에서 allowExecution을 true로 지정하고 브로커를 다시 시작하세요.",
  );
  check(
    "storage_unavailable",
    "상태 저장소",
    !state.storage_fault && !state.projection_pending,
    !state.storage_fault && !state.projection_pending
      ? "저장소와 프로젝트 JSON이 정상입니다."
      : "저장 오류 또는 JSON 반영 지연을 먼저 복구하세요.",
  );
  check(
    "input_required",
    "사용자 입력",
    !r.questions.some((q) => q.status !== "answered"),
    r.questions.some((q) => q.status !== "answered")
      ? "미응답 질문이나 적용되지 않은 문서 변경을 먼저 처리하세요."
      : "처리해야 할 사용자 입력이 없습니다.",
  );
  check(
    "reconcile_required",
    "실행 자원 확인",
    !unknown(r) &&
      quiescent(r) &&
      !r.agents.some((a) => a.herdr.started && a.runtime.status === "stopped"),
    "외부 요청 접수 여부와 에이전트 상태가 불명확하면 CLI에서 대조해야 합니다.",
  );
  let skills = config.skills.length > 0;
  for (const file of config.skills) {
    try {
      const s = await fs.stat(file);
      await fs.access(file, fs.constants.R_OK);
      if (!s.isFile()) skills = false;
    } catch {
      skills = false;
    }
  }
  check(
    "skills_unavailable",
    "홈페이지 전용 스킬",
    skills,
    skills
      ? `${config.skills.length}개 스킬 파일을 읽을 수 있습니다.`
      : "skills에 승인한 홈페이지 SKILL.md의 절대 경로를 지정하세요. 비어 있거나 읽을 수 없는 파일이 있습니다.",
  );
  check(
    "mcp_unconfigured",
    "Higgsfield MCP",
    !!config.mcp,
    config.mcp
      ? "브로커 연결 설정이 있습니다. 요청 전송 시 실제 MCP 연결을 확인합니다."
      : "브로커용 stdio MCP 실행 명령과 도구 매핑을 설정하세요. Claude MCP 등록과는 별개입니다.",
  );
  let documents = true;
  try {
    await readInputs(r.inputs);
  } catch {
    documents = false;
  }
  check(
    "inputs_unavailable",
    "PRD·디자인 문서",
    documents,
    documents
      ? "실행에 고정된 입력 문서와 해시가 일치합니다."
      : "실행 문서가 없거나 변경됐습니다. 새 문서 버전을 CLI로 적용하세요.",
  );
  let host: any;
  try {
    host = { available: true, ...(await herdr.doctor()) };
  } catch {
    host = { available: false };
  }
  check(
    "session_unavailable",
    "homepage 세션",
    host.available,
    host.available
      ? `Herdr ${host.version}에 연결됐습니다.`
      : "homepage 세션을 시작하거나 CLI와 서버 버전을 확인하세요.",
  );
  return {
    project_id: p.project_id,
    run_id: r.run_id,
    revision: p.revision,
    status: r.status,
    action,
    ready: checks.every((c) => c.ok),
    checks,
    slots_used: state.slots,
    max_slots: config.maxProjects,
    waiting_for_slot: state.slots >= config.maxProjects,
    model: config.model,
    effort: config.effort,
    note: "실행 요청은 현재 run에 적용되며 FIFO 큐와 최대 2개 슬롯을 유지합니다. 모델 사용 권한과 실제 생성 결과는 사전 점검만으로 확인되지 않습니다.",
  };
}
