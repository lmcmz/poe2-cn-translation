export type Language = "zh-CN" | "zh-TW";
export type DisplayMode = "both" | "translation" | "tooltip";

export type Settings = {
  enabled: boolean;
  language: Language;
  displayMode: DisplayMode;
};

export const STATE_KEY = "poeCnHelperSettings";

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  language: "zh-CN",
  displayMode: "both",
};

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.sync.get(STATE_KEY);
  return { ...DEFAULT_SETTINGS, ...(stored[STATE_KEY] || {}) };
}

export async function saveSettings(nextSettings: Partial<Settings>) {
  const current = await loadSettings();
  const next = { ...current, ...nextSettings };
  await chrome.storage.sync.set({ [STATE_KEY]: next });
  return next;
}
