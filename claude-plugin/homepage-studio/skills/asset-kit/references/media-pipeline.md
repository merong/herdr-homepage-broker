# 미디어 처리와 웹 반영

`<kit>`은 run guide가 알려 주는 플러그인 경로 아래 `skills/asset-kit`이다. 명령은 run의 `assets/` 디렉터리에서 실행한다고 가정한다. 도구는 `magick`(ImageMagick 7), `avifenc`, `cwebp`, `ffmpeg`/`ffprobe`, `rsvg-convert`, `potrace`, `shasum`, 그리고 폰트 변환용 Python fontTools다. 아래 스크립트는 모두 tab으로 구분된 `경로 … sha256` 줄을 출력한다. 그 값을 receipts에 옮긴다.

## 폴더 구성

```text
assets/
  media-receipts.json        references/media-receipts.md
  prompts/style-block.txt    공통 스타일 블록
  prompts/<asset_id>.txt     슬롯별 프롬프트 원문
  src/<asset_id>.<ext>       생성 원본과 고객 제공 자산 사본(수정하지 않는다)
  src/rejected/              버린 후보. 웹에 쓰지 않는다
  contact-sheet.jpg          일관성 검사용
  icons/<name>.svg           직접 그린 아이콘
  logo/mark.svg              로고 마크(생성했거나 고객 SVG 사본)
  web/                       개발자가 app/으로 복사하는 파일만
```

## 내려받기와 기록

```sh
curl -fL --max-time 180 -o src/hero-still.png "<결과 URL>"
magick identify -format '%w %h %m\n' src/hero-still.png
shasum -a 256 src/hero-still.png
```

- 결과 URL을 그대로 웹에서 참조하지 않는다. 내려받은 파일만 쓴다.
- 결과가 한 장이 아니라 2×2 같은 격자 이미지로 올 수 있다. 몇 장이 왔는지 먼저 확인하고, 격자는 잘라서 슬롯에 나눈다(`magick src/grid.png -crop 2x2@ +repage src/grid-%d.png`).

## 일관성 검사 (1회)

```sh
<kit>/scripts/contact_sheet.sh contact-sheet.jpg src icons logo
```

`src/rejected/` 같은 하위 폴더는 넣지 않는다. `contact-sheet.jpg`를 한 번 읽고 SKILL.md '일관성 검사' 표를 채운다. 장마다 따로 열어 보지 않는다. 셸이 zsh이면 일치하는 파일이 없는 glob(`src/*.jpg`)은 명령 전체를 멈추게 한다. 직접 glob을 쓰기보다 스크립트를 쓴다.

## 크롭

```sh
magick src/hero-still.png -gravity east -crop 4:5 +repage src/hero-still-m.png   # 모바일 4:5, 오른쪽 기준
magick src/plate-a.png -gravity center -crop 16:9 +repage src/plate-a-169.png
```

크롭한 파일도 원본으로 취급해 `src/`에 두고 receipts `derivatives`에 기록한다. 초점 위치는 `usage[].focal`에 적고, 개발자는 CSS `object-position`에 그대로 쓴다.

## 웹 파생본

```sh
<kit>/scripts/make_web.sh src/hero-still.png web hero 640 960 1280 1920        # 전폭
<kit>/scripts/make_web.sh src/hero-still-m.png web hero-m 480 800 1080          # 모바일 크롭
<kit>/scripts/make_web.sh src/content-1.png web content-1 480 800 1200           # 콘텐츠
AVIF_Q=50 WEBP_Q=70 <kit>/scripts/make_web.sh src/plate-a.png web plate-a 960 1280 1920   # 용량 초과 시
```

| 대상 | 폭 | 상한(가장 큰 파일) |
| --- | --- | --- |
| 히어로·전폭 | 640, 960, 1280, 1920 | LCP 이미지 200KB |
| 콘텐츠 | 480, 800, 1200 | 150KB |
| 모바일 크롭 | 480, 800, 1080 | 150KB |

- 원본보다 큰 폭은 만들지 않는다(스크립트가 건너뛰고 알린다).
- 상한을 넘으면 품질을 한 단계 내리고, 그래도 넘으면 가장 큰 폭을 뺀다.

## 히어로 영상

```sh
<kit>/scripts/hero_video.sh src/hero-video.mp4 web hero 1600
<kit>/scripts/make_web.sh web/hero-poster.jpg web hero-poster 960 1600
```

- 4초 이상인 클립은 끝 1초를 처음 1초에 섞어 이음매 없는 루프로 만든다(`XFADE=0`이면 섞지 않는다). 출력은 소리 없는 H.264 MP4(`+faststart`)와 VP9 WebM이다.
- **WebM이 꼭 필요하다.** 자동 검사가 쓰는 Playwright Chromium에는 H.264 디코더가 없다. MP4만 있으면 검사 화면과 녹화에서 영상이 재생되지 않는다. Safari는 MP4를 쓴다.
- 목표는 파일당 4MB 이하, 상한은 6MB다. 넘으면 `MP4_CRF=27 WEBM_CRF=40`으로 다시 만들거나 폭을 1280으로 낮춘다.
- 포스터는 인코딩된 영상의 첫 프레임이다. 그래야 재생이 시작될 때 화면이 튀지 않는다. 색이 팔레트에서 벗어났으면 영상을 다시 생성하지 않고 ffmpeg로 보정한다. 예: `-vf "eq=saturation=0.85:gamma=0.97,colorbalance=rs=-0.03:bs=0.02"`. 보정한 뒤 포스터를 다시 뽑는다.

## 로고 마크 (생성한 경우)

```sh
magick src/logo-mark.png -background white -alpha remove -colorspace gray -threshold 55% logo/mark.pbm
potrace logo/mark.pbm -s --flat --color '#1F3A2E' -o logo/mark-traced.svg
```

- potrace는 검은 부분을 도형으로 바꾼다. 마크가 어두운 바탕 위의 밝은 도형이면 `-negate`를 `-threshold` 뒤에 더한다.
- 추적한 SVG를 열어 `viewBox`를 정사각형으로 맞추고, 여백을 10% 안팎으로 두고, `width`·`height` 속성과 `<metadata>`를 지워 `logo/mark.svg`로 저장한다. 32px로 렌더링해 형태가 뭉개지지 않는지 본다(`rsvg-convert -w 32 logo/mark.svg -o /tmp/m32.png`).
- 고객이 준 로고는 추적하거나 다시 그리지 않는다. 받은 파일을 그대로 쓴다.

## 파비콘 세트

```sh
<kit>/scripts/favicons.sh logo/mark.svg web '#F2EBDD'   # 배경색은 브리프 팔레트의 밝은 바탕색
```

`favicon.svg`, `favicon.ico`(16·32·48), `apple-touch-icon.png`(180, 불투명), `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`(마크 80%)를 만든다. `<head>` 태그와 `site.webmanifest`는 seo-basics를 따른다.

## OG 이미지

```sh
python3 -c "from fontTools.ttLib import TTFont; f=TTFont('<브리프 제목 폰트>.woff2'); f.flavor=None; f.save('/tmp/og-font.ttf')"
magick src/hero-still.png -resize 1200x630^ -gravity center -extent 1200x630 \
  \( -size 1200x630 gradient:'rgba(0,0,0,0)-rgba(0,0,0,0.55)' \) -compose over -composite \
  -font /tmp/og-font.ttf -fill '#FFFFFF' -pointsize 64 -gravity southwest -annotate +72+120 '<카피덱 §7 OG 문구>' \
  -pointsize 28 -annotate +72+64 '<브랜드명>' -strip -quality 85 web/og.jpg
```

- 1200×630, JPG, 300KB 이하다. 글자는 생성 모델이 아니라 이 명령으로 넣는다.
- 문구가 없으면 브랜드명과 로고 마크만 넣는다. 결과 파일을 한 번 열어 한글이 깨지지 않았는지 본다.

## 아이콘

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"
     stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M4 7h16M4 12h10M4 17h7"/>
</svg>
```

- 24px 격자에서 그리고 가장자리 2px은 비운다. 선 굵기, 끝 모양, 모서리 반경을 세트 전체에서 하나로 고정한다.
- 색은 `currentColor`로만 받는다. 의미를 전하는 아이콘은 개발자가 옆에 텍스트를 두고, 장식이면 `aria-hidden="true"`다.

## 웹 반영 (개발자)

`assets/web/`의 파일을 `app/`의 정적 경로로 복사해서 쓴다. 이름을 바꾸지 않는다. 그래야 receipts와 대조할 수 있다. `alt`는 카피덱 §6을 따른다.

```html
<picture>
  <source media="(max-width: 767px)" type="image/avif" srcset="/media/hero-m-480.avif 480w, /media/hero-m-800.avif 800w, /media/hero-m-1080.avif 1080w" sizes="100vw" width="1080" height="1350">
  <source media="(max-width: 767px)" type="image/webp" srcset="/media/hero-m-480.webp 480w, /media/hero-m-800.webp 800w, /media/hero-m-1080.webp 1080w" sizes="100vw" width="1080" height="1350">
  <source type="image/avif" srcset="/media/hero-960.avif 960w, /media/hero-1280.avif 1280w, /media/hero-1920.avif 1920w" sizes="100vw">
  <source type="image/webp" srcset="/media/hero-960.webp 960w, /media/hero-1280.webp 1280w, /media/hero-1920.webp 1920w" sizes="100vw">
  <img src="/media/hero-1280.webp" width="1920" height="1080" alt="…" loading="eager" fetchpriority="high" decoding="async">
</picture>
```

- 첫 화면의 LCP 이미지만 `loading="eager" fetchpriority="high"`다. 나머지는 `loading="lazy" decoding="async"`다.
- 모든 `<img>`에 `width`·`height`를 넣어 레이아웃 이동을 막는다. 크롭이 다른 `<source>`에도 넣는다.
- `sizes`는 실제 표시 폭에 맞춘다. 반폭 split 이미지라면 `(min-width: 768px) 50vw, 100vw`다.

히어로 영상은 768px 이상이면서 움직임 줄이기 설정이 없을 때만 재생한다. 그 밖에는 정지 이미지만 보인다. 5초 넘게 자동 재생되므로 일시정지 버튼이 있어야 한다(WCAG 2.2.2).

```html
<div class="hero-media">
  <picture><!-- 위의 정지 이미지 --></picture>
  <video class="hero-video" muted loop playsinline preload="none" poster="/media/hero-poster-1600.webp"
         width="1600" height="900" aria-hidden="true">
    <source src="/media/hero-1600.webm" type="video/webm">
    <source src="/media/hero-1600.mp4" type="video/mp4">
  </video>
  <button class="hero-video-toggle" type="button" aria-pressed="false" hidden>영상 일시정지</button>
</div>
```

```css
.hero-media { position: relative; }
.hero-video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: none; }
@media (min-width: 768px) and (prefers-reduced-motion: no-preference) { .hero-video { display: block; } }
```

```js
const video = document.querySelector(".hero-video");
const toggle = document.querySelector(".hero-video-toggle");
const motionOk = matchMedia("(min-width: 768px) and (prefers-reduced-motion: no-preference)");
if (video && toggle && motionOk.matches) {
  video.preload = "auto";
  video.play().catch(() => {});
  toggle.hidden = false;
  toggle.addEventListener("click", () => {
    const pause = !video.paused;
    pause ? video.pause() : video.play();
    toggle.setAttribute("aria-pressed", String(pause));
    toggle.textContent = pause ? "영상 재생" : "영상 일시정지";
  });
}
```

- 버튼 문구는 카피덱 §5 'UI 문구'에서 가져온다. 버튼은 키보드로 닿고, 포커스 표시가 보여야 한다.
- 영상 위 텍스트의 대비는 CSS 그라데이션 오버레이로 확보한다. 4.5:1을 포스터 기준으로 확인한다.
