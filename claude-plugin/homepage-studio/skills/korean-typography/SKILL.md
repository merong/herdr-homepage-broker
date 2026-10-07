---
name: korean-typography
description: 한국어 웹페이지의 글자를 다룰 때 쓴다. lang="ko", 한글 폰트 스택과 라틴 혼용, word-break keep-all 기반 줄바꿈, 행간·자간·최소 크기·한 줄 길이 수치, 의미 단위 줄바꿈, 숫자·단위·날짜 표기, 로컬 웹폰트 로딩(서브셋, font-display, 라이선스)을 정한다. 디자인 브리프의 타입 절, 정적 사이트 구현, 품질 게이트의 타이포 점검에 쓴다.
---

# 한국어 타이포그래피

> 구조(HTML 기초 → 폰트 스택 → 기본 CSS → 최소 크기 → 폰트 로딩 → 흔한 실수)는 jp-web-design-guardrails의 jp-design(MIT, Marsel Bait)을 따랐다. 내용은 한국어 규칙으로 새로 썼다. palt, auto-phrase, text-autospace, 후리가나, 세로쓰기 같은 일본어 전용 규칙은 옮기지 않았다.

폰트 후보는 references/fonts.md, 파일 준비와 서브셋은 references/font-pipeline.md에 있다.

## 1. HTML

- `<html lang="ko">`를 쓴다. 영어 문장과 영문 고유명사 구간은 `<span lang="en">`으로 감싼다. 스크린리더가 발음 엔진을 바꾼다.
- 글자 사이에 공백을 넣어 간격을 만들지 않는다("회 사 소 개"). 스크린리더가 글자를 하나씩 읽는다. 간격은 `letter-spacing`으로 준다.

## 2. 폰트 스택

```css
:root {
  --font-sans: "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "맑은 고딕", sans-serif;
  --font-serif: "Noto Serif KR", "AppleMyungjo", "Batang", "바탕", serif;
}
```

- 한글 웹폰트를 먼저, 운영체제 한글 폰트를 다음에 둔다(macOS → Windows 순). 시스템 폰트 파일은 앱에 넣지 않는다.
- 한글 폰트는 라틴 글자도 그린다. 라틴 전용 서체를 따로 고른 경우에만 라틴 폰트를 앞에 둔다. 이때 그 `@font-face`에 `unicode-range`를 걸어 한국어 문장부호(`·` `“ ”` `‘ ’` `…`)는 한글 폰트가 그리게 한다.

```css
@font-face {
  font-family: "Brand Latin";
  src: url("/fonts/brand-latin-600.woff2") format("woff2");
  font-weight: 600;
  font-display: swap;
  unicode-range: U+0020-007E, U+00A0-00B6, U+00B8-00FF;
  size-adjust: 106%; /* 한글 옆에서 작아 보이면 스크린샷을 보며 102–110% 사이로 맞춘다 */
}
```

- 한글 서체는 한 페이지에 최대 2종(예: 제목 명조 + 본문 고딕)이다. 웨이트는 보통 2–3개만 쓴다.

## 3. 기본 CSS

```css
:root { font-synthesis: none; }
body {
  font-family: var(--font-sans);
  font-size: 1.0625rem;      /* 17px. 모바일은 16px 가능 */
  line-height: 1.7;
  letter-spacing: -0.01em;
  word-break: keep-all;      /* 한글을 어절 단위로 끊는다 */
  overflow-wrap: break-word; /* 긴 영문·숫자열이 넘치지 않게 */
}
h1, h2, h3 { text-wrap: balance; }
p, li, dd { text-wrap: pretty; }
.u-anywhere { overflow-wrap: anywhere; } /* flex·grid 안의 URL, 이메일 */
input, select, textarea, button { font: inherit; }
input, select, textarea { font-size: max(1rem, 16px); }
```

- `word-break`의 기본값은 한글을 글자 단위로 끊는다("납품합니/다"). `keep-all`은 빠뜨리면 안 된다.
- `font-synthesis: none`으로 가짜 굵기와 가짜 기울임을 막는다. 대신 쓰는 웨이트 파일을 모두 넣어야 한다.
- `line-break: strict`, `word-break: auto-phrase`, `text-autospace`, `font-feature-settings: "palt"`는 일본어용이다. 쓰지 않는다.

## 4. 수치

| 행간 | 값 |
| --- | --- |
| 본문 | 1.6–1.8 (기본 1.7). 명조 긴 본문은 1.75–1.85 |
| 짧은 글(카드 설명, 캡션) | 1.55–1.65 |
| h2·h3 | 1.25–1.4 |
| 디스플레이(h1, 히어로) | 1.1–1.25 |
| 버튼, 라벨 | 1.2–1.3 |

| 자간 | 값 |
| --- | --- |
| 본문 15–18px | 0 ~ -0.01em |
| 20–28px | -0.01 ~ -0.02em |
| 32–48px | -0.02 ~ -0.03em |
| 56px 이상 | -0.03 ~ -0.045em. -0.05em보다 좁히지 않는다 |
| 캡션, 작은 라벨 | 0 ~ +0.01em |

| 최소 크기 | 값 |
| --- | --- |
| 본문 | 16px (권장 16–18px) |
| 보조 본문, 내비게이션, 버튼 | 15px |
| 캡션 | 13px |
| 법적 고지, 푸터 | 12px |
| 폼 입력 | 16px (iOS 확대 방지) |

- 300 이하의 가는 웨이트는 32px 이상에서만 쓴다.
- 본문 한 줄은 공백 포함 35–45자다. Pretendard와 SUIT는 한 글자 평균 약 0.68em(실측)이므로 `max-inline-size: 26–30em`이 출발점이다. 스크린샷에서 실제 글자 수를 센다.
- 크기 비율은 기업 사이트 1.25, 랜딩 1.333을 출발점으로 `clamp()`로 만든다. 48px 이상의 디스플레이 문장은 한 줄 14음절 이내로 둔다.
- 긴 본문은 왼쪽 정렬이다. 가운데 정렬은 두 줄 이하의 짧은 문장에만 쓴다. 양쪽 정렬은 쓰지 않는다.

## 5. 의미 단위 줄바꿈

카피덱은 의도한 줄바꿈을 ` / `, 끊으면 안 되는 묶음을 `{ }`로 표시한다(korean-copywriting copy-deck-template).

```html
<h1>소량 금형,<br class="br-wide"> <span class="nowrap">3주 안에</span> 납품합니다</h1>
```

```css
.nowrap { white-space: nowrap; }
@media (max-width: 767px) { .br-wide { display: none; } }
```

- `<br>`만으로 줄을 고정하지 않는다. 화면 폭이 바뀌면 한두 글자짜리 줄이 생긴다. `<br>`은 넓은 화면용 클래스와 함께 쓴다.
- 날짜·수량 사이의 공백("2026년 10월", "주 5일")이 줄 끝에서 갈리면 `&nbsp;`를 쓴다.
- 1440px과 390px 스크린샷에서 마지막 줄이 한두 글자뿐인 곳을 찾아 고친다. 390px에서 히어로 헤드라인은 3줄 이내여야 한다.

## 6. 강조와 문장부호

- 한글에 이탤릭을 쓰지 않는다. 강조는 한 단계 높은 굵기나 색으로 한다. `em { font-style: normal; font-weight: 600; }`
- 따옴표는 `“ ”` `‘ ’`를 쓴다. 화면 문구에 곧은 따옴표(`"`)를 쓰지 않는다. 작품명과 책 제목은 `『 』` 또는 `《 》`로 쓴다.
- 말줄임은 `…` 한 글자로 쓴다(`...` 아님). 범위는 물결표로 쓴다: `3~5일`, `09:00~18:00`.

## 7. 숫자, 단위, 날짜

- 금액은 `12,000원`처럼 쓴다. `₩`는 표와 가격표에서만 쓴다.
- 날짜는 `2026년 10월 7일` 또는 `2026. 10. 7.` 중 하나로 통일한다. 시간도 `09:00~18:00` 또는 `오전 9시~오후 6시` 중 하나다.
- 전화는 `02-1234-5678`로 쓰고, 링크는 `tel:+82212345678`이다.
- 면적은 법정 단위 `m²`를 쓴다. 평은 고객 자료에 있을 때만 괄호로 덧붙인다.
- 표, 사양, 가격의 숫자 열은 `font-variant-numeric: tabular-nums`를 쓴다. 본문에는 쓰지 않는다.

## 8. 웹폰트 로딩 요약

- 폰트는 모두 로컬 파일이다. Google Fonts와 jsDelivr 같은 CDN 링크를 쓰지 않는다(외부 요청 0).
- `font-display: swap`만 쓴다. `optional`은 스크린샷이 대체 폰트로 찍힐 수 있어 금지다. `block`도 쓰지 않는다.
- 기본은 패키지가 제공하는 `unicode-range` 분할본이다. 한글 전체(11,172자)를 한 파일로 싣지 않는다.
- preload는 첫 화면 헤드라인에 쓰는 파일 1–2개만 한다.
- 고른 폰트가 페이지의 모든 글자를 갖고 있는지 `scripts/page_text.py --check`로 확인한다. 한글 11,172음절 중 2,350–2,800음절만 가진 폰트와 파일이 많다(references/fonts.md).
- OFL 라이선스 파일을 `app/`의 폰트 폴더에 함께 넣는다.

## 9. 흔한 실수

1. `word-break: keep-all`을 빠뜨려 글자 단위로 줄이 바뀐다.
2. `keep-all`만 쓰고 `overflow-wrap`이 없어 긴 URL과 영문이 넘친다.
3. `<br>`로만 줄을 고정해서 모바일에 한두 글자짜리 줄이 생긴다.
4. 본문 행간이 1.5 이하다.
5. 큰 제목의 자간이 0이라 헐겁다. 반대로 -0.05em보다 좁혀 글자가 붙는다.
6. 가는 웨이트(300 이하)를 본문에 쓴다.
7. 입력창 글자가 16px보다 작아 iOS에서 화면이 확대된다.
8. 이탤릭이나 가짜 굵기를 쓴다.
9. CDN 폰트 링크를 쓴다.
10. `font-display: optional`이나 `block`을 쓴다.
11. 한글 폰트 전체 파일이나 안 쓰는 웨이트까지 싣는다.
12. 라틴 폰트를 앞에 두고 `unicode-range`를 걸지 않아 한국어 따옴표와 가운뎃점이 라틴 글꼴로 나온다.
13. 모든 섹션 제목 위에 넓은 자간의 영문 대문자 라벨을 붙인다.
14. 긴 본문을 가운데 정렬한다.
15. 문구가 바뀐 뒤 페이지 글자 서브셋을 다시 만들지 않아 빠진 글자만 다른 서체로 나온다.
16. 회사명이나 제품명에 드문 음절이 있는데 2,350–2,800음절만 가진 폰트를 골랐다. `page_text.py --check`가 잡는다.
