# Checks: what each id means

Ids, layers and categories are defined in [../taxonomy/render-bug-taxonomy.yaml](../taxonomy/render-bug-taxonomy.yaml); this file says how each check decides. Every check is a pure function of its inputs (raw row, pipeline output, page DOM, screenshot pixels) with the thresholds below. A threshold change is a PR with a self-test case, never a local tweak during a review.

Fields: `question` (stem), `image` (stem image column), `option:N` (1-based), `solution`, `page` (whole document).

## Static checks (`S-*`): raw row + the pinned app pipeline, no browser

Inputs per question: the exported `paper.json` item (what the app receives on the path), the `bank.json` row (incl. `question_type`, options with `image` and `isCorrect`, `answer_option_id`), the `RenderedQuestion` from the app pipeline, and the captured page HTML.

| Check | Fires when | Notes |
|---|---|---|
| `S-STEM-EMPTY` | the stem has no text after stripping tags and whitespace, and no `<img>` | |
| `S-MOJIBAKE` | `Ã.`, `â€`, `Â[ -¿]` or `�` in any field | Hindi and other scripts are not mojibake. |
| `S-OPTION-COUNT` | the path payload has a number of options other than 4 | Part tests with 5 options: pass `--expect-options 5`. |
| `S-OPTION-EMPTY` | an option's payload `text` is empty after stripping tags, and it has no inline `<img>` | |
| `S-OPTION-DUP` | two options have the same normalised text (whitespace collapsed, case kept) and the same inline images | The app's `duplicate_option_text` flag maps here too. |
| `S-OPTION-IMAGE-DROPPED` | the bank option has a non-empty `image` **and** the path does not render option images (live, practice, analysis at the pin) **and** the option `text` does not already contain `<img src=` for it | Path capability comes from app-render-paths.md; update it when the app learns to draw option images. |
| `S-KEY-INVALID` | `answer_option_id` is empty, is not one of the option ids, or disagrees with the single `isCorrect: true`; or zero or several options are `isCorrect` | Scoring integrity, reported with rendering because a mock test is useless without it. |
| `S-TYPE-NOT-ON-PATH` | bank `question_type` is MATCH, ASSERTION_REASON or STATEMENT and the path delivers no type (live at the pin), and the stem does not already carry the layout: MATCH needs a `<table>` with at least 3 rows and 2 columns; AR / STATEMENT need a `<br>` or block element before every enumerated label | Severity blocker for MATCH, major for AR / STATEMENT. |
| `S-STRUCT-PARSE-FAILED` | the app pipeline emitted `structure_parse_failed` | Only on paths where the type reaches the renderer. |
| `S-STRUCT-TAG-LOSS` | the type reaches the renderer, structure was extracted, and a match cell or A/R part in the raw stem contains `<sub>`, `<sup>` or `<img>` that the rebuilt stem HTML lacks | Blocker when the lost tag is `img`. |
| `S-OPTIONS-IN-STEM` | the stem contains all four option texts, or `(1) … (2) … (3) … (4)` / `(A) … (D)` sequences whose bodies equal the options | |
| `S-TABLE-TEXT` | a pipe table (`^\s*\|.*\|\s*$` lines with a `---` separator) or a tab-aligned grid appears outside `<table>` | |
| `S-KATEX-COMPILE` | any math segment (after the app's `normalize`, split on `$$…$$` then `$…$`, the same delimiters as the page) fails `katex.renderToString(tex, {displayMode, throwOnError: true, strict: false, trust: false})` with the pinned `katex.min.js` + `mhchem.min.js` | Catches both parse errors and undefined commands (with `throwOnError: true` KaTeX throws for both). Message = KaTeX's. |
| `S-UNBALANCED-DOLLAR` | the app pipeline emitted `unbalanced_delimiter` | |
| `S-MATH-OUTSIDE-DELIMS` | outside math segments and outside tags, the text has `\\[a-zA-Z]{2,}`, `\\[()\[\]]`, `\^\{` or `_\{` | Literal backslashes in code-like text are rare in NEET papers; confirm in triage. |
| `S-BAKED-RESIDUE` | the rendered field HTML still contains `class="katex`, `<math`, `<annotation`, `<semantics`, `pstrut` or `vlist` | Means de-bake missed a block (usually no annotation). |
| `S-PERCENT-IN-MATH` | a math segment contains `%` not preceded by `\` | |
| `S-DOUBLE-ESCAPE` | the app pipeline emitted `double_escaped_command`, or a math segment still contains `\\[a-zA-Z]` outside `matrix`/`array`/`aligned`/`cases`/`align` environments | |
| `S-EMPTY-MATH` | `$$` + optional whitespace + `$$`, or `$` + whitespace + `$` | |
| `S-INVISIBLE-CHAR` | a math segment contains U+200B-U+200F, U+2060, U+FEFF, U+00AD, a C0 control other than tab/newline, or a combining mark (U+0300-U+036F) | |
| `S-CHEM-NO-CE` | a math segment (no `\ce`/`\pu`) matches `\b(?:[A-Z][a-z]?\d+){2,}\b` (for example `H2SO4`) | Heuristic, minor, never blocks. |
| `S-MARKDOWN` | outside math: `\*\*[^*\s][^*]*\*\*`, `__[^_]+__`, `!\[[^\]]*\]\([^)]+\)`, `^#{1,6} `, or a line starting with `- ` / `* ` followed by another such line | |
| `S-ENTITY-LITERAL` | after the app's entity decode, the field still has `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#\d+;` or `&#x[0-9a-f]+;` as text | |
| `S-STYLE-LAYOUT` | a raw tag has `style` containing `display:\s*(flex|grid|table|inline-block)`, `float`, `position:\s*absolute`, `width`, `columns` or `text-decoration` | The sanitizer drops `style`, so this layout or emphasis is lost. |
| `S-TAG-DROPPED` | a raw tag outside the app sanitizer allowlist, other than `script` and `style`: `u`, `font`, `center`, `mark`, `math`, `svg`, `iframe`, `object`, `video`, `big`, `small`, `tt`, ... | `u` and `font color`: major (emphasis such as NOT lost). Others: minor unless the tag carried content (svg, math): blocker. |
| `S-NEWLINE-COLLAPSE` | a raw field has 2+ `\n` that separate enumerated items, labels or table-like rows, and the rendered HTML has no `<br>`, `<p>`, `<li>`, `<tr>` or `<div>` at those positions | |
| `S-RENDER-FALLBACK` | the app pipeline emitted `render_error` | |
| `S-IMG-NOT-LINKIFIED` | outside tags: a markdown image `![](url)`, a bare image URL with an upper-case extension, or a bare image URL followed by `?query` | These are exactly the gaps in the app's `linkifyImageUrls` at the pin. |
| `S-IMG-UNREACHABLE` | an `<img src>` or the image column does not return HTTP 200 with an `image/*` content type and a decodable body on a host-side GET (2 retries, 10 s timeout, results recorded) | The only network-dependent static check; its raw results go in `images.json`. |
| `S-IMG-SRC-UNSAFE` | an image URL contains a space, `"`, `<` or `>` | The app interpolates the stem image into `src="..."` unescaped. |
| `S-IMG-DUP` | the stem HTML has `<img src=X>` and the image column is also X | |

## DOM checks (`D-*`): `assets/probe.js`, Chromium and Android WebView

Run after the page is stable: `ready().key` unchanged for 3 polls 100 ms apart and `settled` (document complete, fonts loaded, every image complete), 10 s cap.

| Check | Fires when | Notes |
|---|---|---|
| `D-KATEX-ERROR` | a `.katex-error` element exists in a field | Message = its `title`. |
| `D-KATEX-UNDEFINED` | an element inside `.katex` has inline colour `rgb(204, 0, 0)` / `#cc0000` | KaTeX's rendering of an unknown command with `throwOnError: false`. |
| `D-RAW-LATEX` | a text node outside `.katex` contains a backslash command, `\(`, `\[`, `^{` or `_{` | |
| `D-STRAY-DOLLAR` | a text node outside `.katex` contains an unescaped `$` | |
| `D-ZERO-MATH` | a visible `.katex` with text has zero width or height | |
| `D-LITERAL-MARKUP` | a text node shows `**x**`, `![`, `](http`, an HTML tag or an entity literally | Category by match: markdown vs escaped HTML. |
| `D-LITERAL-URL` | a text node shows an image URL | |
| `D-MOJIBAKE` | as `S-MOJIBAKE`, on rendered text | |
| `D-HCLIP` | a visible element with content has `right > viewport + 0.5` or `left < -0.5` and no horizontally scrolling ancestor; only the outermost offender per field is reported | The page sets `overflow: hidden` on `html, body`: this content is cut off. |
| `D-HSCROLL` | an ancestor with `overflow-x: auto/scroll` (KaTeX display blocks) has `scrollWidth > clientWidth + 1` | |
| `D-OVERLAP` | two non-inline sibling blocks with content intersect by more than 2 px on both axes | |
| `D-RUNON-LABELS` | in the stem, two consecutive `Statement I/II/…/A-E/1-5`, `Assertion (A):` or `Reason (R):` labels start on the same line (`|Δtop| < max(4 px, line height / 2)`) | |
| `D-MATCH-LAYOUT` | `bankType` is MATCH and the stem has no `<table>` with 3+ rows and 2+ columns | |
| `D-TABLE-RAGGED` | a table's rows have different widths (sum of `colspan`) | |
| `D-IMG-BROKEN` | an image is not complete or has `naturalWidth == 0` at probe time | |
| `D-IMG-TINY` | an image renders under 24 CSS px wide and its natural width is under 48 px | |
| `D-OPTION-COUNT` | the page has a number of `.opt` tiles other than `expectOptions` | |
| `D-OPTION-EMPTY` | an option tile has no text and no image | |
| `D-OPTION-DUP` | two option tiles have the same text and the same image sources | |
| `D-HEIGHT-CLAMP` | `(content height + 2) × DPR > maxPhysicalHeight` (8000 for QuestionWebView) | The bottom is cut off in the app. |
| `D-NOT-READY` | the probe ran on a page that never settled | |
| `D-FONT` | KaTeX output exists and `document.fonts.check('16px KaTeX_Main')` is false | |

The probe's own regression suite is `assets/probe-selftest/selftest.mjs` (21 synthetic cases, run twice for byte-identical output). Every new DOM check or threshold change adds a case there first.

## Device checks (`H-*`): what the Patrol test observes around the page

| Check | Fires when |
|---|---|
| `H-JS-ERROR` | a `QuestionWebView JS error: ...` line was printed while the question was on screen |
| `H-NO-HEIGHT` | the `QuestionWebView` height is still `<= 1` logical px after readiness |
| `H-LOAD-FAILED` | the text `Couldn't load this question` is on screen |

## Visual checks (`V-*`): pixel statistics on the native screenshot

Computed on the WebView's rectangle (from the widget tree, recorded with the result), on a 4 px grid, deterministic:

| Check | Fires when |
|---|---|
| `V-BLACK` | more than 98% of sampled pixels have every channel `< 16` |
| `V-BLANK` | more than 99.5% of sampled pixels equal the page background colour within ±4 per channel while the DOM reports text in the stem |

## Parity checks (`P-*`): the dashboard's TS renderer vs the app pipeline

Same raw row through `neet-renderer` `renderQuestion` and through the pinned app pipeline:

| Check | Fires when |
|---|---|
| `P-STRUCT-KIND` | the structure kinds differ (`plain` / `match` / `assertion_reason` / `statement`) for the same row and type |
| `P-FLAGS` | the sets of error-severity flag codes differ |
| `P-TEXT` | the visible text (tags stripped, whitespace collapsed, math source kept) differs |

## Cross-layer

`X-ENGINE-DIFF` (info): the same `(question, field, check)` fires in exactly one of `dom-chromium` and `dom-android`. The Android result stands; repeated engine differences of one kind mean the desktop profile needs tuning.
