import fs from "node:fs/promises";
import path from "node:path";
import { Config, fail } from "../contracts/types.js";
import { command } from "../contracts/validate.js";
import { hash, canonical, realDirectory } from "../storage/store.js";
import { prepareRuntime } from "./runtime.js";
export const sample = {
  prd: "# 기업 랜딩 페이지 PRD\n\n샘플 회사 Example Studio의 한국어 반응형 홈페이지를 제작한다.\n히어로, 서비스 3개, 회사 소개, 문의 영역을 포함한다.\n이미지와 간단한 CSS 모션을 포함하며 실제 회사 정보나 실적은 임의로 만들지 않는다.\n소스와 localhost 미리보기를 제공하고 사용자 검토 대기 상태로 마친다.\n배포, 결제, 분석 추적, 폼 서버는 제외한다.\n",
  design:
    "# 디자인 지침\n\n밝은 배경, 차분한 파란색 강조색, 가독성 높은 한국어 서체를 사용한다.\n모바일 한 열, 데스크톱 서비스 3열 레이아웃.\nHiggsfield를 통한 대표 이미지 1장과 절제된 CSS 진입 모션을 적용한다.\n브랜드 로고 및 생성 도구가 준비되지 않으면 필요한 정보를 요청한다.\n키보드 탐색과 prefers-reduced-motion을 지원한다.\n",
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
