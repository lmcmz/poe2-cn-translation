import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sourcePath = join(root, "data/source-terms.json");
const manualPath = join(root, "data/manual-overrides.json");
const clientKeywordsPath = join(root, "data/client-keywords.json");
const siteUiPath = join(root, "data/site-ui.json");
const leaguePath = join(root, "data/league-terms.json");
const publicDataRoot = join(root, "public/data");
const sourceTerms = JSON.parse(await readFile(sourcePath, "utf8"));
// Manual UI-label layer (poe.ninja's own computed-stat labels that have no 1:1
// PoE2DB source). Overlaid last so it wins. Marked source:"manual".
let manualTerms = [];
try {
  manualTerms = JSON.parse(await readFile(manualPath, "utf8"));
} catch {
  manualTerms = [];
}
// Official client keyword terms + definitions (Traditional Chinese only),
// extracted from PoE2 KeywordPopups via pathofexile-dat. source:"client".
let clientKeywords = [];
try {
  clientKeywords = JSON.parse(await readFile(clientKeywordsPath, "utf8"));
} catch {
  clientKeywords = [];
}
// Trade-site UI chrome (not game data): "Search Listed Items", "Damage per
// Second", "+ Add Stat Filter", min/max placeholders, etc. source:"manual".
let siteUi = [];
try {
  siteUi = JSON.parse(await readFile(siteUiPath, "utf8"));
} catch {
  siteUi = [];
}
// League / season names (poe.ninja league dropdowns etc.). zh from poe2db
// /cn + /tw league pages (1:1); permanent leagues marked source:"official".
let leagueTerms = [];
try {
  leagueTerms = JSON.parse(await readFile(leaguePath, "utf8"));
} catch {
  leagueTerms = [];
}
const allTerms = [...sourceTerms, ...clientKeywords, ...manualTerms, ...siteUi, ...leagueTerms];
const languages = ["zh-CN", "zh-TW"];

await mkdir(publicDataRoot, { recursive: true });

// PoE2DB stores local weapon/armour mods with a class-qualifier prefix
// ("Two Handed Melee Weapon or Crossbow: +3 to Level of all Attack Skills"),
// but on an actual item / in the trade filter they render in the BARE form
// ("+3 to Level of all Attack Skills", "# to Level of all Attack Skills"). This
// matches such a qualifier prefix so we can also register the bare variant.
const QUALIFIER_RE =
  /\b(Weapon|Bow|Crossbow|Quarterstaff|Staff|Wand|Sceptre|Spear|Flail|Mace|Sword|Axe|Dagger|Claw|Focus|Shield|Buckler|Armour|Helmet|Gloves|Boots|Amulet|Ring|Belt|Quiver|Martial|Caster|Ranged|Melee|Handed)\b/;

for (const language of languages) {
  const dictionary = {};

  for (const term of allTerms) {
    const localized = term.translations?.[language];
    if (!localized?.text || !localized?.sourceUrl) {
      continue;
    }

    dictionary[term.english] = {
      translation: localized.text,
      type: term.type,
      slug: term.slug,
      source: term.source,
      sourceUrl: localized.sourceUrl,
      confidence: 1
    };
  }

  // Derive bare variants from class-qualifier-prefixed local mods.
  let derived = 0;
  for (const term of allTerms) {
    const localized = term.translations?.[language];
    if (!localized?.text) continue;
    const em = term.english.match(/^([^:]{1,60}): (.+)$/);
    if (!em || !QUALIFIER_RE.test(em[1])) continue;
    const restEn = em[2].trim();
    const lm = localized.text.match(/^[^:：]{1,45}[:：]\s*(.+)$/);
    if (!lm) continue;
    const restTr = lm[1].trim();
    if (restEn.length < 3 || restTr.length < 1 || dictionary[restEn]) continue;
    dictionary[restEn] = {
      translation: restTr,
      type: term.type,
      slug: term.slug,
      source: term.source,
      sourceUrl: localized.sourceUrl,
      confidence: 1,
    };
    derived += 1;
  }
  console.log(`[${language}] ${Object.keys(dictionary).length} entries (+${derived} bare qualifier variants)`);

  await writeFile(
    join(root, `data/dictionary.${language}.json`),
    `${JSON.stringify(dictionary, null, 2)}\n`,
  );
  await writeFile(
    join(publicDataRoot, `dictionary.${language}.json`),
    `${JSON.stringify(dictionary, null, 2)}\n`,
  );
}

const meta = {
  generatedAt: new Date().toISOString(),
  sourcePath: "data/source-terms.json",
  sourceCount: sourceTerms.length,
  outputs: languages.map((language) => ({
    language,
    path: `data/dictionary.${language}.json`,
    count: sourceTerms.filter((term) => term.translations?.[language]?.text).length
  }))
};

await writeFile(join(root, "data/dictionary.meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
await writeFile(join(publicDataRoot, "dictionary.meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
