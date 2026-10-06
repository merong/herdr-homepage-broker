import fs from "node:fs/promises";
import path from "node:path";
import { Config, fail } from "../contracts/types.js";
import { command } from "../contracts/validate.js";
import { hash, canonical, realDirectory } from "../storage/store.js";
import { prepareRuntime } from "./runtime.js";
export const sample = {
  prd: "# Example Studio 홈페이지 · Higgsfield 이미지 생성 테스트 PRD\n\n## 목표와 범위\n가상의 회사 Example Studio를 소개하는 한국어 반응형 랜딩 페이지를 만든다.\n히어로, 서비스 3개, 회사 소개, 데모 문의 영역을 포함한다. 회사 실적·고객·주소는 지어내지 않는다.\n산출물은 app/ 소스와 localhost 미리보기이며, 사용자 검토 대기에서 마친다.\n배포·결제·분석 추적·폼 서버는 제외한다. PM·개발자·디자이너의 3개 역할만 사용한다.\n\n## 필수 이미지 생성 시나리오\n이번 테스트 실행에서 디자이너가 설치된 Higgsfield MCP의 이미지 생성 도구를 실제 호출하여 새로운 히어로 이미지 1장을 만든다.\n이미지 생성은 선택 사항이 아니다. 기존 hero.jpg 재사용, 스톡 이미지, SVG/CSS 대체물은 이 테스트의 통과 조건을 충족하지 않는다.\n생성 요청은 count=1로 1건만 제출한다. 생성 모델은 설치된 홈페이지 스킬과 도구에서 지원하는 모델을 선택해 기록한다.\n디자이너는 접속 가능한 Higgsfield 도구를 확인하고 생성 시작·job 접수·완료 시 간결한 progress 보고를 남긴다.\n연결·인증 실패는 실제 오류를 포함한 입력 요청 1건으로 알린다. 결과 불명확 또는 실패 시 추가 유료 제출하지 않고 확인을 요청한다.\n\n## 작업 순서\n1. PM은 고정 팀을 생성하고 이미지 생성 → 개발자 통합 → 최소 검토의 의존성을 계획한다.\n2. 디자이너는 design.md의 프롬프트로 1장을 생성하고 실행 폴더 assets/에 원본·웹용 이미지와 media-receipts.json을 저장한다.\n3. 개발자는 전달받은 새 이미지를 app/assets/에 복사하여 실제 히어로 img 요소에 사용한다. 이미지가 완료되기 전 최종 납품하지 않는다.\n4. PM은 생성 기록과 이미지 연결, localhost 응답을 한 번 확인한 후 사용자 검토로 넘긴다. 반복적인 디자인 QA는 하지 않는다.\n\n## 최소 통과 증거\n- media-receipts.json에 provider, tool, model, prompt, count, 제출 시각, 실제 provider_job_id, 완료 상태, 결과 URL, 로컬 경로 및 SHA-256을 기록한다. 추측한 job ID나 완료 상태를 쓰지 않는다.\n- 개발자 완료 보고에 적용한 app/assets/ 경로와 SHA-256을 포함하여 디자이너가 제공한 웹용 파일과 일치시킨다.\n- localhost에서 히어로 이미지가 표시됨을 한 번 확인하고 이미지 HTTP 응답 및 실제 크기(naturalWidth > 0)를 확인한다.\n- 신규 생성 여부·job ID·이미지 경로·미리보기 URL을 최종 보고에 남긴다. CSS로 장식한 것만으로 생성 완료라 하지 않는다.\n",
  design:
    "# Example Studio 디자인 · 이미지 생성 테스트\n\n## 화면\n밝은 아이보리 배경, 차분한 파란색 강조색, 읽기 쉬운 한국어 서체를 사용한다.\n데스크톱 히어로는 카피와 큰 사진 2열, 모바일은 카피 다음 사진 1열로 배치한다.\n생성 사진이 즉시 식별되도록 히어로 가로폭의 절반 이상을 사용하며 과도한 오버레이로 가리지 않는다.\n서비스는 데스크톱 3열, 모바일 1열. 텍스트 워드마크를 사용하며 별도 로고나 실적을 만들지 않는다.\n절제된 CSS 진입 모션만 사용하고 키보드 탐색, prefers-reduced-motion, 이미지 alt를 지원한다.\n\n## 이번 실행에서 새로 생성할 이미지 1장\nHiggsfield MCP에서 아래 프롬프트를 바탕으로 16:9, count=1 이미지를 생성한다.\n이전 추상 유리 이미지와 구분되는 구체적인 공간 사진을 만든다. 실제 회사 사무실이라고 주장하지 않는다.\n\nPrompt: Editorial architectural photograph of a fictional creative design studio in soft morning daylight. A long pale oak desk with neatly arranged blank paper material samples, a small cobalt-blue sculptural object and a green plant. Large windows, ivory plaster walls, warm natural wood, calm muted blue accents, subtle realistic shadows. Wide horizontal composition, inviting professional atmosphere, crisp realistic material details, no people, no text, no logos, no watermark. This is an illustrative fictional studio, not a real company location.\n\n최종 화면 alt: “햇살이 들어오는 가상의 디자인 스튜디오, 원목 책상과 파란 오브제”.\n사진 아래 “AI로 제작한 스튜디오 콘셉트 이미지”라는 짧은 설명을 배치한다.\n\n## 이미지 전달과 검증\n디자이너 소유의 실행 폴더 assets/에 원본 및 필요하면 JPEG/WebP 웹용 파생본을 저장한다.\n파일명은 hero-studio이며 형식에 맞는 확장자를 사용한다. 원본을 보존하고 각 파일의 크기·해시·job ID를 media-receipts.json에 기록한다.\n개발자는 웹용 파일을 app/assets/에 복사하고 실제 img src, width/height, object-fit: cover를 적용한다.\n장식용 CSS 배경이나 이전 이미지로 이 요구사항을 대체하지 않는다. 생성되지 않으면 미완료로 보고한다.\n",
};
export function projectDirectory(c: Config, id: string) {
  if (
    typeof id !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id) ||
    ["constructor", "prototype", "__proto__"].includes(id)
  )
    fail(
      "invalid_project",
      "Project ID must contain 1..64 letters, digits, _ or -",
    );
  if (!c.projectsRoot) fail("invalid_config", "projectsRoot is required");
  return path.join(c.projectsRoot, id);
}
async function readRegular(file: string) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024)
    fail("unsafe_file", "Expected a regular file up to 4 MiB");
  return fs.readFile(file, "utf8");
}
async function writeOnce(file: string, text: string) {
  try {
    await fs.writeFile(file, text, { flag: "wx", mode: 0o600 });
  } catch (e: any) {
    if (e.code !== "EEXIST") throw e;
    if ((await readRegular(file)) !== text)
      fail(
        "init_conflict",
        "Existing project file differs; it will not be overwritten",
      );
  }
}
export async function initializeProject(c: Config, input: any) {
  if (
    !input ||
    typeof input !== "object" ||
    Object.keys(input).some(
      (k) => !["project_id", "request_id", "prd", "design"].includes(k),
    )
  )
    fail("invalid_init", "Expected project_id, request_id, prd and design");
  if (
    typeof input.request_id !== "string" ||
    !/^[a-zA-Z0-9_-]{8,100}$/.test(input.request_id)
  )
    fail("invalid_init", "A stable request_id is required");
  for (const key of ["prd", "design"])
    if (
      typeof input[key] !== "string" ||
      !input[key].trim() ||
      Buffer.byteLength(input[key]) > 65536
    )
      fail("invalid_init", `${key} must contain 1..65536 bytes`);
  const directory = projectDirectory(c, input.project_id);
  await realDirectory(c.projectsRoot!);
  let created = false;
  try {
    await fs.mkdir(directory, { mode: 0o700 });
    created = true;
  } catch (e: any) {
    if (e.code !== "EEXIST") throw e;
  }
  if ((await fs.realpath(directory)) !== directory)
    fail("unsafe_path", "Symlink project directory refused");
  const marker = path.join(directory, "homepage-init.json");
  const identity = {
    schema_version: 1,
    request_id: input.request_id,
    hash: hash(canonical(input)),
  };
  if (!created) {
    let old;
    try {
      old = JSON.parse(await readRegular(marker));
    } catch {
      fail(
        "directory_exists",
        "Existing directory is not owned by this initialization request",
      );
    }
    if (old.request_id !== identity.request_id || old.hash !== identity.hash)
      fail(
        "init_conflict",
        "Project was initialized by a different request; use a new project ID",
      );
  }
  await writeOnce(marker, JSON.stringify(identity, null, 2) + "\n");
  await writeOnce(path.join(directory, "prd.md"), input.prd);
  await writeOnce(path.join(directory, "design.md"), input.design);
  const request = command({
    schema_version: 1,
    command_id: `init-${input.request_id}`,
    type: "submit",
    project_id: input.project_id,
    payload: {
      directory,
      inputs: {
        prd: { path: path.join(directory, "prd.md"), sha256: hash(input.prd) },
        design: {
          path: path.join(directory, "design.md"),
          sha256: hash(input.design),
        },
      },
    },
  });
  const request_file = path.join(directory, "homepage-request.json");
  await writeOnce(request_file, JSON.stringify(request, null, 2) + "\n");
  await realDirectory(path.join(directory, "app"));
  const runtime = await prepareRuntime(c, directory);
  return {
    initialized: true,
    project_id: input.project_id,
    directory,
    request_file,
    command_id: request.command_id,
    session: "homepage",
    runtime,
  };
}
export async function initializedRequest(c: Config, id: string) {
  const directory = projectDirectory(c, id);
  if ((await fs.realpath(directory)) !== directory)
    fail("unsafe_path", "Symlink project refused");
  const req = command(
    JSON.parse(
      await readRegular(path.join(directory, "homepage-request.json")),
    ),
  );
  if (
    req.type !== "submit" ||
    req.project_id !== id ||
    req.payload.directory !== directory
  )
    fail(
      "request_mismatch",
      "Initialized request no longer matches the project",
    );
  for (const key of ["prd", "design"])
    if (req.payload.inputs[key].path !== path.join(directory, `${key}.md`))
      fail(
        "request_mismatch",
        "Input document must belong to the initialized project",
      );
  return req;
}

export async function projectFiles(p: {
  project_id: string;
  directory: string;
  run_id: string;
  revision: number;
}) {
  if ((await fs.realpath(p.directory)) !== p.directory)
    fail("unsafe_path", "Symlink project refused");
  const [meta, task, agents] = await Promise.all(
    ["meta", "task", "agents"].map(async (name) =>
      JSON.parse(await readRegular(path.join(p.directory, name + ".json"))),
    ),
  );
  for (const v of [meta, task, agents])
    if (
      v.schema_version !== 1 ||
      v.project_id !== p.project_id ||
      v.run_id !== p.run_id ||
      v.revision !== p.revision
    )
      fail(
        "projection_pending",
        "JSON revisions differ from the broker; retry after synchronization",
      );
  return {
    consistent: true,
    project_id: p.project_id,
    run_id: p.run_id,
    revision: p.revision,
    files: {
      "meta.json": {
        schema_version: meta.schema_version,
        project_id: meta.project_id,
        run_id: meta.run_id,
        revision: meta.revision,
        status: meta.status,
        input_required: meta.input_required,
        reason: meta.reason,
        resume_required: meta.resume_required,
        execution_requested: meta.execution_requested,
        orchestration: meta.orchestration ?? null,
        slot_reserved: meta.slot_reserved,
        inputs: meta.inputs,
        herdr: {
          session_name: meta.herdr?.session_name,
          workspace_id: meta.herdr?.workspace_id,
        },
        input_requests: (meta.input_requests ?? []).map((q: any) => ({
          request_id: q.request_id,
          status: q.status,
          question: q.question,
          kind: q.kind,
        })),
        artifacts: {
          source: meta.artifacts?.source,
          preview: {
            status: meta.artifacts?.preview?.status,
            url: meta.artifacts?.preview?.url,
          },
        },
      },
      "task.json": {
        schema_version: task.schema_version,
        project_id: task.project_id,
        run_id: task.run_id,
        revision: task.revision,
        tasks: (task.tasks ?? []).map((t: any) => ({
          task_id: t.task_id,
          title: t.title,
          status: t.status,
          role: t.role,
          attempt: t.attempt,
          depends_on: t.depends_on,
          writes: t.writes,
          result: t.result,
          updated_at: t.updated_at ?? null,
        })),
      },
      "agents.json": {
        schema_version: agents.schema_version,
        project_id: agents.project_id,
        run_id: agents.run_id,
        revision: agents.revision,
        agents: (agents.agents ?? []).map((a: any) => ({
          agent_id: a.agent_id,
          role: a.role,
          status: a.status,
          waiting_reason: a.waiting_reason,
          model: a.model,
          effort: a.effort,
          task_id: a.task_id,
          herdr: {
            pane_id: a.herdr?.pane_id,
            terminal_id: a.herdr?.terminal_id,
          },
          runtime: {
            status: a.runtime?.status,
            fresh: a.runtime?.fresh,
            observed_at: a.runtime?.observed_at,
          },
        })),
      },
    },
  };
}
