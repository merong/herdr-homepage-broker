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
  // Lifecycle guards remain enforced, separately from setup checks.
  const blockers: { code: string; detail: string }[] = [];
  if (!action)
    blockers.push({
      code: "project_state",
      detail: "실행 중이거나 종료된 요청입니다.",
    });
  if (r.questions.some((q) => q.status !== "answered"))
    blockers.push({
      code: "input_required",
      detail: "프로젝트의 미응답 질문을 먼저 처리하세요.",
    });
  if (
    unknown(r) ||
    !quiescent(r) ||
    r.agents.some((a) => a.herdr.started && a.runtime.status === "stopped")
  )
    blockers.push({
      code: "reconcile_required",
      detail:
        "이전 실행 결과가 불명확합니다. 기존 에이전트 상태를 대조해야 합니다.",
    });
  let documents = true;
  try {
    await readInputs(r.inputs);
  } catch {
    documents = false;
  }
  const pluginIssues: string[] = [];
  if (!config.allowExecution)
    pluginIssues.push("관리자 설정에서 실행이 중지되어 있습니다.");
  if (state.storage_fault || state.projection_pending)
    pluginIssues.push("프로젝트 상태 저장을 복구해야 합니다.");
  try {
    await herdr.doctor();
  } catch {
    pluginIssues.push(
      "homepage 세션에 연결할 수 없습니다. Herdr 세션을 시작하세요.",
    );
  }
  for (const file of config.skills) {
    try {
      if (!(await fs.stat(file)).isFile()) throw new Error("not a file");
      await fs.access(file, fs.constants.R_OK);
    } catch {
      pluginIssues.push("설정된 홈페이지 스킬 파일을 읽을 수 없습니다.");
      break;
    }
  }
  const checks = [
    {
      code: "documents_ready",
      label: "문서 준비",
      ok: documents,
      detail: documents
        ? "prd.md와 design.md의 실행 사본이 준비되었습니다."
        : "문서가 없거나 변경되었습니다. 새 문서 버전을 적용하세요.",
    },
    {
      code: "plugin_ready",
      label: "플러그인 준비",
      ok: !pluginIssues.length,
      detail: pluginIssues.length
        ? pluginIssues.join(" ")
        : "homepage 연결과 실행 준비 완료 · PM 세션과 실행 지침 자동 준비",
    },
  ];
  return {
    project_id: p.project_id,
    run_id: r.run_id,
    revision: p.revision,
    status: r.status,
    action,
    ready: checks.every((c) => c.ok) && !blockers.length,
    checks,
    blockers,
    slots_used: state.slots,
    max_slots: config.maxProjects,
    waiting_for_slot: state.slots >= config.maxProjects,
    model: config.model,
    effort: config.effort,
    note: "프로젝트 경로·PM 실행 지침·모델·홈페이지 스킬은 자동 준비됩니다. 도구 연결과 모델 인증은 실제 실행 시 확인합니다.",
  };
}
