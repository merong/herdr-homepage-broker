# Herdr Homepage Broker

`homepage` 전용 Herdr 세션에서 홈페이지 제작 요청을 접수하고 프로젝트·에이전트·작업 상태를 JSON으로 관리하는 macOS 플러그인입니다.

- 웹 UI에서 샘플 요청 작성 → 디렉터리·PRD/design 초기화 → 브로커 CLI로 큐 접수.
- Herdr CLI와 Socket API로 최대 2개 프로젝트를 처리. 프로젝트마다 PM pane 하나만 생성합니다. 실행 후 지침 파일을 프롬프트로 전달하고, PM은 Claude 내부 에이전트로 개발·디자인 작업을 수행합니다. 작업 보고와 JSON 상태 갱신은 PM이 담당합니다.
- Claude Code `claude-opus-5-5`, high effort. homepage-studio 전용 스킬 7개와 개발·디자인·카피 helper를 번들로 제공하고, Claude의 Higgsfield MCP 연결을 재사용.
- `meta.json`, `task.json`, `agents.json` 상태 확인, 동일 요청 재전송 방지, 재시작 후 명시적 재개.
- 내장 웹 UI: 검색·필터·입력 요청·미리보기·JSON 상태 확인·환경 체크·도움말·제작 시작/작업 재개.

초기화가 실행 구성을 자동 준비합니다. 기본은 프로젝트별 **제작 시작/작업 재개**를 눌러 실행하는 방식이며 큐 접수만으로 모델을 시작하지 않습니다. 0.7.0에서는 LUMEN GROVE의 실제 이미지 생성·소스·localhost 납품을 확인했습니다. 0.8.0의 새 제작 워크플로는 자동 테스트와 플러그인 검사로 검증하며, 새 유료 제작 전체를 다시 실행한 결과와는 구분합니다.

## 설치

Node.js 24+, Herdr 0.8.0+, macOS가 필요합니다.

```sh
herdr --session homepage
```

별도 터미널에서 플러그인을 설치합니다.

```sh
herdr --session homepage plugin install merong/herdr-homepage-broker --ref v0.8.0 --yes
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
  "web": { "enabled": true, "port": 7318 }
}
```

프로젝트 기본 경로는 `~/herdr-homepages/<project-id>`입니다. `projectsRoot`에 절대 경로를 지정하면 다른 상위 디렉터리를 사용할 수 있습니다. 최종 경로는 제작 요청 전에 화면에서 확인할 수 있습니다. 기본 상태 저장소는 `~/.local/state/herdr-homepage/sessions/homepage`입니다.

설정 파일 없이 사용할 수 있습니다. `homepage`, Opus 5.5/high, Herdr PM 1명, localhost 미리보기를 자동 구성하며 `homepage-runtime.json`에 기록합니다. 신규 PM은 번들 `homepage-studio`를 명시적으로 로드합니다. 리서치 → 디자인 브리프 → 카피덱 → 에셋 → 정적 빌드 → 품질 검사 → 수정 1회 → 결과 기록 순서로 수행하며, 내부 개발·디자인·카피 helper는 필요할 때 최대 2명을 동시에 사용하도록 지시합니다. Claude에 로그인된 Higgsfield MCP를 재사용하고 인증정보를 복사하지 않습니다. 사전 체크는 **문서 준비 / 플러그인 준비** 두 항목이며, 보조 도구 누락은 안내만 합니다.

사용자 지정 `skills`와 [브로커 stdio MCP 설정](examples/mcp-stdio-config.json)은 선택 사항입니다. 기본 `allowExecution:true`, `autoStart:false`이며, 관리자가 명시적으로 설정한 `allowExecution:false`는 유지합니다. 자동 큐 처리를 원하는 운영 환경에서만 `autoStart:true`를 지정합니다.

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
