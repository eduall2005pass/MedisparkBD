import { it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { fixHtml2CanvasTextBaseline } from "../src/components/admin/MaterialPdf/pdf-capture.ts";

const require = createRequire(import.meta.url);
const chrome = process.env.CHROME_BIN ??
  ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(existsSync);

it("PDF text stays centered under Tailwind Preflight without changing preview images", {
  skip: !chrome && "Chrome/Chromium is required for the canvas regression test",
  timeout: 45000,
}, () => {
  const dir = mkdtempSync(join(tmpdir(), "medispark-pdf-capture-"));
  try {
    const fixture = join(dir, "capture.html");
    const renderer = pathToFileURL(require.resolve("html2canvas")).href;
    const preflight = pathToFileURL(require.resolve("tailwindcss/preflight.css")).href;
    writeFileSync(fixture, `<!doctype html><html><head>
      <link rel="stylesheet" href="${preflight}">
      <style>
        body { margin: 0; font-family: Arial, sans-serif; }
        .a4-page { width: 600px; padding: 10px; background: #fff; }
        .label { display: flex; align-items: center; justify-content: center;
          margin-bottom: 8px; padding: 6px 12px; background: #0b1e3a;
          color: #fff; font-weight: 700; overflow: hidden; }
        .header { font-size: 11px; line-height: 1.5; }
        .topic { font-size: 11px; line-height: 1.5; }
        .footer { font-size: 9px; line-height: 1; letter-spacing: 0.45px; }
        .diagram { width: 20px; height: 20px; }
      </style>
      <script src="${renderer}"></script>
    </head><body>
      <div class="a4-page">
        <div class="label header"><span>SSC Academic Biology</span></div>
        <div class="label topic"><span>TOPIC: Cell Biology and Genetics</span></div>
        <div class="label footer">MEDISPARK ACADEMIC &amp; ADMISSION CARE</div>
        <img class="diagram" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">
      </div>
      <pre id="result">pending</pre>
      <script>
        ${fixHtml2CanvasTextBaseline.toString()}
        (async () => {
          try {
            await document.fonts.ready;
            const page = document.querySelector('.a4-page');
            const image = document.querySelector('.diagram');
            const imageBefore = image.getBoundingClientRect().toJSON();
            const labels = Array.from(document.querySelectorAll('.label')).map(label => {
              const rect = label.getBoundingClientRect();
              return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
            });
            const capture = () => html2canvas(page, { scale: 2, logging: false, backgroundColor: '#fff' });
            const textBounds = canvas => {
              const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
              return labels.map(rect => {
                let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
                for (let y = rect.y * 2; y < (rect.y + rect.h) * 2; y++) {
                  for (let x = rect.x * 2; x < (rect.x + rect.w) * 2; x++) {
                    const i = (Math.floor(y) * canvas.width + Math.floor(x)) * 4;
                    if (data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200) {
                      minX = Math.min(minX, x); minY = Math.min(minY, y);
                      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
                    }
                  }
                }
                return { minX, minY, maxX, maxY };
              });
            };
            const beforeCanvas = await capture();
            const before = textBounds(beforeCanvas);
            const restore = fixHtml2CanvasTextBaseline(document);
            let afterCanvas;
            const imageDuring = image.getBoundingClientRect().toJSON();
            const imageDisplay = getComputedStyle(image).display;
            try { afterCanvas = await capture(); } finally { restore(); }
            document.querySelector('#result').textContent = JSON.stringify({
              labels, before, after: textBounds(afterCanvas), imageBefore, imageDuring, imageDisplay,
              beforeSize: [beforeCanvas.width, beforeCanvas.height],
              afterSize: [afterCanvas.width, afterCanvas.height],
              remainingFixes: Array.from(document.querySelectorAll('style')).filter(style =>
                style.textContent.includes('visibility: hidden')).length,
            });
          } catch (error) {
            document.querySelector('#result').textContent = JSON.stringify({ error: String(error) });
          }
        })();
      </script>
    </body></html>`);

    const output = execFileSync(chrome!, [
      "--headless", "--no-sandbox", "--disable-gpu", "--no-first-run",
      "--allow-file-access-from-files", `--user-data-dir=${join(dir, "profile")}`,
      "--virtual-time-budget=10000", "--dump-dom", pathToFileURL(fixture).href,
    ], { encoding: "utf8", timeout: 35000, maxBuffer: 2 * 1024 * 1024 });
    const match = output.match(/<pre id="result">([\s\S]*?)<\/pre>/);
    assert.ok(match, "Browser did not return the capture results");
    assert.notEqual(match[1], "pending", "Browser did not finish rendering the canvases");
    const result = JSON.parse(match[1]);
    assert.equal(result.error, undefined);
    assert.deepEqual(result.beforeSize, result.afterSize, "A4 dimensions must not change");
    assert.deepEqual(result.imageBefore, result.imageDuring, "Preview image geometry must not change");
    assert.equal(result.imageDisplay, "block", "Only metric probes should become inline");
    assert.equal(result.remainingFixes, 0, "Temporary styles must be removed after capture");
    for (let i = 0; i < result.labels.length; i++) {
      const before = result.before[i];
      const after = result.after[i];
      const label = result.labels[i];
      assert.ok(after.maxY >= after.minY, `Label ${i} must contain visible text`);
      assert.ok(before.minY > after.minY, `Label ${i}: text must no longer shift downward`);
      assert.equal(before.minX, after.minX, `Label ${i}: horizontal alignment must not change`);
      assert.equal(before.maxX, after.maxX, `Label ${i}: text width must not change`);
      const topGap = after.minY - label.y * 2;
      const bottomGap = (label.y + label.h) * 2 - 1 - after.maxY;
      const beforeTopGap = before.minY - label.y * 2;
      const beforeBottomGap = (label.y + label.h) * 2 - 1 - before.maxY;
      // Glyph ink is not symmetric within a native font's line box.
      assert.ok(Math.abs(topGap - bottomGap) < Math.abs(beforeTopGap - beforeBottomGap),
        `Label ${i}: vertical alignment must improve, not just move the entire box`);
      assert.ok(topGap > 2 && bottomGap > 2,
        `Label ${i}: glyphs must not clip against the badge edges`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
