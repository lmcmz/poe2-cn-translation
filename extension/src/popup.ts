import "./popup.css";
import { normalizeLine, toTemplate, PLACEHOLDER } from "./stat-template";
import { loadSettings, saveSettings, type DisplayMode, type Language } from "./settings";

type DictionaryMeta = {
  generatedAt: string;
  sourceCount: number;
  outputs: Array<{ language: Language; count: number }>;
};

const enabledInput = requiredElement<HTMLInputElement>("#enabled");
const languageSelect = requiredElement<HTMLSelectElement>("#language");
const displayModeSelect = requiredElement<HTMLSelectElement>("#display-mode");
const dictionaryCount = requiredElement<HTMLElement>("#dictionary-count");
const dictionaryDate = requiredElement<HTMLElement>("#dictionary-date");
const termSearchInput = requiredElement<HTMLInputElement>("#term-search");
const termResults = requiredElement<HTMLElement>("#term-results");

// Tri-lingual term search: type English / 简体 / 繁体 — any of the three — and
// see the matching term in all three languages. Built by joining the zh-CN and
// zh-TW dictionaries on their shared English key. Click any line to copy it.
type SearchRow = {
  en: string; cn: string; tw: string;
  enLow: string; cnLow: string; twLow: string;
};
let searchRows: SearchRow[] = [];
let searchLoaded = false;

const tmpl = (s: string) =>
  s ? toTemplate(normalizeLine(s)).template.split(PLACEHOLDER).join("#") : "";

async function loadSearchRows() {
  if (searchLoaded) return;
  const get = (lang: Language) =>
    fetch(chrome.runtime.getURL(`data/dictionary.${lang}.json`))
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}));
  const [cnDict, twDict] = (await Promise.all([get("zh-CN"), get("zh-TW")])) as Record<
    string,
    { translation: string }
  >[];
  const keys = new Set([...Object.keys(cnDict), ...Object.keys(twDict)]);
  const seen = new Set<string>();
  const rows: SearchRow[] = [];
  for (const english of keys) {
    const en = tmpl(english);
    if (seen.has(en.toLowerCase())) continue;
    seen.add(en.toLowerCase());
    const cn = tmpl(cnDict[english]?.translation || "");
    const tw = tmpl(twDict[english]?.translation || "");
    rows.push({
      en, cn, tw,
      enLow: en.toLowerCase(), cnLow: cn.toLowerCase(), twLow: tw.toLowerCase(),
    });
  }
  searchRows = rows;
  searchLoaded = true;
}

function copyLine(el: HTMLElement, text: string) {
  if (!text) return;
  navigator.clipboard?.writeText(text).then(() => {
    const orig = el.textContent;
    el.textContent = "✓ 已复制";
    window.setTimeout(() => (el.textContent = orig), 1000);
  });
}

function renderResults(query: string) {
  termResults.textContent = "";
  const q = query.trim().toLowerCase();
  if (!q) return;
  const hits = searchRows
    .filter((r) => r.enLow.includes(q) || r.cnLow.includes(q) || r.twLow.includes(q))
    .sort((a, b) => a.en.length - b.en.length)
    .slice(0, 40);
  for (const r of hits) {
    const row = document.createElement("div");
    row.className = "term-row";
    for (const [label, text, cls] of [
      ["简", r.cn, "term-cn"],
      ["繁", r.tw, "term-tw"],
      ["EN", r.en, "term-en"],
    ] as const) {
      if (!text) continue;
      const line = document.createElement("button");
      line.type = "button";
      line.className = `term-line ${cls}`;
      line.title = "点击复制";
      const tag = document.createElement("span");
      tag.className = "term-tag";
      tag.textContent = label;
      const val = document.createElement("span");
      val.textContent = text;
      line.append(tag, val);
      line.addEventListener("click", () => copyLine(val, text));
      row.append(line);
    }
    termResults.append(row);
  }
  if (!hits.length) {
    const none = document.createElement("div");
    none.className = "term-none";
    none.textContent = "无匹配词条";
    termResults.append(none);
  }
}

initPopup().catch((error) => {
  console.error("[PoE2 CN] Failed to initialize popup", error);
});

async function initPopup() {
  const settings = await loadSettings();
  enabledInput.checked = settings.enabled;
  languageSelect.value = settings.language;
  displayModeSelect.value = settings.displayMode;
  await renderMeta(settings.language);

  termSearchInput.addEventListener("focus", () => void loadSearchRows(), { once: true });
  termSearchInput.addEventListener("input", async () => {
    await loadSearchRows();
    renderResults(termSearchInput.value);
  });

  enabledInput.addEventListener("change", async () => {
    await saveSettings({ enabled: enabledInput.checked });
  });

  languageSelect.addEventListener("change", async () => {
    const language = languageSelect.value as Language;
    await saveSettings({ language });
    await renderMeta(language);
  });

  displayModeSelect.addEventListener("change", async () => {
    await saveSettings({ displayMode: displayModeSelect.value as DisplayMode });
  });

  chrome.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName !== "sync" || !changes[STATE_KEY]?.newValue) return;
    const next = changes[STATE_KEY].newValue;
    enabledInput.checked = next.enabled;
    languageSelect.value = next.language;
    displayModeSelect.value = next.displayMode;
    await renderMeta(next.language);
  });
}

async function renderMeta(language: Language) {
  const response = await fetch(chrome.runtime.getURL("data/dictionary.meta.json"));
  if (!response.ok) throw new Error(`Dictionary metadata request failed: ${response.status}`);
  const meta = (await response.json()) as DictionaryMeta;
  const output = meta.outputs.find((item) => item.language === language);
  dictionaryCount.textContent = `${output?.count ?? 0} 条`;
  dictionaryDate.textContent = formatDate(meta.generatedAt);
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知";
  return date.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });
}

function requiredElement<T extends Element>(selector: string) {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Popup markup is missing ${selector}`);
  return element;
}

const STATE_KEY = "poeCnHelperSettings";
