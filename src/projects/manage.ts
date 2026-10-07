import fs from "node:fs/promises";
import path from "node:path";
import { Config, fail } from "../contracts/types.js";
import { command } from "../contracts/validate.js";
import { hash, canonical, realDirectory } from "../storage/store.js";
import { prepareRuntime } from "./runtime.js";
// Built-in sample request (web "샘플 요청 채우기", CLI project sample).
export const sample = {
  prd: '# 첫날 입주청소 — 업체 소개 홈페이지\n\n## 한 줄 요약\n\n이사 날짜가 정해진 사람이 이 업체의 가격과 작업 방식을 확인하고, 그 자리에서 견적을 보거나 예약 문의를 남기게 하는 홈페이지.\n\n## 회사\n\n**첫날 입주청소**는 서울과 경기 남부(성남·하남·과천·광명)에서 아파트·오피스텔 입주 청소를 하는 가상의 업체다. 이 문서가 회사에 관한 유일한 사실이다. 여기에 없는 연혁, 누적 고객 수, 평점, 후기, 언론 보도, 인증, 제휴사는 만들지 않는다. 푸터에 "가상의 업체로 만든 데모 홈페이지입니다. 사진은 AI로 만든 연출 이미지입니다."를 작게 적는다.\n\n### 하는 일\n\n- 빈 집 전체를 청소한다.\n  - 주방: 후드 필터, 싱크대 배수구, 수납장 안\n  - 욕실: 줄눈 오염, 수전 물때, 배수구\n  - 방·거실: 바닥, 걸레받이, 몰딩\n  - 창: 유리, 창틀 레일, 방충망\n  - 베란다: 바닥, 배수구\n  - 붙박이장·신발장 안쪽 먼지\n- 하루에 한 집만 작업한다. 3~4명이 한 팀으로 오며, 25평 기준 6~7시간 걸린다.\n- 작업이 끝나면 공간별 체크리스트를 고객과 함께 확인한다. 체크리스트는 주방, 욕실, 방과 거실, 창과 베란다의 4개 공간에 36개 항목이다.\n- 고객이 확인한 뒤에 결제한다. 예약금은 없다.\n- 놓친 곳을 작업 다음 날부터 48시간 안에 알려 주면 무상으로 다시 방문한다.\n- 중성 세제를 기본으로 쓴다. 곰팡이나 심한 물때처럼 강한 약품이 필요한 곳은 쓰기 전에 고객에게 알린다.\n\n### 가격 (부가세 포함)\n\n- 신축(준공 2년 이내): 평당 14,000원\n- 구축: 평당 16,000원\n- 20평 미만은 20평 요금을 받는다. 60평이 넘으면 현장 견적이다.\n- 추가 옵션\n  - 냉장고 내부: 30,000원\n  - 에어컨 필터 세척: 대당 10,000원\n- 금액은 예약 때 알려 준 평수나 건물 연식이 실제와 다를 때만 바뀐다. 그때는 작업 전에 알리고, 고객이 동의해야 진행한다.\n\n### 예약\n\n- 원하는 날짜보다 7일 전까지 예약하기를 권한다. 주말과 공휴일에도 같은 요금으로 작업한다.\n- 문의에 필요한 정보는 다음과 같다.\n  - 주소(구·동까지)\n  - 평수\n  - 신축/구축\n  - 희망 날짜\n  - 옵션\n  - 이름과 연락처\n- 전화번호, 사무실 주소, 사업자 정보는 데모라서 만들지 않는다.\n\n## 고객\n\n- 이사 날짜가 정해진 신혼부부와 1~2인 가구로, 입주 청소 업체를 처음 고른다.\n- 이들이 걱정하는 것은 세 가지다.\n  - 현장에서 가격이 올라가지 않을까\n  - 대충 하고 가지 않을까\n  - 끝나고 무엇을 확인해야 할까\n- 대부분 휴대폰으로 여러 업체를 비교하면서 본다.\n\n## 페이지가 할 일\n\n1. 첫 화면에서 입주 청소 업체라는 것, 일하는 지역, 가격대가 보인다.\n2. 고객의 걱정 세 가지에 각각 답한다.\n   - 가격: 미리 정해진 가격\n   - 작업 방식: 하루 한 집, 팀 구성, 걸리는 시간\n   - 확인: 체크리스트, 확인 후 결제, 48시간 재방문\n3. 주 행동은 **우리 집 견적 보기**다.\n   - 평수, 신축/구축, 옵션을 고르면 금액이 바로 계산된다.\n   - 계산 결과에서 바로 예약 문의로 넘어간다.\n4. 보조 행동은 **예약 문의 남기기**다.\n   - 실제로 입력하고 검증되는 폼이다.\n   - 견적 계산기에서 넘어오면 고른 값이 채워져 있다.\n   - 제출하면 "데모 문의가 확인되었습니다. 정보는 전송되거나 저장되지 않습니다."를 보여 준다.\n\n섹션 구성과 순서, 개수, 문구는 제작자가 정한다. 위 정보가 빠짐없이 전달되면 된다. FAQ는 정말 필요할 때만 넣는다.\n\n## 범위 밖\n\n결제, 회원 가입, 실제 문의 전송, 외부 예약 시스템, 지도, 채팅 위젯, 블로그.\n\n## 이미지\n\n- Higgsfield로 이 프로젝트용 이미지를 새로 만든다. 최대 8장이며, 영상은 만들지 않는다.\n- 이미지마다 페이지에서 맡을 정보가 있어야 한다. 분위기만 있는 이미지는 쓰지 않는다. 예를 들면 다음과 같다.\n  - 청소 전후 비교\n  - 창틀 레일이나 배수구 같은 디테일\n  - 작업하는 손과 도구\n  - 청소를 마친 빈 집의 빛\n- 작업자 얼굴이 드러나는 사진은 만들지 않는다. 이미지 안에 글자나 로고도 넣지 않는다.\n\n## 납품\n\n반응형 정적 홈페이지(한국어)와 로컬 미리보기. 390px 휴대폰 화면이 우선이며, 1440px 데스크톱에서도 완성된 화면이어야 한다.\n',
  design:
    '# 첫날 입주청소 — 디자인 방향\n\n## 인상\n\n이사 첫날 아침, 막 청소를 마친 빈 집에 들어섰을 때의 느낌이다. 빛이 바닥에 길게 들어오고, 닦은 유리와 스테인리스에 반사가 있고, 아무 냄새도 나지 않는 조용함. 귀엽거나 들뜬 느낌보다 믿을 수 있는 전문가의 담백함.\n\n## 브랜드 고정 요소\n\n없다. 로고, 색, 서체는 제작자가 정한다. 워드마크는 텍스트로 만든다.\n\n## 참고할 성격\n\n화면을 그대로 베끼지 말고, 아래 성격만 가져온다.\n\n- toss.im: 한 화면에 한 메시지를 담는다. 한국어 제목이 크고, 숫자를 크고 단순하게 보여 준다.\n- apple.com 제품 페이지: 스크롤에 따라 장면이 바뀌며 하나의 이야기를 끝까지 보여 준다.\n- muji.com: 재질이 보이는 담백한 사진과 넉넉한 여백.\n\n## 색과 글자\n\n- 색은 사진 속 빛과 재질에서 출발해 정한다. 청소 업체 사이트에 흔한 파랑·민트 대신 이 회사만의 색을 찾는다.\n- 한국어 제목은 크고 단단하게, 본문은 휴대폰에서 편하게 읽히게 한다.\n\n## 모션\n\n움직임으로 "깨끗해지는 과정"과 "정확함"을 보여 준다. 아래는 예시이며 다른 아이디어를 써도 된다.\n\n- 청소 전후를 손가락으로 끌어서 비교하는 슬라이더\n- 스크롤하면 뿌연 장면이 맑아지거나, 체크리스트 항목이 차례로 체크되는 장면\n- 견적 계산기에서 금액 숫자가 부드럽게 바뀌는 효과\n\n모션은 페이지의 메시지를 돕는 곳에 쓴다. 휴대폰에서도 부드러워야 하고, 움직임 줄이기(reduced-motion) 설정에서는 움직임 없이 같은 정보가 보여야 한다.\n\n## 이미지\n\n- 25평 안팎의 같은 아파트(밝은 원목 바닥, 흰 벽, 남향 창)를 기준으로 여러 장면을 만든다. 모든 장면이 한 집의 이야기처럼 보여야 한다.\n- 청소 전후 비교는 같은 구도와 같은 빛으로 맞춘다. 청소 후 이미지를 기준으로 청소 전 상태를 만들면 구도가 어긋나지 않는다.\n- 작업자는 손, 장갑, 도구 위주로 보여 준다. 유니폼과 도구의 색은 브랜드 색과 맞춘다.\n\n## 휴대폰\n\n- 고객 대부분은 휴대폰으로 여러 업체를 비교한다.\n- 첫 화면에서 업체의 성격과 가격대가 보여야 한다.\n- 견적 보기 버튼은 스크롤해도 엄지가 닿는 곳에 둔다.\n',
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
