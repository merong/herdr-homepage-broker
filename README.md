# Herdr Homepage Broker

`homepage` 전용 Herdr 세션에서 홈페이지 제작 요청을 접수하고 프로젝트·에이전트·작업 상태를 JSON으로 관리하는 macOS 플러그인입니다.

- 웹 UI에서 샘플 요청 작성 → 디렉터리·PRD/design 초기화 → 브로커 CLI로 큐 접수.
- Herdr CLI와 Socket API로 최대 2개 프로젝트, 프로젝트별 PM·개발자·디자이너를 구성.
- Claude Code `claude-opus-5-5`, high effort. 실제 실행에는 별도 Higgsfield MCP와 승인한 스킬 설정이 필요.
- `meta.json`, `task.json`, `agents.json` 상태 확인, 동일 요청 재전송 방지, 재시작 후 명시적 재개.
- 내장 웹 UI: 검색·필터·입력 요청·미리보기·JSON 상태 확인·환경 체크·도움말·제작 시작/작업 재개.

기본은 `allowExecution:false`인 접수 모드입니다. 실제 모델·Higgsfield로 홈페이지 제작을 완료하는 통합 검증은 아직 끝나지 않았습니다. 화면의 접수 성공과 실제 에이전트 실행을 구분합니다.

## 설치

Node.js 24+, Herdr 0.8.0+, macOS가 필요합니다.

```sh
herdr --session homepage
```

별도 터미널에서 플러그인을 설치합니다.

```sh
herdr --session homepage plugin install merong/herdr-homepage-broker --ref v0.3.0 --yes
```

`homepage` 작업공간에서 시작합니다. 작업공간이 없다면 `herdr --session homepage workspace create --cwd "$HOME" --label homepage-control --focus`로 만듭니다.

```sh
herdr --session homepage plugin action invoke start --plugin herdr-homepage-broker
herdr --session homepage plugin action invoke open-web --plugin herdr-homepage-broker
```

기본 웹 주소는 `http://127.0.0.1:7318`입니다. **제작 요청 → 샘플 요청 채우기 → 초기화 후 homepage로 전송**으로 접수를 시험할 수 있습니다. 기존 프로젝트를 지우는 초기화 기능은 제공하지 않습니다.

[설치·업데이트](docs/installation.md) · [사용법·경로·JSON 상태](docs/usage.md)

## 설정

기본 설정 파일은 `~/.config/herdr-homepage/config.json`입니다. `HOMEPAGE_CONFIG` 또는 CLI `--config`로 바꿀 수 있습니다. 설정과 상태는 설치된 Git checkout 밖에 저장됩니다.

```json
{
  "allowExecution": false,
  "skills": [],
  "web": { "enabled": true, "port": 7318 }
}
```

프로젝트 기본 경로는 `~/herdr-homepages/<project-id>`입니다. `projectsRoot`에 절대 경로를 지정하면 다른 상위 디렉터리를 사용할 수 있습니다. 최종 경로는 제작 요청 전에 화면에서 확인할 수 있습니다. 기본 상태 저장소는 `~/.local/state/herdr-homepage/sessions/homepage`입니다.

실제 제작을 활성화하려면 승인한 홈페이지 스킬의 절대 경로와 [stdio MCP 설정](examples/mcp-stdio-config.json)을 실제 서버에 맞게 채우고 `allowExecution:true`를 지정합니다. 예시의 자리표시자는 실제 연결값이 아닙니다. Claude의 MCP 등록과 브로커 연결은 별개입니다.

## 로컬 개발

```sh
npm ci --ignore-scripts
npm run build
node dist/src/cli.js broker ensure
node dist/src/cli.js web open
```

로컬 소스를 Herdr에 연결하려면 빌드 후 `herdr --session homepage plugin link "$PWD"`를 사용합니다. `plugin link` 자체는 빌드하지 않습니다.

```sh
npm run typecheck
npm run format:check
npm test
```

테스트는 로컬 소켓·파일·프로세스·HTTP와 시험용 Herdr/MCP를 사용하며 모델 호출은 없습니다. 실제 세션을 사용하는 `test:herdr`, `test:plugin`은 운영 작업이 없는 개발 환경에서만 실행하세요.
