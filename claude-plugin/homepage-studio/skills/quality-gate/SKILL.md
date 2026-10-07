---
name: quality-gate
description: 정적 빌드가 끝난 한국어 홈페이지를 납품 전에 정확히 한 번 점검할 때 쓴다. localhost 미리보기에 모델 없는 자동 검사(check_page.py)를 돌려 1440px·390px 전체 스크린샷과 auto-check.json을 만들고, PM이 체크리스트(실행, 템플릿 인상, 레이아웃 반복, 카피, 비주얼 키트, 타이포, 접근성, 성능, 내용 완결성, SEO)로 한 번 판정해 reports/self-check.md에 수정 목록을 쓴다. 수정은 한 번, close에서 결과와 남은 문제를 기록한다. 검사와 수정을 반복하지 않는다.
---

# 품질 게이트 (정확히 1회)

순서는 **check(pm) → fix(developer) → close(pm)**이다. 자동 검사와 PM 점검은 check에서 한 번, 수정은 fix에서 한 번이다. close는 결과를 기록할 뿐 다시 고치지 않는다. 별도 QA 에이전트를 쓰지 않는다.

- 체크리스트: references/checklist.md (항목 ID A1…J8)
- 기록 형식: references/self-check-template.md
- 자동 검사 스크립트 `scripts/check_page.py`의 정확한 경로는 run guide의 'Quality gate' 절에 있다.

## check 태스크

### 1. 미리보기

PM이 build 단계에서 보낸 preview-start의 URL(`http://127.0.0.1:<port>/`)을 쓴다. 미리보기는 빌드 출력 디렉터리를 서빙해야 하고, fix가 끝난 뒤에도 같은 디렉터리를 계속 서빙한다.

### 2. 자동 검사

```sh
python3 <check_page.py 경로> "http://127.0.0.1:<port>/" "<run>/reports/auto-check"
```

- 결과: `reports/auto-check/auto-check.json`, `screenshot-desktop-1440.png`, `screenshot-mobile-390.png`(둘 다 전체 페이지).
- 종료 코드 0은 "검사가 실행됐다"는 뜻이다. 문제는 `issues`와 각 필드에서 읽는다. 2는 인자 오류나 localhost가 아닌 URL이다.
- `{"skipped": …}`가 나오면 Playwright나 Chromium을 쓸 수 없는 것이다. 설치하지 말고 아래 '대체 방법'을 쓴다. self-check 맨 위에 생략 사유를 적는다.
- 접근성 자동 스캔(axe)은 이 스크립트에 없다. 접근성은 체크리스트 G의 명령으로 본다.

### 3. 스크린샷 읽기

전체 페이지 스크린샷은 세로로 길어서 한 번에 읽으면 세부가 뭉개진다. 잘라서 읽는다.

```sh
cd "<run>/reports/auto-check" && mkdir -p slices
magick screenshot-desktop-1440.png -crop x1800 +repage slices/desktop-%02d.png
magick screenshot-mobile-390.png -crop x1600 +repage slices/mobile-%02d.png
magick montage slices/mobile-*.png -tile 4x1 -geometry +6+0 -background '#888888' slices/mobile-sheet-%d.png
```

데스크톱 조각과 모바일 시트를 순서대로 한 번씩 읽는다. 같은 조각을 다시 열지 않는다. 고객은 이 두 폭의 정지 화면으로 판단한다. 정지 화면에서 보이지 않는 요소(등장 애니메이션 때문에 투명한 요소)는 없는 것과 같다.

### 4. 명령으로 보는 항목

체크리스트의 D(카피), E(키트), F(폰트), G(접근성), H(성능), J(SEO)에 붙은 명령을 실행한다. 주요 명령은 다음과 같다.

- 카피 AI 티: korean-copywriting `references/ai-tells-ko.md` '빠른 검사'
- 남은 COPY-GAP: `grep -rn "COPY-GAP" <빌드 출력 디렉터리>`
- 원장 대조: `python3 <asset-kit>/scripts/receipts_check.py <run>/assets`
- 글자 누락: `python3 <korean-typography>/scripts/page_text.py <빌드 출력> --check <폰트 파일들>`
- 대비: `python3 <quality-gate>/scripts/contrast.py <글자색> <배경색> …`

### 5. 판정과 기록

`reports/self-check.md`를 템플릿대로 쓴다. 모든 항목 ID에 판정과 근거(JSON 키, 파일과 줄, 조각 이름)를 단다. 근거 없는 "통과"는 쓰지 않는다.

**심각도**

| 등급 | 기준 | 예 |
| --- | --- | --- |
| 차단 | 고객이 스크린샷에서 바로 알아채는 결함, 또는 사실·법적 위험 | 깨진 이미지, 가로 넘침, 출처 없는 수치, 틀린 법인명, 남은 COPY-GAP, 외부 요청, 작동하지 않는 폼, 실제 전송 확인 없이 나오는 폼 성공 문구, 히어로 글자 대비 실패, 빈 섹션 |
| 중요 | 품질을 눈에 띄게 낮추지만 기능은 된다 | 템플릿 인상, 인접 섹션 반복, 카피 AI 티, 폰트 대체, 용량 초과, 포커스 표시 없음 |
| 경미 | 고치면 좋지만 인상이 바뀌지 않는다 | 미세한 간격, 한 곳의 어색한 줄바꿈 |

**수정 목록**은 fix 태스크의 유일한 입력이다.

- 차단을 모두 넣고, 중요는 영향이 큰 순서로 넣는다. 합쳐서 10개 이내다.
- 항목마다 위치, 현상, 바꿀 내용, 확인 방법을 쓴다. 문구를 바꾸는 항목에는 **최종 문구를 그대로** 쓴다. 개발자가 문구를 짓지 않게 한다.
- 새 이미지 생성, 새 섹션, 디자인 방향 변경이 필요한 것은 수정 목록에 넣지 않는다. '수정하지 않는 것'에 이유와 함께 적는다.

## fix 태스크

homepage-studio `references/build.md` 'fix 태스크'를 따른다. 수정 목록만 처리하고, 같은 출력 디렉터리로 다시 빌드하고, 항목별로 바꾼 파일과 변경 전→후를 PM에게 돌려준다.

## close 태스크

1. 자동 검사를 **한 번 더** 같은 명령으로 실행하되 출력은 `reports/auto-check/final/`로 한다. 이 결과는 최종 증거다. 이것을 보고 다시 고치지 않는다.
2. self-check.md에 '수정 결과', '최종 자동 검사', '남은 문제'를 쓴다. 남은 문제는 차단부터 적고, 누가 어떻게 고칠지(예: README '공개 전 필수')를 단다.
3. check에서 확정한 COPY-GAP 문구를 copy-deck.md 해당 섹션과 부록 B에 반영한다.
4. completed 보고에는 최종 issue_count, 남은 차단 문제 수, self-check 경로를 넣는다.

## 대체 방법 (자동 검사가 생략됐을 때)

```sh
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PROFILE=$(mktemp -d)
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --no-first-run --user-data-dir="$PROFILE" \
  --window-size=1440,900 --screenshot="<run>/reports/auto-check/fallback-desktop-1440x900.png" "<preview URL>"
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --no-first-run --user-data-dir="$PROFILE" \
  --window-size=390,844 --screenshot="<run>/reports/auto-check/fallback-mobile-390x844.png" "<preview URL>"
curl -s -o /dev/null -w '%{http_code}\n' "<preview URL>"
```

- 이 방법은 첫 화면만 찍는다. 창 높이를 늘려 전체를 찍으면 `100vh` 섹션이 늘어나 실제와 달라진다. 첫 화면 아래는 HTML·CSS를 읽고 명령 항목으로 판정한다.
- self-check 맨 위에 "자동 검사 생략: <skipped 값>, 대체: 첫 화면 스크린샷 + 수동 점검"이라고 쓰고, 확인하지 못한 항목은 '확인 못 함'으로 표시한다. 통과로 쓰지 않는다.

## 하지 않는 것

- 자동 검사를 고쳐 가며 여러 번 돌리기, 수정 후 다시 점검해 또 고치기.
- 근거 없이 통과 판정하기, 실행하지 않은 명령의 결과 쓰기.
- 검사 도구, 브라우저, 패키지 설치.
- 수정 목록에 없는 개선을 fix에서 하기.
