/**
 * Shared html2canvas color sanitizer for PDF capture.
 *
 * Tailwind CSS v4 emits modern CSS color functions that html2canvas 1.4.1
 * cannot parse — `oklch()`, `oklab()`, `lab()`, `lch()`, `hwb()`,
 * `color()`, `color-mix()`, `light-dark()`. Any utility with an opacity
 * modifier (e.g. `border-[#0b1e3a]/20`, `bg-white/10`, `text-amber-300`)
 * resolves to `color-mix(in oklab, …)` / `oklch(…)` at computed-style time,
 * which throws `Attempting to parse an unsupported color function "oklab"`.
 *
 * This runs inside html2canvas `onclone` on the cloned document: every node
 * inside `.a4-page` whose computed color contains a modern function gets an
 * overriding inline style in sRGB (`rgb()/rgba()/#hex`), which html2canvas
 * parses reliably. A canvas 2d context is used for the conversion because
 * `ctx.fillStyle` normalizes any CSS color the browser understands; when
 * the browser itself cannot normalize (or returns another modern function),
 * a per-property sRGB fallback is applied so generation never fails.
 */

const COLOR_PROPS = [
  "color",
  "background-color",
  "border-color",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "border-block-color",
  "border-block-start-color",
  "border-block-end-color",
  "outline-color",
  "text-decoration-color",
  "column-rule-color",
  "fill",
  "stroke",
  "stop-color",
  "flood-color",
  "lighting-color",
  "background",
] as const;

// Substrings that html2canvas 1.4.1 cannot parse. Checked case-insensitively
// on the computed value. `lab(` / `lch(`/`hwb(` need the paren so plain
// words like "label" don't false-positive; `color` needs `color(` / `color-mix`.
const UNSUPPORTED_RE = /oklch|oklab|\blab\s*\(|\blch\s*\(|\bhwb\s*\(|\bcolor\s*\(|color-mix|light-dark/i;

function fallbackFor(prop: string): string {
  const p = prop.toLowerCase();
  if (p === "color" || p === "fill" || p === "stroke") return "#0f172a";
  if (p.includes("border") || p.includes("outline") || p.includes("column-rule"))
    return "#cbd5e1";
  // background / background-color default to white so text stays readable.
  return "#ffffff";
}

/**
 * Rewrite every unsupported computed color inside `.a4-page` in `clonedDoc`
 * to an html2canvas-safe sRGB value. Safe to call multiple times; no-ops
 * when nothing modern is found. Never throws — wrapped by callers in
 * try/catch as well.
 */
export function sanitizeClonedColorsForHtml2Canvas(clonedDoc: Document): void {
  const baseFix = clonedDoc.createElement("style");
  baseFix.textContent =
    ".a4-page, .a4-page * { color-scheme: light !important; } " +
    ".a4-page { background-color: #ffffff !important; } " +
    ".pdf-hide { display: none !important; }";
  clonedDoc.head.appendChild(baseFix);

  const win = clonedDoc.defaultView;
  if (!win) return;
  const all = clonedDoc.querySelectorAll(".a4-page, .a4-page *");
  if (all.length === 0) return;

  const probe = clonedDoc.createElement("canvas") as HTMLCanvasElement;
  probe.width = 1;
  probe.height = 1;
  const ctx = probe.getContext("2d");
  if (!ctx) return;

  const normalize = (val: string): string => {
    try {
      ctx.fillStyle = "#ffffff";
      ctx.fillStyle = val;
      const out = String(ctx.fillStyle);
      // Canvas resolved to another modern function (older browser) — reject.
      if (UNSUPPORTED_RE.test(out)) return "";
      return out;
    } catch {
      return "";
    }
  };

  all.forEach((node) => {
    const htmlEl = node as HTMLElement;
    let cs: CSSStyleDeclaration;
    try {
      cs = win.getComputedStyle(htmlEl);
    } catch {
      return;
    }
    for (const prop of COLOR_PROPS) {
      let val = "";
      try {
        val = cs.getPropertyValue(prop);
      } catch {
        continue;
      }
      if (!val || !UNSUPPORTED_RE.test(val)) continue;
      const safe = normalize(val) || fallbackFor(prop);
      try {
        htmlEl.style.setProperty(prop, safe, "important");
      } catch {
        /* ignore */
      }
    }
    // Shadows / images that embed modern colors — drop them for capture.
    try {
      const bs = cs.getPropertyValue("box-shadow");
      if (bs && UNSUPPORTED_RE.test(bs))
        htmlEl.style.setProperty("box-shadow", "none", "important");
    } catch {
      /* ignore */
    }
    try {
      const ts = cs.getPropertyValue("text-shadow");
      if (ts && UNSUPPORTED_RE.test(ts))
        htmlEl.style.setProperty("text-shadow", "none", "important");
    } catch {
      /* ignore */
    }
    try {
      const bgImg = cs.getPropertyValue("background-image");
      if (bgImg && UNSUPPORTED_RE.test(bgImg))
        htmlEl.style.setProperty("background-image", "none", "important");
    } catch {
      /* ignore */
    }
  });
}
