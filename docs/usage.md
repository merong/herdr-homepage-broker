# 웹 UI와 프로젝트 사용법

## 샘플 제작 요청

웹 UI에서 **제작 요청 → 샘플 요청 채우기**를 누릅니다. 고유 프로젝트 ID, PRD와 디자인 초안이 입력됩니다. 내용을 검토한 뒤 **프로젝트 초기화만** 또는 **초기화 후 homepage로 전송**을 선택합니다.

초기화는 새 프로젝트 폴더에 `prd.md`, `design.md`, `homepage-init.json`, `homepage-request.json`, `app/`를 만듭니다. 기존 폴더·수정된 문서를 덮어쓰지 않습니다. 브로커에 접수되면 `meta.json`, `task.json`, `agents.json`, `.herdr/runs/`가 추가됩니다. 초기화는 기존 프로젝트 삭제나 재설정이 아닙니다.

웹 버튼 → 고정된 브로커 CLI subcommand → IPC 큐 접수 → 스케줄러의 Herdr CLI(`--session homepage`) 순서로 전달됩니다. HTTP에서 임의 shell 명령이나 에이전트 프롬프트를 실행하지 않습니다. 실행 설정이 꺼져 있으면 queued로 접수하고 에이전트는 시작하지 않습니다.

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

- `queued`: 접수되어 실행 순서를 기다림. 실행 비활성 모드이면 그대로 대기.
- `starting` / `running` / `retrying`: 실행 준비·작업·재시도.
- `waiting_input`: 사용자 응답 필요. 문서 변경 답변은 추가로 새 PRD/design을 적용해야 함.
- `paused`: 재시작 또는 불명확한 실행으로 정지. 대조 후 명시적 resume 필요.
- `review_pending`: 소스·미리보기와 작업 결과를 사용자 검토로 넘긴 상태.
- `failed` / `cancelled`: 실패 또는 취소.

업무 상태와 에이전트 실행 상태는 구분합니다. 유휴 상태가 제작 완료를 의미하지 않습니다. ready로 확인된 localhost 미리보기만 링크를 표시합니다. 연결이 끊기면 마지막 수신값임을 표시하고 자동 재연결합니다.

TUI 보드도 연결이 끊기면 마지막 수신 상태를 표시하고 같은 오류를 반복 출력하지 않습니다. 브로커가 중지됐다면 화면의 start 명령으로 다시 시작합니다. `r`은 프로젝트 재개이며 브로커 시작이나 모델 실행 활성화가 아닙니다. 연결 복구 전 재개·취소·pane 이동 키는 차단되며, 오프라인 입력을 나중에 자동 전송하지 않습니다.

## 상태 체크와 도움말

프로젝트 상세에서 `queued`는 **제작 시작**, `paused`는 **작업 재개** 버튼을 제공합니다. 버튼을 누르면 실행 준비 화면에서 모델 실행 허용, 홈페이지 스킬, Higgsfield MCP 설정, 문서 해시, homepage 연결, 입력 요청·실행 자원 상태를 확인합니다. 부족한 항목과 설정 파일 경로를 표시합니다. 준비를 통과한 경우 **확인 후 제작 시작/작업 재개**로 요청을 보냅니다.

웹 요청은 고정된 `execute` CLI를 거쳐 현재 `project_id`와 `run_id`에만 적용합니다. 실제 MCP 연결과 생성·상태 도구 존재 여부는 전송 시 확인합니다. 요청 접수와 실제 실행 시작은 다릅니다. FIFO 순서와 최대 2개 슬롯을 유지하므로 슬롯이 차면 대기합니다. 이미 실행 중이거나 종료된 run, 미응답 질문, 불명확한 외부 요청이 있으면 거부합니다.

`allowExecution:false`는 웹 버튼으로 우회하지 않습니다. 설정 파일에 승인한 `skills`, 실제 `mcp` 연결 정보, `allowExecution:true`를 지정하고 브로커를 재시작합니다. 실행 허용은 큐 전체에 적용되므로 다른 대기 요청도 자동으로 실행될 수 있습니다. 모델 사용 권한과 생성 성공 여부는 이 사전 점검만으로 보장되지 않습니다.

응답이 끊기면 **같은 요청으로 결과 확인**을 사용합니다. 같은 탭의 새로고침 후에도 요청 ID를 유지하며, 이미 접수한 요청을 중복 실행하지 않습니다. 브로커 연결이 끊기면 실행 버튼이 비활성화됩니다. 실행 준비가 완료되지 않은 경우에는 설정을 수정하고 **준비 상태 다시 확인**을 누릅니다.

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

**상태 체크**는 브로커, homepage Socket API, 실행 허용, MCP 설정 유무, 승인 스킬 수를 보여줍니다. 실제 MCP 접속·모델 계정 검증은 수행하지 않습니다. 설치 checkout에서 `node dist/src/cli.js doctor`로 상세 진단합니다.

**도움말**에는 프로젝트 초기화, 경로 설정, 상태 의미, 입력 응답, GitHub 설치·태그 업데이트, Herdr 자체 업데이트와 문제 해결이 포함됩니다. 설치·업데이트는 [설치 문서](installation.md)를 참고하세요.

웹 서버는 loopback에서만 동작합니다. 상태 읽기와 초기화·submit·시작/재개 작업을 HTTP로 노출하며 변경 요청은 같은 출처와 CSRF 토큰을 확인합니다. 답변·취소·피드백은 기존 CLI를 사용합니다. 이 웹 서버를 원격 공개용 REST 큐로 사용하지 않습니다.
