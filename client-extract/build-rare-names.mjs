#!/usr/bin/env node
// Build the rare-item-name fragment maps from the official Words table.
//
// PoE2 rare item names are generated as <prefix> <suffix>, e.g. "Empyrean Call".
// The official zh-TW word is in Words.Text2 (the global client ships Traditional
// Chinese only — no Simplified, so this is zh-TW only). Prefixes are Wordlist 1
// & 3 (no leading space); suffixes are Wordlist 2 & 5 (leading space, e.g.
// " Call", " the Accursed"). The content script splits a name on the first space
// and looks up both halves — translating ONLY when BOTH are known fragments.
//
// Output: extension/data/rare-name-parts.json { prefixes:{en:zh}, suffixes:{" en":zh} }

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const T = path.join(HERE, "tables");
const EXT = path.resolve(HERE, "..", "extension");
// data/ is the source of truth; public/data/ is what CRXJS copies into dist/.
const OUTS = [
  path.join(EXT, "data", "rare-name-parts.json"),
  path.join(EXT, "public", "data", "rare-name-parts.json"),
];

const en = JSON.parse(readFileSync(path.join(T, "English", "Words.json"), "utf8"));
const tw = JSON.parse(readFileSync(path.join(T, "Traditional Chinese", "Words.json"), "utf8"));

const PREFIX_WL = new Set([1, 3]);
const SUFFIX_WL = new Set([2, 5]);
const prefixes = {};
const suffixes = {};

for (let i = 0; i < en.length; i++) {
  const w = en[i];
  const zh = (tw[i] && tw[i].Text2) || "";
  if (!w.Text || !zh || !/[一-鿿]/.test(zh)) continue;
  if (w.Text === zh) continue; // untranslated
  if (PREFIX_WL.has(w.Wordlist)) prefixes[w.Text] = zh;
  else if (SUFFIX_WL.has(w.Wordlist)) suffixes[w.Text] = zh; // key keeps the leading space
}

const json = JSON.stringify({ prefixes, suffixes }, null, 0) + "\n";
for (const out of OUTS) writeFileSync(out, json, "utf8");
console.log(
  `Wrote rare-name-parts.json (x${OUTS.length}): ${Object.keys(prefixes).length} prefixes, ${Object.keys(suffixes).length} suffixes (zh-TW).`,
);
