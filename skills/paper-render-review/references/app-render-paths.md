# How the MentorBox app renders a question, per test type

Facts below were read at MentorBox monorepo `main` = `8672b249` (2026-10-06). Paths are relative to the monorepo root; `NR` = `flutter_app/lib/features/shared/neet_renderer/`. **Re-verify against your pin** (`paperqa pin --diff` lists what changed); when the code disagrees with this file, the code wins and this file gets a PR.

## 1. The shared pipeline

```
JSON  ->  mapper (per path)  ->  Question  ->  toRawQuestion()  ->  renderQuestion(raw, opts)  ->  RenderedQuestion
      ->  QuestionWebView(question: ..., correctIndex, revealed, locked, showSolution, background, textStyle)
      ->  one HTML document per question, loaded with loadHtmlString(baseUrl: KatexServer.origin)
      ->  KaTeX 0.16.11 + mhchem + auto-render run inside the Android System WebView
```

- `NR/question_adapter.dart` `toRawQuestion()`: option ids become `'1'..'n'`, `isCorrect = i == correctIndex`, solution is `solution ?? explanation`.
- `NR/render.dart` `renderQuestion`:
  1. `classifyType(questionType, stem)` (`NR/structure.dart`): lowercase *contains* test. `mcq` is re-classified to MATCH or ASSERTION_REASON by content; **a null type gives UNKNOWN and no structure is extracted**.
  2. `renderField` on stem, solution, each option: `normalize` → (`validateMath` only when asked; every app call site passes `validateMath: false`) → `renderToHtmlResult`.
  3. `extractStructure(type, stem)`: MATCH (from a `.matching-question` div, an inline `<table>`, or "Column I / Column II" text), ASSERTION_REASON / Statement I-II, STATEMENT (bolds labels, `<br>` before each), else plain.
  4. `resolveAnswer` (no / multiple correct, duplicate option text, answer text not matching).
- `NR/normalize.dart` `normalize()` order: `debakeKatex` (pre-rendered `.katex` blocks become `$tex$` from their `<annotation encoding="application/x-tex">`; without the annotation only the text is kept) → `linkifyImageUrls` (bare `https?://…\.(png|jpe?g|gif|webp|bmp|svg)` becomes `<img>`; **skips URLs inside markdown `](…)`; lower-case extensions only; the match ends at the extension, so a `?query` stays as text**) → `decodeSafeEntities` (keeps `&lt;` `&gt;`) → `repairControlCharCommands` → `normalizeDelimiters` (`\( \)` → `$`, `\[ \]` → `$$`; a bare `\begin…\end` is wrapped only when the field has no `$`) → `fixMathSpacingScripts` (`\,^` → `\,{}^`) → `repairDoubleEscapes` (whitelist; skipped when the field contains `\begin{`) → `hasUnbalancedDelimiters` (flags, never closes).
- `NR/pipeline.dart` sanitizer: `script`/`style` removed with children. Allowed tags: `a b blockquote br caption code col colgroup dd del details div dl dt em h1-h6 hr i img ins kbd li ol p pre q rp rt ruby s samp section span strong sub summary sup table tbody td th thead tfoot tr ul var`. **Every other tag is unwrapped (children kept), so `u`, `font`, `center`, `mark`, `math`, `svg`, `iframe` lose their meaning.** Global attributes: `class id title role align dir lang`; `img`: `src alt title width height loading decoding`; `td`/`th`: `colspan rowspan align` (+`scope`); `a`: `href name target rel`. **`style` and `on*` are always dropped.** On a parser exception the field falls back to escaped text with `render_error`.
- **No markdown support anywhere in the renderer.** `**bold**` and `![](url)` render literally.
- Structured stems are rebuilt by `NR/widgets/rendered_question_view.dart` `stemToHtml`; match cells and A/R text pass through `_stripTags` first, **so `<sub>`, `<sup>` and `<img>` inside a match cell or an A/R statement are lost.**

## 2. The page (`NR/widgets/question_web_view.dart` `_document`)

- Head: viewport `width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no`; `katex.min.css` from `KatexServer.origin` (a loopback `HttpServer` serving `assets/katex/` from the bundle).
- **`html, body { overflow: hidden }`**: anything wider than the WebView is clipped silently, no scrollbar. `.katex-display { overflow-x: auto }`: wide display math scrolls inside the page.
- Body: `#wrap > .qcard > (.stem + img.qimg) + .opts > .opt*(.ltr, .otext, .mark)`, then `#sol` (hidden until revealed). Options are always one per row.
- `renderMathInElement(wrap, {delimiters: [$$…$$ display, $…$ inline], throwOnError: false})`, no custom `errorColor`: a parse error becomes `span.katex-error[title]` in `#cc0000`; an **undefined command** renders inline in `#cc0000` inside normal output.
- Height: the page posts `ceil(max(rect, scrollHeight, body.scrollHeight)) + 2` on the `FlutterHeight` channel; Dart **clamps it to 8000 physical px** (`_clampHeight`, e.g. 2666 CSS px at DPR 3). Taller content is cut off at the bottom.
- JS errors go to the `JsError` channel and are only `debugPrint`ed as `QuestionWebView JS error: …`.
- The stem image is `<img class="qimg" src="${q.image}">` with the URL interpolated unescaped. **Option images are never rendered.**
- The page source differs by dark/light tone only in colours.
- `KatexHtmlView` (`NR/widgets/katex_html_view.dart`, QOTD teaser, solutions, home): same head and delimiters, `#c` container, errors swallowed.

## 3. Per test type

| Path | Entry | Type reaches the renderer? | Fields on the page | Watch for |
|---|---|---|---|---|
| **Live exam / mock test** (`/live-tests/exam`) | `features/live_test/ui/views/live_exam_screen.dart` `_renderedFor` → `QuestionWebView(correctIndex: -1, revealed: false, showSolution: false, background: DarkColors.bg, textStyle: 16 / 1.45 / w500)` | **No.** Backend `apps/live_tests/paper.py paper_questions` and `LivePaperQuestionSerializer` send `number, section, question_id, question, options, image, marks`; the app's `paperQuestionFromJson` (`features/live_test/data/live_test_mapper.dart`) sets no type. Everything is UNKNOWN: no MATCH table rebuild, no A/R layout, no statement breaks. | stem, stem image, option **text** only (the serializer keeps each option's `image`, the mapper reads only `id` and `text`) | `STRUCT.TYPE_MISSING_ON_PATH`, `MEDIA.OPTION_IMAGE_DROPPED`, everything in the stem must carry its own layout |
| Practice runner, custom test (`/runner`) | `features/practice/ui/views/runner_screen.dart` | Yes: `question_format` from the list serializer, read by `QuestionDto.fromJson` as `question_type ?? type ?? question_format` | stem, image, options; solution hidden. Proctored runs set `FLAG_SECURE` (screenshots come out black) | the secure window in any harness that reuses this screen |
| Analysis / solutions (practice and live) | `features/analysis/ui/widgets/question_review.dart` | Read, but `build_question_analysis` sends no type, so null | WebView **only** if there is an image or `needsRichRenderer(stem or solution)`; otherwise native text. **Options are not checked**, so `\ce{}` or `<img>` in an option renders natively (wrong) | `needsRichRenderer` gaps |
| Bookmark detail, QOTD | `bookmarks/bookmark_detail_screen.dart`, `qotd/qotd_providers.dart` | via `QuestionDto` | stem, image, options (+ solution) | |
| Dev render screen | `lib/main_dev_render.dart`, `/dev/render` (debug only) | from the case or a fetch by id | everything, revealed | `assets/dev/` is not in pubspec, so bundled cases fail to load; `?id=` only pre-fills the field |

Data source: a live paper position points at a `questions_clean` row (`apps/live_tests/paper.py bank_rows`, model `QuestionClean`, `options` = `[{id, text, image, isCorrect}]`, `answer_option_id`). The app's older QA loop (`flutter_app/tool/qa/export_corpus.sql`) samples `questions`, not `questions_clean`, so it does not cover live papers.

## 4. What this means for a paper review

1. Review on the **live** path for any mock or live test: render with no type, options as text only, exactly as above.
2. For every bank row whose `question_type` is MATCH, ASSERTION_REASON or STATEMENT, the stem itself must contain the layout (a two-column `<table>`, `<br>` between labels) because the app will not build it. That is check `S-TYPE-NOT-ON-PATH`.
3. Every option with a bank `image` is a blocker on the live path unless the image is also inside the option `text` as `<img>` (`S-OPTION-IMAGE-DROPPED`).
4. Width matters: the live exam hosts the WebView inside padding; measure the real WebView width on the device pass (`window.innerWidth`) and use it for the desktop pass.
5. The store build may be older than main. If `paperqa pin --diff` between the store build and main touches any file above, run the device pass on both.
