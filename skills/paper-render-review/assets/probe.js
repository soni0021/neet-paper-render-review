/*
 * mbqa DOM probe: deterministic render-anomaly checks for one rendered
 * MentorBox question page (QuestionWebView / KatexHtmlView document).
 *
 * Contract
 * - Read-only. It never changes the DOM, styles, scroll position or state.
 * - Deterministic. Same DOM + same viewport + same fonts => byte-identical
 *   JSON (anomalies sorted, numbers rounded, no clocks, no randomness).
 * - Self-contained ES2017, no dependencies. Runs unchanged in desktop
 *   Chromium (Playwright `page.evaluate`) and in the Android System WebView
 *   (`WebViewController.runJavaScriptReturningResult`).
 *
 * Usage
 *   1. Inject this file's source once per document (evaluate it as a script).
 *   2. Poll `window.__mbqa.ready()` until the `key` is identical for 3
 *      consecutive polls 100 ms apart AND `settled` is true (or give up after
 *      10 s and record D-NOT-READY).
 *   3. Call `JSON.stringify(window.__mbqa.probe(opts))` and parse the result.
 *      On Android, runJavaScriptReturningResult may hand back the JSON string
 *      itself JSON-encoded; decode twice when the first decode yields a string.
 *
 * opts (all optional)
 *   expectOptions      number   expected option count (default 4; 0 = skip)
 *   bankType           string   bank question_type (MATCH, ASSERTION_REASON,
 *                               STATEMENT, ...) for structure checks
 *   maxPhysicalHeight  number   the host's height clamp in physical px
 *                               (QuestionWebView: 8000)
 *   devicePixelRatio   number   override window.devicePixelRatio
 *   viewportWidth      number   override window.innerWidth (CSS px)
 *
 * Check ids match taxonomy/render-bug-taxonomy.yaml (layer "dom").
 */
(function () {
  'use strict';

  var VERSION = 'mbqa-probe/1.0.0';

  // ---------- helpers ----------

  function r1(n) { return Math.round(n * 10) / 10; }

  function norm(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

  function snip(s) {
    s = norm(s);
    return s.length > 160 ? s.slice(0, 157) + '...' : s;
  }

  function hasImg(el) { return !!(el && el.querySelector && el.querySelector('img')); }

  // A stable, short locator: field-relative tag/class path with nth-of-type.
  function locator(el, root) {
    var parts = [];
    var cur = el;
    while (cur && cur !== root && cur.nodeType === 1 && parts.length < 6) {
      var tag = cur.tagName.toLowerCase();
      var cls = (cur.className && typeof cur.className === 'string')
        ? '.' + cur.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
      var n = 1;
      var sib = cur;
      while ((sib = sib.previousElementSibling)) if (sib.tagName === cur.tagName) n++;
      parts.unshift(tag + cls + ':' + n);
      cur = cur.parentElement;
    }
    return parts.join('>') || '.';
  }

  function insideKatex(node) {
    var el = node.nodeType === 1 ? node : node.parentElement;
    while (el) {
      if (el.classList && (el.classList.contains('katex') || el.classList.contains('katex-error'))) return true;
      el = el.parentElement;
    }
    return false;
  }

  function textNodes(root) {
    var out = [];
    if (!root) return out;
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var n;
    while ((n = w.nextNode())) {
      var p = n.parentElement;
      if (!p) continue;
      var t = p.tagName;
      if (t === 'SCRIPT' || t === 'STYLE') continue;
      if (!norm(n.nodeValue)) continue;
      out.push(n);
    }
    return out;
  }

  function rect(el) {
    var b = el.getBoundingClientRect();
    return { x: r1(b.left), y: r1(b.top + (window.scrollY || 0)), w: r1(b.width), h: r1(b.height), right: r1(b.right) };
  }

  function hidden(el) {
    var s = getComputedStyle(el);
    return s.display === 'none' || s.visibility === 'hidden';
  }

  // Nearest ancestor (inside the document) that clips horizontally.
  function clipAncestor(el) {
    var cur = el.parentElement;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      var ox = getComputedStyle(cur).overflowX;
      if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  // ---------- fields ----------

  function fields() {
    var out = [];
    var wrap = document.getElementById('wrap');
    if (wrap) {
      var stem = wrap.querySelector('.stem');
      if (stem) out.push({ name: 'question', el: stem });
      var opts = wrap.querySelectorAll('.opt');
      for (var i = 0; i < opts.length; i++) {
        out.push({ name: 'option:' + (i + 1), el: opts[i].querySelector('.otext') || opts[i], tile: opts[i] });
      }
      var sol = document.querySelector('#sol .solbody');
      if (sol) out.push({ name: 'solution', el: sol, optional: true });
    } else {
      // KatexHtmlView documents (#c) and anything else: one field.
      var c = document.getElementById('c') || document.body;
      out.push({ name: 'content', el: c });
    }
    return out;
  }

  // ---------- readiness ----------

  function ready() {
    var imgs = Array.prototype.slice.call(document.images);
    var done = imgs.filter(function (i) { return i.complete; }).length;
    var fontsStatus = document.fonts ? document.fonts.status : 'n/a';
    var katex = document.querySelectorAll('.katex').length;
    var errs = document.querySelectorAll('.katex-error').length;
    var root = document.getElementById('wrap') || document.body;
    var h = Math.ceil(Math.max(root.getBoundingClientRect().height, root.scrollHeight, document.body.scrollHeight));
    var state = {
      readyState: document.readyState,
      fonts: fontsStatus,
      katex: katex,
      katexErrors: errs,
      images: imgs.length,
      imagesComplete: done,
      height: h,
      width: Math.ceil(document.documentElement.scrollWidth)
    };
    state.settled = state.readyState === 'complete' &&
      (fontsStatus === 'loaded' || fontsStatus === 'n/a') && done === imgs.length;
    state.key = JSON.stringify([state.readyState, fontsStatus, katex, errs, imgs.length, done, h, state.width]);
    return state;
  }

  // ---------- checks ----------

  var RAW_LATEX = /\\(?:[a-zA-Z]{2,}|[()[\]{}])|\^\{|_\{/;
  var LITERAL_MARKUP = /\*\*[^*\s][^*]*\*\*|!\[[^\]]*\]\(|\]\((?:https?:)?\/\/|<\/?(?:sub|sup|br|b|i|u|p|div|span|table|tr|td|img|strong|em)\b[^>]*>|&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[0-9a-fA-F]+);/;
  var LITERAL_IMG_URL = /https?:\/\/[^\s"'<>]+\.(?:png|jpe?g|gif|webp|bmp|svg)(?:\?[^\s"'<>]*)?/i;
  var LABEL = /\b(?:Statement\s*[-–]?\s*(?:I{1,3}|IV|V|[A-E]|[1-5])\b|Assertion\s*(?:\(A\))?\s*:|Reason\s*(?:\(R\))?\s*:)/g;
  var MOJIBAKE = /Ã.|â€|Â[ -¿]|�/;

  function probe(opts) {
    opts = opts || {};
    var expectOptions = opts.expectOptions === undefined ? 4 : opts.expectOptions;
    var dpr = opts.devicePixelRatio || window.devicePixelRatio || 1;
    var vw = opts.viewportWidth || window.innerWidth;
    var anomalies = [];
    var fs = fields();
    var order = {};
    fs.forEach(function (f, i) { order[f.name] = i; });
    order.page = -1; order.image = 0.5;

    function add(check, field, el, root, message, snippet, metrics) {
      anomalies.push({
        check: check,
        field: field,
        locator: el ? locator(el, root || document.body) : '.',
        message: message,
        snippet: snippet === undefined ? '' : snip(snippet),
        metrics: metrics || {}
      });
    }

    // Page level: readiness, height clamp, horizontal overflow, fonts.
    var st = ready();
    if (!st.settled) add('D-NOT-READY', 'page', null, null, 'document not settled when probed', '', { readyState: st.readyState, fonts: st.fonts, images: st.images, imagesComplete: st.imagesComplete });
    var maxPhys = opts.maxPhysicalHeight || 0;
    if (maxPhys > 0 && (st.height + 2) * dpr > maxPhys) {
      add('D-HEIGHT-CLAMP', 'page', null, null, 'content taller than the host height clamp; the bottom is cut off', '', { heightCss: st.height + 2, dpr: dpr, physical: Math.ceil((st.height + 2) * dpr), clamp: maxPhys });
    }
    if (st.katex > 0 && document.fonts && document.fonts.check && !document.fonts.check('16px KaTeX_Main')) {
      add('D-FONT', 'page', null, null, 'KaTeX_Main font not available; math falls back to system glyphs', '');
    }

    // Stem image.
    var qimg = document.querySelector('#wrap .qimg');
    var images = Array.prototype.slice.call(document.querySelectorAll('#wrap img, #c img'));
    images.forEach(function (img) {
      var f = img === qimg ? 'image' : fieldOf(img);
      if (!img.complete || img.naturalWidth === 0) {
        add('D-IMG-BROKEN', f, img, null, img.complete ? 'image failed to load or decode' : 'image still loading at probe time', img.getAttribute('src') || '', { complete: img.complete, naturalWidth: img.naturalWidth });
        return;
      }
      var rr = img.getBoundingClientRect();
      if (rr.width > 0 && rr.width < 24 && img.naturalWidth < 48) {
        add('D-IMG-TINY', f, img, null, 'image renders smaller than 24 CSS px', img.getAttribute('src') || '', { renderedWidth: r1(rr.width), naturalWidth: img.naturalWidth });
      }
    });

    function fieldOf(node) {
      for (var i = 0; i < fs.length; i++) if (fs[i].el.contains(node)) return fs[i].name;
      return 'page';
    }

    // Per-field checks.
    var optionKeys = [];
    fs.forEach(function (f) {
      var el = f.el;
      if (f.optional && hidden(document.getElementById('sol') || el)) {
        // Solution hidden until revealed: geometry is meaningless, text checks still apply.
      }

      // KaTeX parse errors (throwOnError:false renders .katex-error[title]).
      Array.prototype.forEach.call(el.querySelectorAll('.katex-error'), function (e) {
        add('D-KATEX-ERROR', f.name, e, el, e.getAttribute('title') || 'KaTeX error', e.textContent);
      });

      // Undefined control sequences: KaTeX (throwOnError:false) renders the
      // command itself in errorColor #cc0000 inside otherwise normal output.
      // auto-render builds through the DOM, so the inline colour is
      // serialised as rgb(204, 0, 0), never as the hex KaTeX passed in.
      var reds = Array.prototype.filter.call(el.querySelectorAll('.katex [style]'), function (e) {
        return e.style.color.replace(/\s/g, '') === 'rgb(204,0,0)' || /cc0000/i.test(e.getAttribute('style') || '');
      });
      reds.forEach(function (e) {
        if (reds.some(function (o) { return o !== e && o.contains(e); })) return;
        add('D-KATEX-UNDEFINED', f.name, e, el, 'undefined LaTeX command shown in red', e.textContent);
      });

      // Zero-size math that has content.
      Array.prototype.forEach.call(el.querySelectorAll('.katex'), function (k) {
        if (hidden(k)) return;
        var b = k.getBoundingClientRect();
        if (norm(k.textContent) && (b.width === 0 || b.height === 0) && !(f.optional)) {
          add('D-ZERO-MATH', f.name, k, el, 'math element has text but no size', k.textContent);
        }
      });

      // Text-node scans outside KaTeX output.
      textNodes(el).forEach(function (n) {
        if (insideKatex(n)) return;
        var t = n.nodeValue;
        var m;
        if ((m = RAW_LATEX.exec(t))) add('D-RAW-LATEX', f.name, n.parentElement, el, 'LaTeX command visible as text', t, { match: m[0] });
        if (/(^|[^\\])\$/.test(t)) add('D-STRAY-DOLLAR', f.name, n.parentElement, el, 'unpaired $ visible as text', t);
        if ((m = LITERAL_MARKUP.exec(t))) add('D-LITERAL-MARKUP', f.name, n.parentElement, el, 'markup or entity visible as text', t, { match: m[0] });
        if ((m = LITERAL_IMG_URL.exec(t))) add('D-LITERAL-URL', f.name, n.parentElement, el, 'image URL visible as text instead of an image', t, { match: m[0] });
        if ((m = MOJIBAKE.exec(t))) add('D-MOJIBAKE', f.name, n.parentElement, el, 'mis-decoded characters', t, { match: m[0] });
      });

      if (f.optional) return; // geometry below only for visible fields

      // Horizontal clipping and trapped horizontal scroll. Report the
      // outermost offender per field only.
      var reported = [];
      var all = el.querySelectorAll('*');
      for (var i = 0; i < all.length; i++) {
        var node = all[i];
        if (reported.some(function (p) { return p.contains(node); })) continue;
        if (hidden(node)) continue;
        if (!norm(node.textContent) && node.tagName !== 'IMG') continue;
        var b = node.getBoundingClientRect();
        if (b.width === 0) continue;
        var clip = clipAncestor(node);
        if (clip) {
          var ox = getComputedStyle(clip).overflowX;
          if ((ox === 'auto' || ox === 'scroll') && clip.scrollWidth > clip.clientWidth + 1 && reported.indexOf(clip) < 0) {
            add('D-HSCROLL', f.name, clip, el, 'content needs horizontal scrolling inside the page', clip.textContent, { scrollWidth: clip.scrollWidth, clientWidth: clip.clientWidth });
            reported.push(clip);
            continue;
          }
        }
        if (b.right > vw + 0.5 || b.left < -0.5) {
          add('D-HCLIP', f.name, node, el, 'content extends past the screen edge and is clipped', node.textContent, { left: r1(b.left), right: r1(b.right), viewport: vw });
          reported.push(node);
        }
      }

      // Overlapping block children (absolute/negative-margin collapse).
      var kids = Array.prototype.filter.call(el.children, function (c) { return !hidden(c) && (norm(c.textContent) || hasImg(c) || c.tagName === 'IMG'); });
      for (var a = 0; a < kids.length; a++) {
        for (var bIdx = a + 1; bIdx < kids.length; bIdx++) {
          var ra = kids[a].getBoundingClientRect(), rb = kids[bIdx].getBoundingClientRect();
          var ix = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
          var iy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
          var inlineish = getComputedStyle(kids[a]).display.indexOf('inline') === 0 && getComputedStyle(kids[bIdx]).display.indexOf('inline') === 0;
          if (!inlineish && ix > 2 && iy > 2) {
            add('D-OVERLAP', f.name, kids[bIdx], el, 'two blocks overlap', kids[bIdx].textContent, { overlapX: r1(ix), overlapY: r1(iy), with: locator(kids[a], el) });
          }
        }
      }

      // Enumerated labels (Statement I/II, Assertion/Reason) on one line.
      if (f.name === 'question') {
        var labels = [];
        textNodes(el).forEach(function (n) {
          if (insideKatex(n)) return;
          LABEL.lastIndex = 0;
          var mm;
          while ((mm = LABEL.exec(n.nodeValue))) {
            var range = document.createRange();
            range.setStart(n, mm.index);
            range.setEnd(n, mm.index + 1);
            var rs = range.getClientRects();
            if (rs.length) labels.push({ text: mm[0], top: rs[0].top, h: rs[0].height, node: n });
          }
        });
        for (var L = 1; L < labels.length; L++) {
          if (Math.abs(labels[L].top - labels[L - 1].top) < Math.max(4, labels[L].h / 2)) {
            add('D-RUNON-LABELS', f.name, labels[L].node.parentElement, el, 'enumerated labels share one line', labels[L - 1].text + ' ... ' + labels[L].text);
          }
        }
        // MATCH questions must show two columns.
        if (/MATCH/i.test(opts.bankType || '')) {
          var ok = Array.prototype.some.call(el.querySelectorAll('table'), function (tb) {
            var rows = tb.querySelectorAll('tr');
            var cols = 0;
            Array.prototype.forEach.call(rows, function (tr) { cols = Math.max(cols, tr.children.length); });
            return rows.length >= 3 && cols >= 2;
          });
          if (!ok) add('D-MATCH-LAYOUT', f.name, el, el, 'MATCH question without a two-column table', el.textContent);
        }
      }

      // Tables with ragged rows.
      Array.prototype.forEach.call(el.querySelectorAll('table'), function (tb) {
        var widths = Array.prototype.map.call(tb.querySelectorAll('tr'), function (tr) {
          var w = 0;
          Array.prototype.forEach.call(tr.children, function (td) { w += parseInt(td.getAttribute('colspan') || '1', 10) || 1; });
          return w;
        });
        var uniq = widths.filter(function (v, i2, arr) { return arr.indexOf(v) === i2; });
        if (uniq.length > 1) add('D-TABLE-RAGGED', f.name, tb, el, 'table rows have different column counts', tb.textContent, { rowWidths: widths });
      });

      // Option content.
      if (f.tile) {
        var key = norm(el.textContent) + '|' + Array.prototype.map.call(el.querySelectorAll('img'), function (i3) { return i3.getAttribute('src'); }).join(',');
        if (!norm(el.textContent) && !hasImg(el)) add('D-OPTION-EMPTY', f.name, el, f.tile, 'option has no visible text or image', '');
        optionKeys.push({ name: f.name, key: key, el: el });
      }
    });

    // Option set checks.
    var nOpts = optionKeys.length;
    if (expectOptions > 0 && document.getElementById('wrap') && nOpts !== expectOptions) {
      add('D-OPTION-COUNT', 'page', null, null, 'expected ' + expectOptions + ' options, rendered ' + nOpts, '', { rendered: nOpts, expected: expectOptions });
    }
    for (var x = 0; x < optionKeys.length; x++) {
      for (var y = x + 1; y < optionKeys.length; y++) {
        if (optionKeys[x].key && optionKeys[x].key === optionKeys[y].key && optionKeys[x].key !== '|') {
          add('D-OPTION-DUP', optionKeys[y].name, optionKeys[y].el, null, 'renders identically to ' + optionKeys[x].name, optionKeys[y].el.textContent);
        }
      }
    }

    anomalies.sort(function (p, q) {
      var a1 = order[p.field] !== undefined ? order[p.field] : 99;
      var b1 = order[q.field] !== undefined ? order[q.field] : 99;
      if (a1 !== b1) return a1 - b1;
      if (p.check !== q.check) return p.check < q.check ? -1 : 1;
      return p.locator < q.locator ? -1 : p.locator > q.locator ? 1 : 0;
    });

    return {
      probe: VERSION,
      viewport: { width: vw, dpr: dpr },
      ready: { settled: st.settled, fonts: st.fonts, katex: st.katex, katexErrors: st.katexErrors, images: st.images, imagesComplete: st.imagesComplete, heightCss: st.height },
      fields: fs.map(function (f) { return { name: f.name, rect: f.optional ? null : rect(f.el), text: snip(f.el.textContent) }; }),
      anomalies: anomalies
    };
  }

  window.__mbqa = { version: VERSION, ready: ready, probe: probe };
})();
