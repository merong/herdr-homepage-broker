# Example Studio 디자인 · 이미지 생성 테스트

## 화면
밝은 아이보리 배경, 차분한 파란색 강조색, 읽기 쉬운 한국어 서체를 사용한다.
데스크톱 히어로는 카피와 큰 사진 2열, 모바일은 카피 다음 사진 1열로 배치한다.
생성 사진이 즉시 식별되도록 히어로 가로폭의 절반 이상을 사용하며 과도한 오버레이로 가리지 않는다.
서비스는 데스크톱 3열, 모바일 1열. 텍스트 워드마크를 사용하며 별도 로고나 실적을 만들지 않는다.
절제된 CSS 진입 모션만 사용하고 키보드 탐색, prefers-reduced-motion, 이미지 alt를 지원한다.

## 이번 실행에서 새로 생성할 이미지 1장
Higgsfield MCP에서 아래 프롬프트를 바탕으로 16:9, count=1 이미지를 생성한다.
이전 추상 유리 이미지와 구분되는 구체적인 공간 사진을 만든다. 실제 회사 사무실이라고 주장하지 않는다.

Prompt: Editorial architectural photograph of a fictional creative design studio in soft morning daylight. A long pale oak desk with neatly arranged blank paper material samples, a small cobalt-blue sculptural object and a green plant. Large windows, ivory plaster walls, warm natural wood, calm muted blue accents, subtle realistic shadows. Wide horizontal composition, inviting professional atmosphere, crisp realistic material details, no people, no text, no logos, no watermark. This is an illustrative fictional studio, not a real company location.

최종 화면 alt: “햇살이 들어오는 가상의 디자인 스튜디오, 원목 책상과 파란 오브제”.
사진 아래 “AI로 제작한 스튜디오 콘셉트 이미지”라는 짧은 설명을 배치한다.

## 이미지 전달과 검증
디자이너 소유의 실행 폴더 assets/에 원본 및 필요하면 JPEG/WebP 웹용 파생본을 저장한다.
파일명은 hero-studio이며 형식에 맞는 확장자를 사용한다. 원본을 보존하고 각 파일의 크기·해시·job ID를 media-receipts.json에 기록한다.
개발자는 웹용 파일을 app/assets/에 복사하고 실제 img src, width/height, object-fit: cover를 적용한다.
장식용 CSS 배경이나 이전 이미지로 이 요구사항을 대체하지 않는다. 생성되지 않으면 미완료로 보고한다.
