# PoE2 中文翻译 · PoE2 Chinese Translation

A Chrome extension that adds **Simplified / Traditional Chinese** to *Path of Exile 2*
community sites and the official trade site. Every term comes **1:1 from official
game data** (PoE2DB + the official game client) — never machine-guessed.

> 不隶属于 Grinding Gear Games，也未获其认可。Path of Exile 为 GGG 商标。
> Fan-made; not affiliated with or endorsed by Grinding Gear Games.

## Features

- **简体 / 繁体** Chinese, switchable any time
- Three display modes: **英文+中文** (bilingual) · **仅中文** (replace) · **悬浮提示** (tooltip)
- Covered sites: **poe.ninja / poe2.ninja**, **pobb.in**, **Maxroll** (`/poe2`),
  **FilterBlade**, **Mobalytics** (`/poe-2`), and the **official trade site**
  (`pathofexile.com/trade2`, where GGG ships no Traditional Chinese)
- Built-in **查词条**: type English / 简体 / 繁体 and find the matching term in all three;
  copy the official English to paste into the trade stat search
- Fully local & offline (the dictionary is bundled); collects no user data

## Install

**From source (unpacked):**

```bash
cd extension
npm install
npm run build       # builds the dictionary + the extension into dist/
```

Then in Chrome → `chrome://extensions` → enable **Developer mode** → **Load unpacked**
→ select `extension/dist`.

## How the dictionary is built

The built dictionaries are committed (`extension/data/dictionary.*.json`), so you can
`npm run build` without any crawling. `build-dictionary.mjs` overlays these sources:

```
extension/data/*.json   ──build-dictionary.mjs──►  dictionary.zh-CN.json / zh-TW.json
   ├ source-terms.json        (term names + mods, from PoE2DB)
   ├ client-keywords.json     (official client — client-extract/build-keyword-overlay.mjs)
   ├ rare-name-parts.json     (official client — client-extract/build-rare-names.mjs)
   ├ league-terms.json        (PoE2DB /cn + /tw league pages)
   ├ manual-overrides.json    (site UI labels with no 1:1 game source)
   └ site-ui.json             (trade-site UI chrome)
```

- `extension/scripts/` — `build-dictionary.mjs` (overlay → dictionaries) and
  `build-trade-content.mjs` (a CSP-proof self-contained bundle for strict-CSP sites
  like the official trade site + Mobalytics).
- `client-extract/` — pulls official Traditional Chinese straight from the PoE2 patch
  CDN via [`pathofexile-dat`](https://github.com/SnosMe/poe-dat-viewer) (no game install
  needed). The downloaded tables are **not** redistributed (see `.gitignore`).

> The PoE2DB scraping step that produces `source-terms.json` is run upstream and is not
> included here, to be respectful of [PoE2DB](https://poe2db.tw)'s servers. The compiled
> output is what ships.

## Data sources & licensing

- **Code**: MIT (see [LICENSE](LICENSE)).
- **Translation data**: derived from official PoE2 game data and **PoE2DB (poedb.tw)**.
  It is game content owned by Grinding Gear Games, redistributed here for
  **non-commercial fan use** only. Credit to [PoE2DB](https://poe2db.tw).

## Privacy

No data collection, no tracking, no external servers — translation runs entirely in
your browser. Full policy: <https://lmcmz.github.io/poe2-cn-translation/>
