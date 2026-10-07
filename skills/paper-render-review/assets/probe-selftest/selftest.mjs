// Self-test for ../probe.js: renders synthetic question pages that copy the
// app's QuestionWebView document shape, runs the probe in headless Chromium,
// checks each case raises exactly the expected checks, and runs everything
// twice to prove the output is byte-identical.
//
//   npm ci && npx playwright install chromium && npm test
//
// KaTeX comes from npm katex@0.16.11, byte-identical to the app's vendored
// flutter_app/assets/katex (checked 2026-10-07). To test against the app's
// copy instead: KATEX_DIR=/path/to/flutter_app/assets/katex npm test
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const KATEX_DIR = process.env.KATEX_DIR || path.join(here, 'node_modules', 'katex', 'dist');
if (!fs.existsSync(path.join(KATEX_DIR, 'katex.min.js'))) {
  console.error('KaTeX not found: run `npm ci`, or set KATEX_DIR to the app assets/katex directory.');
  process.exit(2);
}
// The app's assets/katex is flat; the npm dist keeps mhchem and auto-render in contrib/.
function katexFile(rel) {
  for (const candidate of [path.join(KATEX_DIR, rel), path.join(KATEX_DIR, 'contrib', rel)]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}
const PROBE = fs.readFileSync(path.join(here, '..', 'probe.js'), 'utf8');
// 10x10 grey PNG.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAAEklEQVR4nGNoaGjAgxhGpbEiAOFOT/GXD3mTAAAAAElFTkSuQmCC',
  'base64',
);

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/img/tiny.png') { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(TINY_PNG); }
  if (url.startsWith('/assets/katex/')) {
    const file = katexFile(url.slice('/assets/katex/'.length));
    if (file) {
      const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream';
      res.writeHead(200, { 'content-type': type });
      return res.end(fs.readFileSync(file));
    }
  }
  if (url.startsWith('/page/')) {
    const c = CASES.find((x) => x.id === url.slice(6));
    if (c) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(doc(c)); }
  }
  res.writeHead(404); res.end('not found');
});

let ORIGIN = '';

// Mirrors QuestionWebView._document (framed card, light tone, 16px / 1.45).
function doc(c) {
  const opts = (c.options ?? ['$1$', '$2$', '$3$', '$4$'])
    .map((o, i) => `<div class="opt" onclick="pick(${i})"><div class="ltr">${String.fromCharCode(65 + i)}</div><div class="otext">${o}</div><div class="mark"></div></div>`)
    .join('');
  const img = c.image ? `<img class="qimg" src="${c.image}" referrerpolicy="no-referrer">` : '';
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<link rel="stylesheet" href="${ORIGIN}/assets/katex/katex.min.css">
<style>
  html, body { margin: 0; padding: 0; background: rgba(250,250,248,1); overflow: hidden; }
  #wrap { font-family: "sans-serif", sans-serif; font-size: 16px; line-height: 1.45; color: rgba(20,23,29,1);
    overflow-wrap: break-word; word-break: break-word; padding-bottom: 14px; }
  .qcard { background: #fff; border-radius: 20px; padding: 18px 18px 16px; }
  .stem { font-weight: 500; }
  .qimg { max-width: 100%; height: auto; border-radius: 12px; margin: 12px 0; display: block; }
  #wrap img { max-width: 100%; height: auto; }
  table { border-collapse: collapse; margin: 6px 0; width: 100%; table-layout: fixed; }
  td, th { border: 1px solid rgba(17,17,17,.14); padding: 5px 9px; vertical-align: top; overflow-wrap: break-word; word-break: break-word; }
  .opts { margin-top: 14px; display: grid; gap: 10px; grid-template-columns: 1fr; align-items: stretch; }
  .opt { display: flex; align-items: center; gap: 12px; padding: 13px 14px; border: 1.5px solid transparent; border-radius: 14px; min-width: 0; background: #f3f3f0; }
  .opt .ltr { flex: 0 0 28px; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border-radius: 50%; font-weight: 700; font-size: .87em; }
  .opt .otext { flex: 1; min-width: 0; font-weight: 500; }
  .opt .mark { flex: 0 0 auto; width: 0; }
  .katex { font-size: 1.05em; }
  .katex-display { margin: .3em 0; overflow-x: auto; overflow-y: hidden; }
</style>
</head>
<body>
<div id="wrap">
  <div class="qcard">
    <div class="stem">${c.stem}</div>${img}
    <div class="opts">${opts}</div>
  </div>
</div>
<script src="${ORIGIN}/assets/katex/katex.min.js"></script>
<script src="${ORIGIN}/assets/katex/mhchem.min.js"></script>
<script src="${ORIGIN}/assets/katex/auto-render.min.js"></script>
<script>
  var wrap = document.getElementById('wrap');
  try {
    renderMathInElement(wrap, { delimiters: [ {left: '$$', right: '$$', display: true}, {left: '$', right: '$', display: false} ], throwOnError: false });
  } catch (e) { window.__jsError = String(e); }
</script>
</body>
</html>`;
}

const LONG_SUM = Array.from({ length: 60 }, (_, i) => `a_{${i}}`).join('+');
const CASES = [
  { id: 'clean', stem: 'If $a=2$ and $b=4$, find $\\frac{a}{b}$ and $\\ce{H2SO4}$ molar mass.', options: ['$\\frac{1}{2}$', '$2$', '$\\sqrt{2}$', '$4$'], expect: [] },
  { id: 'clean-statements', stem: '<b>Statement I:</b> $x$ is real.<br><b>Statement II:</b> $y$ is real.', expect: [] },
  { id: 'clean-match', bankType: 'MATCH', stem: '<table><thead><tr><th>Column I</th><th>Column II</th></tr></thead><tbody><tr><td>A. $x$</td><td>I. $y$</td></tr><tr><td>B. $z$</td><td>II. $w$</td></tr></tbody></table>', expect: [] },
  { id: 'katex-undefined', stem: 'Evaluate $\\badmacro{x}$ now.', expect: ['D-KATEX-UNDEFINED'] },
  { id: 'katex-parse-error', stem: 'Evaluate $x^$ now.', expect: ['D-KATEX-ERROR'] },
  { id: 'katex-spacing-script', stem: 'Angle is $30\\,^\\circ$.', expect: ['D-KATEX-ERROR'] },
  { id: 'raw-latex', stem: 'The value of \\alpha is two.', expect: ['D-RAW-LATEX'] },
  { id: 'stray-dollar', stem: 'It costs $5 per kg.', expect: ['D-STRAY-DOLLAR'] },
  { id: 'markdown', stem: '**Assertion** holds. See ![fig](https://example.invalid/fig.png)', expect: ['D-LITERAL-MARKUP', 'D-LITERAL-URL'] },
  { id: 'entity', stem: 'H&amp;lt;sub&amp;gt;2&amp;lt;/sub&amp;gt;O', expect: ['D-LITERAL-MARKUP'] },
  { id: 'display-scroll', stem: `Sum: $$${LONG_SUM}$$`, expect: ['D-HSCROLL'] },
  { id: 'inline-clip', stem: 'Pick one.', options: ['$\\frac{aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa}{b}$', '$2$', '$3$', '$4$'], expect: ['D-HCLIP'] },
  { id: 'broken-image', stem: 'See figure.', image: '/img/missing.png', expect: ['D-IMG-BROKEN'] },
  { id: 'tiny-image', stem: 'See figure.', image: '/img/tiny.png', expect: ['D-IMG-TINY'] },
  { id: 'option-empty-count', stem: 'Pick one.', options: ['$1$', '', '$3$'], expect: ['D-OPTION-COUNT', 'D-OPTION-EMPTY'] },
  { id: 'option-dup', stem: 'Pick one.', options: ['$2$', '$2$', '$3$', '$4$'], expect: ['D-OPTION-DUP'] },
  { id: 'runon', stem: 'Statement I: x is real. Statement II: y is real.', expect: ['D-RUNON-LABELS'] },
  { id: 'match-lost', bankType: 'MATCH', stem: 'Match Column I with Column II. A. x B. y I. p II. q', expect: ['D-MATCH-LAYOUT'] },
  { id: 'ragged-table', stem: '<table><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></table>', expect: ['D-TABLE-RAGGED'] },
  { id: 'height-clamp', stem: Array.from({ length: 160 }, (_, i) => `Line ${i}`).join('<br>'), expect: ['D-HEIGHT-CLAMP'] },
  { id: 'mojibake', stem: 'Itâ€™s a vector.', expect: ['D-MOJIBAKE'] },
];

async function waitStable(page) {
  let last = null; let same = 0;
  for (let i = 0; i < 100; i++) {
    const r = await page.evaluate(() => window.__mbqa.ready());
    if (r.key === last && r.settled) { if (++same >= 2) return true; } else same = 0;
    last = r.key;
    await page.waitForTimeout(100);
  }
  return false;
}

async function runAll(browser) {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 3 });
  const out = {};
  for (const c of CASES) {
    const page = await ctx.newPage();
    await page.goto(`${ORIGIN}/page/${c.id}`, { waitUntil: 'load' });
    await page.addScriptTag({ content: PROBE });
    await waitStable(page);
    const json = await page.evaluate((o) => JSON.stringify(window.__mbqa.probe(o)), { expectOptions: 4, bankType: c.bankType || '', maxPhysicalHeight: 8000 });
    out[c.id] = json;
    await page.close();
  }
  await ctx.close();
  return out;
}

server.listen(0, '127.0.0.1', async () => {
  ORIGIN = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  let failed = 0;
  try {
    const a = await runAll(browser);
    const b = await runAll(browser);
    for (const c of CASES) {
      const res = JSON.parse(a[c.id]);
      const got = [...new Set(res.anomalies.map((x) => x.check))].sort();
      const want = [...c.expect].sort();
      const ok = JSON.stringify(got) === JSON.stringify(want);
      const det = a[c.id] === b[c.id];
      if (!ok || !det) failed++;
      console.log(`${ok && det ? 'PASS' : 'FAIL'} ${c.id.padEnd(20)} got=[${got.join(',')}] want=[${want.join(',')}]${det ? '' : ' NONDETERMINISTIC'}`);
      if (!ok && process.env.VERBOSE) console.log(JSON.stringify(res.anomalies, null, 1));
    }
    console.log(`${CASES.length - failed}/${CASES.length} cases pass; browser ${browser.version()}`);
  } finally {
    await browser.close();
    server.close();
  }
  process.exit(failed ? 1 : 0);
});
