---
name: seo-basics
description: 한국어 정적 기업·랜딩 사이트에 기본 SEO를 넣을 때 쓴다. html lang, title과 meta description 길이, Open Graph와 Twitter 카드, 파비콘 세트와 site.webmanifest, 하나의 SITE_URL로 만드는 canonical·sitemap.xml·robots.txt, 출처 있는 값만 쓰는 Organization·LocalBusiness JSON-LD를 다룬다. research 단계의 회사 정보 수집, build 단계의 head 작성, quality-gate J 항목 판정에 쓴다.
---

# 기본 SEO

범위는 정적 사이트 한 벌의 기본 태그와 파일이다. 키워드 리서치, 콘텐츠 마케팅, 분석 도구, 검색엔진 등록은 하지 않는다. 등록은 납품 후 고객이 한다. 문구는 카피덱 §7 '메타'에서 가져오고, 사실은 research.md의 사실 ID가 있는 것만 쓴다.

## SITE_URL

절대 URL이 필요한 곳은 모두 설정 한 곳의 `SITE_URL`에서 만든다: canonical, `og:url`, `og:image`, sitemap, robots의 `Sitemap` 줄, JSON-LD의 `url`과 `logo`.

정하는 순서:

1. PRD에 도메인이 있으면 그 도메인
2. research.md에서 확인한 공식 도메인(사실 ID가 있어야 한다). 이때 브리프 '가정'에 "공식 도메인으로 가정"이라고 적는다.
3. 둘 다 없으면 `https://example.com`. README '공개 전 필수'의 첫 항목에 교체할 위치를 적는다. quality-gate D8은 이 값만 예외로 둔다.

- 끝에 `/`를 붙이지 않고 저장한다(`https://example.com`). 페이지 URL은 `SITE_URL + "/"`처럼 만든다.
- 빌드 설정 한 곳(예: `app/site.config.json`)에 두고, 빌드가 HTML, sitemap, robots, JSON-LD에 채운다. 순수 HTML이면 `%SITE_URL%` 자리를 빌드 스크립트가 바꾼다. 출력에 `%SITE_URL%`이 남으면 안 된다.

## head

```html
<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>도면 받은 다음 날 견적 | <브랜드명></title>
  <meta name="description" content="<카피덱 §7 description>">
  <link rel="canonical" href="https://example.com/">
  <meta name="theme-color" content="<브리프 §1 주색 hex>">

  <meta property="og:type" content="website">
  <meta property="og:locale" content="ko_KR">
  <meta property="og:site_name" content="<브랜드명>">
  <meta property="og:title" content="<og:title>">
  <meta property="og:description" content="<og:description>">
  <meta property="og:url" content="https://example.com/">
  <meta property="og:image" content="https://example.com/og.jpg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="<카피덱 §6 og alt>">
  <meta name="twitter:card" content="summary_large_image">

  <link rel="icon" href="/favicon.ico" sizes="32x32">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="manifest" href="/site.webmanifest">
</head>
```

- `viewport`에 `maximum-scale`이나 `user-scalable=no`를 넣지 않는다(quality-gate G9).
- Twitter(X)는 `twitter:title`, `twitter:description`, `twitter:image`가 없으면 OG 값을 쓴다. `twitter:card`만 넣는다.
- 여러 페이지면 페이지마다 title, description, canonical이 다르다. canonical은 자기 자신의 URL이다.

## title과 description

| 요소 | 길이(공백 포함) | 형식 |
| --- | --- | --- |
| title | 30자 안팎 | "핵심 \| 브랜드명". 브랜드명은 끝에 둔다 |
| description | 60–100자 | 앞 50자 안에 무엇을, 누구에게, 어디서 하는지 |
| og:title | title과 같거나 "\| 브랜드명"을 뺀 것 | 카피덱 §7 |
| og:description | description과 같거나 더 짧게 | 카피덱 §7 |

- 핵심에는 고객이 실제로 검색할 말(업종, 지역, 대표 서비스)을 넣는다. 히어로 헤드라인을 그대로 옮길 필요는 없다. 검색 결과에서는 무엇을 하는 회사인지가 먼저다.
- 키워드 나열, "최고의", "No.1" 같은 출처 없는 최상급은 쓰지 않는다. 문체는 본문과 같게 한다.
- 검색 결과에서 잘리는 길이는 글자 수가 아니라 화면 폭으로 정해진다. 위 길이는 한글 기준의 안전한 범위다.

## OG 이미지

asset-kit 'OG 이미지와 파비콘'이 만든 1200×630 JPG(300KB 이하)를 출력 루트의 `/og.jpg`로 둔다. 이미지 안 글자는 로컬에서 합성한 것이다. `og:image`는 반드시 절대 URL이다.

## 파비콘과 매니페스트

asset-kit `scripts/favicons.sh`가 만든 파일을 출력 루트에 둔다: `favicon.svg`, `favicon.ico`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`.

```json
{
  "name": "<브랜드명>",
  "short_name": "<12자 이내>",
  "lang": "ko",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ],
  "theme_color": "<브리프 §1 주색>",
  "background_color": "<브리프 §1 바탕색>",
  "display": "browser"
}
```

`site.webmanifest`로 저장한다. 앱처럼 설치되는 사이트가 아니므로 `display`는 `browser`다.

## sitemap.xml과 robots.txt

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/</loc><lastmod>2026-10-07</lastmod></url>
</urlset>
```

```text
User-agent: *
Allow: /

Sitemap: https://example.com/sitemap.xml
```

- 페이지마다 `<url>` 하나를 둔다. `lastmod`는 빌드 날짜다. `priority`와 `changefreq`는 넣지 않는다.
- `SITE_URL`이 기본값이어도 같은 형식으로 만든다. 교체는 README가 안내한다.

## JSON-LD

**research 단계**에서 아래 필드에 들어갈 사실을 사실 ID와 함께 모은다. **build 단계**에서는 출처가 있는 필드만 넣는다. 출처가 없는 필드는 비워 두지 말고 빼며, 값을 지어내지 않는다.

- 기본 타입은 `Organization`이다.
- 방문형 지역 사업(병원, 학원, 매장, 시공 업체 등)이고 주소에 출처가 있으면 `LocalBusiness`나 그 하위 타입이 분명히 맞을 때만 그 타입을 쓴다.
- `index.html`에 블록 하나를 둔다.

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "<브랜드명>",
  "legalName": "<등기 법인명, research.md '표기 기준' 그대로>",
  "description": "<카피덱 §7>",
  "url": "https://example.com/",
  "logo": "https://example.com/icon-512.png",
  "email": "<이메일>",
  "telephone": "+82-2-1234-5678",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "<도로명 주소와 상세 주소>",
    "addressLocality": "<시·군·구>",
    "addressRegion": "<시·도>",
    "postalCode": "<우편번호>",
    "addressCountry": "KR"
  },
  "sameAs": ["<research에서 확인한 공식 계정 URL>"]
}
</script>
```

- `telephone`은 국가번호 형식으로 쓴다. `02-1234-5678`은 `+82-2-1234-5678`, `010-…`은 `+82-10-…`이다. 화면의 `tel:` 링크도 같은 형식이다.
- `logo`는 512px PNG다. 고객 로고 PNG가 있으면 그것을, 없으면 `icon-512.png`를 쓴다.
- `foundingDate`는 출처가 있을 때만 쓴다(`YYYY` 또는 `YYYY-MM-DD`).
- `LocalBusiness`의 `openingHoursSpecification`, `geo`, `priceRange`도 출처가 있을 때만 쓴다.
- `aggregateRating`, `review`는 넣지 않는다. 자기 회사의 평점 마크업은 리치 결과 대상도 아니다.
- `award`와 `numberOfEmployees`는 출처 없이 넣지 않는다.
- 값 안에 `</script>`가 들어가지 않게 한다. 확인 명령은 quality-gate J7에 있다.

## 검색엔진 소유 확인

Google Search Console과 네이버 서치어드바이저의 소유 확인 메타는 고객 계정이 있어야 만들 수 있다. 페이지에 넣지 않는다. README '공개 전 필수'에 다음을 적는다.

- 메타를 넣을 위치(`<head>`)
- 공개 후 두 곳에 `sitemap.xml`을 제출할 것

## 하지 않는 것

- 분석 도구, 태그 매니저, 광고 픽셀(납품 후 고객이 넣는다)
- 숨긴 텍스트, 키워드 반복, 출처 없는 최상급
- 평점·후기 마크업, 출처 없는 JSON-LD 필드
- PRD에 없는 다국어 페이지와 `hreflang`
