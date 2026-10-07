# 한글 웹폰트 후보

모두 SIL OFL 1.1이다. 버전, 파일 구성, 음절 수는 2026-10-07에 npm 패키지를 직접 열어 확인했다. 다른 버전을 쓰면 `scripts/page_text.py --check`로 다시 확인한다. 한글 완성형 음절은 모두 11,172자이고, 상용 한글(KS X 1001)은 2,350자다.

## 고딕(산세리프)

| 폰트 | npm 패키지(확인 버전) | 웨이트 | 웹 파일 | 한글 음절 | RFN | 성격 |
| --- | --- | --- | --- | --- | --- | --- |
| Pretendard | `pretendard` 1.3.9 | 100–900 | `dist/web/static/pretendard-dynamic-subset.css`(웨이트당 92조각, 조각 12–15KB) / `pretendard-subset.css`(웨이트당 1파일, Regular 267KB) | 분할본 11,172 / 단일 서브셋 2,780 | 있음 "Pretendard" | 중립, 단정. 한국 웹의 기본값 |
| SUIT | `@sun-typeface/suit` 2.0.5 | 100–900 | `fonts/static/woff2/SUIT-*.woff2`(웨이트당 1파일, Regular 168KB). 패키지 CSS에 `font-display`가 없다 | 2,668 | 있음 "SUIT" | 기하학적, 단단함. 숫자가 깔끔하다 |
| Wanted Sans | `wanted-sans` 1.0.3 | 400–900, 1000 | `fonts/webfonts/static/split/WantedSans-*.css`(웨이트당 92조각) | 11,172 | 패키지 CSS 머리말에 "Reserved Font Name Wanted Sans"가 있다(OFL.txt에는 없음). 있다고 보고 다룬다 | 현대적, 기술 기업 |
| IBM Plex Sans KR | `@fontsource/ibm-plex-sans-kr` 5.3.0 | 100–700 | `400.css` 등(조각 분할) | 확인 필요 | fontsource LICENSE에 RFN 줄 없음 | 공학적, 산업재 |
| Noto Sans KR | `@fontsource/noto-sans-kr` 5.3.0 | 100–900 | `400.css` 등(조각 분할) | 확인 필요(Noto CJK 계열은 전체 음절 수록이 보통) | 없음 | 가장 무난함. 공공·의료의 긴 본문 |
| Gothic A1 | `@fontsource/gothic-a1` 5.3.0 | 100–900 | `400.css` 등 | 확인 필요 | 없음 | 조금 고전적인 고딕 |
| 고운돋움 | `@fontsource/gowun-dodum` 5.3.0 | 400 | `400.css` | 확인 필요 | 없음 | 손글씨 기운의 부드러운 고딕. 짧은 글에만 |

## 명조(세리프)

| 폰트 | npm 패키지(확인 버전) | 웨이트 | 웹 파일 | 한글 음절 | RFN | 성격 |
| --- | --- | --- | --- | --- | --- | --- |
| Noto Serif KR | `@fontsource/noto-serif-kr` 5.3.0 | 200–900 | `400.css`(124조각). `korean-400.css`는 분할 없는 단일 파일(수백 KB)이라 쓰지 않는다 | 11,172 | 없음 | 정통 명조. 법률, 컨설팅, 공공 |
| 함렛 Hahmlet | `@fontsource/hahmlet` 5.3.0, 가변 `@fontsource-variable/hahmlet` | 100–900 | `400.css`(92조각) 또는 `korean-400.css`(단일 172KB) | 2,788 | 없음 | 현대적이고 개성 있는 명조. 식음료, 공방, 문화 |
| 고운바탕 | `@fontsource/gowun-batang` 5.3.0 | 400, 700 | `400.css` 등 | 확인 필요 | 없음 | 문학적이고 따뜻함 |
| 나눔명조 | `@fontsource/nanum-myeongjo` 5.3.0 | 400, 700, 800 | `400.css` 등 | 확인 필요 | fontsource LICENSE에 RFN 줄 없음 | 고전적, 격식 |

"확인 필요"인 폰트는 고르기 전에 `page_text.py --check`로 카피덱 글자를 대조한다.

## 고르는 법

1. 브리프 §0의 "업종의 재료와 말"에서 출발한다. 서체는 그 재료의 질감을 따라간다. 철과 기계는 단단한 고딕, 종이와 손일은 명조나 부드러운 고딕이다.
2. **Pretendard는 한국 웹의 Inter다.** 써도 되지만 "깔끔해서"는 이유가 아니다. 쓴다면 브리프 §2에 이유를 적고, 제목 서체·웨이트·크기 대비 중 하나로 차이를 만든다.
3. 한 페이지에 한글 서체는 2종까지다. 흔한 짝은 제목 명조와 본문 고딕, 또는 한 고딕 계열의 웨이트 대비다.
4. 회사명, 제품명, 대표 헤드라인에 드문 음절이 있으면 11,172음절을 모두 가진 폰트나 분할본을 쓴다.
5. 라틴 전용 서체는 브랜드가 영문 워드마크를 가졌거나 숫자·영문 비중이 클 때만 더한다. 넣는다면 OFL 폰트로 고르고(예: `@fontsource/source-serif-4`), SKILL.md §2의 `unicode-range` 규칙을 지킨다.

## 업종별 출발점 (기본값이 아니다)

| 업종 | 제목 | 본문 | 메모 |
| --- | --- | --- | --- |
| 제조, 산업재, B2B 기술 | IBM Plex Sans KR 600–700 또는 SUIT 700–800 | 같은 계열 400 | 사양표 숫자에 `tabular-nums` |
| 법률, 회계, 컨설팅 | Noto Serif KR 500–700 또는 나눔명조 700 | Pretendard 또는 Noto Sans KR 400 | 장식 없이, 행간 넉넉하게 |
| 식음료, 공방, 로컬 가게 | Hahmlet 600–800 또는 고운바탕 700 | Pretendard 400 또는 고운돋움(짧은 글) | 사진이 주인공이면 제목 크기를 낮춘다 |
| IT, 스타트업, 앱 | Wanted Sans 700–900 또는 SUIT 800 | 같은 계열 400–500 | 큰 숫자와 짧은 문장 |
| 의료, 공공, 교육 | Noto Sans KR 700 또는 Pretendard 700 | 같은 계열 400 | 판독성 우선. 본문 17–18px |
| 건축, 인테리어, 부동산 | Noto Serif KR 300–400 큰 크기(48px 이상) | 고딕 400 | 가는 웨이트는 32px 이상에서만 |

## 쓰지 않는 것

- 상용 폰트(산돌, 윤디자인 등)와 라이선스가 OFL·Apache가 아닌 "무료 폰트". 웹 임베딩과 재배포 조건이 제각각이다.
- 라이선스가 패키지 안의 파일로 확인되지 않는 폰트. 예: `spoqa-han-sans` npm 패키지의 license 필드는 "SEE LICENSE IN LICENSE"다. 쓰려면 그 파일부터 확인한다.
- 운영체제 폰트 파일(Apple SD Gothic Neo, 맑은 고딕)을 앱에 복사하는 것.
- Google Fonts, jsDelivr, unpkg 같은 CDN 링크.
