# 설치와 업데이트

## 준비

macOS, Node.js 24 이상, Herdr 0.8.0 이상이 필요합니다. 실제 홈페이지 제작에는 Claude Code 로그인과 Opus 5.5 사용 권한, 홈페이지용 스킬, 브로커에 연결 가능한 Higgsfield MCP가 필요합니다. 기본 접수·웹 UI 시험은 모델을 호출하지 않습니다.

```sh
node --version
herdr --version
herdr --session homepage
```

Herdr가 없다면 [공식 설치 안내](https://herdr.dev/)를 따릅니다. `homepage`는 기존 세션과 분리된 전용 세션입니다.

현재 설치 검증 대상은 Herdr 0.9.3입니다. CLI를 업데이트해도 이미 실행 중인 서버는 이전 버전일 수 있으므로 웹의 **상태 체크**에서 서버 버전도 확인합니다. 활성 작업이 있다면 세션을 강제 종료하지 않습니다.

## GitHub 릴리스 설치

```sh
herdr --session homepage plugin install merong/herdr-homepage-broker --ref v0.3.0 --yes
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

## 지속 설정

`~/.config/herdr-homepage/config.json`은 플러그인과 외부 CLI가 함께 읽는 기본 파일입니다. XDG_CONFIG_HOME을 사용하면 그 아래 `herdr-homepage/config.json`입니다. `HOMEPAGE_CONFIG` 또는 `--config`가 우선합니다. Herdr 서버가 이미 실행 중이면 나중에 export한 환경 변수는 기존 서버에 반영되지 않으므로 기본 파일 사용을 권합니다.

```json
{
  "allowExecution": false,
  "skills": [],
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
4. 미완료 run이 있었다면 상태를 대조하고 CLI에서 명시적으로 resume합니다.

```sh
herdr --session homepage plugin action invoke stop --plugin herdr-homepage-broker
herdr --session homepage plugin install merong/herdr-homepage-broker --ref v0.3.0 --yes
herdr --session homepage plugin action invoke start --plugin herdr-homepage-broker
```

`v0.3.0`을 설치할 릴리스 태그로 바꿉니다. 로컬 link에서 Git 설치로 바꿀 때만 기존 link를 `herdr --session homepage plugin unlink herdr-homepage-broker`로 해제합니다. 이 명령은 소스 디렉터리나 프로젝트 상태를 삭제하지 않습니다. 구버전에 stop 액션이 없다면 그 버전의 foreground 브로커를 Ctrl+C로 종료하거나, 확인된 owner PID·시작 시각을 대조해 중지합니다.

Herdr 프로그램 자체의 업데이트는 별도 `herdr update` 명령입니다. 플러그인 릴리스 설치를 위해 Herdr 전체 세션을 강제 종료하지 않습니다.

## 확인과 문제 해결

```sh
herdr --session homepage plugin list --json
herdr --session homepage plugin log list --plugin herdr-homepage-broker
```

- EADDRINUSE: 다른 로컬 서버가 사용 중인 포트입니다. `web.port`를 바꾸고 브로커만 재시작합니다.
- ENOENT / broker.sock: 브로커가 중지됐거나 시작되지 않은 상태입니다. `plugin action invoke start --plugin herdr-homepage-broker`를 `--session homepage`와 함께 실행합니다. `stop`은 상태 조회가 아니라 브로커 종료 명령입니다. 보드는 연결 끊김과 마지막 수신 상태를 표시하고 자동 재연결하며, 브로커 자체를 자동 시작하지 않습니다. 연결 복구 후 필요한 프로젝트만 명시적으로 재개합니다.
- 보드의 `r`은 프로젝트 재개이며 브로커 시작이나 `allowExecution` 설정 변경이 아닙니다. 연결이 끊긴 동안 `r`/`c`/`p`는 비활성입니다.
- 실행 비활성: 큐 접수는 가능하지만 모델은 시작하지 않습니다. 스킬과 MCP를 준비한 뒤 활성화합니다.
- MCP configured와 connected는 다릅니다. 웹 상태 체크는 설정 유무를 보고하며 실제 접속은 CLI `doctor`로 확인합니다.
- 손상·불일치한 JSON은 직접 덮어쓰지 말고 CLI 상태와 checkpoint를 대조합니다.
- `dist/src/cli.js`의 CLI를 직접 쓸 때는 설치 checkout에서 실행합니다. 설치 위치는 Herdr 설치 결과나 plugin 목록에서 확인합니다.
