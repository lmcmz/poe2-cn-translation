// Shared stat-line templating utilities.
//
// Extracted verbatim from content.ts so the translation layer and the
// price-check item parser share ONE implementation of "turn a rolled stat line
// into a number-agnostic template + the extracted numbers". Behavior must stay
// identical to the original inline definitions in content.ts.

// A char that never appears in game text, used to mark where a number was
// (SOH, U+0001). Must match content.ts's original PLACEHOLDER exactly.
export const PLACEHOLDER = "\u0001";

// Matches numeric tokens in a stat line so one template ("30% ...") can cover
// every roll ("12% ...", "(20 — 30)% ..."). A roll range "(20 — 30)" counts as
// ONE slot (not two) so a range template also matches a single rolled value.
// The trailing "[+\-]?#" also treats the official trade site's "#" placeholder
// ("#% increased Physical Damage", "+# to maximum Life") as a single slot, so
// those filter rows match the same templates and translate.
export const RANGE_OR_NUMBER_RE =
  /\(\s*[+\-]?\d+(?:\.\d+)?\s*[—–\-]\s*[+\-]?\d+(?:\.\d+)?\s*\)|[+\-]?\d+(?:\.\d+)?|[+\-]?#/g;

// Collapse whitespace and drop the space PoE2DB writes before "%" ("30 %",
// "(1 — 111) %") so it matches the item's "30%"/"111%".
export function normalizeLine(text: string): string {
  return text.replace(/\s+/g, " ").replace(/\s+%/g, "%").trim();
}

export function toTemplate(text: string): { template: string; numbers: string[] } {
  const numbers: string[] = [];
  const template = text.replace(RANGE_OR_NUMBER_RE, (match) => {
    numbers.push(match);
    return PLACEHOLDER;
  });
  return { template, numbers };
}

export function fillTemplate(template: string, numbers: string[]): string {
  let i = 0;
  return template.replace(new RegExp(PLACEHOLDER, "g"), () =>
    i < numbers.length ? numbers[i++] : PLACEHOLDER,
  );
}

// Canonical key for matching a mod line to a trade stat. Removes everything that
// varies between a rolled line and a stat *pattern* — digits, +/- signs, the
// game's "#" placeholder, our PLACEHOLDER, brackets — while keeping "%" (which
// distinguishes flat vs increased mods). The item parser and the backend
// stat-map builder MUST use this identical transform so their keys line up:
//
//   "+85 to maximum Life"            -> "to maximum life"
//   "+#% to Fire Resistance" (EE2)   -> "% to fire resistance"
//   "+40% to Fire Resistance" (item) -> "% to fire resistance"   (matches)
//   "Adds 15 to 25 Cold Damage"      -> "adds to cold damage"
export function statKeyOf(text: string): string {
  return text
    .replace(/#/g, "")
    .replace(/[0-9]/g, "")
    .replace(/[+\-]/g, "")
    .replace(/[()]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
