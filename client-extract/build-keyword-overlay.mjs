#!/usr/bin/env node
// Turn the extracted KeywordPopups tables into a zh-TW overlay for the extension
// dictionary. Source: official PoE2 client data (Data/Balance[/Traditional
// Chinese]/KeywordPopups), so these are authoritative — Traditional Chinese
// ONLY (the global client ships no Simplified Chinese).
//
// Emits both the keyword TERM (name) and its DEFINITION (the hover tooltip body)
// as EN -> zh-TW entries, with the game's [Type|Display] link markup stripped so
// the English key matches the rendered text on poe.ninja.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TABLES = path.join(HERE, "tables");
const OUT = path.resolve(HERE, "..", "extension", "data", "client-keywords.json");

const en = JSON.parse(readFileSync(path.join(TABLES, "English", "KeywordPopups.json"), "utf8"));
const tw = JSON.parse(readFileSync(path.join(TABLES, "Traditional Chinese", "KeywordPopups.json"), "utf8"));
const twById = new Map(tw.map((r) => [r.Id, r]));

// [Type|Display] -> Display ; [Display] -> Display ; collapse whitespace.
function clean(s) {
  return String(s || "")
    .replace(/\[([^\][|]+)\|([^\]]+)\]/g, "$2")
    .replace(/\[([^\]]+)\]/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

const out = [];
const seen = new Set();
function add(english, zhTw, kind) {
  const e = clean(english);
  const t = clean(zhTw);
  if (!e || !t || e === t || e.length < 2 || seen.has(e)) return;
  seen.add(e);
  out.push({
    english: e,
    type: kind,
    source: "client",
    translations: { "zh-TW": { text: t, sourceUrl: "client:KeywordPopups" } },
  });
}

for (const r of en) {
  const t = twById.get(r.Id);
  if (!t) continue;
  add(r.Term, t.Term, "keyword");
  add(r.Definition, t.Definition, "keyword_description");
}

writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n", "utf8");
const defs = out.filter((o) => o.type === "keyword_description").length;
console.log(`Wrote ${out.length} entries to ${path.relative(path.resolve(HERE, ".."), OUT)} (${out.length - defs} terms, ${defs} definitions). zh-TW only.`);
