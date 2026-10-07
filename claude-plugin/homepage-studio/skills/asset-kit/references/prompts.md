# 생성 프롬프트 작성법

프롬프트는 영어로 쓴다. 설명과 판정은 한국어로 한다. 프롬프트 원문은 `assets/prompts/<asset_id>.txt`에 저장하고, 그 파일의 sha256을 receipts의 `prompt_sha256`에 적는다.

```sh
shasum -a 256 assets/prompts/hero-still.txt
```

## 1. 공통 스타일 블록

브리프 §1 팔레트, §0 업종의 재료, §4 원칙에서 한 번 만들고 `assets/prompts/style-block.txt`에 저장한다. 모든 이미지 프롬프트 끝에 원문 그대로 붙인다. 슬롯마다 고쳐 쓰지 않는다. 고쳐 쓰면 키트의 톤이 갈라진다. Higgsfield brandkit의 `brand-lock.md`가 같은 생각이다.

```text
STYLE — <medium: editorial documentary photograph | quiet still life | architectural photograph>.
Light: <soft overcast daylight from the left, low contrast>.
Grade: <muted, low saturation, warm highlights, deep green shadows>; palette anchored to <#1F3A2E deep green>, <#F2EBDD paper>, <#B5651D copper>.
Lens: <50mm, f/4, eye level>; texture: <fine film grain>.
Place: contemporary South Korea when a setting is visible.
No text, no letters, no numbers, no signage, no logos, no watermark, no UI, no borders, no frames.
```

- hex는 이름과 함께 쓴다. 모델은 hex보다 색 이름을 더 잘 따른다.
- 매체, 빛, 그레이드, 렌즈 네 축을 모두 고정한다. 하나라도 비우면 장마다 달라진다.
- 장소가 보이는 장면에는 한국을 명시한다. 그래도 간판, 콘센트, 차량, 도로 표지가 다른 나라 것처럼 나오면 결함이다.

## 2. 슬롯 프롬프트 형식

```text
SUBJECT — <무엇이 보이는가, 구체적인 사물·재료·동작 하나>
COMPOSITION — <피사체 위치, 거리, 시점>; <텍스트가 놓일 빈 영역: "calm empty area in the left 40% for a headline">
CROP SAFETY — <모바일 4:5 크롭에서도 살아야 할 부분: "keep the subject inside the right-center 50%">
ASPECT — <16:9 | 3:2 | 4:5 | 1:1>
<style-block.txt 원문>
```

- 피사체는 하나다. "factory, workers, products and machines"처럼 나열하면 초점이 없다.
- 헤드라인이 올라갈 이미지는 빈 영역의 위치를 브리프 와이어프레임과 맞춘다.
- 히어로와 전폭 이미지는 데스크톱 16:9와 모바일 4:5 크롭을 모두 견디게 만든다. 피사체를 가운데에서 약간 벗어난 곳에 두고 가장자리를 비운다.
- 이 회사의 실제 시설, 제품, 직원이라고 오해할 장면은 만들지 않는다(SKILL.md '원칙'). 제품이 꼭 필요하면 고객 제공 사진을 쓰고, 없으면 재료와 공정의 클로즈업으로 대신한다.

## 3. 업종별 예 (형식 예시. 그대로 쓰지 않는다)

**금형 공장 히어로**

```text
SUBJECT — a freshly machined steel mold insert resting on a worn workbench, faint coolant sheen on its cavities
COMPOSITION — low three-quarter view from the right, subject in the right third, calm dark empty area in the left 45% for a headline
CROP SAFETY — keep the insert inside the right-center 50%
ASPECT — 16:9
<style block>
```

**동네 베이커리 콘텐츠 이미지**

```text
SUBJECT — hands folding laminated dough on a floured wooden counter, early morning
COMPOSITION — overhead view, hands entering from the bottom edge, no faces
ASPECT — 4:5
<style block>
```

**법률사무소 섹션 플레이트**

```text
SUBJECT — afternoon light falling across stacked case binders and a closed fountain pen on a dark oak desk
COMPOSITION — shallow depth of field, objects in the lower third, wide quiet upper area
ASPECT — 16:9
<style block>
```

## 4. 영상 (히어로 루프, image-to-video)

원본은 확정한 hero-still이다. 새 장면을 만들지 않고 그 장면을 살짝 움직인다.

```text
MOTION — very slow camera push-in; <one natural movement: drifting steam | dust in the light beam | leaves moving in the window reflection>
KEEP — same composition, same objects, same light and grade as the source image; no new objects; no people entering; no cuts
LENGTH — 5–8 seconds, calm and even speed so the end can blend into the start
No text, no logos, no watermark.
```

- 움직임은 하나만 준다. 카메라 이동과 피사체 동작을 동시에 크게 주면 루프 이음매가 튄다.
- 무해한 프롬프트가 nsfw로 거부되는 경우가 있다. "intimate", "sensual", "seamless loop feel", "ambient" 같은 분위기 단어를 빼고 평이한 촬영 설명으로 다시 쓴다(Higgsfield `asset-system.md`의 실패 처리와 같다).

## 5. 로고 마크 (고객 로고가 없을 때만)

```text
SUBJECT — a simple geometric brand mark for <업종>, based on <브리프의 모티프 하나: a folded sheet | a mold cavity | a grain of rice>
STYLE — flat single-color mark, <#1F3A2E> on a pure white background, centered, generous margin, no gradient, no shadow, no 3D, no words, no letters unless it is a single-letter monogram of "<영문 이니셜>"
ASPECT — 1:1
```

- 워드마크(회사 이름 글자)는 생성하지 않는다. 브리프의 폰트로 HTML·SVG에서 조판한다.
- 결과는 단색 SVG로 옮긴다(media-pipeline.md '로고 마크'). 자세한 기준은 Higgsfield brandkit `logo.md`를 본다.

## 6. 쓰지 않는 주제와 표현

- 악수, 노트북 화면을 가리키는 사람, 전구, 퍼즐 조각, 홀로그램, 네트워크 선, 지구본, 도시 야경, 하늘색 그라데이션, 무지개빛·보라 네온 추상, 광택 나는 3D 덩어리, 과한 보케
- 카메라를 보고 웃는 정장 차림 인물, 단체 사진, 얼굴 클로즈업. 사람이 필요하면 손, 작업하는 모습, 중간 거리의 뒷모습이나 옆모습으로 쓴다
- 인증서, 상패, 계약서처럼 사실을 주장하는 사물
- "beautiful", "stunning", "high quality", "8k", "award-winning" 같은 빈 수식어. 대신 빛, 재료, 거리를 구체적으로 쓴다
