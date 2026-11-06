# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 개요

`herdr-homepage-broker`는 macOS용 Herdr 플러그인입니다. 전용 Herdr 세션 `homepage`에서 홈페이지 제작 요청을 받아, 프로젝트마다 Herdr workspace에 Claude PM을 띄우고 상태를 JSON으로 관리합니다(0.7.0부터 Herdr pane은 PM 하나. 0.9.0부터 PM이 저장소의 `claude-plugin/homepage-studio` 스킬로 direction → first-screen → build-out 3개 태스크를 직접 수행하며, 서브에이전트는 이미지 병렬 생성에만 씀). TypeScript ESM, Node 24+, 런타임 의존성은 `ajv` 하나입니다. README·docs·UI 문구와 사용자에게 보이는 오류 상세는 한국어로 작성합니다.

## 명령어

```sh
npm ci --ignore-scripts
npm run build          # tsc → tsc -p tsconfig.ui.json(React 타입 검사) → scripts/export-schemas.mjs(schemas/*.json 재생성) → scripts/copy-web.mjs(src/web/public → dist) → vite build(src/web/ui → dist/src/web/public/ui/components.js)
npm run typecheck
npm run format:check   # prettier만 사용, ESLint 없음
npm test               # build 후 node --test dist/tests/*.test.js
```

테스트는 컴파일된 `dist/tests/*.js`에서 실행되므로 반드시 먼저 빌드해야 합니다. `tsconfig`가 `noEmitOnError`라 타입 오류가 있으면 dist가 갱신되지 않습니다. 단일 파일·단일 테스트 실행:

```sh
npm run build && node --test dist/tests/domain.test.js
npm run build && node --test --test-name-pattern "T19" dist/tests/domain.test.js
```

`npm run test:herdr`, `npm run test:plugin`(`tests/herdr-live.ts`, `tests/plugin-live.ts`)은 실제 `homepage` 세션에 workspace·pane을 만듭니다. `npm test`에 포함되지 않으며, 운영 작업이 없는 환경에서만 실행합니다.

로컬 실행:

```sh
node dist/src/cli.js broker ensure   # 브로커를 detached로 시작(이미 있으면 status 반환)
node dist/src/cli.js web open        # http://127.0.0.1:7318
node dist/src/cli.js doctor
herdr --session homepage plugin link "$PWD"   # link는 빌드하지 않음 — 먼저 npm run build
```

## 아키텍처

### 요청 흐름

웹 UI(127.0.0.1 전용) → `src/web/actions.ts`가 고정된 CLI subcommand(`dist/src/cli.js project init|submit|readiness`, `execute`)만 spawn → 브로커 Unix 소켓 IPC(`broker.sock`, 연결당 JSON 한 줄) → `Broker.serial()` 단일 writer 큐 → Herdr CLI(`herdr --session homepage …`)와 Herdr socket API(`session.snapshot`, `events.subscribe`, `workspace.report_metadata`).

HTTP 입력은 절대 shell 명령이나 에이전트 프롬프트가 되지 않습니다. 웹의 변경 요청은 init/submit/execute뿐이며 same-origin + CSRF 토큰을 확인합니다. answer·cancel·feedback 등은 CLI(`--file command.json`)로만 보냅니다. CLI subcommand와 JSON `type`은 일치해야 합니다(`media request` → `media-request`).

### 핵심 모듈

- `src/broker/broker.ts` — `handle()`(명령 처리), `tick()`(500ms 스케줄러: 슬롯 배정, `setup()`으로 workspace/pane/agent 생성, 태스크 assignment 전송, 미리보기 검증, 미디어 polling, 취소), `observe()`(Herdr snapshot을 agent runtime 상태에 반영하고 pane 소유권 불일치·소멸 시 run을 pause), `operation()`(외부 작업 저널).
- `src/domain/engine.ts` — 상태 머신. `mutate()`가 submit/cancel/answer/resume/feedback/apply-inputs/report를 처리하고, `report()`가 에이전트 보고 종류(team-create, plan, progress, completed, failed, question)를 검증합니다. `validatePlan()`은 역할별 쓰기 경계를 강제합니다.
- `src/storage/store.ts` — 상태 디렉터리의 `broker-checkpoint.json`이 유일한 원본입니다. 커밋할 때마다 프로젝트 디렉터리에 `meta.json`, `task.json`, `agents.json`, `.herdr/runs/<run_id>/run.json` projection을 쓰며 agent token은 제거합니다. 이 projection 파일은 읽기 전용 출력이니 직접 수정하지 않습니다.
- `src/contracts/` — 타입, ajv 명령·payload 스키마, `checkpoint()` 불변식 검사. `schemas/*.schema.json`은 빌드 때 생성되지만 Git에 추적되므로 `validate.ts`를 바꾸면 재생성된 파일도 함께 커밋합니다.
- `src/herdr/transport.ts` — Herdr CLI 래퍼(`HERDR_PANE_ID` 등 호출자 컨텍스트 제거, session/socket 고정), socket API, `Observer`(이벤트 구독, backoff 재연결).
- `src/agents/native.ts` — `claude-native` 모드(신규 run 기본)의 PM 지침. `.herdr/runs/<run>/pm-instructions.md`·`homepage-orchestration.md`를 씁니다. 지침은 argv가 아니라 첫 `agent prompt`에서 "이 파일들을 읽으라"는 짧은 메시지로 전달합니다. `pm-instructions.md`는 PM 시작 때 한 번만 쓰므로 이미 시작한 PM은 업데이트 후에도 이전 지침을 씁니다. PM의 브로커 호출은 run 폴더의 `broker-cli` 래퍼(node·cli.js·소켓 고정, 토큰 없음, 0700) 하나로만 합니다. zsh가 `"$CLI"`를 단어 분리하지 않기 때문입니다. PM이 셸에 붙여 넣는 명령의 경로는 모두 `shellQuote()`로 인용하고 `<placeholder>`는 따옴표 밖에 둡니다.
- `src/agents/studio.ts` + `claude-plugin/homepage-studio/` — 저장소에 포함된 Claude 플러그인(스킬 `homepage-studio`, 시각 판단 스킬 `design-taste`·`high-end-visual-design`·`frontend-design`, 스크린샷 스크립트 `skills/homepage-studio/scripts/look.py`; 0.9.0에서 helper 에이전트와 나머지 스킬 제거). `frontend-design`과 `high-end-visual-design`은 원본 바이트 그대로이고, `design-taste`는 taste-skill `design-taste-frontend` v2의 발췌본입니다(원문 줄 그대로, 바꾼 줄은 `[adapted]`, 25KB 이하). 충돌 시 우선순위는 homepage-studio `SKILL.md`가 정하며, 출처·해시는 `THIRD_PARTY_NOTICES.md`에 기록합니다. PM은 `--setting-sources=`로 실행되어 `~/.claude/skills`, 사용자 플러그인, 프로젝트 `.claude/agents`를 **로드하지 않으므로**, native run에만 `--plugin-dir`로 전달합니다. 플러그인 파일이 없으면 Herdr 호출 전에 `studio_plugin_missing`으로 멈추고, 플러그인 없이 실행하는 fallback은 없습니다. `skills-lock.json`에는 플러그인 버전과 트리 해시를 기록합니다. `look.py`가 쓰는 python3 + Python Playwright는 `doctor`의 `studio` 키와 readiness `warnings`에서 경고만 하고 실행을 막지 않습니다(`cwebp`는 `optional_missing` 참고 정보). PM pane과 같도록 `$SHELL -l -i -c`로 도구를 찾고 실패하면 브로커 PATH로 대신합니다. 테스트는 `tests/helpers.ts`에서 `SHELL`을 지웁니다. 스킬 본문은 prettier 대상이 아니며, 외부 출처 발췌는 `THIRD_PARTY_NOTICES.md`에 기록합니다.
- `src/agents/prompts.ts` — 모드별 프롬프트 분기, assignment 파일, `claudeArgs()`. native 태스크 파일에는 그 assignment용 report envelope 전체 예시(sequence는 시작값)가 들어갑니다. 레거시 `pm-led` run은 `<role>-system.md` + `--append-system-prompt-file`을 씁니다.
- `src/web/server.ts` + `src/web/public/` + `src/web/ui/` — 대시보드(0.10.0, 0.11.0부터 `/dashboard`의 `dashboard.html`). `public/`은 셸(`app.js` 라우팅·목록·인스펙터, `actions.js` 다이얼로그·요청, `live.js` SSE·MCP 상태)과 디자인 시스템 CSS(`tokens.css`·`bundle.css`·`app.css`)이며 번들러 없이 그대로 복사됩니다. 터미널 미러·진행 단계·스크린샷·활동 기록·구조도는 `src/web/ui/*.tsx` React 컴포넌트를 Vite(`vite.config.mjs`, IIFE)로 `dist/src/web/public/ui/components.js`에 빌드하고, 셸이 `window.BrokerUI.slot(key, 이름, props)`으로 key별 컨테이너에 마운트합니다(셸이 DOM을 다시 그려도 React root 유지). 아이콘은 `scripts/icons.mjs`가 lucide-react에서 `public/icons.js`로 생성합니다. CSP가 `script-src 'self'`·`style-src 'self'`이므로 인라인 스크립트와 HTML `style` 속성을 쓰지 않습니다(React의 `style` prop은 CSSOM이라 허용). 서버는 시작 시 정적 파일을 읽어 두므로 빌드 후 브로커를 재시작해야 반영됩니다. `webSnapshot()`이 operation receipt·token·명령 envelope을 걸러 표시 필드만 내보냅니다. 실시간 갱신은 SSE `/api/events`, 실패 시 `/api/status` polling으로 복구합니다. 프로젝트별 읽기 API는 `GET /api/projects/<id>/terminal?agent=`(`herdr pane read --source visible --format ansi`, pane별 900ms 캐시), `events?before=&limit=`, `shots`, `shots/<run>/<회차>/<파일>`, `assets/<run>/<파일>`이며, 이미지는 `src/web/files.ts`가 경로 세그먼트·realpath 포함·확장자·16MB로 제한합니다. 스크린샷은 look.py가 쓰는 `.herdr/runs/<run>/reports/look/<회차>/`를 그대로 읽고 따로 저장하거나 지우지 않습니다. 쓰기 경로는 init/submit/execute 외에 `POST /api/projects/focus`(`herdr workspace focus`, 브로커 상태 불변) 하나가 추가됐고 같은 CSRF 검사를 거칩니다.
- `src/web/public/landing.html`·`landing.css`·`legacy.js`·`landing/*.webp` + `src/web/ui/Landing.tsx`·`Showcase.tsx` + `src/web/showcase.ts` — 랜딩 페이지(0.11.0). 라우트는 `/` = `landing.html`(첫 화면), `/dashboard` = `dashboard.html`이며 정확히 일치할 때만 응답합니다(`/dashboard/`·쿼리는 404). 대시보드 안의 화면 전환은 그대로 해시(`#/p/<id>`, `#/structure`)입니다. 랜딩은 셸 JS 없이 `ui/components.js`만 불러오고 `main.tsx`가 `#landing`을 찾아 `Landing`을 직접 마운트합니다(번들이 없으면 정적 fallback 문구와 대시보드 링크가 남습니다). `legacy.js`는 head에서 동기로 실행되어 예전 대시보드 해시(`#/…`, 예전 `#<id>`)를 같은 해시로 `/dashboard`에 `location.replace`합니다. 랜딩 구역 앵커(`#main`·`#flow`·`#watch`·`#showcase`)는 `legacy.js`의 `own` 목록에 있어 넘어가지 않으므로, 앵커를 추가하면 그 목록도 함께 고칩니다. `/dashboard#/request`는 bootstrap 후 제작 요청 창을 엽니다(`actions.js` `requestFromHash`, 전송은 기존 버튼). 제작 사례 API `GET /api/showcase`(쿼리 불가)는 broker status의 프로젝트마다 현재 run과 디스크의 이전 run(`.herdr/runs/*`)에서 `listShots()`로 표지 회차(가장 최근 `final`, 없으면 가장 최근 회차)를 고르고, 필드를 하나씩 골라 `{project_id, name, status, created_at, run_id, round, stage, at, rounds, delivered, shots{desktop, mobile, desktop_full, mobile_full: {path, mtime}|null}, preview_url}`와 `summary{projects, showcased, delivered, active, queued, review, max_parallel}`만 내보냅니다. 경로·토큰·verdict·문서 본문은 내보내지 않습니다. `name`은 `prd.md` 앞 4KB의 첫 `# ` 제목에서 부제와 "홈페이지"·"PRD" 같은 꼬리를 뗀 값(`displayName()`)입니다. 스크린샷이 없거나, final 없이 failed/cancelled/superseded인 프로젝트는 빠집니다. `preview_url`은 표지가 현재 run이고 미리보기가 ready일 때만 `previewUrl()`을 거쳐 채웁니다. 표지 이미지는 기존 `/api/projects/<id>/shots/<path>?v=<mtime>` 라우트로 읽습니다. 랜딩 사진 4장(`public/landing/{hero,direction,first-screen,build-out}.webp`, Higgsfield `gpt_image_2_6`)은 Git에 포함되고 서버 화이트리스트에 `image/webp`로 등록되어 있으며, W17이 장당 400KB·합계 1.5MB 이하를 확인합니다. 생성 기록(모델·프롬프트·job ID)은 로컬 `docs/landing-assets.md`에 있습니다. 랜딩 사진을 바꾸면 그 기록과 화이트리스트를 함께 고칩니다. `landing.css`는 DS 토큰만 쓰고 리셋을 `:where()`로 감싸 컴포넌트 클래스가 이기게 합니다. `web open`·`open-web`은 `/`(랜딩)를 열고, 응답 없음 Herdr 알림 본문 끝에는 `/dashboard#/p/<id>` 주소가 붙습니다.
- `src/storage/events.ts` — 표시용 활동 로그 `<프로젝트>/.herdr/events.jsonl`. `store.commit()`이 원자적 쓰기 성공 후 `diffEvents(published, next)`로 run·상태·태스크·보고·질문/답변 여부·미리보기 변화를 덧붙입니다. 질문 답변 내용은 기록하지 않습니다. 쓰기 실패는 무시하며 커밋을 되돌리거나 projection pending으로 만들지 않습니다(실행 게이트에 영향 없음).
- `src/domain/stall.ts` — 응답 없음 판단. run `running` + agent가 진행 중 태스크 보유 + runtime `fresh` + Herdr 상태 idle/done/unknown(blocked 제외)이 `stallAfterMinutes`(기본 5, 1..120) 이상 바뀌지 않으면 stall입니다. `observe()`가 상태가 바뀔 때만 `runtime.changed_at`을 갱신하고, `tick()`의 `checkStall()`이 (agent, since)마다 한 번 `stall` 이벤트와 `herdr notification show`(best-effort)를 보내며 풀리면 `stall_cleared`를 남깁니다. 업무 상태는 바꾸지 않습니다.
- `src/media/` — `mcp.ts`는 선택적인 broker stdio MCP(`config.mcp`), `health.ts`는 `claude --setting-sources '' mcp list` 출력을 파싱하며 자격증명을 제거합니다. 기본 모드에서는 Claude에 설치된 Higgsfield MCP를 PM(레거시 run은 디자이너)이 직접 씁니다.
- `src/preview/manager.ts` — localhost 미리보기 프로세스. pid + 프로세스 시작 시각 + 포트로 소유권을 확인하므로 PID가 재사용되면 stop을 거부합니다.
- `src/projects/` — `manage.ts`(프로젝트 init, write-once 파일), `runtime.ts`(`homepage-runtime.json`).
- `src/ui/board.ts` — Herdr pane용 TUI 보드.

### 바꾸면 안 되는 불변식

- **고정값**: session `homepage`, model `claude-opus-5-5`, effort `high`, 최대 2개 프로젝트, 최대 2개 미리보기. agent 수는 `claude-native` run이면 PM 1명, `pm-led`/레거시 run이면 정확히 3명입니다. `config.ts`가 다른 값을 거부하고 `checkpoint()`가 검증합니다. 다른 세션·모델로의 fallback을 추가하지 않습니다.
- **멱등성**: 모든 쓰기 명령은 `command_id`를 가지며, canonical hash와 함께 `checkpoint.commands`에 저장됩니다. 같은 ID에 내용이 다르면 `command_conflict`입니다. 에이전트 보고는 추가로 `event_id`와 단조 증가하는 `sequence`를 씁니다.
- **원자적 변경**: 변경은 `structuredClone(state)`에 적용한 뒤 `store.commit(next)`합니다. 거부된 명령의 부분 변경이 남지 않게 하기 위해서입니다. 커밋 결과를 알 수 없으면 `store.failed`가 writer를 중지시킵니다.
- **외부 작업 저널**: Herdr/MCP/preview 호출은 `Broker.operation()`을 거치고 `prepared → dispatching → settled|unknown`의 각 단계가 저장됩니다. 결과가 불명확하면 run을 `paused` + `resume_required`로 두고 **자동 재전송하지 않습니다.** 확정 검증 오류(`HerdrRejected`)만 미실행으로 간주합니다. 사용자는 `reconcile`의 `confirm_not_executed`로 정리합니다.
- **재시작**: 브로커가 시작되면 종료되지 않은 run은 모두 `paused`/`broker_restarted`가 되고, 명시적 resume(웹 "작업 재개" 또는 `execute` action `resume`)이 필요합니다.
- **오케스트레이션 모드** (`run.orchestration.mode`): 신규·피드백 run은 `claude-native`입니다. PM이 바로 `plan`을 보고하고, 모든 논리 태스크(역할이 developer/designer여도)는 `taskAgent()`를 통해 같은 PM에게 하나씩 배정되며, 보고·`media-request`도 PM만 합니다. `pm-led`(0.5~0.6) run은 PM이 `team-create`를 보낸 뒤에야 브로커가 developer/designer pane을 만들며, 재개해도 원래 모드를 유지합니다. 모드 분기를 건드릴 때는 `requiredAgents()`, `taskAgent()`, `checkpoint()` 검증, `prepareRuntime()`, `injectedSkills()`, `setup()`의 `studioPlugin()`/`claudeArgs()` 호출, `scripts/export-schemas.mjs`(meta·agents 스키마가 모드별 agent 수를 검증)를 함께 확인합니다. 쓰기 경계는 developer `app/`, designer `assets/`, pm `reports/`이며, assets와 reports는 `.herdr/runs/<run_id>/` 기준 상대 경로입니다. `claude-native` run은 작성자가 PM 하나라 역할과 무관하게 세 루트 모두 허용합니다(`validatePlan(tasks, mode)`).
- **업무 상태 ≠ 에이전트 runtime 상태**: idle/done은 납품 완료가 아닙니다. `review_pending`은 모든 태스크 완료 + 미리보기 ready + quiescent일 때만 됩니다.
- **실행 게이트**: `allowExecution`(기본 true), `autoStart`(기본 false). `autoStart`가 아니면 queued run은 `execute` 명령으로 `execution_requested`가 설정돼야 슬롯을 받습니다.

### 런타임 경로와 환경 변수

| 항목 | 기본값 | 재정의 |
| --- | --- | --- |
| 설정 | `~/.config/herdr-homepage/config.json` | `HOMEPAGE_CONFIG`, `--config` |
| 브로커 상태(checkpoint, `broker.sock`, `broker.log`, `lock/`) | `~/.local/state/herdr-homepage/sessions/homepage/` | `HOMEPAGE_STATE_DIR` |
| 프로젝트 | `~/herdr-homepages/<project-id>` | `HOMEPAGE_PROJECTS_ROOT`, `projectsRoot`, `--projects-root` |
| Herdr 소켓 | `~/.config/herdr/sessions/homepage/herdr.sock` | `HERDR_CONFIG_PATH` (바이너리는 `HERDR_BIN_PATH`) |
| 홈페이지 스킬 자동 탐색 (레거시 run만 주입, native는 references 경로만 안내) | `~/.claude/skills/higgsfield-websites/SKILL.md` | `CLAUDE_CONFIG_DIR`, `skills`(명시하면 모든 모드에 주입) |

Herdr는 최소 0.8.0, socket protocol 19 이상이 필요하며 현재 검증 대상은 0.9.3입니다. CLI 계약은 https://herdr.dev/docs/cli-reference/ 를 참고합니다.

## 테스트 구조

- `tests/helpers.ts`의 `fixture()`는 `/private/tmp/hp-*` 아래에 `allowExecution:false`인 Config와 PRD/design 입력을 만듭니다. `FakeHerdr`는 `cli/api/snapshot/doctor`를 대체하는 test double이고, `cmd()`와 `pmReport()`는 명령 envelope을 만듭니다.
- `tests/fixtures/mcp-server.mjs`는 가짜 stdio MCP, `preview.mjs`는 가짜 미리보기 서버입니다. 테스트는 모델을 호출하지 않습니다.
- 테스트 이름의 접두사(T##, E##, W##, P##, M##, B##, S##=studio 플러그인)는 테스트 계획 시나리오 ID입니다. `studio.dir`은 테스트에서 임시 사본을 가리키도록 바꿀 수 있는 seam입니다.
- S10·S13은 생성된 명령 문장을 공백·따옴표·`$`가 든 경로에서 실제 sh·zsh로 실행합니다. S12는 `tests/fixtures/look-fixed.html`로 실제 `look.py`(Python Playwright + Chromium)를 돌려 픽셀을 확인하며, python3·Playwright·Chromium이 없을 때만 skip하고 그 밖의 오류는 실패시킵니다.

## 저장소 관례

- `dist/`, `.runtime/`(로컬 실험 스크립트·로그), 그리고 `docs/installation.md`와 `docs/usage.md`를 제외한 `docs/*`는 gitignore 대상입니다. docs의 기획·리서치·검증 문서는 로컬에만 있습니다.
- Herdr의 `plugin install`이 `herdr-plugin.toml`의 `[[build]]`(`npm ci --ignore-scripts`, `npm run build`)를 실행하므로 dist는 커밋하지 않습니다.
- 버전을 올릴 때는 `package.json`, `package-lock.json`, `herdr-plugin.toml`, `src/version.ts`, `claude-plugin/homepage-studio/.claude-plugin/plugin.json`, README.md와 `docs/installation.md`의 `--ref vX.Y.Z`를 함께 바꿉니다. 사용자에게 보이는 변경 사항은 `docs/usage.md`에 `## … (X.Y.Z)` 섹션으로 추가합니다.
