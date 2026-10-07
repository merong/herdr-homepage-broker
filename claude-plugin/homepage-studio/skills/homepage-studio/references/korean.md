# 한국어 카피·서체·SEO

## 카피

- **입력에 있는 구체적인 명사와 숫자를 쓴다.** 예: "평당 14,000원", "하루 한 집", "48시간 안에 다시 방문". 같은 자리에 "최고의", "프리미엄", "완벽한" 같은 추상어를 쓰지 않는다.
- **고객의 말로 쓴다.** 고객이 걱정하는 것을 그대로 묻고 바로 답한다.
- **한 문장에는 한 가지만 담는다.** 제목은 15자 안팎, 본문 문단은 2~3문장으로 쓴다.
- **문체는 해요체나 합니다체 중 하나로 통일한다.**
- **CTA는 행동 동사로 쓴다.** 예: "견적 보기", "예약 문의 남기기". "자세히 보기"는 무엇을 보는지 알 수 있을 때만 쓴다.
- **AI 티가 나는 표현은 사실로 바꾼다.** 아래와 같은 표현이 보이면 입력 속 사실로 바꿔 쓴다.
  - "새로운 기준", "~을 넘어", "단순한 ~이 아닌", "당신의 일상을 바꿀"
  - 셋씩 나열하는 문장의 반복
  - 영문 대문자 섹션 라벨
- **줄바꿈은 화면에서 다듬는다.** 스크린샷에서 줄바꿈이 어색하면 `<br>`을 넣기보다 문장을 고친다.

## 서체

**OFL 서체를 npm으로 받아 self-host한다.** CDN은 쓰지 않는다.

| 서체 | 설치 | 쓸 파일 | 성격 |
| --- | --- | --- | --- |
| Pretendard | `npm i pretendard` | `dist/web/static/pretendard-dynamic-subset.css` (분할 서브셋) | 중립, 단정 |
| SUIT | `npm i @sun-typeface/suit` | `fonts/static/woff2/SUIT-*.woff2` (`@font-face`를 직접 쓰고 `font-display: swap`을 넣는다) | 기하학적, 숫자가 깔끔함 |
| Wanted Sans | `npm i wanted-sans` | `fonts/webfonts/static/split/WantedSans-*.css` | 현대적, 기술 기업 |
| 한글 세리프 | `npm i @fontsource/noto-serif-kr` 또는 `@fontsource/hahmlet` | 패키지 CSS | 편집, 공방, 전통 |

- 위 파일 경로는 패키지 버전에 따라 다를 수 있다. 설치한 뒤 `ls node_modules/<패키지>`로 실제 경로를 확인한다.
- 빌드 도구를 쓰면 CSS를 import한다. 순수 HTML이면 CSS와 woff2를 `app/` 안으로 복사하고 상대 경로를 맞춘다.
- 패키지의 LICENSE가 OFL인지 확인하고, `notes.md`에 서체 이름과 라이선스를 한 줄로 적는다.
- 성격은 제목 서체가 만든다. 한 패밀리의 웨이트 대비(800 대 400)만으로 충분한 경우가 많다. 서체는 두 종류를 넘기지 않는다.

```css
:root { word-break: keep-all; overflow-wrap: break-word; }
body { font-size: 17px; line-height: 1.7; letter-spacing: -0.01em; }
h1, h2 { line-height: 1.25; letter-spacing: -0.03em; text-wrap: balance; }
p { text-wrap: pretty; }
.price, .num { font-variant-numeric: tabular-nums; }
h1 { font-size: clamp(2.25rem, 6vw + 1rem, 5.5rem); }
```

- 휴대폰 본문은 16~17px로 한다. 제목은 390px에서 3줄을 넘지 않게 한다.
- 영문 워드마크나 라틴 서체를 섞을 때는 `unicode-range`로 한글에 적용되지 않게 한다.

## SEO 기본

- `<html lang="ko">`
- `<title>`: "회사명 — 핵심 제공물 한 구" 형식
- `meta description`: 80~120자. 입력 속 사실(지역, 제공물, 가격대)을 넣는다.
- Open Graph: title, description, image. image는 히어로로 1200×630 사본을 만든다. 배포 주소가 없으므로 canonical은 생략한다.
- 제목 구조: `h1`은 하나, 섹션마다 `h2`를 쓴다.
- JSON-LD: 입력에 있는 사실만 넣는다(이름, 서비스, 지역, 가격). 주소나 전화가 없으면 해당 필드를 비우지 말고 아예 뺀다. 가상 업체 데모이면 JSON-LD 자체를 생략해도 된다.
- 파비콘: 워드마크의 첫 글자나 기호로 SVG 하나를 만든다.
