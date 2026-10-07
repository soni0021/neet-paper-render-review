---
name: paper-render-review
description: "Use before a NEET mock test or live test reaches students, and whenever someone asks to review a paper's rendering, find rendering bugs the MentorBox Android app would show, sync the QA renderer to the app's renderer at monorepo main, run the render-every-question Patrol test or the deterministic anomaly scan, or file, triage, categorise or fix rendering bugs from the bug catalog. Renders every question exactly as the app does (same Dart pipeline, same WebView page, same KaTeX), finds anomalies with deterministic checks only, and records each one in the categorised catalog so the next similar bug is fixed by recipe. Not for checking whether an answer or solution is academically correct (human R1-R3 review), app performance, or general Flutter UI work."
---

# Paper render review (before a mock or live test)

A student sees the question the way the **Android app** renders it, not the way the QA dashboard or a PDF shows it. This skill renders every question of one paper through the app's own renderer at a pinned commit, on desktop Chromium and on an Android emulator, runs deterministic checks over the result, matches every anomaly to a categorised bug catalog, stages fixes, and produces a go / no-go report.

Three rules hold for every step:

1. **The app is the oracle.** Render with the MentorBox monorepo's `flutter_app/lib/features/shared/neet_renderer/` at a recorded commit, through the same entry point the test type uses. Never "approximately the same" code.
2. **Deterministic only.** Same paper + same pins + same device profile give byte-identical findings. No LLM, VLM or "looks fine to me" in the verdict. Screenshots are evidence for humans.
3. **Never write a database.** Read-only exports; fixes are staged files a named human applies. Read [references/safety-and-data.md](references/safety-and-data.md) before the first query.

## Load the reference for the sub-task

| Sub-task | Load |
|---|---|
| Before any DB query, commit or push | [references/safety-and-data.md](references/safety-and-data.md) |
| How the app renders each test type, which fields reach the page, what is dropped | [references/app-render-paths.md](references/app-render-paths.md) |
| Harness layout, the `paperqa` CLI, pins, outputs, determinism rules | [references/harness.md](references/harness.md) |
| Installing patrol_cli, Android wiring, device profile, Patrol gotchas | [references/patrol-and-device.md](references/patrol-and-device.md) |
| What each check id means, thresholds, false-positive notes | [references/checks.md](references/checks.md) |
| Triage, matching findings to the catalog, writing a new bug, fix recipes | [references/bug-catalog.md](references/bug-catalog.md) |
| The report and the go / no-go gate | [assets/report-template.md](assets/report-template.md) |
| The harness does not exist yet in `neet-qa-platform` | [prompts/implement-harness.md](prompts/implement-harness.md) |

Category and check ids come from [taxonomy/render-bug-taxonomy.yaml](taxonomy/render-bug-taxonomy.yaml). The DOM probe is [assets/probe.js](assets/probe.js) (self-test: [assets/probe-selftest/](assets/probe-selftest/)).

## 0. Collect the inputs (ask for anything missing, do not guess)

| Input | Example | Why |
|---|---|---|
| Paper identity | live test slug or id; or a list of `question_id`s; or the pipeline's `mock_test_id` plus the expected count | Pipeline `mock_test_id`s are inconsistent (`FST_4_13-03-2025` vs `FST_4_13_03_2025`, trailing spaces). Match exactly and check the count. |
| Test type / render path | `live` (live and mock tests), `practice`, `analysis` | Each path feeds the renderer different fields (see app-render-paths). Mock tests are live tests in the app. |
| App builds to cover | `main` plus the oldest store build students still run, e.g. `1.1.40+51` | Students run the store build, not main. A fix on main does not reach them before the test. |
| Exam start time | `2026-10-12 14:00 IST` | Sets the deadline for data fixes; freeze the paper at least 24 h before. |
| Reviewer | the human who signs the report | Required on the report and on every catalog occurrence. |

If the user only said "review the paper for the mock test", ask for the first four before starting.

## 1. Preflight (5 minutes)

- Checkouts: `neet-qa-platform` on a new branch `review/<paper>-<date>` (never `main`), and the MentorBox monorepo fetched (`git fetch --no-recurse-submodules origin main`; recursing into the counsellor_dashboard submodule has hung for minutes).
- Run `paperqa doctor`. It must report Flutter at the monorepo CI pin (`flutter-version` in `.github/workflows/flutter.yml`, 3.44.1 on 2026-10-07), patrol_cli 4.8.0+, Android SDK + the review AVD, Node 20+, Python 3.11+, read-only DB access. Fix what it flags (references/patrol-and-device.md).
- **Exit:** doctor all green, or each red item written into the report as a known limitation.

## 2. Pin the renderer ("sync to latest main")

```bash
paperqa pin --ref main                 # resolves origin/main to a SHA, checks it out under .mentorbox/
paperqa pin --app-version 1.1.40+51    # also pin the store build (resolved via the pubspec version line)
paperqa pin --diff                     # what changed in the renderer since the last pin
```

- `APP_PIN.json` records the SHA, the renderer tree hash, the KaTeX version, the hash of the live exam's `QuestionWebView(...)` call, and the copied asset hashes. `paperqa pin --check` fails when any of them drifts.
- Read the `--diff`. A change in `neet_renderer/`, the paper mapper, the exam screen's `QuestionWebView` arguments or the KaTeX assets can create or close bug classes: note which catalog entries it may affect (their `signature.app_sha_range`).
- If the harness's host widget no longer matches the exam screen's `QuestionWebView(...)` call, stop and update the host first (prompts/implement-harness.md, "host parity").
- **Exit:** both pins recorded, `pin --check` green, diff read and noted.

## 3. Freeze and export the paper (read-only)

```bash
paperqa export --paper <paper-id> --path live
```

- Writes `papers/<paper>/paper.json` in the exact shape the app receives on that path (for `live`: what `LivePaperQuestionSerializer` sends, answer keys stripped), `bank.json` (the bank rows, incl. `question_type`, option images and the key, for static checks only), and `manifest.json` (ids in order, count per section, `content_sha256`).
- Verify the count and the section split against the paper spec (a full NEET paper is 180 in Physics / Chemistry / Botany / Zoology; part tests vary). A missing bank row is a blocker on its own.
- **Exit:** manifest written, count verified, hash recorded in the report.

## 4. Static pass (every question, no browser, about 1 minute)

```bash
paperqa static --paper <paper-id>
```

Runs the pinned app pipeline (`paperQuestionFromJson` → `toRenderable().toRawQuestion()` → `renderQuestion(opts: RenderOptions(validateMath: false))` for `live`) in `flutter test`, captures the exact HTML document `QuestionWebView` would load, compiles every math segment with the vendored KaTeX + mhchem (`throwOnError: true`), and runs the `S-*` checks against the raw row and the pipeline output. Output: `runs/<run>/static.jsonl`, `pages/<n>.html`.

## 5. DOM pass in desktop Chromium (every question, about 2 minutes)

```bash
paperqa dom --paper <paper-id> --profile chromium-360css-dpr3
```

Loads each captured page in headless Chromium at the device's WebView width (CSS px measured by the device pass, 360 by default) and DPR 3, serves KaTeX from the pinned app assets, waits for the probe's readiness key to be stable, then runs `assets/probe.js` (`D-*` checks). Output: `dom-chromium.jsonl`. Fast and good for iteration, but **not** the truth: the Android System WebView is.

## 6. Device pass with Patrol (every question, about 3-8 minutes per 180)

```bash
paperqa device --paper <paper-id> --serial emulator-5554 --profile android-360dp-api35
```

`patrol test -t patrol_test/render_paper_test.dart` in the harness app renders each question with the exam screen's exact `QuestionWebView` arguments, waits for readiness, runs the same probe through `runJavaScriptReturningResult` on the page's controller (`WebViewWidget.platform.params.controller`; no app change needed), records `JsError` messages and the reported height, and saves `$.takeNativeScreenshot('q<NNN>')`. patrol_cli pulls the screenshots to the host. Output: `dom-android.jsonl`, `device.jsonl` (`H-*`), `shots/`.

- The device profile (AVD, system image, WebView version, `wm size` / `wm density`, font scale, animations off, locale) is applied and recorded by the command. A WebView major version different from the profile is reported, not ignored.
- Unlock the screen first: a PIN keyguard means no frames and every question times out.

## 7. Visual and parity passes

```bash
paperqa visual --run <run>     # V-BLACK / V-BLANK pixel statistics on every screenshot
paperqa parity --paper <id>    # the QA dashboard's TS renderQuestion vs the app pipeline (P-*)
```

Parity findings mean a reviewer looking at the dashboard saw something different from what students will see. They are bugs in the dashboard renderer, not in the paper, but they explain why earlier human review missed something.

## 8. Merge, deduplicate, match the catalog

```bash
paperqa merge --run <run>      # findings.jsonl + triage.md
```

- One finding per (question, field, check, locator, profile), stable `finding_id` (catalog-template/finding.schema.json). Cross-engine differences become `X-ENGINE-DIFF` (info).
- Each finding is matched against `catalog/bugs.jsonl` signatures (references/bug-catalog.md). Matched findings inherit the bug id, the category and the fix recipe. Unmatched findings are **new** and go to step 9.
- **Exit:** every blocker and major finding is either matched to a bug id or marked new; nothing is "unknown".

## 9. Triage new findings (human + agent)

For each new finding, in this order:

1. Open its screenshot and its `pages/<n>.html`. Confirm it on the device render. If the device shows it fine and only Chromium flags it, record `PARITY.ENGINE` and move on.
2. Decide: real bug, or `HARNESS.FALSE_POSITIVE`. A false positive is fixed in the check (with a probe self-test case), never by editing the data.
3. Real bug: find the category in the taxonomy. If two fit, pick the one whose fix playbook you will follow. If none fits, propose a new category in the same PR (taxonomy rules in references/bug-catalog.md).
4. Find the root cause layer with evidence (raw field, pipeline output, page HTML, DOM). Write a **synthetic** minimal repro (hand-written, never real question text).
5. Add the catalog entry (`RB-####`) with a signature narrow enough not to swallow other bugs, and a fix recipe someone else can follow.

## 10. Fix

| Root cause layer | What to do | Who applies |
|---|---|---|
| `source-data`, `importer` output | Stage `fixes/<paper>/fixes.json` + dry-run `apply.py` + `rollback.py` (safety reference). Re-render the fixed rows locally with `paperqa static/dom/device --override fixes/<paper>/fixes.json` and attach the after-screenshot. | A named human runs `apply.py --commit` |
| `app-mapper`, `app-renderer`, `backend-payload` | A PR in the MentorBox monorepo on its own branch, with a regression test built from the synthetic repro (flutter-testing / django-verification skills there). Also stage the data workaround for students on older builds. | PR review |
| `importer` (pipeline code) | A PR in `neet-question-pipeline` so new papers stop producing it. | PR review |
| `harness` | A PR in `neet-qa-platform` with a probe self-test case. | PR review |

Images: upload a replacement to a **new** object key and point the row at it; never overwrite a key a published paper references.

## 11. Re-run and gate

- Re-run steps 4-8 on the affected questions with the staged fixes as overrides, then a full static + DOM pass on the whole paper.
- **Gate (go):** 0 open blockers on every pinned build; every major either fixed or accepted by the reviewer by name with a reason; the paper `content_sha256` in the report equals the current export (nothing changed under you).
- A human spot-checks every blocker/major screenshot pair (before/after) plus 10 clean questions chosen by `sha256(paper_id)` order (deterministic sample), on a real phone if one is available.

## 12. Report and record

- Fill [assets/report-template.md](assets/report-template.md) into `runs/<run>/REPORT.md`: pins, profile, counts by category and severity, every blocker with screenshot, the fixes staged, the gate result, who signed.
- Append an `occurrences` entry to every matched or new catalog bug. Commit catalog + report + findings (not screenshots of real questions to any public place) on the review branch and open a PR in `neet-qa-platform`.
- Tell the requester: go / no-go, the blockers left, what a human must still do (apply data fixes, upload images, sign), and the deadline.

## Commands when the harness is not built yet

The `paperqa` CLI is specified in [references/harness.md](references/harness.md) and built by [prompts/implement-harness.md](prompts/implement-harness.md). Until it exists, do not improvise a renderer. The minimum faithful substitute is:

1. Static: in the monorepo, a throwaway `flutter test` that loads the exported `paper.json` and calls the same chain as step 4, printing flags and writing each `QuestionWebView` document via the repo's `test/helpers/fake_webview.dart` (`lastLoadedHtml`).
2. DOM: open those documents in Chromium with `assets/probe.js` exactly as `assets/probe-selftest/selftest.mjs` does.
3. Say in the report that the device pass did not run, so `LAYOUT.*` coverage is desktop-only.

## Red flags (stop and fix the process)

- Rendering with the TS `neet-renderer`, the dashboard preview, a PDF or an HTML preview and calling it "what the app shows".
- Reviewing `public.questions` when the paper serves from `questions_clean` (the app's existing `tool/qa/export_corpus.sql` reads `questions`).
- A finding id or ordering that changes between two runs of the same inputs.
- Any write to a database, any `UPDATE` "just to test", any image overwritten in place.
- A screenshot judged by an LLM as the reason a question passed.
- A pin older than the last renderer change on main without a written reason.
- A real question's text, image or id in the public skill repo, an issue or a chat outside the org.
- Accepting a blocker because "the app will be fixed": students on the store build will still see it.
