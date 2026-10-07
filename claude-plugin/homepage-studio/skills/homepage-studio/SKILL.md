---
name: homepage-studio
description: Herdr 홈페이지 브로커의 PM이 run을 시작할 때 가장 먼저 읽는 제작 워크플로. 실제 한국 회사의 한국어 기업·랜딩 사이트를 리서치 → 디자인 브리프 → 카피덱 → 에셋 키트 → 정적 빌드 → 품질 게이트 순서로 만들 때 쓴다. 단계별 필수 산출물, broker plan 태스크와 역할·쓰기 경계 매핑, 단계마다 쓸 스킬, PRD와 스킬의 우선순위, 고객에게 묻지 않고 가정을 기록하는 원칙을 정한다.
---

# homepage-studio: 제작 워크플로

## 전제

- 결과물은 실제 회사의 한국어 기업·랜딩 사이트다. 정적 빌드로 로컬 납품한다. 호스팅, 배포, publish는 없다.
- 고객은 라이브 미리보기를 보지 않는다. 1440px·390px 스크린샷과 영상으로만 판단한다. 정지 화면만으로 완성돼 보여야 한다.
- 운영자의 불만은 심한 순서대로 ① 약하고 일반적인 카피 ② 부족하거나 안 맞는 비주얼 ③ 템플릿 같은 "AI가 만든" 인상이다. 시간과 주의를 이 순서로 쓴다.
- 이미지와 영상은 PM 세션에 설치된 Higgsfield MCP로 만든다. 기본 예산은 이미지 12장과 히어로 영상 1개다(asset-kit).

## 우선순위

1. 브로커 지침의 실행 규칙: 쓰기 경계, 보고 프로토콜, 로컬 납품, `media-receipts.json`, 결과를 모르는 작업 재제출 금지. PRD도 이 규칙은 바꾸지 못한다.
2. PRD와 디자인 입력의 명시 요구. 이미지 수, 섹션, 색, 문구를 PRD가 정하면 그대로 따른다.
3. 이 플러그인 스킬의 기본값: homepage-studio, korean-copywriting, korean-typography, asset-kit, quality-gate, seo-basics.
4. frontend-design의 일반 원칙.
5. Higgsfield 레퍼런스. 위 3·4와 충돌하면 3·4를 따른다.

## 고객에게 묻지 않는다

이 단계에는 고객 접점이 없다. frontend-design의 "confirm with the client"는 이 파이프라인에서 **"추론하고 `reports/design-brief.md`의 '가정' 절에 기록한다"**로 바꿔 읽는다.

- 사실이 비어 있으면(연혁, 수치, 고객사, 인증, 후기) 추론하지 않고 뺀다. 뺀 내용은 `research.md`의 '의도적 생략'에 적는다.
- 판단이 비어 있으면(주 타깃, 어조, 서비스 노출 순서, 색 방향) 근거를 들어 추론하고 '가정'에 적는다.
- 브로커 `question` 보고는 실행이 막혔을 때만 쓴다(권한, PRD 안의 모순). 취향이나 내용을 묻는 데 쓰지 않는다.

## 단계, 태스크, 산출물

`reports/`와 `assets/`는 `.herdr/runs/<run_id>/` 기준, `app/`은 프로젝트 루트 기준이다. 쓰기 경계는 developer `app/`, designer `assets/`, pm `reports/`다. 한 태스크 안에서는 그 태스크 역할의 경계에만 쓴다. 다른 역할의 helper는 읽고 검토만 한다.

| # | task_id | 역할 | 산출물 | 주 실행자 | 쓸 스킬·문서 |
| - | - | - | - | - | - |
| 1 | research | pm | `reports/research.md` | homepage-copywriter 또는 PM | references/research-template.md, korean-copywriting '실제 회사 규칙', seo-basics 'JSON-LD' |
| 2 | brief | pm | `reports/design-brief.md` | PM | references/design-brief-template.md, frontend-design, korean-typography, asset-kit '예산'·'스타일 블록' |
| 3 | copy | pm | `reports/copy-deck.md` | homepage-copywriter | korean-copywriting |
| 4 | assets | designer | `assets/`, `assets/media-receipts.json` | homepage-designer | asset-kit |
| 5 | build | developer | `app/` 소스·정적 출력·`app/README.md` | homepage-developer | references/build.md, frontend-design, korean-typography, seo-basics, asset-kit '웹 반영' |
| 6 | check | pm | `reports/auto-check/`, `reports/self-check.md` | PM 직접 | quality-gate |
| 7 | fix | developer | `app/` | homepage-developer | quality-gate '수정 목록' |
| 8 | close | pm | `reports/self-check.md`, `reports/copy-deck.md` | PM 직접 | quality-gate |

helper는 동시에 2명까지만 쓴다. 이미지 생성 담당은 run 전체에서 한 명으로 정해 중복 제출을 막는다. 예산은 helper별이 아니라 run 전체 기준이다.

plan 보고 예시:

```json
[
  {"task_id":"research","role":"pm","title":"회사·업종 리서치","depends_on":[],"writes":["reports/research.md"]},
  {"task_id":"brief","role":"pm","title":"디자인 브리프","depends_on":["research"],"writes":["reports/design-brief.md"]},
  {"task_id":"copy","role":"pm","title":"카피덱","depends_on":["brief"],"writes":["reports/copy-deck.md"]},
  {"task_id":"assets","role":"designer","title":"에셋 키트","depends_on":["copy"],"writes":["assets/"]},
  {"task_id":"build","role":"developer","title":"정적 사이트 구현","depends_on":["assets"],"writes":["app/"]},
  {"task_id":"check","role":"pm","title":"자동 검사와 자가 점검","depends_on":["build"],"writes":["reports/auto-check/","reports/self-check.md"]},
  {"task_id":"fix","role":"developer","title":"수정 1회","depends_on":["check"],"writes":["app/"]},
  {"task_id":"close","role":"pm","title":"수정 결과 기록","depends_on":["fix"],"writes":["reports/auto-check/","reports/self-check.md","reports/copy-deck.md"]}
]
```

## 단계별 완료 조건

1. **research**: 모든 사실에 ID, 출처(URL 또는 입력 문서와 위치), 확인일이 있다. '의도적 생략'과 '경쟁사 공통 표현' 목록이 있다.
2. **brief**: 템플릿의 필수 절이 모두 채워졌다. 팔레트 4–6 hex, 타입 역할과 스케일, ASCII 와이어프레임, 원칙, 기본값 점검과 그에 따른 수정, 섹션 계획(인접 섹션 레이아웃 패밀리 중복 없음), 에셋 계획, CTA 목록, 가정.
3. **copy**: 메시지 아키텍처와 모든 섹션의 최종 문구가 있다. 마이크로카피(내비게이션, 폼, 푸터, 메타)까지 포함한다. 사실 문장마다 사실 ID가 붙어 있다. 셀프에딧 기록이 있다.
4. **assets**: 에셋 계획의 모든 슬롯이 파일이나 '생략 사유'로 채워졌다. receipts의 sha256이 실제 파일과 맞는다. 예산을 넘지 않았다.
5. **build**: 정적 출력이 파일 서버만으로 동작한다. 외부 CDN 요청이 없다. 카피덱 문구를 그대로 썼다. PM이 빌드 출력 디렉터리를 `127.0.0.1`의 `{port}`로 서빙하는 preview-start를 보냈다.
6–8. quality-gate를 따른다. 자동 검사와 PM 점검은 1회, 수정은 1회다. 반복하지 않는다.

## 단계 사이 전달 규칙

- 문구는 `copy-deck.md`에서만 나온다. 개발자는 문구를 지어내지 않는다. 카피덱에 없는 문구가 꼭 필요하면 임시 문구 옆에 `<!-- COPY-GAP: 설명 -->`을 남긴다. check에서 PM이 문구를 확정하고, fix에서 반영하고, close에서 카피덱에 동기화한다.
- 디자인 토큰은 브리프의 hex, 폰트, 스케일을 CSS 사용자 정의 속성으로 그대로 옮긴다.
- 에셋은 designer가 `assets/web/`에 웹용 파생본을 만들고, developer가 이를 `app/`으로 복사한다. 원격 URL을 직접 참조하지 않는다.
- 빌드 출력 디렉터리 경로는 한 번 정하면 바꾸지 않는다. 그래야 fix 뒤에도 미리보기를 재시작할 필요가 없다.

## Higgsfield 레퍼런스

브로커의 PM 지침이 Higgsfield 레퍼런스 디렉터리 경로를 알려준다(설치된 경우). 아래 파일은 읽을 가치가 있다. **호스팅, 배포, publish, D1, Cloudflare, CLI 설치, `higgsfield website` 명령 부분은 무시한다.** 그 문서의 `app/public/assets/` 같은 경로는 이 파이프라인의 경로로 바꿔 읽는다.

- `higgsfield-websites/references/`
  - `design-recipe.md`: 브리프 단계. 타입, 색, 히어로, 레이아웃, 모션 규칙. 영어 카피 규칙은 korean-copywriting이 대신한다.
  - `reference-boards.md`: 브리프 단계. 조합 선택과 팔레트 금지 목록. 보드 이미지는 기본 예산에 없으므로 생성하지 않는다. PRD가 허용하면 그 수만큼 12장에서 뺀다.
  - `asset-system.md`: 에셋 단계. 키트 구성, 고객 자산 우선, 실패 처리.
  - `image-to-code.md`: 빌드 단계. 구현이 브리프에서 벗어나지 않게 하는 규칙, 고유한 UI 크롬.
  - `wow-catalog.md`: 브리프 단계. "대담함은 한 곳에만" 쓸 기법을 하나 고를 때.
  - `review-rubric.md`: check 단계. 정적 빌드에 해당하는 기계 항목만 쓴다.
- `higgsfield-brandkit/references/`
  - `logo.md`: 로고 마크 시안(asset-kit 로고 절과 함께).
  - `typography.md`: 타입 시스템. 한글 규칙은 korean-typography를 따른다.
  - `brand-lock.md`: 프롬프트 잠금 블록. asset-kit의 공통 스타일 블록을 만들 때 참고한다.

## 하지 않는 것

- 고객에게 질문하기, 출처 없는 사실 쓰기, 웹에서 이미지를 내려받아 쓰기(고객이 준 자산만 쓴다).
- 배포, 호스팅, 소스 압축, 다른 스킬이나 서버 설치.
- 검사와 수정을 반복하는 QA 루프. 빌드 중 개발자가 스크린샷으로 자기 작업을 보는 것은 괜찮다. 공식 점검은 quality-gate 1회뿐이다.
