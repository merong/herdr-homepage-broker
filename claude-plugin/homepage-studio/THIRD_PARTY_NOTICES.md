# Third-party notices

This plugin contains one vendored skill and several skills that adapt material from other open-source projects. Each source is listed below with the exact revision read, its license, what was used, and how it was changed. The full license texts follow the list.

Sources were read as text only. No code from them is included or executed, except the vendored frontend-design skill, which is a Markdown file.

## 1. frontend-design (vendored, unmodified)

- Project: Anthropic, claude-plugins-official
- URL: https://github.com/anthropics/claude-plugins-official
- Revision: d4226d062928f8d9505dbdeadd10217d23361052
- License: Apache License 2.0
- Files: `skills/frontend-design/SKILL.md` and `skills/frontend-design/LICENSE.txt`, copied byte for byte
  - SKILL.md sha256 `d91970639e9f5c37682ac7ab60094d35f1c7c1f38d731bd56396563aee10c1d3`
  - LICENSE.txt sha256 `0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594`
- Modifications: none. The upstream skill has no NOTICE file.
- Other skills in this plugin cite frontend-design by name and summarise a few of its points in Korean (for example quality-gate checklist B1, B2 and B5). Those summaries are new text, and the vendored files are unchanged.

## 2. copy-that-sells

- URL: https://github.com/avectats7/copy-that-sells
- Revision: 33e195b46c02dd883b29c5e75afd2273a1dc8e7f
- License: MIT, Copyright (c) 2026 Tato Polanco
- Used:
  - the pass structure of the skill (brief, angle, headline, body, self-edit)
  - `craft.md`
  - `diagnostics.md`
  - `self-edit.md` (layers 1 and 3)
  - `spanish-craft.md`, only as a model of how to adapt the method to another language
- Adapted into:
  - `skills/korean-copywriting/SKILL.md`
  - `skills/korean-copywriting/references/craft-ko.md`
  - `skills/korean-copywriting/references/ai-tells-ko.md`
- Changes:
  - The material was restructured, translated and rewritten for Korean company homepages.
  - Korean length limits, speech-level rules, fact-ID rules and Korean AI-tell patterns were added.
  - The English examples and ad copy were replaced with new Korean examples.
- Not used: `examples.md`, its third-party advertisements, and the SaaS and DTC phrasing.

## 3. jp-web-design-guardrails

- URL: https://github.com/mrslbt/jp-web-design-guardrails
- Revision: 1ac0c1ab591c464307124e7894d7b62096699c86
- License: MIT, Copyright (c) 2026 Marsel Bait
- Used: the section structure of the jp-design skill and its typography reference (HTML basics, font stack, base CSS, minimum sizes, font loading, common mistakes).
- Adapted into:
  - `skills/korean-typography/SKILL.md`
  - `skills/korean-typography/references/fonts.md`
  - `skills/korean-typography/references/font-pipeline.md`
- Changes:
  - All rules were rewritten for Korean (Hangul) text.
  - Japanese-only rules were left out: palt, furigana, vertical text, auto-phrase and text-autospace.
  - CDN font loading was replaced with self-hosted files, `font-display: swap` and local subsetting.
  - The font candidates and measurements were checked independently on 2026-10-07.

## 4. website-quality-checker

- URL: https://github.com/llqqssttyy/website-quality-checker
- Revision: 1b532df16fef95ff57d6180317bd857dc1100a75
- License: MIT, Copyright (c) 2026 KIM DAEUN
- Used:
  - categories B (main content quality), C (site and operator information), F2 (mass AI generation) and F6 (deceptive design)
  - `references/lowest-quality-signals.md`
  - section 4 of `references/google-qrg-summary.md` (effort, originality, talent and accuracy)
- Adapted into: section I of `skills/quality-gate/references/checklist.md`
- Changes:
  - The items were condensed and reworded as pass/fail checks for a single company homepage.
  - The scoring system, grades and weights were removed.
  - D1 (first-hand photos) was dropped, because this pipeline uses generated imagery by design.

## 5. ai-instruct

- URL: https://github.com/ziniman/ai-instruct
- Revision: 435aa7c5e8fd58c611b6f56e53daa41bd5a721a3
- License: Apache License 2.0, by Boaz Ziniman. The upstream repository has no NOTICE file.
- Used:
  - from `web-accessibility-guide.md`: the "Anti-Patterns to Flag" list, the universal baseline in "Checklist by Product Type", and the guidance on video, forms, rgba text contrast and touch targets
  - from `web-performance-guide.md`: the guidance on LCP images, CLS and image dimensions, image formats, lazy loading, font loading and `@import`, plus its checklist
- Adapted into: sections G and H of `skills/quality-gate/references/checklist.md`, and the asset and typography rules that those sections reference.
- **Modified.** The material was translated into Korean, condensed, and limited to static sites. Framework-specific parts (Next.js, Tailwind, hosting and CDN) were removed. Other changes:
  - WCAG criterion numbers were corrected: 2.4.7 Focus Visible, 2.4.11 Focus Not Obscured (AA), 2.4.13 Focus Appearance (AAA), and 2.5.8 Target Size Minimum, which is 24×24 at AA, with 44×44 kept as a recommendation.
  - The `font-display: optional` recommendation was replaced with `swap`.
  - The contrast figures quoted for specific palette colours were not carried over. Contrast is measured with `skills/quality-gate/scripts/contrast.py`.
  - The file carrying this material says that it was changed.
- License text: Apache License 2.0. A copy is at `skills/frontend-design/LICENSE.txt` and at https://www.apache.org/licenses/LICENSE-2.0.

## Referenced, not included

- **Higgsfield skills** (`higgsfield-websites`, `higgsfield-brandkit`). The skills name files the PM may read from the user's own installation at run time. No text from them is copied here.
- **Fonts** (Pretendard, SUIT, Wanted Sans, and Noto Serif KR and Hahmlet via Fontsource). They are named and measured but not bundled. Each generated site installs them as dependencies and ships their OFL license files.
- **WCAG 2.2** (W3C). Only success criterion numbers and thresholds are cited.

---

## MIT License: copy-that-sells

```
MIT License

Copyright (c) 2026 Tato Polanco

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## MIT License: jp-web-design-guardrails

```
MIT License

Copyright (c) 2026 Marsel Bait

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## MIT License: website-quality-checker

```
MIT License

Copyright (c) 2026 KIM DAEUN

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Apache License 2.0: frontend-design, ai-instruct

The full text is in `skills/frontend-design/LICENSE.txt` and at https://www.apache.org/licenses/LICENSE-2.0.
