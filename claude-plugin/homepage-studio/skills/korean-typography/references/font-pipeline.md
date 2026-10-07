# 웹폰트 파일 준비

목표는 세 가지다. 실행 중 외부 요청이 없어야 하고, 1440px·390px 스크린샷이 의도한 서체로 찍혀야 하고, 페이지가 실제로 쓰는 글자와 웨이트만 실어야 한다.

`<skill>`은 run guide가 알려 주는 플러그인 경로 아래 `skills/korean-typography`의 절대 경로다. 아래 명령의 `app/public/fonts/`는 예시다. 빌드 도구가 정적 파일을 복사하는 위치에 맞춘다.

## 전략 고르기

| 전략 | 언제 | 장점 | 주의 |
| --- | --- | --- | --- |
| A. 패키지 분할본(기본) | 거의 항상. 특히 본문, 폼, RFN 폰트 | 11,172음절 전체를 보장하는 패키지가 많다. 쓰는 조각만 내려받는다 | 조각 파일이 많다(웨이트당 90개 안팎). preload하지 않는다 |
| B. 페이지 글자 서브셋 | 제목 전용 서체를 파일 1개로 줄이고 싶을 때. **RFN이 없는 폰트만** | 수십 KB 파일 1개. preload하기 좋다 | 문구가 바뀔 때마다 다시 만든다. 폼 입력에는 쓰지 않는다 |
| C. 단일 상용 서브셋 | 패키지가 제공하는 웨이트당 1파일(예: Pretendard `pretendard-subset.css`, 2,780음절) | 요청이 적다 | 드문 음절이 빠진다. `--check`를 통과할 때만 쓴다 |

RFN(Reserved Font Name)이 있는 폰트(Pretendard, SUIT, Wanted Sans)는 직접 서브셋을 만들지 않는다. OFL에서 서브셋은 수정본이고, 수정본은 예약된 이름을 쓸 수 없다. 저작자가 배포한 파일(A, C)을 그대로 쓴다.

## 공통 순서

1. 폰트 패키지를 `app/`의 의존성으로 버전을 고정해 설치한다. 프로젝트가 쓰는 패키지 매니저를 쓴다(예: `npm install --save-exact pretendard@1.3.9`).
2. `scripts/font_css.py`로 쓰는 웨이트의 `@font-face`와 woff2 파일만 복사한다. 이 스크립트는 `local()`과 woff 대체 소스를 지우고 `font-display: swap`을 강제한다. 라이선스 파일도 함께 복사한다.
3. 생성된 `fonts.css`를 사이트 CSS보다 먼저 불러온다.
4. 빌드한 다음 `scripts/page_text.py --check`로 글자 누락을 확인한다.
5. README '자산 출처'에 폰트 이름, 버전, 라이선스 파일 위치를 적는다.

## A. 패키지 분할본

```sh
# Pretendard 400·700
python3 <skill>/scripts/font_css.py --out app/public/fonts/pretendard --weights 400,700 \
  --license app/node_modules/pretendard/dist/LICENSE.txt \
  app/node_modules/pretendard/dist/web/static/pretendard-dynamic-subset.css

# fontsource(예: Noto Serif KR 600) — 웨이트별 CSS를 넘긴다. korean-600.css가 아니라 600.css다
python3 <skill>/scripts/font_css.py --out app/public/fonts/noto-serif-kr --weights 600 \
  --license app/node_modules/@fontsource/noto-serif-kr/LICENSE \
  app/node_modules/@fontsource/noto-serif-kr/600.css

# Wanted Sans 500·800
python3 <skill>/scripts/font_css.py --out app/public/fonts/wanted-sans --weights 500,800 \
  --license app/node_modules/wanted-sans/fonts/OFL.txt \
  app/node_modules/wanted-sans/fonts/webfonts/static/split/WantedSans-Medium.css \
  app/node_modules/wanted-sans/fonts/webfonts/static/split/WantedSans-ExtraBold.css
```

SUIT는 분할본이 없다. 웨이트당 파일 1개(C와 같은 성격)이므로 `--check`가 필요하다.

```sh
python3 <skill>/scripts/font_css.py --out app/public/fonts/suit --weights 400,800 \
  --license app/node_modules/@sun-typeface/suit/LICENSE \
  app/node_modules/@sun-typeface/suit/fonts/static/woff2/SUIT.css
```

출력의 `bytes_copied`는 디스크에 복사한 양이다. 실제로 내려받는 양은 페이지에 쓰인 조각만큼이다(보통 웨이트당 100–300KB).

## B. 페이지 글자 서브셋 (RFN 없는 폰트만)

HTML 빌드가 끝난 뒤, 빌드의 마지막 단계로 실행한다. fix 단계에서 문구가 바뀌면 다시 실행한다. `package.json`의 `postbuild`에 넣어 두면 잊지 않는다.

```sh
# 1. 빌드된 HTML과 카피덱에서 글자를 모은다(인쇄 가능한 ASCII는 항상 포함)
python3 <skill>/scripts/page_text.py app/dist --extra <run>/reports/copy-deck.md --out app/font-src/page-chars.txt

# 2. 서브셋을 만든다(예: Hahmlet 700, fontsource의 korean 파일을 원본으로)
pyftsubset app/node_modules/@fontsource/hahmlet/files/hahmlet-korean-700-normal.woff2 \
  --text-file=app/font-src/page-chars.txt --layout-features='*' --flavor=woff2 \
  --output-file=app/dist/fonts/hahmlet-700-page.woff2

# 3. 누락을 확인한다
python3 <skill>/scripts/page_text.py app/dist --extra <run>/reports/copy-deck.md \
  --check app/dist/fonts/hahmlet-700-page.woff2
```

```css
@font-face {
  font-family: "Hahmlet";
  src: url("/fonts/hahmlet-700-page.woff2") format("woff2");
  font-weight: 700;
  font-display: swap;
}
```

- 제목 전용으로만 쓴다. 본문과 폼 입력은 A를 쓴다. 사용자가 입력하는 글자는 미리 알 수 없다.
- 원본 파일에 없는 글자는 서브셋에도 없다. Hahmlet 원본은 2,788음절이다.
- `pyftsubset`은 fontTools에 들어 있다. 없으면 B를 쓰지 않고 A로 간다.

## preload

```html
<link rel="preload" href="/fonts/hahmlet-700-page.woff2" as="font" type="font/woff2" crossorigin>
```

- 첫 화면 헤드라인 서체 파일 1–2개만 preload한다. 분할본은 어느 조각이 쓰일지 미리 알 수 없으므로 preload하지 않는다.
- preload한 파일은 반드시 그 페이지에서 쓰여야 한다. 쓰이지 않으면 콘솔 경고가 남는다.

## 확인

- `page_text.py --check`의 `missing_hangul`이 비어 있어야 한다. `missing_other`는 기호다. 화면에서 다른 서체로 보여도 되는지 판단한다. 아니면 기호를 바꾸거나 SVG 아이콘으로 대체한다.
- quality-gate 자동 검사 `fonts.rendered_fonts`에서 `custom: false`인 플랫폼 폰트(Apple SD Gothic Neo 등)가 웹폰트 대신 쓰인 요소가 없는지 본다. 있으면 웨이트 파일 누락, 경로 오류, 글자 누락 가운데 하나다.
- `failed_requests`에 `.woff2`가 없어야 하고, `external_hosts`가 비어 있어야 한다.
- 라이선스 파일이 출력 디렉터리 안 폰트 폴더에 있어야 한다.
