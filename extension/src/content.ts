import "./content.css";
import {
  DEFAULT_SETTINGS,
  STATE_KEY,
  loadSettings,
  saveSettings,
  type Language,
  type Settings,
} from "./settings";
import { PLACEHOLDER, normalizeLine, toTemplate, fillTemplate } from "./stat-template";

type DictionaryEntry = {
  translation: string;
  type?: string;
  slug?: string;
  source: string;
  sourceUrl?: string;
  confidence: number;
};

type Dictionary = Record<string, DictionaryEntry>;

const SKIP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "TEXTAREA",
  "INPUT",
  "SELECT",
  "OPTION",
  "CODE",
  "PRE",
  "NOSCRIPT",
]);

// Entity-name types: short, distinctive, safe to translate *inline* inside
// larger text (e.g. a skill name in a build list). These go into the substring
// regex. NOTE: "keyword" is deliberately excluded — translating bare keywords
// inside an otherwise-English stat sentence produces an ugly half-translated
// line. Keywords are still translated when they stand alone (matched as a whole
// element/node by the line matcher below).
const INLINE_TYPES = new Set([
  "skill_gem",
  "support_gem",
  "spirit_gem",
  "gem",
  "unique_item",
  "item_class",
  "class_or_ascendancy",
  "lineage_support",
]);
const INLINE_MAX_LEN = 40;

// Stat/description types matched as whole lines (exact or number-templated),
// never sprinkled word-by-word.
const STAT_TYPES = new Set([
  "explicit_stat",
  "implicit_stat",
  "modifier_stat",
  "enchant_stat",
  "stat",
  "passive_skill_stat",
  "property",
]);

// Matches numeric tokens in a stat line so one dictionary entry ("30% ...") can
// cover every roll ("12% ...", "(20 — 30)% ..."). PLACEHOLDER must be a char
// that never appears in game text.
// A roll range "(20 — 30)" counts as ONE slot (not two) so a dictionary range
// entry also matches a single rolled value on an item ("136% increased ...").
// Inline formatting tags: a keyword inside one of these, embedded in a longer
// sentence, must NOT be translated alone (that produces a half-translated line).
const INLINE_TAGS = new Set([
  "A", "SPAN", "B", "I", "EM", "STRONG", "SMALL", "MARK", "U", "SUB", "SUP", "ABBR", "FONT",
]);
// Things we must never destroy by replacing an element's children: media (gem
// icons, item art) AND interactive controls (the official trade site's MIN/MAX
// inputs, dropdowns, checkboxes live in the same row as the label). For such
// elements the inner text node still translates via the text-node pass, which
// leaves siblings — including the inputs — intact.
const MEDIA_SELECTOR =
  "img, svg, picture, canvas, video, iframe, use, image, input, select, textarea, button";

type TemplateEntry = {
  transTpl: string;
  type?: string;
  slug?: string;
  source: string;
};

type LineHit = { english: string; entry: DictionaryEntry };

let settings: Settings = { ...DEFAULT_SETTINGS };
let dictionary: Dictionary = {};
let matcher: RegExp | null = null;
let templateIndex: Map<string, TemplateEntry> = new Map();
// Case-insensitive exact index: poe.ninja renders sentence case ("Energy
// shield") while game data is title case ("Energy Shield"). Keyed by
// normalizeLine(english).toLowerCase().
let lowerIndex: Map<string, DictionaryEntry> = new Map();
let lineReplacements: { el: HTMLElement; nodes: ChildNode[] }[] = [];
let observer: MutationObserver | null = null;
let renderTimer = 0;
let toolbarToggle: HTMLButtonElement | null = null;
let toolbarLanguage: HTMLSelectElement | null = null;
let toolbarDisplayMode: HTMLSelectElement | null = null;

init().catch((error) => {
  console.error("[PoE Ninja CN Helper] Failed to initialize", error);
});

async function init() {
  settings = await loadSettings();
  dictionary = await loadDictionary(settings.language);
  matcher = buildMatcher(dictionary);
  templateIndex = buildTemplateIndex(dictionary);
  lowerIndex = buildLowerIndex(dictionary);
  await loadRareNameParts(settings.language);
  loadOfficialStats(); // fire-and-forget; panel falls back to the dict until ready
  injectToolbar();

  if (settings.enabled) {
    annotateDocument();
    startObserver();
  }

  document.addEventListener("click", handleTermClick, true);
  chrome.storage.onChanged.addListener(handleSettingsChange);
}

async function loadDictionary(language: Language): Promise<Dictionary> {
  const path =
    language === "zh-TW"
      ? "data/dictionary.zh-TW.json"
      : "data/dictionary.zh-CN.json";
  const response = await fetch(chrome.runtime.getURL(path));
  if (!response.ok) {
    throw new Error(`Dictionary request failed: ${response.status}`);
  }
  return response.json();
}

// The substring matcher only includes short inline terms (names/keywords).
// Long stat lines are handled by exact whole-node lookup in annotateTextNode,
// which keeps this regex bounded and fast even with a 30k-entry dictionary.
function buildMatcher(entries: Dictionary) {
  const terms = Object.entries(entries)
    .filter(([english, entry]) => isInlineTerm(english, entry))
    .map(([english]) => english)
    .sort((a, b) => b.length - a.length);
  if (terms.length === 0) {
    return null;
  }

  const pattern = terms.map(escapeRegExp).join("|");
  // 'i' so page sentence-case ("herald of ash") still matches title-case data.
  return new RegExp(`(^|[^A-Za-z0-9])(${pattern})(?=$|[^A-Za-z0-9])`, "gi");
}

function buildLowerIndex(entries: Dictionary): Map<string, DictionaryEntry> {
  const index = new Map<string, DictionaryEntry>();
  for (const [english, entry] of Object.entries(entries)) {
    const key = normalizeLine(english).toLowerCase();
    if (!index.has(key)) {
      index.set(key, entry);
    }
  }
  return index;
}

// Resolve a page string to a dictionary entry, case-insensitively.
function resolveEntry(text: string): DictionaryEntry | undefined {
  return dictionary[text] || lowerIndex.get(normalizeLine(text).toLowerCase());
}

// A standalone text node whose whole (trimmed) value is a dictionary term — e.g.
// the bare "Requires: " label text node in an item's requirement line, which is
// not its own element so the element pass can't catch it.
function exactNodeEntry(value: string): LineHit | null {
  const t = normalizeLine(value);
  if (t.length < 2 || t.length > 80) return null;
  const entry = resolveEntry(t);
  return entry ? { english: t, entry } : null;
}

function isInlineTerm(english: string, entry: DictionaryEntry) {
  if (!INLINE_TYPES.has(entry.type || "") || english.length > INLINE_MAX_LEN) {
    return false;
  }
  // Only inline-match *distinctive* names. Short single common words like
  // "Shield", "Bow", "Ring", "Belt" would sprinkle into unrelated text
  // ("Energy Shield" -> "Energy Shield盾牌"); require multi-word or length >= 8.
  // Such short names still translate when they stand alone (whole-element match).
  return /\s/.test(english) || english.length >= 8;
}

// Build the number-templated stat index: "30% increased X" and "12% increased X"
// both collapse to the template "§% increased X", so any roll on the page can be
// matched and the page's actual number reinserted into the translation.
function buildTemplateIndex(entries: Dictionary): Map<string, TemplateEntry> {
  const index = new Map<string, TemplateEntry>();
  for (const [english, entry] of Object.entries(entries)) {
    if (!STAT_TYPES.has(entry.type || "")) {
      continue;
    }
    const en = toTemplate(normalizeLine(english));
    const tr = toTemplate(normalizeLine(entry.translation));
    // Only usable if both sides have the same (>=1) number count, so reinsertion
    // is unambiguous.
    if (en.numbers.length === 0 || en.numbers.length !== tr.numbers.length) {
      continue;
    }
    const key = en.template.toLowerCase();
    if (!index.has(key)) {
      index.set(key, {
        transTpl: tr.template,
        type: entry.type,
        slug: entry.slug,
        source: entry.source,
      });
    }
  }
  return index;
}




// Match a whole line (an element's combined text or a standalone node) against
// the dictionary: exact first, then number-templated. Returns a synthetic entry
// whose translation has the page's real numbers filled in.
function lookupLine(text: string, allowPrefix = true): LineHit | null {
  const norm = normalizeLine(text);
  if (norm.length < 2 || norm.length > 600 || !/[A-Za-z]/.test(norm)) {
    return null;
  }

  const exact = resolveEntry(norm);
  if (exact) {
    return { english: norm, entry: exact };
  }
  // Plural toggle: the game shows a singular noun when a value is 1
  // ("+1 Charm Slot") while PoE2DB stores the plural ("+1 Charm Slots").
  if (!norm.endsWith("s")) {
    const plural = resolveEntry(norm + "s");
    if (plural) {
      return { english: norm, entry: plural };
    }
  }

  const { template, numbers } = toTemplate(norm);
  if (numbers.length > 0) {
    const tpl = templateIndex.get(template.toLowerCase());
    if (tpl) {
      return {
        english: norm,
        entry: {
          translation: fillTemplate(tpl.transTpl, numbers),
          type: tpl.type,
          slug: tpl.slug,
          source: tpl.source,
          confidence: 1,
        },
      };
    }
  }

  // Prefix fallback: socketed-rune / qualifier mods render as "Bonded: <stat>",
  // "Implicit: <stat>", etc. The qualifier breaks the whole-line match, so strip
  // a short leading "Word(s): " prefix and translate the remainder, keeping the
  // prefix text. Only one level deep to avoid recursion.
  if (allowPrefix) {
    const m = norm.match(/^([A-Za-z][A-Za-z ]{0,24}):\s+(.+)$/);
    if (m) {
      const rest = lookupLine(m[2], false);
      if (rest) {
        const pfx = resolveEntry(m[1]);
        const prefix = pfx ? pfx.translation : m[1];
        return {
          english: norm,
          entry: {
            translation: `${prefix}: ${rest.entry.translation}`,
            type: "composed",
            source: rest.entry.source,
            confidence: 1,
          },
        };
      }
    }
  }

  return null;
}

// Decompose a SHORT label entirely into a sequence of dictionary terms, e.g.
// "Rare Helmet" -> 稀有 + 头盔 = "稀有头盔". Returns the joined translation only if
// EVERY word is covered (so the result is never half-English — no sprinkle).
// Used for poe.ninja's rarity+slot item labels which PoE2DB only has as separate
// words, never as the combined phrase.
const DECOMPOSE_MAX_WORDS = 5;
const DECOMPOSE_TERM_WORDS = 6;

function decomposeLine(text: string): string | null {
  const norm = normalizeLine(text);
  const words = norm.split(" ").filter(Boolean);
  if (words.length < 2 || words.length > DECOMPOSE_MAX_WORDS) {
    return null;
  }
  const parts: string[] = [];
  let i = 0;
  while (i < words.length) {
    let matched = false;
    for (let j = Math.min(words.length, i + DECOMPOSE_TERM_WORDS); j > i; j--) {
      const candidate = words.slice(i, j).join(" ");
      const entry = resolveEntry(candidate);
      if (entry) {
        parts.push(entry.translation);
        i = j;
        matched = true;
        break;
      }
    }
    if (!matched) {
      return null; // a word isn't a known term -> abort (leave English)
    }
  }
  return parts.join("");
}

// Rare item names are generated as "<prefix> <suffix>" ("Empyrean Call"). The
// official zh-TW fragments come from the client Words table (zh-TW ONLY — the
// global client has no Simplified). Translate ONLY when the name is pure letters
// (no digits/%) AND BOTH halves are known fragments, so normal text is untouched.
let rareNameParts: { prefixes: Record<string, string>; suffixes: Record<string, string> } | null =
  null;

function decomposeRareName(text: string): string | null {
  if (!rareNameParts) return null;
  const norm = normalizeLine(text);
  // names are 2-4 short words, letters/apostrophe/space only (excludes stats)
  if (norm.length > 40 || !/^[A-Za-z'’]+(?: [A-Za-z'’]+){1,3}$/.test(norm)) {
    return null;
  }
  const sp = norm.indexOf(" ");
  const prefix = norm.slice(0, sp);
  const suffix = norm.slice(sp); // keeps the leading space, e.g. " Call"
  const p = rareNameParts.prefixes[prefix];
  const s = rareNameParts.suffixes[suffix];
  if (!p || !s) return null;
  return p + s.trim();
}

async function loadRareNameParts(language: Language): Promise<void> {
  // zh-TW only — no Simplified source exists.
  if (language !== "zh-TW") {
    rareNameParts = null;
    return;
  }
  try {
    const res = await fetch(chrome.runtime.getURL("data/rare-name-parts.json"));
    rareNameParts = res.ok ? await res.json() : null;
  } catch {
    rareNameParts = null;
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function injectToolbar() {
  if (document.querySelector(".poe-cn-toolbar")) {
    return;
  }

  const toolbar = document.createElement("div");
  toolbar.className = "poe-cn-toolbar";
  toolbar.setAttribute("data-poe-cn-ui", "true");

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.textContent = settings.enabled ? "ON" : "OFF";
  toggle.setAttribute("aria-label", "Toggle Chinese term annotations");
  toggle.setAttribute("aria-pressed", String(settings.enabled));

  const language = document.createElement("select");
  language.setAttribute("aria-label", "Chinese language");
  language.innerHTML = `
    <option value="zh-CN">简体</option>
    <option value="zh-TW">繁體</option>
  `;
  language.value = settings.language;
  const displayMode = document.createElement("select");
  displayMode.setAttribute("aria-label", "Display mode");
  displayMode.innerHTML = `
    <option value="both">英+中</option>
    <option value="translation">中文</option>
    <option value="tooltip">Tooltip</option>
  `;
  displayMode.value = settings.displayMode;
  toolbarToggle = toggle;
  toolbarLanguage = language;
  toolbarDisplayMode = displayMode;

  toggle.addEventListener("click", async () => {
    const nextSettings = await saveSettings({ enabled: !settings.enabled });
    await applySettings(nextSettings);
  });

  language.addEventListener("change", async () => {
    const nextSettings = await saveSettings({ language: language.value as Language });
    await applySettings(nextSettings);
  });

  displayMode.addEventListener("change", async () => {
    const nextSettings = await saveSettings({
      displayMode: displayMode.value as Settings["displayMode"],
    });
    await applySettings(nextSettings);
  });

  const searchButton = document.createElement("button");
  searchButton.type = "button";
  searchButton.textContent = "查词条";
  searchButton.setAttribute("aria-label", "Bilingual stat search");
  searchButton.addEventListener("click", () => toggleStatSearch());

  toolbar.append(toggle, language, displayMode, searchButton);
  document.documentElement.append(toolbar);
}

// ---- Bilingual stat search ----
// The official trade stat dropdown searches English only and re-renders on every
// keystroke (so translating it in place is fragile). Instead: type 中文 or
// English here, find the stat, and copy the English (template form) to paste
// into the trade search. Robust — no React/CSP hooking.
type SearchRow = { en: string; zh: string; enLow: string; zhLow: string; id?: string; group?: string };
let searchIndex: SearchRow[] | null = null;
// Authoritative list from the official trade stat API (id + English text),
// mapped to Chinese via our dictionary. Only available on pathofexile.com.
let officialStats: SearchRow[] | null = null;
let statSearchEl: HTMLElement | null = null;

// On the official trade site, fetch GGG's own stat list so the search is
// authoritative: exact English text the trade search expects, plus the stat id.
async function loadOfficialStats(): Promise<void> {
  if (!/(^|\.)pathofexile\.com$/.test(location.host)) return;
  const realm = /trade2/.test(location.pathname) ? "trade2" : "trade";
  try {
    const res = await fetch(`/api/${realm}/data/stats`, {
      headers: { accept: "application/json" },
      credentials: "same-origin",
    });
    if (!res.ok) return;
    const data = await res.json();
    const seen = new Set<string>();
    const rows: SearchRow[] = [];
    for (const group of data.result || []) {
      for (const e of group.entries || []) {
        if (!e.id || !e.text || seen.has(e.id)) continue;
        seen.add(e.id);
        const zh = lookupLine(e.text)?.entry.translation || "";
        rows.push({
          id: e.id,
          en: e.text,
          zh,
          group: group.label || "",
          enLow: e.text.toLowerCase(),
          zhLow: zh.toLowerCase(),
        });
      }
    }
    officialStats = rows;
  } catch {
    officialStats = null;
  }
}

function buildSearchIndex(): SearchRow[] {
  const seen = new Set<string>();
  const rows: SearchRow[] = [];
  for (const [english, entry] of Object.entries(dictionary)) {
    const en = toTemplate(normalizeLine(english)).template.split(PLACEHOLDER).join("#");
    if (seen.has(en.toLowerCase())) continue;
    seen.add(en.toLowerCase());
    const zh = toTemplate(normalizeLine(entry.translation)).template.split(PLACEHOLDER).join("#");
    rows.push({ en, zh, enLow: en.toLowerCase(), zhLow: zh.toLowerCase() });
  }
  return rows;
}

function toggleStatSearch() {
  if (statSearchEl) {
    statSearchEl.remove();
    statSearchEl = null;
    return;
  }
  // Prefer the authoritative official stat list (id + exact trade text); fall
  // back to the dictionary-derived index off-site or until the API loads.
  if (!officialStats && !searchIndex) searchIndex = buildSearchIndex();

  const panel = document.createElement("div");
  panel.setAttribute("data-poe-cn-ui", "true");
  panel.style.cssText =
    "position:fixed;right:16px;bottom:56px;z-index:2147483647;width:420px;max-width:92vw;max-height:60vh;display:flex;flex-direction:column;background:rgba(20,18,14,.97);border:1px solid rgba(240,198,116,.5);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.45);color:#f5ead2;font:13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:10px";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "输入中文或英文词条… / type 中文 or English";
  input.style.cssText =
    "width:100%;box-sizing:border-box;padding:7px 9px;border:1px solid rgba(245,234,210,.3);border-radius:6px;background:rgba(255,255,255,.08);color:#f5ead2;font:inherit;margin-bottom:8px";

  const results = document.createElement("div");
  results.style.cssText = "overflow:auto;display:flex;flex-direction:column;gap:4px";

  const render = (q: string) => {
    results.textContent = "";
    const query = q.trim().toLowerCase();
    if (query.length < 1) return;
    const index = officialStats || searchIndex || [];
    const hits = index
      .filter((r) => r.enLow.includes(query) || (r.zhLow && r.zhLow.includes(query)))
      .sort((a, b) => a.en.length - b.en.length)
      .slice(0, 25);
    for (const r of hits) {
      const row = document.createElement("button");
      row.type = "button";
      row.title = "点击复制英文 / click to copy English";
      row.style.cssText =
        "text-align:left;border:1px solid rgba(245,234,210,.15);border-radius:6px;background:rgba(255,255,255,.04);color:inherit;font:inherit;padding:6px 8px;cursor:pointer";
      const zh = document.createElement("div");
      zh.textContent = r.zh || (r.group ? `[${r.group}]` : "");
      zh.style.cssText = "color:#f0c674;font-weight:600";
      const en = document.createElement("div");
      en.textContent = r.en;
      en.style.cssText = "color:#cfc6b4;font-size:.92em;font-family:ui-monospace,Menlo,monospace";
      row.append(zh, en);
      row.addEventListener("click", () => {
        navigator.clipboard?.writeText(r.en).then(() => {
          const orig = zh.textContent;
          zh.textContent = "✓ 已复制英文，可粘贴到搜索框";
          window.setTimeout(() => (zh.textContent = orig), 1200);
        });
      });
      results.append(row);
    }
    if (!hits.length) {
      const none = document.createElement("div");
      none.textContent = "无匹配 / no match";
      none.style.cssText = "color:#9a9a9a;padding:4px";
      results.append(none);
    }
  };
  input.addEventListener("input", () => render(input.value));

  panel.append(input, results);
  document.documentElement.append(panel);
  statSearchEl = panel;
  input.focus();
}

async function handleSettingsChange(
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string,
) {
  if (areaName !== "sync" || !changes[STATE_KEY]?.newValue) {
    return;
  }

  const nextSettings = {
    ...DEFAULT_SETTINGS,
    ...changes[STATE_KEY].newValue,
  } as Settings;
  await applySettings(nextSettings);
}

async function applySettings(nextSettings: Settings) {
  const languageChanged = nextSettings.language !== settings.language;
  const enabledChanged = nextSettings.enabled !== settings.enabled;
  const displayModeChanged = nextSettings.displayMode !== settings.displayMode;
  settings = nextSettings;
  syncToolbar();

  if (languageChanged) {
    dictionary = await loadDictionary(settings.language);
    matcher = buildMatcher(dictionary);
    templateIndex = buildTemplateIndex(dictionary);
    lowerIndex = buildLowerIndex(dictionary);
    await loadRareNameParts(settings.language);
    searchIndex = null; // rebuilt lazily for the new language
    officialStats = null;
    loadOfficialStats(); // re-map official stats to the new language
  }

  if (languageChanged || enabledChanged || displayModeChanged) {
    clearAnnotations();
  }

  if (settings.enabled) {
    annotateDocument();
    startObserver();
  } else {
    stopObserver();
  }
}

function syncToolbar() {
  if (toolbarToggle) {
    toolbarToggle.textContent = settings.enabled ? "ON" : "OFF";
    toolbarToggle.setAttribute("aria-pressed", String(settings.enabled));
  }

  if (toolbarLanguage) {
    toolbarLanguage.value = settings.language;
  }

  if (toolbarDisplayMode) {
    toolbarDisplayMode.value = settings.displayMode;
  }
}

function startObserver() {
  if (observer) {
    return;
  }

  observer = new MutationObserver(() => {
    window.clearTimeout(renderTimer);
    renderTimer = window.setTimeout(() => {
      if (settings.enabled) {
        annotateDocument();
      }
    }, 200);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

function stopObserver() {
  if (!observer) {
    return;
  }
  observer.disconnect();
  observer = null;
}

function annotateDocument() {
  if (!document.body) {
    return;
  }
  // Pass 1: whole-line matches (exact or number-templated). Reconstructs stat
  // sentences that the page splits across keyword/value <span>s, so they are
  // translated in full instead of word-by-word.
  annotateElementLines();
  // Pass 2: entity names embedded inside larger untranslated text.
  annotateInlineNames();
  // Pass 3: input placeholders ("min"/"max") — an attribute, not a text node.
  translatePlaceholders();
}

// Translate input placeholders (e.g. the trade site's "min"/"max" boxes), which
// are attributes rather than text nodes. Only entries explicitly marked as
// site_ui_placeholder are touched, and the original is kept for restore.
function translatePlaceholders() {
  const inputs = document.querySelectorAll<HTMLInputElement>("input[placeholder]");
  for (const input of inputs) {
    if (input.dataset.poeCnPh !== undefined) continue;
    const ph = (input.placeholder || "").trim();
    if (!ph) continue;
    const entry = resolveEntry(ph);
    if (entry && entry.type === "site_ui_placeholder") {
      input.dataset.poeCnPh = input.placeholder;
      input.placeholder = entry.translation;
    }
  }
}

// Match an element's *combined* text against the dictionary and, on a hit,
// replace the whole element's content with one translated term. This is what
// makes fragmented stat lines (keywords rendered as separate links/spans)
// translate fully rather than half.
function annotateElementLines() {
  const elements = document.body.querySelectorAll<HTMLElement>("*");
  for (const el of elements) {
    if (!el.isConnected || el.dataset.poeCnLine || shouldSkipElement(el)) {
      continue;
    }
    // Skip large containers (whole cards/lists) cheaply before reading text.
    if (el.childElementCount > 15) {
      continue;
    }
    if (el.querySelector(".poe-cn-term, [data-poe-cn-line]")) {
      continue; // a descendant already matched a line
    }
    // NEVER replace an element that contains media — that would delete gem icons,
    // item art, etc. The inner text-only element (a sibling of the icon) still
    // gets matched on its own, so the label still translates.
    if (el.querySelector(MEDIA_SELECTOR)) {
      continue;
    }
    const raw = el.textContent || "";
    if (!raw.trim() || raw.length > 640) {
      continue;
    }
    let hit = lookupLine(raw);
    if (!hit) {
      // Fallback: short label fully composed of dict terms ("Rare Helmet").
      const composed = decomposeLine(raw);
      if (composed) {
        hit = {
          english: normalizeLine(raw),
          entry: { translation: composed, type: "composed", source: "poe2db", confidence: 1 },
        };
      }
    }
    if (!hit) {
      // Fallback: procedurally-generated rare item name ("Empyrean Call").
      const rare = decomposeRareName(raw);
      if (rare) {
        hit = {
          english: normalizeLine(raw),
          entry: { translation: rare, type: "rare_name", source: "client", confidence: 1 },
        };
      }
    }
    if (!hit) {
      continue;
    }
    // Anti-sprinkle: a keyword sitting inside an inline tag that is only part of
    // a longer sentence must not be translated alone (e.g. a <a>Surpassing</a>
    // link inside an English description). Such fragments stay English.
    if (hit.entry.type === "keyword" && INLINE_TAGS.has(el.tagName)) {
      const parentText = el.parentElement
        ? normalizeLine(el.parentElement.textContent || "")
        : hit.english;
      if (parentText.length > normalizeLine(hit.english).length + 6) {
        continue;
      }
    }
    // Detach (don't discard) the original children so toggling off restores the
    // exact markup — links, value spans and all — without touching innerHTML.
    const original = Array.from(el.childNodes);
    lineReplacements.push({ el, nodes: original });
    el.dataset.poeCnLine = "1";
    el.replaceChildren(createTermElement(hit.english, hit.entry));
  }
}

function annotateInlineNames() {
  if (!matcher) {
    return;
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const value = node.nodeValue;
      if (!value || !value.trim()) {
        return NodeFilter.FILTER_REJECT;
      }
      const parent = node.parentElement;
      if (!parent || shouldSkipElement(parent)) {
        return NodeFilter.FILTER_REJECT;
      }
      if (value.length > 1000) {
        return NodeFilter.FILTER_REJECT;
      }
      if (exactNodeEntry(value)) {
        return NodeFilter.FILTER_ACCEPT;
      }
      matcher!.lastIndex = 0;
      return matcher!.test(value)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });

  const nodes: Text[] = [];
  while (walker.nextNode()) {
    nodes.push(walker.currentNode as Text);
  }

  for (const node of nodes) {
    annotateTextNode(node);
  }
}

function shouldSkipElement(element: Element) {
  if (SKIP_TAGS.has(element.tagName)) {
    return true;
  }
  return Boolean(element.closest("[data-poe-cn-ui], .poe-cn-term, [data-poe-cn-line]"));
}

function annotateTextNode(node: Text) {
  if (!matcher) {
    return;
  }

  const text = node.nodeValue || "";

  // Exact whole-node label (e.g. a bare "Requires: " text node): replace the
  // node, preserving surrounding whitespace.
  const exactHit = exactNodeEntry(text);
  if (exactHit) {
    const lead = text.length - text.trimStart().length;
    const trail = text.length - text.trimEnd().length;
    const frag = document.createDocumentFragment();
    if (lead) frag.append(document.createTextNode(text.slice(0, lead)));
    frag.append(createTermElement(exactHit.english, exactHit.entry));
    if (trail) frag.append(document.createTextNode(text.slice(text.length - trail)));
    node.replaceWith(frag);
    return;
  }

  const fragment = document.createDocumentFragment();
  let lastIndex = 0;
  let matched = false;

  matcher.lastIndex = 0;
  for (const match of text.matchAll(matcher)) {
    const prefix = match[1] || "";
    const english = match[2];
    const termStart = (match.index || 0) + prefix.length;
    const termEnd = termStart + english.length;
    const entry = resolveEntry(english);

    if (!entry) {
      continue;
    }

    if (termStart > lastIndex) {
      fragment.append(document.createTextNode(text.slice(lastIndex, termStart)));
    }

    fragment.append(createTermElement(english, entry));
    lastIndex = termEnd;
    matched = true;
  }

  if (!matched) {
    return;
  }

  if (lastIndex < text.length) {
    fragment.append(document.createTextNode(text.slice(lastIndex)));
  }

  node.replaceWith(fragment);
}

function createTermElement(english: string, entry: DictionaryEntry) {
  const wrapper = document.createElement("span");
  wrapper.className = "poe-cn-term";
  wrapper.dataset.poeCnOriginal = english;
  wrapper.dataset.poeCnTranslation = entry.translation;

  const translated = entry.translation;
  const source = entry.sourceUrl
    ? `Source: ${entry.sourceUrl}`
    : `Source: ${entry.source}`;
  wrapper.title = `${english} -> ${translated}\n${entry.type || "term"}\n${source}`;

  if (entry.slug) {
    const locale = settings.language === "zh-TW" ? "tw" : "cn";
    wrapper.dataset.poeCnHref = `https://poe2db.tw/${locale}/${entry.slug}`;
  }

  if (settings.displayMode === "translation") {
    wrapper.classList.add("poe-cn-term--translation-only");
    wrapper.textContent = translated;
  } else if (settings.displayMode === "tooltip") {
    wrapper.classList.add("poe-cn-term--tooltip-only");
    wrapper.textContent = english;
  } else {
    wrapper.append(document.createTextNode(english));

    const note = document.createElement("span");
    note.className = "poe-cn-term__translation";
    note.textContent = translated;
    wrapper.append(note);
  }

  return wrapper;
}

function clearAnnotations() {
  // Restore whole-line element replacements first by re-attaching their original
  // child nodes (avoids innerHTML round-tripping).
  for (const { el, nodes } of lineReplacements) {
    if (el.isConnected) {
      el.replaceChildren(...nodes);
      delete el.dataset.poeCnLine;
    }
  }
  lineReplacements = [];

  const terms = [...document.querySelectorAll<HTMLElement>(".poe-cn-term")];
  for (const term of terms) {
    term.replaceWith(
      document.createTextNode(term.dataset.poeCnOriginal || term.textContent || ""),
    );
  }
  // Restore translated input placeholders.
  for (const input of document.querySelectorAll<HTMLInputElement>("input[data-poe-cn-ph]")) {
    input.placeholder = input.dataset.poeCnPh || input.placeholder;
    delete input.dataset.poeCnPh;
  }
  document.body?.normalize();
}

function handleTermClick(event: MouseEvent) {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }

  const term = target.closest<HTMLElement>(".poe-cn-term[data-poe-cn-href]");
  if (!term) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  window.open(term.dataset.poeCnHref, "_blank", "noopener");
}
