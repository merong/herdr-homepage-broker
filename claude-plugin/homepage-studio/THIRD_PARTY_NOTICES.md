# Third-party notices

This plugin contains two vendored skills and one adapted excerpt, listed below with the exact revision read, its license and how it is used. Everything else in the plugin (the homepage-studio skill, its references and `scripts/look.py`) is original to this repository.

## frontend-design (vendored, unmodified)

- Project: Anthropic, claude-plugins-official
- URL: https://github.com/anthropics/claude-plugins-official
- Revision: d4226d062928f8d9505dbdeadd10217d23361052
- License: Apache License 2.0
- Files: `skills/frontend-design/SKILL.md` and `skills/frontend-design/LICENSE.txt`, copied byte for byte
  - SKILL.md sha256 `d91970639e9f5c37682ac7ab60094d35f1c7c1f38d731bd56396563aee10c1d3`
  - LICENSE.txt sha256 `0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594`
- Modifications: none. The upstream skill has no NOTICE file.
- The homepage-studio skill refers to it by name (`homepage-studio:frontend-design`) and does not copy its text.
- License text: `skills/frontend-design/LICENSE.txt` and https://www.apache.org/licenses/LICENSE-2.0.

## high-end-visual-design (vendored, unmodified)

- Project: Leonxlnx, taste-skill
- URL: https://github.com/Leonxlnx/taste-skill
- Revision: b482f7a970abb98c4108d4a9f761e458c64cefc8
- License: MIT License, Copyright (c) 2026 Leonxlnx
- Files: upstream `skills/soft-skill/SKILL.md` and `LICENSE`, copied byte for byte to `skills/high-end-visual-design/SKILL.md` and `skills/high-end-visual-design/LICENSE`
  - SKILL.md sha256 `e1e32f5e2d420872c6c7332b53d5ff7721946766b78c4822b424c2d512c8fdbc`
  - LICENSE sha256 `4575a543ab88dad12ccea7d97e563d0bce5b448b06072e65d3264497dad326df`
- Modifications: none. The folder name follows the skill's own frontmatter name (`high-end-visual-design`), not the upstream folder name.
- The homepage-studio skill refers to it by name (`homepage-studio:high-end-visual-design`) and does not copy its text.
- License text: `skills/high-end-visual-design/LICENSE`.

## design-taste (adapted excerpt)

- Project: Leonxlnx, taste-skill
- URL: https://github.com/Leonxlnx/taste-skill
- Revision: b482f7a970abb98c4108d4a9f761e458c64cefc8
- License: MIT License, Copyright (c) 2026 Leonxlnx
- Source: upstream `skills/taste-skill/SKILL.md` (`design-taste-frontend` v2), sha256 `aa194351b246b8b4799099d4ed7b033d29eab6e6e3d58d8d2172978be7b3ec89`
- Files: `skills/design-taste/SKILL.md` (excerpt) and `skills/design-taste/LICENSE` (upstream `LICENSE` copied byte for byte, sha256 `4575a543ab88dad12ccea7d97e563d0bce5b448b06072e65d3264497dad326df`)
- Modifications:
  - Omitted sections: 1.B, 1.C, 2, 3.A, 3.B, 3.D, 3.F, 5.A to 5.C, 6.A, 6.E, 6.F, 8, 10, 11 (except two lines of 11.C), 12, 13 and the appendices. Kept sections are also cut to selected lines.
  - Kept lines are the upstream wording unchanged, with the original section numbers and titles, except lines marked `[adapted]`. Every changed or added line, including the two changed titles (0.C and 6.C), ends with `[adapted]`. A provenance block at the top lists these rules.
  - Reason: the homepage PM needs only the design read, the three dials, the AI tells and the pre-flight check, and the adapted lines resolve conflicts with the homepage-studio workflow (facts from input only, local assets only, no questions about taste, no React or CDN assumptions).
- License text: `skills/design-taste/LICENSE`.

## Referenced, not included

- **Higgsfield skills** (`higgsfield-websites`, `higgsfield-brandkit`). The broker's run guide names their `references/` directories in the user's own installation, which the PM may read at run time. No text from them is copied here.
- **Fonts.** The homepage-studio skill names Korean web fonts (for example Pretendard, SUIT, Wanted Sans, and Noto Serif KR and Hahmlet via Fontsource). They are not bundled. Each generated site installs them as dependencies and ships their OFL license files.
- **Playwright for Python.** `scripts/look.py` imports it from the user's Python installation. It is not bundled.

## Removed in 0.9.0

Version 0.8.0 also shipped the skills korean-copywriting, korean-typography, quality-gate, asset-kit and seo-basics, which adapted material from copy-that-sells (MIT), jp-web-design-guardrails (MIT), website-quality-checker (MIT) and ai-instruct (Apache 2.0). Those skills and their files were removed in 0.9.0, so their notices no longer apply to this plugin.
