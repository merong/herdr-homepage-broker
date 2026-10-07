# 설치와 업데이트

## 준비

macOS, Node.js 24 이상, Herdr 0.8.0 이상이 필요합니다. 실제 홈페이지 제작에는 Claude Code 로그인과 Opus 5.5 사용 권한이 필요합니다. Claude.ai에 연결된 Higgsfield MCP를 재사용합니다. 신규 실행에 필요한 홈페이지 전용 스킬은 `homepage-studio` Claude 플러그인으로 함께 설치됩니다. 기본 접수·웹 UI 시험은 모델을 호출하지 않습니다.

```sh
node --version
herdr --version
herdr --session homepage
```

Herdr가 없다면 [공식 설치 안내](https://herdr.dev/)를 따릅니다. `homepage`는 기존 세션과 분리된 전용 세션입니다.

현재 설치 검증 대상은 Herdr 0.9.3입니다. CLI를 업데이트해도 이미 실행 중인 서버는 이전 버전일 수 있으므로 웹의 **상태 체크**에서 서버 버전도 확인합니다. 활성 작업이 있다면 세션을 강제 종료하지 않습니다.

## GitHub 릴리스 설치

```sh
herdr --session homepage plugin install merong/herdr-homepage-broker --ref v0.9.0 --yes
```

설치가 의존성 설치와 TypeScript·정적 UI 빌드를 실행합니다. `dist`와 `node_modules`는 Git에 포함하지 않습니다. `--ref`를 고정하면 재현 가능한 버전을 설치할 수 있습니다.

workspace가 없다면 생성한 뒤 그 안에서 플러그인을 실행합니다.

```sh
herdr --session homepage workspace create --cwd "$HOME" --label homepage-control --focus
herdr --session homepage plugin action invoke start --plugin herdr-homepage-broker
herdr --session homepage plugin action invoke open-web --plugin herdr-homepage-broker
herdr --session homepage plugin action invoke web-status --plugin herdr-homepage-broker
```

주소는 기본 `http://127.0.0.1:7318`이며 `web-status`의 실제 주소를 확인합니다. 브로커 시작은 기본적으로 접수·상태 확인만 수행합니다.

## 자동 구성과 선택 설정

`~/.config/herdr-homepage/config.json`은 플러그인과 외부 CLI가 함께 읽는 기본 파일입니다. XDG_CONFIG_HOME을 사용하면 그 아래 `herdr-homepage/config.json`입니다. `HOMEPAGE_CONFIG` 또는 `--config`가 우선합니다. Herdr 서버가 이미 실행 중이면 나중에 export한 환경 변수는 기존 서버에 반영되지 않으므로 기본 파일 사용을 권합니다.

기본 사용에는 설정 파일을 만들 필요가 없습니다. CLI 또는 웹의 프로젝트 초기화에서 `homepage-runtime.json`을 생성하고 세션, 역할, 모델, 스킬, MCP 사용 방식을 준비합니다. 기존 프로젝트도 브로커 시작 시 자동으로 준비합니다. 초기화나 업데이트만으로 제작을 시작하지 않으며 프로젝트별 시작·재개 버튼을 사용합니다.

- 세션: `homepage`, 동시 프로젝트: 최대 2개.
- 에이전트: Herdr PM 1명, `claude-opus-5-5`, high. PM이 디자인·카피·이미지·구현을 직접 진행하며 서브에이전트는 이미지 병렬 생성에만 씁니다.
- 스킬: 설치 checkout의 `claude-plugin/homepage-studio`에 `homepage-studio` 스킬, `frontend-design` 스킬, 스크린샷 스크립트 `look.py`를 포함합니다. 신규 PM에 `--plugin-dir`로 로드합니다. 설치된 Higgsfield 스킬은 필요한 references만 참조하며, 명시적인 `skills` 경로는 추가로 주입합니다. 레거시 run은 기존 Higgsfield 스킬 자동 검색 방식을 유지합니다.
- MCP: Claude.ai에 연결된 Higgsfield의 기존 인증을 사용합니다. 별도 broker stdio 매핑은 필요하지 않습니다. 선택적으로 `mcp` 설정을 제공하면 기존 broker stdio 방식으로 동작합니다.
- 소스: 프로젝트 `app/`, 미리보기: localhost. 배포·게시 명령은 실행하지 않습니다.

경로나 포트를 바꿀 때만 아래처럼 설정합니다.

```json
{
  "projectsRoot": "/absolute/path/homepage-projects",
  "web": { "enabled": true, "port": 7318 }
}
```

경로의 자리표시자는 실제 원하는 절대 경로로 바꿉니다. 파일이 없으면 `~/herdr-homepages`를 사용합니다. MCP 인증정보나 로컬 설정을 Git에 커밋하지 않습니다. 설정 변경은 브로커 재시작 후 반영됩니다.

## 업데이트

Herdr 0.9.3에는 `plugin update`가 없습니다. 원하는 Git 태그로 `plugin install`을 다시 실행합니다. 브로커 프로세스는 이전 checkout 코드를 사용하므로 설치 후 재시작해야 합니다.

1. 웹 상태 체크와 프로젝트 상태를 확인합니다. 제작 중에는 먼저 작업을 정리합니다.
2. `stop` 액션으로 유휴 브로커를 중지합니다. 활성 작업이 있으면 거부하며 강제 종료하지 않습니다.
3. 새 태그를 지정해 설치한 뒤 `start` 액션을 실행합니다.
4. 기존 run과 호환되는 업데이트라면 웹에서 **작업 재개**를 누릅니다. 단, 0.8.0에서 시작한 미완료 run은 아래 호환성 안내에 따라 새 run으로 다시 시작합니다.

```sh
herdr --session homepage plugin action invoke stop --plugin herdr-homepage-broker
herdr --session homepage plugin install merong/herdr-homepage-broker --ref v0.9.0 --yes
herdr --session homepage plugin action invoke start --plugin herdr-homepage-broker
```

`v0.9.0`을 설치할 릴리스 태그로 바꿉니다. 로컬 link에서 Git 설치로 바꿀 때만 기존 link를 `herdr --session homepage plugin unlink herdr-homepage-broker`로 해제합니다. 이 명령은 소스 디렉터리나 프로젝트 상태를 삭제하지 않습니다. 구버전에 stop 액션이 없다면 그 버전의 foreground 브로커를 Ctrl+C로 종료하거나, 확인된 owner PID·시작 시각을 대조해 중지합니다.

이미 실행 중인 Claude PM에는 새 플러그인을 강제로 주입하거나 재시작하지 않습니다. 새 프로젝트 또는 피드백으로 생성한 새 run의 PM부터 0.9.0 워크플로를 사용합니다. 기존 run의 pane·진행 기록은 유지합니다. 0.8.0에서 시작해 아직 진행 중인 run은 재개하지 말고 업데이트 전에 마무리하거나, 업데이트 후 취소하고 새 run으로 다시 시작합니다. 0.8.0 지침이 가리키던 helper와 스킬 파일이 0.9.0 플러그인에는 없습니다.

Herdr 프로그램 자체의 업데이트는 별도 `herdr update` 명령입니다. 플러그인 릴리스 설치를 위해 Herdr 전체 세션을 강제 종료하지 않습니다.

## 확인과 문제 해결

```sh
herdr --session homepage plugin list --json
herdr --session homepage plugin log list --plugin herdr-homepage-broker
```

- EADDRINUSE: 다른 로컬 서버가 사용 중인 포트입니다. `web.port`를 바꾸고 브로커만 재시작합니다.
- ENOENT / broker.sock: 브로커가 중지됐거나 시작되지 않은 상태입니다. `plugin action invoke start --plugin herdr-homepage-broker`를 `--session homepage`와 함께 실행합니다. `stop`은 상태 조회가 아니라 브로커 종료 명령입니다. 보드는 연결 끊김과 마지막 수신 상태를 표시하고 자동 재연결하며, 브로커 자체를 자동 시작하지 않습니다. 연결 복구 후 필요한 프로젝트만 명시적으로 재개합니다.
- 보드의 `r`은 프로젝트 재개이며 브로커 시작이나 `allowExecution` 설정 변경이 아닙니다. 연결이 끊긴 동안 `r`/`c`/`p`는 비활성입니다.
- 실행 중지: 기본값은 실행 가능입니다. 기존 설정 파일에 `allowExecution:false`를 직접 지정한 경우 관리자의 중지 설정을 유지합니다. 중지를 해제하려면 해당 항목을 제거하거나 true로 바꾼 뒤 재시작합니다.
- MCP 연결·인증 문제가 실제 작업에서 발생하면 해당 오류를 사용자 입력 요청으로 보고합니다. 설치된 연결을 점검하려면 `claude --setting-sources '' mcp list` 또는 브로커 `doctor`를 사용합니다. 사전 체크에 별도 MCP 설정을 요구하지 않습니다.
- 손상·불일치한 JSON은 직접 덮어쓰지 말고 CLI 상태와 checkpoint를 대조합니다.
- `dist/src/cli.js`의 CLI를 직접 쓸 때는 설치 checkout에서 실행합니다. 설치 위치는 Herdr 설치 결과나 plugin 목록에서 확인합니다.

## homepage-studio 진단 (0.9.0)

설치 checkout에서 `node dist/src/cli.js doctor`를 실행하면 `studio.plugin`의 경로·버전·준비 여부와 `studio.tools`의 확인 결과를 볼 수 있습니다. 필수 번들 파일(`homepage-studio`·`frontend-design` 스킬, `look.py`)이 없으면 `studio_plugin_missing`으로 실행을 멈추므로 같은 릴리스를 다시 설치하세요.

검사 대상은 `look.py`가 쓰는 `python3`와 Python Playwright입니다. `cwebp`는 있으면 이미지 변환에 쓰고, 없으면 macOS `sips`로 대신하므로 참고 정보(`optional_missing`)로만 표시합니다. 누락은 경고로만 표시하고 자동 설치하거나 제작 시작을 막지 않습니다. Playwright가 없으면 PM은 스크린샷 확인을 생략했다고 보고하고 나머지 작업을 계속합니다.

PM pane은 사용자의 로그인 셸에서 실행되므로 브로커가 물려받은 PATH와 다른 `python3`를 쓸 수 있습니다. 그래서 진단은 `$SHELL -l -i -c`로 PM pane과 같은 방식으로 `python3`·`cwebp` 위치를 찾고, 결과의 `resolved_by`에 `login-shell`을 기록합니다. 로그인 셸 확인이 실패하면 브로커 PATH로 대신 확인하고(`resolved_by: "path"`), 경고에 결과가 PM pane과 다를 수 있다고 적습니다. Playwright 설치 예: `python3 -m pip install playwright && python3 -m playwright install chromium`. PM pane과 같은 `python3`에 설치해야 합니다.
