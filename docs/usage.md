# 웹 UI와 프로젝트 사용법

## 샘플 제작 요청

웹 UI에서 **제작 요청 → 샘플 요청 채우기**를 누릅니다. 고유 프로젝트 ID, PRD와 디자인 초안이 입력됩니다. 내용을 검토한 뒤 **프로젝트 초기화만** 또는 **초기화 후 homepage로 전송**을 선택합니다.

초기화는 새 프로젝트 폴더에 `prd.md`, `design.md`, `homepage-init.json`, `homepage-request.json`, `app/`, `homepage-runtime.json`을 만듭니다. 실행 설정에는 세션·모델·PM 1명·작업 흐름(direction, first-screen, build-out)·스킬·MCP 방식이 자동 기록됩니다. 기존 폴더·수정된 문서를 덮어쓰지 않습니다. 브로커에 접수되면 `meta.json`, `task.json`, `agents.json`, `.herdr/runs/`가 추가됩니다. 초기화는 기존 프로젝트 삭제나 재설정이 아닙니다.

웹 버튼 → 고정된 브로커 CLI subcommand → IPC 큐 접수 → 스케줄러의 Herdr CLI(`--session homepage`) 순서로 전달됩니다. HTTP에서 임의 shell 명령이나 에이전트 프롬프트를 실행하지 않습니다. 접수 후에는 queued로 대기하며, 프로젝트의 **제작 시작**을 눌러 실행합니다.

같은 요청의 재전송은 같은 command ID를 사용합니다. 응답이 끊겼다면 새 요청을 만드는 대신 기존 버튼으로 재시도하세요. 같은 브라우저 탭의 재로드를 위해 요청을 sessionStorage에 보존합니다. 프로젝트 ID를 바꾸려면 새 요청 작성을 선택합니다.

## 생성 경로는 필요한가요?

브로커 submit에는 절대 `directory`가 필수입니다. 웹 UI는 기본 상위 경로 `~/herdr-homepages` 또는 설정 `projectsRoot`와 프로젝트 ID를 합쳐 생성하므로 매번 전체 경로를 입력할 필요가 없습니다. 요청 전 최종 경로를 표시합니다. 특정 위치를 쓰려면 `projectsRoot`를 설정하고 브로커를 재시작합니다. symlink 경로는 거부합니다.

입력 문서 원본은 외부 도구 또는 사용자가 관리하고, 각 실행은 해시가 고정된 사본을 참조합니다. 생성 코드는 `app/`에 기록됩니다. 외부 도구는 상태 JSON을 읽기 전용으로 취급하고 변경 명령은 CLI로 전달합니다.

## CLI 초기화

설치 checkout에서 다음 JSON을 `init.json`으로 준비합니다.

```json
{
  "project_id": "company-homepage",
  "request_id": "company-homepage-v1",
  "prd": "# 요구사항\n기업 소개와 서비스, 문의 영역을 포함하는 반응형 홈페이지.",
  "design": "# 디자인\n밝은 배경, 대표 이미지와 절제된 CSS 모션."
}
```

```sh
node dist/src/cli.js project init --file init.json
node dist/src/cli.js project submit --project company-homepage
node dist/src/cli.js project state --project company-homepage
node dist/src/cli.js status --project company-homepage
```

`project init`의 경로는 `projectsRoot` 또는 CLI `--projects-root /absolute/path`로 지정합니다. 다른 root로 초기화한 경우 submit에도 동일한 설정을 적용합니다. 이미 준비된 외부 PRD/design은 `scripts/make-request.mjs PROJECT_ID DIRECTORY PRD_PATH DESIGN_PATH`로 별도 submit 명령을 만들 수 있습니다.

## JSON 상태 확인

대시보드는 checkpoint 기반 상태를 2초마다 조회합니다. 프로젝트의 **JSON 상태 확인**은 등록된 프로젝트 경로의 세 파일을 직접 읽고 `project_id`, `run_id`, `revision`을 대조합니다. 불일치·파일 누락·symlink는 정상으로 표시하지 않습니다. agent capability와 실행 인자 등 내부 정보는 제외한 JSON을 보여줍니다.

- `queued`: 시작 요청 또는 실행 슬롯을 기다림. `meta.json.execution_requested`가 true이면 사용자가 실행을 요청한 상태.
- `starting` / `running` / `retrying`: 실행 준비·작업·재시도.
- `waiting_input`: 사용자 응답 필요. 문서 변경 답변은 추가로 새 PRD/design을 적용해야 함.
- `paused`: 재시작 또는 불명확한 실행으로 정지. 대조 후 명시적 resume 필요.
- `review_pending`: 소스·미리보기와 작업 결과를 사용자 검토로 넘긴 상태.
- `failed` / `cancelled`: 실패 또는 취소.

업무 상태와 에이전트 실행 상태는 구분합니다. 유휴 상태가 제작 완료를 의미하지 않습니다. ready로 확인된 localhost 미리보기만 링크를 표시합니다. 연결이 끊기면 마지막 수신값임을 표시하고 자동 재연결합니다.

TUI 보드도 연결이 끊기면 마지막 수신 상태를 표시하고 같은 오류를 반복 출력하지 않습니다. 브로커가 중지됐다면 화면의 start 명령으로 다시 시작합니다. `r`은 프로젝트 재개이며 브로커 시작이나 모델 실행 활성화가 아닙니다. 연결 복구 전 재개·취소·pane 이동 키는 차단되며, 오프라인 입력을 나중에 자동 전송하지 않습니다.

## 상태 체크와 도움말

프로젝트 상세에서 `queued`는 **제작 시작**, `paused`는 **작업 재개**를 제공합니다. 실행 준비 화면은 두 항목만 표시합니다.

1. **문서 준비**: 실행에 고정된 PRD/design 사본과 해시를 확인합니다.
2. **플러그인 준비**: 브로커 저장소와 homepage 연결 등 플러그인의 기본 작동 상태를 확인합니다.

초기화·접수·브로커 재시작 시 실행 구성을 자동 준비합니다. 신규 실행은 번들 homepage-studio 스킬을 로드하고 Higgsfield MCP 연결을 재사용하므로 별도 모델 실행 스위치나 stdio 도구 매핑을 입력할 필요가 없습니다. 기존에 명시한 사용자 설정은 유지합니다. 필수 번들 파일이 누락되면 재설치를 안내하며, Python Playwright 누락은 경고만 하고 실행을 막지 않습니다. 실제 MCP 도구가 없거나 로그인이 필요하면 작업 중 입력 요청으로 알립니다.

웹 요청은 `execute` CLI를 거쳐 현재 project/run에 적용됩니다. 시작을 요청한 프로젝트만 FIFO로 처리하며 최대 2개 슬롯이 차면 대기합니다. 요청 접수와 실제 모델 실행은 구분합니다. 미응답 질문·이미 종료된 run·불명확한 이전 실행은 기존 보호 규칙에 따라 거부하고, 설정 체크와 별개로 해당 사유를 표시합니다.

기본 MCP 방식에서는 PM이 설치된 Higgsfield 도구를 직접 사용하고 실행 폴더의 `assets/media-receipts.json`에 실제 job ID·상태·결과 경로를 남겨 작업 보고에 포함합니다. 명시적인 `mcp` 설정이 있으면 기존 broker stdio 제출·상태 조회 방식을 유지합니다. 실제 모델 인증이나 생성 결과는 사전 체크로 보장하지 않습니다.

응답이 끊기면 **같은 요청으로 결과 확인**을 사용합니다. 같은 탭의 새로고침 후에도 요청 ID를 유지하며 중복 실행하지 않습니다. 기본값은 `allowExecution:true`, `autoStart:false`입니다. 관리자가 지정한 `allowExecution:false`는 유지하며 웹에서 우회하지 않습니다. 외부 큐를 자동으로 처리하려는 경우에만 `autoStart:true`를 선택합니다.

CLI 사전 점검은 `node dist/src/cli.js project readiness --project ID`입니다. 웹 시작/재개와 같은 검증을 거치는 명령은 아래 JSON을 파일로 저장한 뒤 `node dist/src/cli.js execute --file execute.json`으로 보냅니다. UUID와 프로젝트 ID는 현재 요청 값으로 바꿉니다. `action`은 대기 요청이면 `start`, 일시 정지 요청이면 `resume`입니다.

```json
{
  "schema_version": 1,
  "command_id": "REPLACE_WITH_UUID",
  "type": "execute",
  "project_id": "company-homepage",
  "run_id": "CURRENT_RUN_UUID",
  "payload": { "action": "start" }
}
```

**상태 체크**는 브로커, homepage Socket API, 자동 구성과 MCP 사용 방식을 보여줍니다. 메인 화면의 MCP 서버 패널은 실제 접속 검사를 별도로 수행합니다. 모델 계정의 유료 생성 성공까지 보장하지는 않습니다. 설치 checkout에서 `node dist/src/cli.js doctor`로 상세 진단합니다.

**도움말**에는 프로젝트 초기화, 경로 설정, 상태 의미, 입력 응답, GitHub 설치·태그 업데이트, Herdr 자체 업데이트와 문제 해결이 포함됩니다. 설치·업데이트는 [설치 문서](installation.md)를 참고하세요.

웹 서버는 loopback에서만 동작합니다. 상태 읽기와 초기화·submit·시작/재개 작업을 HTTP로 노출하며 변경 요청은 같은 출처와 CSRF 토큰을 확인합니다. 답변·취소·피드백은 기존 CLI를 사용합니다. 이 웹 서버를 원격 공개용 REST 큐로 사용하지 않습니다.

## 시각 판단 스킬을 단계별로 로드 (0.9.3)

- 0.9.2 제작 검증에서 PM이 `design-taste`만 로드하고 `high-end-visual-design`과 `frontend-design`은 로드하지 않은 것을 확인했습니다. 그런데도 확인 기록에는 high-end 기법을 골랐다고 적었습니다.
- 이제 단계마다 로드할 스킬을 정해 둡니다. direction을 시작할 때 `design-taste`를, first-screen을 시작할 때 `high-end-visual-design`과 `frontend-design`을 Skill 도구로 로드합니다. PM 지침도 "homepage-studio 스킬이 정한 단계에서 로드한다"로 맞췄습니다.
- 로드하지 않은 스킬의 기법은 확인 기록(verdict)에 적지 않습니다.
- 스킬 내용, 우선순위, 단계와 회차 수는 그대로입니다. first-screen에서 읽는 스킬 본문이 늘어 그 단계 시간이 조금 늘 수 있습니다.

**이미 시작한 PM**: PM 지침은 PM을 시작할 때 읽으므로, 업데이트 후 새로 만든 프로젝트·피드백 run부터 적용됩니다.

## 시각 판단 스킬 추가: taste-skill (0.9.2)

- homepage-studio 플러그인에 [taste-skill](https://github.com/Leonxlnx/taste-skill)(MIT)의 스킬 두 개를 기본으로 넣었습니다. 기존 `frontend-design`은 그대로 둡니다.
  - **`design-taste`**: taste-skill 기본 스킬 `design-taste-frontend` v2의 홈페이지용 발췌본(약 25KB, 원본 87KB)입니다. 남긴 줄은 원본 문장 그대로이고, 우리 규칙에 맞게 바꾼 줄에는 `[adapted]`를 붙였습니다. Next.js 기본 스택, 디자인 시스템 지도, 외부 이미지·CDN 로고, 다크 모드 필수, 블록 라이브러리, 부록은 뺐습니다.
  - **`high-end-visual-design`**: taste-skill의 `soft-skill`을 원본 그대로 넣었습니다.
- **역할**: design-taste로 direction에서 판독 한 줄과 세 다이얼(레이아웃 실험도·모션 강도·정보 밀도)을 정하고, look 회차에서 AI tells와 사전 점검으로 화면을 판정합니다. high-end-visual-design은 고급스러운 질감·여백·버튼·모션을 골라 쓰는 선택지이며 모든 항목을 의무로 적용하지 않습니다. frontend-design은 미적 방향과 구현 완성도를 맡습니다.
- **우선순위**: 충돌하면 homepage-studio 스킬과 references → design-taste → high-end-visual-design·frontend-design 순으로 따릅니다. 입력에 없는 사실·로고·후기를 쓰지 않고, 로컬 자산만 쓰며, 취향을 묻지 않고, 첫 화면 핵심 문구는 1초 안에 보이고, 한국어 서체는 `references/korean.md`를 따르고, 다크 모드는 요청이 있을 때만 씁니다.
- **흐름 변화**: `direction.md`에 `판독: … / 다이얼 V·M·D` 한 줄이 늘었습니다. build-out 확인 회차 중 한 번은 design-taste 사전 점검으로 보고, 고른 high-end 기법도 같은 회차에서 확인합니다. 회차 수와 단계는 그대로입니다.
- **em-dash**: 페이지에 보이는 글자에는 em-dash(—)를 쓰지 않습니다. `<title>` 예시도 `회사명 | 핵심 제공물`로 바꿨습니다.
- PM이 읽는 스킬 본문이 약 18KB에서 55KB로 늘었습니다. 효과와 제작 시간은 다음 제작에서 확인합니다.
- 출처, revision, 해시, 바꾼 내역은 `claude-plugin/homepage-studio/THIRD_PARTY_NOTICES.md`에 있습니다. 필수 번들 파일에 두 스킬이 추가되어, 없으면 `studio_plugin_missing`으로 멈춥니다.

**이미 시작한 PM**: 스킬과 PM 지침은 PM을 시작할 때 읽으므로, 업데이트 후 새로 만든 프로젝트·피드백 run부터 적용됩니다.

## PM 명령 안정성과 화면 확인 보강 (0.9.1)

- **broker-cli 래퍼**: claude-native run은 run 폴더(`.herdr/runs/<run_id>/broker-cli`)에 실행 파일 하나를 만듭니다. node 경로, CLI 경로, 고정 소켓을 담고 있어 PM은 이 경로 하나로 report·preview·media 명령을 보냅니다. zsh에서 여러 단어를 담은 변수가 나뉘지 않아 명령이 실패하던 문제를 막습니다. 래퍼에는 토큰이 없고 토큰은 assignment 파일에만 있습니다.
- **경로 인용**: PM 지침, 태스크 파일, look 명령, 레거시 pm-led 지침의 실행 경로를 모두 셸 작은따옴표로 인용합니다. 프로젝트 경로에 공백·따옴표·`$`가 있어도 그대로 붙여 넣어 실행됩니다. look 명령은 `<preview URL>`과 `<round>`만 바꾸면 됩니다.
- **보고 예시**: 태스크 파일에 그 assignment용 report 전체 예시(plan, progress, completed 등)를 넣습니다. sequence는 시작값이며, 브로커가 마지막으로 받은 값보다 커야 합니다. 결과를 못 본 보고는 같은 파일을 그대로 다시 보내 확인하고, 새 보고는 새 UUID를 씁니다.
- **look.py 전체 페이지 캡처**: 전체 캡처 전 `position: fixed` 요소를 정리할 때, 섹션 안에 갇힌 요소(transform 등으로 화면에 고정되지 않는 요소)는 그대로 둡니다. 숨기거나 옮긴 요소는 선택자와 이유를 `issues.json`에 남깁니다(최대 20개, 전체 수 별도). 스크롤 중 화면에서 관측되지 않은 요소는 그 범위로만 기록하고, 스크롤이 시간 초과되면 관측이 불완전하다고 적습니다. 정리 중 오류가 나면 원래 style로 되돌리고, 오류와 복원 여부를 `issues.json`과 출력에 경고로 남깁니다.
- **homepage-studio 스킬 지침**
  - direction에 대표 장면 한 줄을 적고, first-screen에서 히어로와 대표 섹션을 함께 봅니다.
  - build-out 확인 회차 중 한 번은 중요 이미지의 원본과 배치, 가장 긴 반복 구간, 숫자 입력을 빠르게 바꿨다 되돌린 변화를 확인합니다.
  - 가장 중요한 증거가 가장 큰 시각적 비중을 차지하게 하고, 정보량이 다른 내용을 같은 틀에 반복하지 않습니다. 왼쪽 기준선과 크기·여백 스케일을 정돈합니다.
  - 이미지: 판매 대상과 소품 구별, 결합·전후 비교 사진에서 맞아야 할 부분 확인, 공정 장면의 동일성 기준.
  - 글자: `:root` 변수 6~8단계의 크기 스케일, 숫자는 모두 `tabular-nums`, 비교 숫자는 같은 기준선, SVG 글자는 화면에 보이는 크기로 판단, 첫 화면 h1·가격·CTA는 1초 안에 표시.
  - 모션: 숫자 트윈은 지금 화면에 보이는 값에서 새 목표로 이어 가고, 이징은 등장용·UI용 두 가지로 통일하며, reduced-motion에서는 처음부터 최종 상태입니다. 폼 입력 조건은 필드 옆 도움말에 미리 적습니다.

**이미 시작한 PM**: `pm-instructions.md`는 PM을 시작할 때 한 번만 쓰므로, 0.9.0에서 시작한 PM은 업데이트 후 재개해도 이전 PM 지침을 그대로 씁니다. 재개 뒤 새로 배정되는 태스크 파일만 새 형식(래퍼 경로와 report 예시)으로 만들어집니다. 0.9.1 지침 전체는 업데이트 후 새로 만든 프로젝트·피드백 run부터 적용됩니다.

## PM이 화면을 보며 직접 만드는 3단계 흐름 (0.9.0)

- 신규·피드백 run의 계획은 3개 작업입니다. **direction**(섹션 구성·이미지 목록·시각 방향을 `reports/direction.md` 한 장으로 정리) → **first-screen**(히어로와 대표 섹션 하나를 완성 수준으로 구현하고 미리보기 시작) → **build-out**(나머지 섹션·기능 구현과 최종 확인). 브로커는 이 작업을 같은 PM에게 하나씩 배정합니다.
- PM이 디자인·카피·이미지 생성·구현을 한 세션에서 직접 진행합니다. 0.8.0의 helper 3개(`homepage-studio:homepage-developer`, `homepage-designer`, `homepage-copywriter`)와 korean-copywriting, korean-typography, asset-kit, quality-gate, seo-basics 스킬은 제거했습니다. 플러그인에는 `homepage-studio`, `frontend-design` 스킬과 `look.py`만 남습니다. Claude 서브에이전트는 이미지 여러 장을 병렬로 생성할 때만 사용하며, PM은 서브에이전트가 모두 끝난 뒤에 완료·실패·질문을 보고합니다.
- **look.py**: `python3 <플러그인>/skills/homepage-studio/scripts/look.py <미리보기 주소> <실행 폴더>/reports/look/<회차> [--reduced-motion]`. 데스크톱 1440×900과 모바일 390×844 첫 화면(`desktop.png`, `mobile.png`), 전체 페이지(`desktop-full.png`, `mobile-full.png`), 읽기 쉬운 크기로 나눈 `parts/`, `issues.json`을 저장합니다. 전체 캡처 전에 끝까지 스크롤해 지연 로딩 이미지와 스크롤 효과를 깨운 뒤 맨 위로 돌아갑니다. `issues.json`에는 가로 넘침과 원인 요소, 콘솔 오류, 실패한 요청, 깨진 이미지, localhost 밖으로 나간 요청을 기록합니다. 문제가 있어도 종료 코드는 0이며, 페이지를 열지 못하거나 Playwright가 없을 때만 0이 아닌 코드와 함께 이유를 출력합니다. 127.0.0.1·localhost 주소만 받습니다.
- 확인 횟수: first-screen에서 최대 2회, build-out에서 최대 3회 확인하고 마지막에 `reports/look/final`에 납품 증거를 1회 저장합니다. 별도 QA 에이전트는 없습니다.
- 이미지·영상: PRD/design에 수량이 있으면 그대로 따릅니다. 없으면 페이지에서 배치와 역할이 정해진 이미지만 최대 12장 만듭니다. 영상은 요청이 있을 때만 만듭니다(기본 0개, 0.8.0의 히어로 영상 기본값은 없앴습니다). 생성 기록은 `assets/media-receipts.json`에 파일·용도·배치·모델·job ID·상태·sha256으로 남기며, 결과가 불명확한 작업은 다시 제출하지 않습니다.
- 쓰기 경계: `claude-native` run은 작성자가 PM 하나이므로 역할과 관계없이 모든 작업이 `app/`, `assets/`, `reports/`에 쓸 수 있습니다. 경로 검증(상대 경로, `..` 금지, 세 루트 중 하나로 시작)은 그대로이며, `pm-led`와 레거시 run은 역할별 경계를 유지합니다.
- 보고 시점: 방향 확정, 이미지 작업 접수·완료(실제 job ID 포함), 첫 화면 표시, 각 확인 회차 결과, 미리보기 준비. 시간 간격 보고는 하지 않습니다.
- 사전 체크와 `doctor`는 `python3`와 Python Playwright만 확인하고 `cwebp`는 참고 정보로 표시합니다(없으면 macOS `sips` 사용). PM pane과 같은 로그인 셸 기준으로 `python3`를 찾습니다.
- 샘플 요청 채우기는 가상의 입주청소 업체 홈페이지(**첫날 입주청소**)로 바뀌었습니다. 견적 계산기, 실제로 입력·검증되는 예약 문의 폼, 이미지 최대 8장, 영상 없음이 포함됩니다. 내용은 `examples/prd.md`, `examples/design.md`와 같습니다.

**0.8.0에서 시작한 run**: 0.8.0 지침은 이번 버전에서 제거된 helper와 스킬 파일을 가리킵니다. 진행 중인 run은 업데이트 전에 마무리하거나, 업데이트 후 취소하고 새 run으로 다시 시작합니다. 0.8.0 run을 0.9.0에서 재개하지 마세요. 별도의 호환 처리는 없습니다.

## 홈페이지 제작 스튜디오 (0.8.0)

- 신규 PM 시작 인자에 `--plugin-dir <설치 checkout>/claude-plugin/homepage-studio`를 추가합니다. 명령줄에는 플러그인 경로만 전달하고 긴 지침은 기존처럼 파일을 읽는 첫 프롬프트로 전달합니다. `.claude/agents`를 새로 쓰지 않습니다.
- 전용 스킬: homepage-studio, frontend-design, korean-copywriting, korean-typography, asset-kit, quality-gate, seo-basics. 내부 helper: `homepage-studio:homepage-developer`, `homepage-studio:homepage-designer`, `homepage-studio:homepage-copywriter`. Herdr PM pane은 여전히 1개이며, 동시에 helper 2개까지는 프롬프트 지침입니다.
- 흐름: 리서치 → 디자인 브리프 → 카피덱 → 에셋 → 정적 빌드 → PM 품질 검사 → 수정 1회 → 최종 기록. 자동 검사는 최초 1회와 수정 후 증거 저장 1회로 제한하며 별도 QA 에이전트나 반복 수정 루프는 없습니다.
- 명시적인 PRD 이미지·영상 수량이 우선입니다. 수량이 없으면 run 전체에 이미지 최대 12장과 히어로 영상 1개를 기본 예산으로 사용합니다. 알 수 없는 제출 결과를 재전송하지 않습니다.
- `skills-lock.json`에 플러그인 경로·버전·전체 파일 해시를 저장합니다. `agents.json.orchestration_mode`와 JSON 스키마는 PM 1개인 native 실행과 3개 역할인 레거시 실행을 모두 구분합니다.
- 설치된 Higgsfield 스킬 본문 전체는 신규 run에 자동 주입하지 않으며, 필요한 reference 경로만 안내합니다. 설정의 명시적 `skills`는 계속 지원합니다.
- `doctor`에서 `studio.plugin`과 보조 도구 상태를 확인합니다. 실행 화면은 필수 스킬·스크립트가 없으면 재설치를 안내하고, 선택 도구 누락은 경고만 표시합니다.

브로커 업데이트가 기존 Claude 프로세스를 재시작하지는 않습니다. 이미 시작한 PM의 도구 목록에 새 번들이 추가됐다고 간주하지 않으며, 새 프로젝트·피드백 run부터 새 로딩 경로를 사용합니다. 이 절과 아래 0.7.0 절은 이전 구현 기록이며, 0.9.0에서 바뀐 내용은 위 절을 따릅니다.

참고: [Claude 플러그인 공식 명세](https://code.claude.com/docs/en/plugins-reference). 제3자 출처·라이선스는 저장소의 `claude-plugin/homepage-studio/THIRD_PARTY_NOTICES.md`에 있습니다.

## PM 한 명과 프롬프트 초기화 (0.7.0)

새 프로젝트와 피드백 run은 `meta.json.orchestration.mode: "claude-native"`를 사용합니다. **프로젝트마다 Herdr PM pane 한 개만** 생성하며 `agents.json`에도 PM 한 명만 기록합니다. 개발·디자인은 논리적인 작업 역할이며, `task.json`의 모든 작업은 PM이 실행하고 보고합니다. PM은 직접 구현하거나 같은 Claude 세션의 내부 에이전트를 활용할 수 있습니다.

초기화 순서는 다음과 같습니다.

1. 실행 폴더에 `pm-instructions.md`, `homepage-orchestration.md`와 선택된 홈페이지 스킬 지침을 저장합니다. 프로젝트 `.claude/agents/homepage-developer.md`, `homepage-designer.md`에 Claude 내부 역할을 준비합니다. 기존 사용자 파일은 덮어쓰지 않습니다.
2. Herdr `workspace create`의 기본 터미널에서 `agent start`로 Claude를 실행합니다. 기본 Claude 인자는 `--model claude-opus-5-5 --effort high --setting-sources=`입니다. 지침 본문이나 에이전트 JSON을 명령줄에 넣지 않습니다.
3. 입력 준비가 확인되면 Herdr `agent prompt`로 **PM 지침 파일과 현재 작업 파일을 읽고 수행하라**는 짧은 메시지를 보냅니다. `--append-system-prompt-file`과 `--agents`는 새 실행에 사용하지 않습니다. 별도 유료 초기화 턴 없이 첫 작업에서 지침을 함께 읽습니다.
4. PM은 `plan`을 바로 보고합니다. 브로커는 논리적 개발·디자인·검토 작업을 PM에게 한 번에 하나씩 배정합니다. PM이 필요한 내부 에이전트를 사용하고 결과를 취합해 `progress`/`completed`를 보고합니다. 내부 에이전트가 끝나기 전에 작업 완료를 보고하지 않도록 지시합니다.
5. 모든 작업 완료, localhost 미리보기 준비, PM 유휴 확인 후 사용자 검토 대기로 전환합니다.

내부 개발자·디자이너는 PM 모델을 상속하고 high effort를 사용합니다. 내부 작업자 최대 2명은 프롬프트 지침이며 브로커가 Claude 내부 동시 실행을 강제로 제한하거나 직접 관측하는 것은 아닙니다. 웹 UI는 PM의 Herdr 상태와 작업별 진행 보고를 표시합니다. 내부 역할에 가짜 Herdr pane ID를 만들지 않습니다. Higgsfield 설치 모드에서는 PM 또는 내부 디자이너가 생성하고, 선택적인 broker stdio 모드에서는 PM이 `media-request`를 요청합니다.

기존 `pm-led` 및 이전 실행의 pane·작업 기록은 유지합니다. 기존 실행을 재개하면 원래 구성을 사용하고, 새 프로젝트나 피드백 run부터 한 명 방식으로 전환합니다. `team-create`는 기존 실행의 호환 용도로만 남습니다. Agent/Task/Skill을 막는 도구 제한은 추가하지 않습니다.

명령 계약은 [Herdr CLI](https://herdr.dev/docs/cli-reference/)와 설치된 Herdr 0.9.3 도움말을 확인했습니다. Claude 내부 역할 파일과 모델 상속은 [Claude 공식 subagent 문서](https://code.claude.com/docs/en/sub-agents)를 기준으로 합니다.

## Herdr 원본 CLI로 실행 확인

Herdr 0.9.3의 도움말과 [공식 CLI 문서](https://herdr.dev/docs/cli-reference/), [에이전트 자동화 문서](https://herdr.dev/docs/agent-automation/)를 기준으로 합니다. 모든 명령에 `--session homepage`를 지정합니다. 아래 `PANE_ID`는 `agents.json`이나 실제 조회 응답의 pane ID로 바꿉니다.

```sh
herdr --session homepage agent list
herdr --session homepage agent get PANE_ID
herdr --session homepage agent read PANE_ID --source visible
herdr --session homepage pane process-info --pane PANE_ID
herdr --session homepage agent wait PANE_ID --until idle --until done --timeout 30000
```

`agent` 명령은 이름 또는 pane ID를 받으며 terminal ID를 대상으로 받지 않습니다. 작업 중 화면은 `visible`로 읽습니다. `process-info`의 실제 인자로 모델과 effort를 확인합니다. idle/done은 입력 가능한 실행 상태이며 홈페이지 납품 완료는 아닙니다.

브로커는 기존 shell pane에 짧은 이름으로 `agent start NAME --kind claude --pane PANE_ID --timeout 30000 -- …`를 실행합니다. `agent_not_ready`나 timeout이 발생했다면 프로세스가 이미 시작됐을 수 있으므로 재실행 전에 화면과 프로세스를 확인해야 합니다. 프롬프트 전달 성공도 작업 완료를 의미하지 않습니다. 오류 후 불명확한 작업을 자동 재전송하지 않습니다.

CLI/API 차이를 확인할 때는 설치된 바이너리의 `herdr api schema --output herdr-api.schema.json`으로 해당 버전의 계약을 저장할 수 있습니다. 별도 Herdr 세션을 중지하거나 다시 만드는 것은 이 점검에 필요하지 않습니다.


## MCP 서버 연결과 실시간 진행 (0.6.0)

메인 화면의 **MCP 서버**에서 설치된 서버 이름과 연결·로그인 필요·승인 대기·비활성·실패 상태를 확인합니다. Higgsfield는 별도 강조됩니다. 다른 서버는 목록 조회만 하며 홈페이지 에이전트에 추가 사용 권한을 주지 않습니다.

기본 방식은 실행 에이전트와 같은 설정 범위의 `claude --setting-sources '' mcp list`로 검사합니다. 별도 stdio 설정이 있으면 MCP initialize와 tools/list로 지정된 생성·조회 도구를 확인합니다. 이미지 생성은 호출하지 않습니다. URL, 환경 변수, 실행 인자, 인증 정보는 UI에 전달하지 않습니다. 검사는 비동기로 진행하며 60초간 결과를 공유합니다. 다시 확인은 최소 10초 간격으로 제한합니다. 실패·시간 초과는 확인 불가로 표시하며 이전 성공을 현재 사용 가능으로 표시하지 않습니다.

연결됨은 서버 접속 검사 결과입니다. 이미 실행된 각 Claude 세션에 해당 도구가 로딩되었는지와 실제 이미지 생성 성공은 작업 보고와 provider job 기록으로 별도 확인합니다.

웹 화면은 `/api/events`의 SSE 스트림으로 커밋된 상태를 약 1초 간격으로 수신합니다. 스트림 연결 지연 시 기존 `/api/status` 2초 폴링으로 복구합니다. 숨긴 탭은 스트림을 닫고 다시 보이면 연결합니다. 서버는 느린 클라이언트와 동시 스트림 수를 제한하며, 모델이나 터미널 읽기 호출을 추가하지 않습니다.

현재 진행 영역은 실제 작업 제목·Herdr 요청 단계·에이전트 runtime 상태를 표시합니다. 태스크의 최근 `progress` 또는 `completed` 보고와 보고 시각도 표시합니다. 실행 중인 태스크에 로딩 표시와 shimmer를 적용하고, 완료·대기·입력 요청을 구분합니다. 연결이 끊기면 마지막 기록이라는 안내와 함께 작업 애니메이션을 멈춥니다. OS의 모션 줄이기를 지원합니다.

## 샘플 이미지 생성 테스트

샘플 요청과 `examples/prd.md`, `examples/design.md`는 가상의 입주청소 업체 홈페이지를 만들며, 페이지에서 정보를 맡는 Higgsfield 이미지를 최대 8장 새로 생성하고 영상은 만들지 않는 시나리오입니다(0.9.0). 생성 실패나 불명확한 접수는 자동 재제출하지 않습니다. 생성 기록, 실제 job ID, 파일 경로·해시, localhost 이미지 표시를 확인합니다. 기존 이미지를 재사용한 작업은 신규 생성 테스트 통과로 간주하지 않습니다.

기존 프로젝트의 원본 문서를 수정해도 진행 중인 run의 문서 사본은 바뀌지 않습니다. 새 테스트는 새 프로젝트로 초기화하거나 새 해시를 포함한 `feedback`/`apply-inputs` 명령을 사용합니다. 이전 실행의 이미지·생성 기록·상태 JSON은 보존합니다.


## Claude 도구 및 스킬 사용 (0.6.1)

에이전트 시작 명령에서 `--disallowedTools`와 `--disable-slash-commands`를 제거했습니다. 플러그인이 Agent/Task/Skill을 일괄 차단하거나 Claude의 스킬 기능 전체를 비활성화하지 않습니다. 홈페이지 전용 스킬 사용 지침은 유지합니다. 0.7.0부터는 위의 PM 한 명 방식이 적용됩니다.

변경은 업데이트된 브로커가 새로 시작하는 Claude 프로세스부터 적용됩니다. 이미 실행 중인 프로세스의 시작 인자는 바뀌지 않습니다. 진행 중인 제작을 중단하지 말고 완료 후 브로커를 업데이트하여 다음 실행부터 적용하세요. 이 변경만으로 제작 품질 향상을 검증한 것은 아닙니다.
