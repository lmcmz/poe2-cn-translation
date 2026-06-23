#!/usr/bin/env node
// Post-build step: ship a SELF-CONTAINED content script for the official
// pathofexile.com/trade2 site.
//
// Why: pathofexile.com uses a strict Content-Security-Policy. Content scripts
// and their fetch() of extension resources DO run under page CSP, but CRXJS's
// content-script loader uses a dynamic import() of a web-accessible module,
// which page CSP *does* block. So for the official site we bundle content.ts
// into a single IIFE (no dynamic import) with esbuild and register it directly.
//
// Runs after `vite build`. Patches dist/manifest.json additively; the
// poe.ninja / poe2.ninja / pobb.in entry (CRXJS loader) is left untouched.

import { build } from "esbuild";
import { readFile, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const JS_OUT = "poe-trade-content.js";
const CSS_OUT = "poe-trade-content.css";
// Sites with a strict CSP that blocks CRXJS's dynamic-import loader, so they get
// this self-contained IIFE bundle instead. content_scripts matches may be
// path-specific; web_accessible_resources matches must be host-level ("/*").
const STRICT_SITES = [
  { match: "https://www.pathofexile.com/trade2/*", war: "https://www.pathofexile.com/*", host: "https://www.pathofexile.com/*" },
  { match: "https://mobalytics.gg/poe-2/*", war: "https://mobalytics.gg/*", host: "https://mobalytics.gg/poe-2/*" },
];

async function main() {
  // 1. Bundle content.ts -> single IIFE (no dynamic import). CSS is injected via
  //    the manifest css array instead (also CSP-immune), so drop the css import.
  await build({
    entryPoints: [path.join(ROOT, "src", "content.ts")],
    bundle: true,
    format: "iife",
    target: "chrome111",
    legalComments: "none",
    loader: { ".css": "empty" },
    outfile: path.join(DIST, JS_OUT),
  });
  await copyFile(path.join(ROOT, "src", "content.css"), path.join(DIST, CSS_OUT));

  // 2. Patch the built manifest additively.
  const manifestPath = path.join(DIST, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  manifest.content_scripts = manifest.content_scripts || [];
  const matches = STRICT_SITES.map((s) => s.match);
  if (!manifest.content_scripts.some((cs) => (cs.js || []).includes(JS_OUT))) {
    manifest.content_scripts.push({
      matches,
      js: [JS_OUT],
      css: [CSS_OUT],
      run_at: "document_idle",
    });
  }

  // Ensure the dictionaries are web-accessible + hosts permitted on each site.
  for (const { war, host } of STRICT_SITES) {
    for (const w of manifest.web_accessible_resources || []) {
      if ((w.resources || []).some((r) => r.startsWith("data/")) && !w.matches.includes(war)) {
        w.matches.push(war);
      }
    }
    if (!(manifest.host_permissions || []).includes(host)) {
      manifest.host_permissions = [...(manifest.host_permissions || []), host];
    }
  }

  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log(`Built ${JS_OUT} + ${CSS_OUT} and registered content script for ${matches.join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
