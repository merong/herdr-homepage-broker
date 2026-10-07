# 모션

## 원칙

- 모션은 섹션이 말하는 것을 보여 주는 수단이다. 먼저 섹션의 할 일을 보고, 그것을 움직임으로 보여 줄 수 있는지 정한다.
- 페이지에는 크게 보여 줄 장면 1~2개를 두고, 작은 반응(누름, 호버, 입력 피드백)은 여러 곳에 둔다.
- 섹션마다 그 섹션에 맞는 움직임을 고른다. 같은 등장 효과를 모든 섹션에 반복하지 않는다.
- 첫 화면 핵심 문구(h1, 가격, 주 CTA)는 페이지가 열리고 1초 안에 다 보여야 한다. 등장 시간과 지연을 합쳐 0.8초 안팎으로 두고, 가격과 CTA는 h1 등장을 기다리지 않는다.
- 휴대폰에서도 부드러워야 한다. 390px 화면에서 확인한다.

## 의도에 맞는 기법

| 보여 줄 것 | 기법 |
| --- | --- |
| 변화, 결과(전후) | 드래그 비교 슬라이더: `clip-path: inset()`, pointer 이벤트, 키보드 화살표, `touch-action: pan-y` |
| 과정, 순서 | 스티키 스토리텔링: 섹션을 고정하고 스크롤 진행에 따라 단계, 이미지, 문구를 바꾼다 |
| 정확함, 점검 | 체크 항목이 스크롤에 맞춰 차례로 체크된다. SVG 선 그리기(`stroke-dashoffset`) |
| 숫자, 가격 | 값이 바뀔 때 숫자 트윈(rAF, 300~600ms)과 `font-variant-numeric: tabular-nums`. 연속 입력은 이전 목표값이 아니라 지금 화면에 보이는 값에서 새 목표로 이어 가고, 값을 줄이는 입력 직후 숫자가 커지지 않는지 확인한다. 확정 금액을 읽는 것이 우선인 자리면 숫자는 바로 바꾸고 변화는 다른 표시로 알려도 된다 |
| 공간, 제품 | 마스크나 `clip-path`로 이미지가 열리는 reveal, 느린 스케일 변화 |
| 첫인상 | 히어로 진입: 제목이 줄 단위로 나타나고, 이미지가 살짝 확대된 상태에서 제자리로 온다 |
| 상태 전환 | View Transitions API: 탭, 단계 이동, 필터 |
| 반응 | 버튼 눌림, 입력 검증 피드백, 선택 상태 전환 |

## 구현

- 스크롤 연동은 CSS scroll-driven animations(`animation-timeline: view()`, `scroll()`)를 먼저 쓴다.
  - `@supports (animation-timeline: view())` 안에서만 적용한다.
  - 지원하지 않는 브라우저에서는 최종 상태를 보여 주거나 IntersectionObserver로 대신한다.
- 등장 효과는 IntersectionObserver로 클래스를 붙인다. 한 번 등장하면 관찰을 끊는다.
- 고정 구간이 긴 타임라인이나 여러 요소를 맞춘 연출이 필요하면 라이브러리를 쓴다.
  - GSAP과 ScrollTrigger를 `npm i gsap`으로 설치해 번들한다. 부드러운 스크롤이 꼭 필요할 때만 Lenis를 더한다.
  - 순수 HTML 구성이면 `node_modules`의 배포 파일을 `app/` 안으로 복사한다. 런타임 CDN은 쓰지 않는다.
- 움직임은 `transform`, `opacity`, `clip-path`로 만든다. 레이아웃 속성(width, height, top)은 애니메이션하지 않는다.
- 이징은 등장용 하나와 UI 상태용(호버, 선택, 열림) 하나를 정해 모든 전환에 쓴다. 아래 예시처럼 `:root` 변수로 둔다.
- 휴대폰에서는 다음을 확인한다.
  - 스티키 구간의 스크롤 거리가 화면 높이의 2~3배를 넘지 않는다.
  - 드래그가 세로 스크롤을 막지 않는다.
  - 고정 헤더나 하단 CTA가 내용을 가리지 않는다.

## 필수 안전장치

**내용은 JS 없이도 보여야 한다.** 숨긴 초기 상태는 JS가 클래스를 붙였고 `prefers-reduced-motion: no-preference`일 때만 적용한다. 그래야 JS가 실패하거나 look.py로 전체 페이지를 찍어도 빈 영역이 생기지 않고, reduced-motion에서는 JS를 기다리지 않고 처음부터 최종 상태다.

```html
<script>document.documentElement.classList.add('js')</script>
```

```css
:root { --ease-enter: cubic-bezier(.2,.7,.2,1); --ease-ui: cubic-bezier(.3,0,.2,1); }
@media (prefers-reduced-motion: no-preference) {
  .js .reveal { opacity: 0; transform: translateY(24px); }
  .js .reveal.is-in { opacity: 1; transform: none;
    transition: opacity .6s var(--ease-enter), transform .6s var(--ease-enter); }
}
```

**reduced-motion에서는 움직임 없이 최종 상태를 보여 준다.** 사용자가 직접 조작하는 것(전후 슬라이더, 탭)은 남긴다. 자동 재생은 멈춘다.

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important;
    animation-iteration-count: 1 !important; transition-duration: .01ms !important;
    scroll-behavior: auto !important; }
}
```

```js
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
if (still) { /* 클래스를 바로 is-in으로 두고, GSAP 타임라인은 progress(1)로 둔다 */ }
```

build-out 단계의 look 중 한 회차는 `--reduced-motion`으로 돌려서 정보가 모두 보이는지 확인한다.
