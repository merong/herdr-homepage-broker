# assets/media-receipts.json

생성 작업과 자산 파일의 원장이다. 예산 계산, 중복 제출 방지, 품질 게이트의 파일 대조, README '자산 출처'가 모두 이 파일을 쓴다. 경로는 모두 `assets/` 기준 상대 경로다.

## 규칙

- **제출 전에 먼저 쓴다.** Higgsfield 호출 직전에 그 작업을 `status: "submitting"`으로 기록하고 저장한다. 응답을 받으면 `provider_job_id`와 상태를 고친다. 기록이 `submitting`인 채로 남아 있으면 결과를 모르는 작업(`unknown`)으로 다룬다.
- **실제 값만 쓴다.** job ID, 모델, 상태, URL은 도구가 돌려준 값 그대로 쓴다. 추측하거나 비워 둔 값을 채워 넣지 않는다.
- **태스크가 다시 시작되면 이 파일부터 읽는다.** 브로커가 assets 태스크를 다시 배정할 수 있다. `submitting`, `submitted`, `completed`, `unknown`인 슬롯은 다시 제출하지 않는다.
- 파일을 고치면(크롭, 보정, 파생본) sha256을 다시 계산해 기록한다. 원본 `src/` 파일은 고치지 않는다.

## 상태

| status | 뜻 | 예산 | 다음 행동 |
| --- | --- | --- | --- |
| `submitting` | 호출 직전에 기록했고 응답을 아직 못 받았다 | 셈 | 응답이 오면 갱신. 세션이 끊겼으면 `unknown` 절차 |
| `submitted` | job ID를 받았고 결과를 기다린다 | 셈 | 대기 도구로 결과를 받는다 |
| `completed` | 결과를 받아 내려받았다 | 셈 | `outputs` 기록 |
| `failed` | 도구가 실패를 명확히 돌려주었고 결과물이 없다 | 세지 않음 | 슬롯당 재시도 1회까지. 원인을 바꿔서(프롬프트, 모델) |
| `unknown` | 제출됐는지, 성공했는지 알 수 없다 | 셈 | 아래 절차 |

## 결과를 모를 때

1. job ID가 있으면 ID로 한 번 조회한다(예: `jobs_wait`, `show_generation_by_ids`. 정확한 도구 이름과 인자는 설치된 MCP 설명을 따른다). 결과가 나오면 상태를 고친다.
2. job ID가 없으면 최근 생성 목록(예: `show_generations`)을 한 번 본다. 제출 시각과 프롬프트가 분명히 맞는 작업이 하나뿐일 때만 그 ID를 기록하고 `note`에 "최근 목록에서 대조"라고 적는다.
3. 그래도 모르면 `unknown`으로 둔다. 예산에서 빼고, **같은 슬롯을 다시 제출하지 않는다.** 그 슬롯은 이미 받은 이미지의 다른 크롭으로 메우거나 생략하고, PM에게 asset_id, 제출 시각, 마지막 오류를 알린다.

모델 턴으로 상태를 반복 조회하지 않는다. 기다리는 도구를 한 번 쓰거나, 다른 일을 하다가 한 번 확인한다.

## 형식

```json
{
  "schema": "homepage-studio/media-receipts@1",
  "run_id": "<run_id>",
  "budget": { "images": 12, "videos": 1, "source": "default" },
  "style_block_sha256": "<prompts/style-block.txt의 sha256>",
  "jobs": [
    {
      "asset_id": "hero-still",
      "slot": "hero",
      "kind": "image",
      "provider": "higgsfield",
      "tool": "generate_image",
      "model": "<도구가 돌려준 모델 이름>",
      "prompt_file": "prompts/hero-still.txt",
      "prompt_sha256": "<sha256>",
      "count": 1,
      "submitted_at": "2026-10-07T05:12:03Z",
      "provider_job_id": "<도구가 돌려준 ID>",
      "status": "completed",
      "result_urls": ["<도구가 돌려준 URL>"],
      "outputs": [
        { "path": "src/hero-still.png", "sha256": "<sha256>", "width": 2048, "height": 1152, "bytes": 3456789 }
      ],
      "counts_toward_budget": true,
      "replaces": null,
      "note": ""
    },
    {
      "asset_id": "hero-video",
      "slot": "hero",
      "kind": "video",
      "provider": "higgsfield",
      "tool": "generate_video",
      "model": "<모델>",
      "source_asset": "hero-still",
      "prompt_file": "prompts/hero-video.txt",
      "prompt_sha256": "<sha256>",
      "count": 1,
      "submitted_at": "2026-10-07T05:20:41Z",
      "provider_job_id": "<ID>",
      "status": "completed",
      "result_urls": ["<URL>"],
      "outputs": [{ "path": "src/hero-video.mp4", "sha256": "<sha256>", "bytes": 9876543 }],
      "counts_toward_budget": true
    }
  ],
  "derivatives": [
    { "from": "src/hero-still.png", "path": "web/hero-1920.avif", "width": 1920, "height": 1080, "bytes": 151234, "sha256": "<sha256>" }
  ],
  "local_assets": [
    { "asset_id": "favicon-set", "source": "generated-local", "made_from": "logo/mark.svg", "tool": "favicons.sh",
      "files": [{ "path": "web/favicon.ico", "sha256": "<sha256>" }] },
    { "asset_id": "customer-logo", "source": "customer", "made_from": "<입력 문서 경로>",
      "files": [{ "path": "logo/customer-logo.svg", "sha256": "<sha256>" }] },
    { "asset_id": "icons", "source": "hand-drawn",
      "files": [{ "path": "icons/process.svg", "sha256": "<sha256>" }] }
  ],
  "usage": [
    { "asset_id": "hero-still", "section": "S1", "role": "히어로 정지 화면, 영상 포스터", "breakpoints": "768px 미만 4:5 크롭", "focal": "68% 50%", "alt_ref": "카피덱 §6 hero-still" }
  ],
  "omitted_slots": [
    { "slot": "content-4", "reason": "plate-b 작업 결과 불명. 재제출하지 않고 content-2의 다른 크롭으로 대체" }
  ],
  "budget_used": { "images": 10, "videos": 1 }
}
```

- `kind`는 `image`, `video`, `edit`이다. 결과물을 만드는 편집 작업(배경 제거, 업스케일, 리프레임, 아웃페인트)은 `edit`로 적고 이미지 예산에서 1장으로 센다.
- `count`는 그 작업이 만든 장수다. 한 번에 4장을 받았으면 4다.
- `replaces`는 재생성일 때 바꾼 이전 작업의 asset_id다. 재생성은 예비 슬롯에서 차감한다.
- `web/`의 모든 파일은 `derivatives` 또는 `local_assets`에 있어야 한다.

## 확인

```sh
python3 <kit>/scripts/receipts_check.py assets
```

예산 사용량, 결과가 열린 작업, 없는 파일, sha256 불일치, 목록에 없는 `web/` 파일을 보여준다. `problems`가 빈 배열이어야 assets 태스크를 완료로 보고한다. 비어 있지 않으면 고치거나, 고칠 수 없는 이유를 PM에게 알린다.
