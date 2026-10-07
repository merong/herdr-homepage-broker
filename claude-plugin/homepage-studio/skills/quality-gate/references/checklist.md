# 품질 게이트 체크리스트

check 태스크에서 위에서 아래로 한 번 본다. 항목 앞의 `[차단]`, `[중요]`, `[경미]`는 기본 심각도다. 실제 영향이 다르면 바꾸고 이유를 쓴다. 브리프 §5 '기본값 점검'에 이유와 함께 고른 것으로 적힌 선택은 B 항목에서 통과로 본다.

표기:

- `<out>`: 빌드 출력 디렉터리(예: `app/dist`)
- `<run>`: `.herdr/runs/<run_id>`
- `<ac>`: `<run>/reports/auto-check`
- `<qg>`, `<kit>`, `<typo>`: run guide의 플러그인 경로 아래 `skills/quality-gate`, `skills/asset-kit`, `skills/korean-typography`

> 출처: G·H 항목의 일부는 ai-instruct(Apache-2.0, Boaz Ziniman)의 web-accessibility·web-performance 가이드를 번역하고 줄이고 고친 것이다. WCAG 번호를 바로잡았고 `font-display: optional` 권고를 `swap`으로 바꿨다. I 항목은 website-quality-checker(MIT, KIM DAEUN)를 줄여 옮겼다. 자세한 내용은 `THIRD_PARTY_NOTICES.md`에 있다.

`auto-check.json`은 Read로 한 번 읽는다. 아래 명령은 zsh에서 일치하는 파일이 없을 때 멈추지 않도록 glob 대신 `find`와 `grep -r --include`를 쓴다. Higgsfield `review-rubric.md`가 설치되어 있으면, 정적 빌드에 해당하는 기계 항목 가운데 여기에 없는 것만 더한다.

## A. 실행 (auto-check.json)

- **A1** [차단] 두 폭 모두 페이지가 열렸다. `viewports.desktop`과 `viewports.mobile`에 `navigation_error`가 없다. `networkidle`이 false면 무엇이 계속 요청되는지 `failed_requests`와 함께 본다.
- **A2** [차단] 자기 파일의 요청 실패와 404가 없다. `failed_requests_total`과 `http_errors_total`이 0이어야 한다. 흔한 원인은 파비콘, 폰트 조각, 포스터의 경로다.
- **A3** [중요] `console_errors_total`과 `page_errors_total`이 0이다. 오류가 메뉴나 폼 스크립트에서 나면 [차단]으로 올린다.
- **A4** [차단] `broken_images_total`이 0이다.
- **A5** [차단] 가로 넘침이 없다. `overflow.overflowing`이 false여야 하고, 특히 mobile을 본다. 원인 요소는 `overflow.elements`에 있다.
- **A6** [중요] 페이지 안 링크를 본다. `anchors.missing_targets`가 비어 있어야 하고 `anchors.empty_hash`는 0이어야 한다. `href="#"`은 자리표시 링크다.
- **A7** [차단] 외부 요청이 없다. `external_hosts`가 빈 배열이어야 한다. 이 키는 `issues`에 자동으로 오르지 않으므로 직접 본다.
- **A8** [중요] `sections`가 브리프 §6의 섹션 수와 같다. 자동 검사는 최상위 `<section>`만 센다. 수가 다르면 섹션이 `<div>`로 만들어졌는지부터 본다.
- **A9** [경미] `load_ms`가 localhost에서 3,000을 넘으면 H 항목에서 무거운 파일을 찾는다.

## B. 템플릿 인상 (슬라이스와 CSS)

```sh
grep -rhoiE '#f4f1ea|#d97757|#0b0b0b|#111111|#111[^0-9a-f]|rgba\(0, ?0, ?0, ?0?\.1\)|text-transform: ?uppercase|font-family:[^;}]*mono|linear-gradient|border-radius:[^;}]+' \
  <out> --include='*.css' --include='*.html' | sort | uniq -c | sort -rn | head -30
grep -rhoiE '#[0-9a-f]{6}\b|#[0-9a-f]{3}\b' <out> --include='*.css' | tr 'A-F' 'a-f' | sort | uniq -c | sort -rn
grep -rhoE 'data-aos|AOS\.init|animate__|fade-?up|opacity: ?0[;}]' <out> --include='*.html' --include='*.css' --include='*.js' | sort | uniq -c
```

- **B1** [중요] frontend-design이 꼽은 생성형 디자인의 경향 5가지가 브리프의 선택 없이 들어가 있지 않다.
  1. 크림 배경, 세리프 디스플레이, 테라코타 강조색
  2. 거의 검정인 배경에 형광 강조색 하나
  3. 헤어라인과 빽빽한 단으로 된 신문형 레이아웃
  4. 같은 모양의 카드, 모든 곳에 같은 radius와 같은 회색 그림자, 장식용 그라데이션
  5. 템플릿 크롬
- **B2** [중요] 타이포의 티가 없다.
  - 헤드라인의 한 단어만 색, 굵기, 기울임으로 강조한 것
  - 대문자 라벨과 내용 위의 불필요한 라벨
  - 순서가 아닌 내용에 붙은 01/02/03 번호
  - 가운뎃점으로 이은 메타 문자열('A · B · C')
  - 버튼과 링크 끝의 `→`
- **B3** [중요] homepage-studio `references/design-brief-template.md`의 '한국 기업 사이트의 기본값 목록' 9가지가 없다. 특히 다음을 본다: 남색 그라데이션과 지구본, 스톡 상징 이미지, 핵심 가치 아이콘 카드 3장, 숫자 카운터, 히어로 슬라이더, 영문 대문자 섹션 라벨.
- **B4** [중요] 히어로가 기본형이 아니다.
  - "큰 숫자 + 그라데이션"이나 "가운데 정렬 슬로건 + 버튼 2개 + 흐린 배경 사진"처럼 어느 회사에나 맞는 구성이 아니다.
  - 첫 화면만 보고 업종을 알 수 있고, 이 회사만의 구체(재료, 장소, 공정, 고객)가 하나 이상 보인다.
- **B5** [중요] 대담함은 한 곳에만 쓴다. 기억에 남을 요소 하나를 이름으로 말할 수 있어야 하고, 그것이 브리프 §4 원칙과 같아야 한다. 그런 요소가 없거나 여러 개가 경쟁하면 실패다.
- **B6** [중요] CSS에 쓰인 색이 브리프 §1의 hex와 그 명도 변형뿐이다(두 번째 명령). 조합이 Higgsfield `reference-boards.md`의 금지 팔레트에 해당하지 않는다.
- **B7** [차단] 정지 화면에서 투명하거나 화면 밖에 남은 요소가 없다. 슬라이스의 빈 자리와 흐린 글자를 본다. [중요] 모션은 브리프 §9의 한 순간뿐이다. 섹션마다 fade-up을 넣거나 모든 카드에 hover 들림을 넣지 않았다(세 번째 명령).
- **B8** [경미] 정보를 담지 않은 구분선, 배지, 장식 도형을 하나 뺄 수 있는지 본다.

## C. 레이아웃 반복

- **C1** [중요] 두 폭 모두 `repeated_section_layouts`가 비어 있다. 이 서명은 거칠다(태그, display, 그리드 열 수, flex 방향, 깊이 2). 비어 있어도 다양하다는 증거는 아니다. 서명이 같아도 슬라이스에서 실제로 다르게 보이면 통과로 하고 이유를 쓴다.
- **C2** [중요] 빌드된 섹션의 순서와 패밀리가 브리프 §6 표와 같다.
  - 인접한 두 섹션이 같은 패밀리가 아니다.
  - 같은 패밀리는 2회까지, `grid`는 1회까지다.
  - 패밀리마다 마크업과 그리드가 다르다. 같은 컴포넌트에 내용만 바꿔 넣은 섹션이 아니다.
- **C3** [중요] 같은 모양의 카드 3장(아이콘, 제목, 두 줄 설명)이 없다. 카드가 필요한 곳은 크기, 비율, 내용 밀도로 위계를 둔다.
- **C4** [중요] 모바일 시트에서 '제목 → 문단 → 이미지'처럼 같은 리듬이 3섹션 이상 이어지지 않는다. 섹션마다 배경, 폭, 이미지 크롭과 위치, 글자 크기 가운데 하나 이상이 바뀐다.
- **C5** [경미] 섹션 간격이 모두 같은 값이 아니다. 내용의 무게에 따라 다르다.

## D. 카피

- **D1** [중요] korean-copywriting `references/ai-tells-ko.md` '빠른 검사'를 실행하고, 걸린 것을 하나씩 판정한다. 히어로와 섹션 제목에 남은 티는 수정 목록에 넣는다.
- **D2** [차단] 페이지의 수치, 연도, 인증, 고객사, 인용이 모두 카피덱의 `〔F#〕` 문장에서 왔고, 그 F#이 research.md에 출처와 함께 있다.

  ```sh
  LC_ALL=en_US.UTF-8 grep -rhoE '[0-9][0-9,.]*[ ]?(년|개월|명|개|건|곳|%|배|위|억|만|원|㎡|m²|평|톤|kg|대|종|회|호|층)' <out> --include='*.html' | sort -u
  LC_ALL=en_US.UTF-8 grep -rnoE '최초|유일|1위|넘버원|특허|인증|수상|선정|협력사|고객사|파트너' <out> --include='*.html'
  ```

  나온 값마다 `grep -n '<값>' <run>/reports/copy-deck.md`로 F#을 찾고, research.md에서 그 F#을 확인한다.
- **D3** [차단] 회사 표기가 research.md '표기 기준'과 한 글자도 다르지 않다. 법인명, 브랜드명, 대표자, 사업자등록번호, 주소, 전화, 이메일을 보고, 푸터, 개인정보 고지, JSON-LD `legalName`을 함께 대조한다.
- **D4** [중요] CTA 라벨이 브리프 §8, 카피덱 §3과 같다.
  - 같은 행동에는 어디서나 같은 라벨을 쓴다.
  - 성공 메시지도 라벨과 같은 말을 쓴다.
  - 주 CTA는 하나다.
- **D5** [중요] 본문의 문체가 하나다. 합니다체와 해요체가 섞이면 실패다. 폼 안내와 오류 문구도 본다.

  ```sh
  LC_ALL=en_US.UTF-8 grep -rhoE '(습니다|습니까|입니다|해요|돼요|예요|이에요|세요|까요)[.?!]' <out> --include='*.html' | sort | uniq -c
  ```

- **D6** [차단] `grep -rn 'COPY-GAP' <out>`의 결과가 없어야 한다. 남아 있으면 check에서 최종 문구를 정해 수정 목록에 넣는다. close에서 카피덱에 동기화한다.
- **D7** [중요] korean-copywriting '길이 기준'의 상한을 넘지 않는다. 슬라이스에서 히어로 헤드라인이 1440px에서 2줄, 390px에서 3줄 이내인지 본다.
- **D8** [차단] 자리표시가 없다. 예외는 카피덱에 문서화된 자리표시(`[보유 기간 — 회사 확정 필요]`)와 seo-basics의 `SITE_URL` 기본값뿐이다.

  ```sh
  LC_ALL=en_US.UTF-8 grep -rnoiE 'lorem|ipsum|TODO|TBD|FIXME|XXX|홍길동|○○|000-0000|0000-0000|123-45-67890|example\.(com|org)|\[[^]]{1,30}\]' <out> --include='*.html'
  ```

- **D9** [중요] 로고 바꾸기 시험: 히어로 헤드라인과 섹션 제목에서 브랜드명을 경쟁사 이름으로 바꿔도 말이 되면 일반론이다. research.md '경쟁사 공통 표현'과 겹치는 헤드라인도 같은 실패다.
- **D10** [차단] 생성 이미지를 실물이라고 말하지 않는다. 생성 이미지의 alt, 캡션, 주변 문구가 "당사 공장", "실제 시공 사례", "저희 직원"처럼 말하면 실패다. `assets/media-receipts.json`의 `usage`와 페이지의 이미지를 맞춰 본다. 후기 옆 인물 사진이 생성 이미지면 실패다.

## E. 비주얼 키트

- **E1** [중요] 브리프 §7의 모든 슬롯이 페이지에 쓰였거나 `omitted_slots`에 이유와 함께 있다. 빈 이미지 상자나 회색 자리가 없다.
- **E2** [중요] `python3 <kit>/scripts/receipts_check.py <run>/assets`의 `problems`가 빈 배열이고 `open_jobs`가 없다.
- **E3** [중요] `used`가 `budget` 이하다. 넘었으면 고칠 수 없으므로 '남은 문제'에 적는다.
- **E4** [중요] 슬라이스에서 이미지들이 같은 빛과 그레이드로 보인다. 한 장만 다르면 이미 받은 원본의 크롭이나 색 보정으로만 고친다. 새로 생성하지 않는다.
- **E5** [차단] 화면에 보이는 이미지 결함이 없다: 글자 흔적, 로고, 워터마크, 손가락이나 얼굴 왜곡, 외국 간판. 고치는 방법은 크롭, 이미 받은 다른 이미지로 교체, 그 섹션에서 이미지를 빼는 것이다.
- **E6** [중요] 히어로 영상
  - `<video>`에 WebM과 MP4 `<source>`, `poster`, `muted loop playsinline`이 있다. Playwright Chromium은 H.264를 재생하지 못한다. WebM이 없으면 데스크톱 스크린샷의 영상 자리가 비어 보인다.
  - 일시정지 버튼이 있고 라벨이 카피덱 §5 'UI 문구'와 같다.
  - 768px 미만이거나 움직임 줄이기 설정이면 정지 화면이 나온다. 모바일 슬라이스에서 포스터가 보여야 한다.
  - 파일당 6MB 이하다: `find <out> \( -name '*.mp4' -o -name '*.webm' \) -exec ls -l {} +`
- **E7** [중요] OG 이미지가 1200×630, 300KB 이하이고 글자가 잘리지 않았다. `magick identify <파일>`로 크기를 보고 Read로 한 번 본다.
- **E8** [중요] 파비콘 세트 파일이 출력에 있고 `<head>`가 그 파일들을 가리킨다(seo-basics).
- **E9** [차단] 고객이 준 로고와 사진을 다시 그리거나 바꾸지 않았다. [중요] 로고가 시안이면 README와 브리프 '가정'에 그렇게 적혀 있다.

## F. 타이포

- **F1** [중요] `fonts.rendered_fonts.families`에서 의도한 웹폰트가 `custom: true`로 대부분의 글리프를 그렸다.
  - `custom: false`인 플랫폼 폰트(Apple SD Gothic Neo 등)가 많은 글리프를 그렸다면, 웨이트 파일 누락, 경로 오류, 글자 누락 가운데 하나다.
  - `rendered_fonts`가 `{error}`면 `webfonts_loaded`와 `computed_font_families`로 대신 본다.
- **F2** [중요] 패밀리와 웨이트마다 `page_text.py`를 따로 실행하고 `missing_hangul`이 비어 있는지 본다. 제목 전용 서체에서 글자가 빠졌으면, 그 글자가 실제 제목에 쓰였는지 확인한다.

  ```sh
  python3 <typo>/scripts/page_text.py <out> --check $(find <out>/fonts/<family> -name '*-400*.woff2')
  ```

  `--check`는 맨 끝에 둔다. 파일 이름 패턴은 패키지마다 다르므로 `find` 결과를 먼저 본다. 출력에 `coverage`가 없으면 폰트 파일이 하나도 넘어가지 않은 것이다.
- **F3** [중요] 줄바꿈: `word-break: keep-all`이 적용되어 있다(`grep -rnoE 'word-break: ?keep-all' <out> --include='*.css'`). 슬라이스에서 다음이 없어야 한다.
  - 단어 중간에서 끊긴 줄
  - 제목 마지막 줄에 한 글자나 한 단어만 남은 줄
  - 조사만 남은 줄
- **F4** [중요] 크기와 행간: 본문은 16px 이상(권장 17px)이고 모바일도 같다. 입력 필드 글자는 16px 이상이다. 본문 행간은 1.6–1.8이고 본문 폭은 `max-inline-size` 30em 이하다. 기준표는 korean-typography '수치'에 있다.
- **F5** [중요] 폰트를 외부에서 받지 않고 `font-display: swap`만 쓴다. 출력이 비어야 한다. 외부 호스트가 나오면 A7 [차단]이다.

  ```sh
  grep -rnoE 'fonts\.googleapis|fonts\.gstatic|cdn\.jsdelivr|unpkg\.com|cdnjs|use\.typekit|font-display: ?(optional|block|fallback|auto)' <out> --include='*.css' --include='*.html'
  ```

- **F6** [중요] 폰트 라이선스 파일이 출력의 폰트 폴더에 있다: `find <out> \( -iname '*license*' -o -iname 'ofl*' \)`
- **F7** [경미] 가짜 굵기와 기울임이 없다. `font-synthesis: none`이 있고, 쓰는 웨이트마다 파일이 있다.

## G. 접근성 (WCAG 2.2 AA)

자동 접근성 스캔(axe 등)은 하지 않는다. 아래 명령과 코드 읽기로 판정한다.

- **G1** [중요] 구조: `seo.lang`이 `ko`이고 `seo.h1_count`가 1이다. 제목 수준을 건너뛰지 않는다. `header`, `nav`, `main`, `footer` 랜드마크가 있다. 본문 바로가기 링크가 첫 포커스다.

  ```sh
  grep -hoE '<h[1-6]' <out>/index.html | tr -d '<' | tr '\n' ' '; echo
  grep -hoE '<(header|nav|main|footer)[ >]' <out>/index.html | sort | uniq -c
  ```

- **G2** [중요] `images_missing_alt_total`이 0이다. 장식 이미지는 `alt=""`이고, 의미 있는 이미지는 카피덱 §6의 alt를 쓴다. 인라인 SVG 아이콘은 `aria-hidden="true"`이거나 이름이 있다.
- **G3** [중요] 키보드와 포커스. 다음 명령의 첫째와 둘째 출력은 비어야 한다.

  ```sh
  grep -rnoE 'tabindex="[1-9][0-9]*"' <out> --include='*.html'
  grep -rnoE '<(a|button|input|select|textarea)[^>]*aria-hidden="true"' <out> --include='*.html'
  grep -rhoE 'outline: ?(none|0)|:focus-visible|scroll-padding-top' <out> --include='*.css' | sort | uniq -c
  ```

  - `outline: none`을 쓰면 `:focus-visible` 대체 스타일이 있어야 한다(2.4.7 Focus Visible).
  - 고정 헤더가 포커스된 요소를 가리지 않도록 `scroll-padding-top`을 둔다(2.4.11 Focus Not Obscured).
  - 포커스 표시는 2px 이상, 주변과 3:1 이상을 권장한다. 이 기준은 2.4.13 Focus Appearance로 AAA이므로 필수는 아니다.
  - 모바일 메뉴 버튼은 `<button>`이고, `aria-expanded`가 바뀌고, Esc로 닫힌다.
  - `aria-label`은 보이는 글자로 시작한다(2.5.3).
- **G4** 대비. 히어로와 본문 글자는 [차단], 그 밖은 [중요]다.
  - 글자색과 배경색 쌍을 잰다: 브리프 §1 토큰, 버튼, 링크, 푸터, 폼 테두리. 명령은 `python3 <qg>/scripts/contrast.py <글자색> <배경색> …`이다.
  - 기준은 일반 글자 4.5:1, 큰 글자(24px 이상, 굵게 18.66px 이상)와 UI 요소, 포커스 표시 3:1이다.
  - 반투명 글자색은 쓰지 않는다. 다음 명령에 나온 글자색은 불투명 값으로 바꾼다.

    ```sh
    grep -rnoE '(^|[;{[:space:]])color: ?(rgba|hsla)\([^)]*\)|(^|[;{[:space:]])color: ?#[0-9a-fA-F]{8}\b' <out> --include='*.css'
    ```

  - 이미지나 영상 위의 글자는 글자 바로 옆 빈 배경 영역을 잘라 평균색으로 잰다. 스크린샷의 1px은 CSS 1px이다.

    ```sh
    magick <ac>/screenshot-desktop-1440.png -crop 320x80+96+420 +repage -alpha off -scale '1x1!' -depth 8 -format '#%[hex:p{0,0}]\n' info:
    python3 <qg>/scripts/contrast.py '#FFFFFF' '<위 결과>'
    ```

    평균은 밝은 점을 감춘다. 결과가 6:1 미만이면 슬라이스에서 가장 밝은 부분을 눈으로 확인하고, 의심되면 실패로 본다.
- **G5** 폼. 작동 문제는 [차단], 나머지는 [중요]다.
  - 모든 입력에 연결된 `<label>`이 있다. placeholder만으로 된 라벨은 실패다.
  - `required`, `autocomplete`, 전화번호 `inputmode="tel"`을 쓴다.
  - 오류는 `aria-describedby`로 연결하고 색만으로 표시하지 않는다.
  - 성공 메시지는 `role="status"`나 `aria-live="polite"` 영역에 나온다.
  - 개인정보 동의 체크박스와 고지가 있다.
  - honeypot은 보이지 않고 키보드로 닿지 않는다.
  - [차단] 성공 문구("받았습니다", "접수", "전송되었습니다" 등)는 `submitInquiry`에서 설정된 엔드포인트가 2xx를 돌려준 분기에서만 나온다. 엔드포인트가 비었거나, 요청이 실패했거나, honeypot이 채워졌을 때 이런 문구가 나오면 차단이다. 납품 후 실제 문의가 사라지기 때문이다.
  - [차단] 엔드포인트가 비었을 때의 동작이 research.md의 연락 사실과 맞다(homepage-studio `references/build.md` '문의 폼').
    - 출처 있는 이메일이 있으면 `mailto:` 넘기기다. 주소가 그 사실 ID의 값과 같고, 제목과 본문이 인코딩되며, 화면은 메일 앱이 열린다고만 말하고, 주소를 글자로도 보여 주고, 입력값을 지우지 않는다.
    - 이메일이 없으면 출처 있는 전화와 다른 채널을 안내한다.
    - 연락 사실이 하나도 없으면 중립 안내만 한다(I3).

    ```sh
    grep -rnoE 'data-endpoint="[^"]*"|mailto:[^"?<]+|tel:[^"<]+' <out> --include='*.html' --include='*.js' | sort -u
    LC_ALL=en_US.UTF-8 grep -rnoE '받았습니다|접수(되었|됐|가 완료)|전송(되었|됐|이 완료)|보내졌습니다|완료되었습니다' <out> --include='*.html' --include='*.js'
    grep -rn -A40 'submitInquiry' <out> --include='*.js' --include='*.html' | head -80
    ```

    두 번째 명령에 나온 문구가 2xx 분기 밖에서 쓰이면 실패다. 빌드 출력이 축약되어 읽기 어려우면 `app/` 소스에서 같은 함수를 읽는다.
- **G6** [중요] 움직임
  - `prefers-reduced-motion: reduce` 규칙이 있다.
  - 5초 넘게 움직이는 것(영상, 자동 슬라이더)에는 정지 수단이 있다(2.2.2).
  - 소리 나는 자동 재생이 없다.
  - 1초에 3번 넘게 깜빡이는 것이 없다(2.3.1).
- **G7** [중요] 터치 대상: 링크와 버튼은 24×24px 이상이거나 충분히 떨어져 있다(2.5.8 AA). 메뉴 버튼, 주 CTA, 폼 버튼은 44×44px을 권장한다. 모바일 슬라이스에서 푸터 링크와 전화번호의 간격을 본다.
- **G8** [중요] hover에서만 보이는 설명, 메뉴, 링크가 없다. 있다면 focus에서도 보이고 터치로도 닿아야 한다(1.4.13, 2.1.1).

  ```sh
  grep -rnoE ':hover[^{]*\{[^}]*(opacity: ?1|visibility: ?visible|display: ?(block|flex))' <out> --include='*.css'
  ```

- **G9** [중요] 확대를 막지 않는다(1.4.4). 출력이 비어야 한다.

  ```sh
  grep -rnoE 'user-scalable=(no|0)|maximum-scale=1(\.0)?([^0-9.]|$)' <out> --include='*.html'
  ```

- **G10** [경미] 색만으로 정보를 전하지 않는다(1.4.1). 본문 링크에는 밑줄이나 다른 구분이 있고, 필수 표시는 글자로도 나온다.

## H. 성능

- **H1** [중요] LCP 이미지를 확인한다. 대개 히어로 정지 화면이나 포스터다. 200KB 이하이고 `fetchpriority="high"`가 있으며 `loading="lazy"`가 아니다. CSS 배경 이미지로 넣지 않았다. 확인 명령은 `grep -rhoE '<img[^>]*fetchpriority="high"[^>]*>' <out> --include='*.html'`이다.
- **H2** [중요] 모든 `<img>`에 `width`와 `height`가 있다. `grep -rhoE '<img[^>]*>' <out> --include='*.html' | grep -vc 'width='`의 결과가 0이어야 한다.
- **H3** [경미] 첫 화면 아래 이미지는 lazy다: `grep -rhoE 'loading="(lazy|eager)"' <out> --include='*.html' | sort | uniq -c`
- **H4** [중요] 이미지 용량을 본다. 목록에 나와도 되는 것은 LCP 이미지(200KB까지)와 OG 이미지(300KB까지)뿐이다.

  ```sh
  find <out> \( -name '*.avif' -o -name '*.webp' -o -name '*.jpg' -o -name '*.jpeg' -o -name '*.png' \) -size +150k -exec ls -l {} +
  ```

- **H5** [중요] 폰트 웨이트 파일은 브리프 §2에 적힌 것뿐이다. preload는 2개 이하이고 CSS `@import`가 없다.

  ```sh
  grep -rhoE '<link[^>]*rel="preload"[^>]*>' <out> --include='*.html'
  grep -rn '@import' <out> --include='*.css'
  ```

- **H6** [중요] 영상 파일은 하나당 6MB 이하다(목표 4MB). `preload="none"`으로 시작하고, 조건이 맞을 때만 스크립트가 받는다(asset-kit `references/media-pipeline.md` '웹 반영').
- **H7** [경미] JS는 `find <out> -name '*.js' -exec du -ch {} + | tail -1`로 잰다. 정적 기업 사이트에는 JS가 거의 필요 없다. 합계가 100KB를 넘으면 무엇이 큰지 확인한다. 분석 도구, 채팅 위젯, 지도 SDK는 없어야 한다(A7).

## I. 내용 완결성

website-quality-checker의 콘텐츠 품질, 운영자 정보, AI 대량 생성, 기만적 디자인 항목과 Google 검색 품질 평가 가이드라인의 네 축(노력, 독창성, 재능, 정확성)을 이 파이프라인에 맞게 줄였다. 점수는 매기지 않는다.

- **I1** [중요] 첫 화면만으로 무엇을 하는 회사인지, 누구를 위한 것인지 알 수 있다. 지역이 중요한 업종이면 어디서 하는지도 알 수 있다.
- **I2** [차단] 푸터에 법인명, 주소, 출처가 있는 사업자 정보가 있고 D3과 같은 값이다. 거래나 YMYL 업종일수록 엄격하게 본다.
- **I3** [차단] research.md에 있는 연락 수단(전화 `tel:`, 이메일 `mailto:`, 문의 폼)이 모두 페이지에 있다. 각 수단은 헤더나 푸터에서 바로 닿는다. 출처 있는 연락 사실이 하나도 없으면 고칠 수 없는 차단이다. 폼이 중립 안내만 보여 주는지 확인하고, '남은 문제'와 README '공개 전 필수' 맨 위에 적는다.
- **I4** [중요] 섹션마다 이 회사에서만 나오는 정보가 하나 이상 있다: 공정, 재료, 장소, 담당 방식, 결정 기준, 사례. 경쟁사 사이트에도 그대로 있을 문장만으로 된 섹션은 필러다(D9와 함께 본다).
- **I5** [차단] D2가 통과했다. 업종 광고 규제에 걸릴 표현이 없다: 의료, 건강, 금융, 교육의 효과 보장, 후기, 전후 비교, 근거 없는 최상급. 의심되면 문장을 빼는 수정을 넣는다. 판단이 필요한 것은 '남은 문제'에 적는다.
- **I6** [중요] 같은 메시지를 섹션마다 되풀이하지 않는다. 다음과 같은 섹션이 없다.
  - 내용 없는 비전·미션
  - 인사말
  - "준비 중"이나 "Coming soon"
  - 빈 게시판이나 빈 공지 목록
- **I7** [중요] `<title>`, meta description, 히어로가 약속한 것을 본문이 보여 준다.
- **I8** [차단] 기만적 디자인이 없다. D10도 이 항목에 속한다.
  - 누를 수 있어 보이지만 작동하지 않는 요소
  - 가짜 긴급성(마감 임박, 남은 수량)
  - 지어낸 후기, 평점, 카운터
  - 출처 없는 인증 배지
  - 광고처럼 보이는 링크

## J. SEO (seo-basics)

- **J1** [중요] `seo.title`이 30자 안팎이고 "핵심 | 브랜드명" 형식이다.
- **J2** [중요] `seo.meta_description`이 60–100자이고 핵심이 앞 50자 안에 있다.
- **J3** [중요] OG와 Twitter 태그가 갖춰져 있다. `og:image`는 절대 URL이고 그 파일이 출력에 있다.
  - OG: `og:type`, `og:site_name`, `og:title`, `og:description`, `og:url`, `og:image`, `og:image:width`, `og:image:height`, `og:image:alt`, `og:locale`(`ko_KR`)
  - Twitter: `twitter:card`(`summary_large_image`)
- **J4** [중요] canonical, `og:url`, `og:image`, sitemap, robots, JSON-LD가 같은 `SITE_URL`을 쓴다. `schema.org`, `www.w3.org`, `www.sitemaps.org`는 이름공간이라 결과에 나와도 된다.

  ```sh
  grep -rhoE 'https?://[^"'"'"' <>)]+' <out> --include='*.html' --include='*.xml' --include='*.txt' --include='*.webmanifest' \
    | sed -E 's#(https?://[^/]+).*#\1#' | sort | uniq -c
  ```

- **J5** [중요] 파비콘 `<link>`, `site.webmanifest`, `theme-color`가 있고 가리키는 파일이 있다.
- **J6** [중요] `sitemap.xml`과 `robots.txt`가 출력 루트에 있고 XML이 파싱된다: `python3 -c "import sys, xml.dom.minidom; xml.dom.minidom.parse(sys.argv[1]); print('ok')" <out>/sitemap.xml`
- **J7** JSON-LD가 파싱되고, 값은 research.md에 출처가 있는 것뿐이다. `aggregateRating`과 `review`가 없다. 지어낸 값은 [차단], 파싱 실패는 [중요]다.

  ```sh
  python3 - <out>/index.html <<'PY'
  import json, re, sys
  html = open(sys.argv[1], encoding="utf-8").read()
  blocks = re.findall(r'<script[^>]*application/ld\+json[^>]*>(.*?)</script>', html, re.S | re.I)
  print(len(blocks), "JSON-LD block(s)")
  for b in blocks:
      print(json.dumps(json.loads(b), ensure_ascii=False, indent=2))
  PY
  ```

- **J8** [경미] 검색엔진 소유 확인 메타는 페이지에 넣지 않고 README '공개 전 필수'에 적었다.
