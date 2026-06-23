import type { ManifestV3Export } from "@crxjs/vite-plugin";

const manifest: ManifestV3Export = {
  manifest_version: 3,
  name: "PoE2 中文翻译",
  description:
    "为 poe.ninja、Maxroll、FilterBlade、Mobalytics 与官方交易站添加简体/繁体中文翻译，词条 1:1 来自 PoE2DB 与官方游戏数据。",
  version: "0.3.0",
  permissions: ["storage"],
  host_permissions: [
    "https://poe.ninja/*",
    "https://poe2.ninja/*",
    "https://pobb.in/*",
    // Official trade2 — translate the site + read the public stat list.
    "https://www.pathofexile.com/*",
    // Additional PoE2 data sites (scoped to their PoE2 sections where possible).
    "https://maxroll.gg/poe2/*",
    "https://www.filterblade.xyz/*",
    "https://filterblade.xyz/*",
    // mobalytics.gg uses a strict CSP — its content script + host access are
    // registered by scripts/build-trade-content.mjs (self-contained IIFE).
  ],
  icons: {
    "16": "icons/icon-16.png",
    "32": "icons/icon-32.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png",
  },
  action: {
    default_title: "PoE2 中文翻译",
    default_popup: "src/popup.html",
    default_icon: {
      "16": "icons/icon-16.png",
      "32": "icons/icon-32.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png",
    },
  },
  content_scripts: [
    {
      // CRXJS loader (dynamic import) — fine on these non-strict-CSP sites.
      // pathofexile.com uses a strict CSP that blocks the dynamic import, so it
      // is handled by a separate self-contained bundle injected via
      // scripts/build-trade-content.mjs (post-build).
      matches: [
        "https://poe.ninja/*",
        "https://poe2.ninja/*",
        "https://pobb.in/*",
        "https://maxroll.gg/poe2/*",
        "https://www.filterblade.xyz/*",
        "https://filterblade.xyz/*",
      ],
      js: ["src/content.ts"],
      run_at: "document_idle",
    },
  ],
  web_accessible_resources: [
    {
      resources: [
        "data/dictionary.zh-CN.json",
        "data/dictionary.zh-TW.json",
        "data/dictionary.meta.json",
        "data/rare-name-parts.json",
      ],
      matches: [
        "https://poe.ninja/*",
        "https://poe2.ninja/*",
        "https://pobb.in/*",
        // NOTE: web_accessible_resources match patterns must use a "/*" path
        // (host-level). pathofexile.com + mobalytics.gg are added by
        // build-trade-content.mjs — a path like /trade2/* is rejected here.
        "https://maxroll.gg/*",
        "https://www.filterblade.xyz/*",
        "https://filterblade.xyz/*",
      ],
    },
  ],
};

export default manifest;
