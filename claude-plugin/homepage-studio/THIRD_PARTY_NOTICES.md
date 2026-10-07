# Third-party notices

This plugin contains one vendored skill, listed below with the exact revision read, its license and how it is used. Everything else in the plugin (the homepage-studio skill, its references and `scripts/look.py`) is original to this repository.

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

## Referenced, not included

- **Higgsfield skills** (`higgsfield-websites`, `higgsfield-brandkit`). The broker's run guide names their `references/` directories in the user's own installation, which the PM may read at run time. No text from them is copied here.
- **Fonts.** The homepage-studio skill names Korean web fonts (for example Pretendard, SUIT, Wanted Sans, and Noto Serif KR and Hahmlet via Fontsource). They are not bundled. Each generated site installs them as dependencies and ships their OFL license files.
- **Playwright for Python.** `scripts/look.py` imports it from the user's Python installation. It is not bundled.

## Removed in 0.9.0

Version 0.8.0 also shipped the skills korean-copywriting, korean-typography, quality-gate, asset-kit and seo-basics, which adapted material from copy-that-sells (MIT), jp-web-design-guardrails (MIT), website-quality-checker (MIT) and ai-instruct (Apache 2.0). Those skills and their files were removed in 0.9.0, so their notices no longer apply to this plugin.
