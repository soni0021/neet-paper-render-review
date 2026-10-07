# Prompt: build the paper render review harness

Paste everything below the line into a coding agent (Claude Code recommended) started in a checkout of `neet-qa-platform`, with the MentorBox monorepo cloned next to it. Fill the three `<...>` values first.

---

You are implementing the **paper render review harness** in `neet-qa-platform` so that, before any NEET mock or live test, every question of the paper can be rendered exactly as the MentorBox Android app renders it, checked by deterministic rules, and recorded in a categorised bug catalog. The skill that will use this harness, and the contract you are building to, live in the public repo `soni0021/neet-paper-render-review`:

- `skills/paper-render-review/SKILL.md`: the workflow your harness serves.
- `skills/paper-render-review/references/harness.md`: **the contract** (layout, CLI, `APP_PIN.json`, host, determinism). Build exactly this; if you must deviate, change that file in the same PR and say why.
- `skills/paper-render-review/references/app-render-paths.md`: how the app renders each test type (with file:line at monorepo `8672b249`).
- `skills/paper-render-review/references/checks.md`: every check id and its rule. `skills/paper-render-review/taxonomy/render-bug-taxonomy.yaml`: ids, categories, severities.
- `skills/paper-render-review/references/patrol-and-device.md`: Patrol versions, Android wiring, device profile, test shape.
- `skills/paper-render-review/references/bug-catalog.md`, `skills/paper-render-review/catalog-template/*.json*`: catalog format and matching.
- `skills/paper-render-review/assets/probe.js` + `assets/probe-selftest/`: the DOM probe (21 self-test cases, deterministic). Copy it byte-for-byte; do not fork it.
- `skills/paper-render-review/references/safety-and-data.md`: read before you touch a database.

Inputs:
- MentorBox monorepo checkout: `<path, e.g. ../mentorbox_monorepo>` (remote `soni0021/mentorbox_monorepo`, default branch `main`).
- Read-only Postgres role for the question bank / live tests: `<env var name holding it, e.g. PAPERQA_RO_DATABASE_URL>`. Never print it.
- First real paper to try it on after the fixture passes: `<live test id or slug>`.

## 0. Before writing code: confirm these assumptions with the owner

State them back in 1-3 bullets each and wait for a yes or a correction (MentorBox rule: surface assumptions first; stop when requirements conflict):

1. **The harness lives in `neet-qa-platform/paper-review/`**, not in the MentorBox app, because Patrol and QA tooling are not allowed on the app's `main` (Patrol exists only on perf branches there).
2. **The app's renderer is imported, not ported:** the harness is a Flutter app with a path dependency on the MentorBox `flutter_app/` checked out at a pinned SHA (`.mentorbox/`, gitignored). "Change the renderer in neet-qa to the latest main" means `paperqa pin --ref main`, plus (PR 6) bringing the dashboard's TypeScript `neet-renderer` to parity so reviewers see what students see.
3. **The default render path is `live`** (mock tests are live tests in the app).
4. **No AI in the verdict** (neet-qa-platform `AGENTS.md`): every check is deterministic code; screenshots are evidence for humans.
5. **No writes** to any database. Exports are `SELECT`s on a read-only session; fixes are staged files a named human applies.

If the owner wants the harness elsewhere, or a port instead of an import, stop and re-plan.

## 1. What exists today (reviewed 2026-10-07; re-verify, the code wins)

MentorBox monorepo (`main` = `8672b249`):
- Renderer: `flutter_app/lib/features/shared/neet_renderer/` (normalize → sanitize → structure → `QuestionWebView` page with KaTeX 0.16.11 + mhchem + auto-render served from `assets/katex/` by a loopback `KatexServer`). Details: `references/app-render-paths.md`.
- Live / mock exam path: `live_exam_screen.dart` `_renderedFor` → `renderQuestion(q.toRenderable().toRawQuestion(), opts: RenderOptions(validateMath: false))` → `QuestionWebView(correctIndex: -1, revealed: false, showSolution: false, background: DarkColors.bg, textStyle: 16 / 1.45 / w500 / DarkColors.ink)`. The paper JSON comes from `common_backend/apps/live_tests/paper.py paper_questions` through `LivePaperQuestionSerializer` (answer keys stripped; **no question type**; option `image` kept) and is mapped by `flutter_app/lib/features/live_test/data/live_test_mapper.dart paperQuestionFromJson` (**keeps only option `id` and `text`**).
- The app's existing QA loop (`flutter_app/tool/qa/`) samples `public.questions`, not `questions_clean`, renders in the Dart VM only, and has no DOM or device checks.
- Patrol wiring that works (perf branch `perf/live-start-patrol`, commit `d531c840`): `references/patrol-and-device.md` §3.
- CI Flutter: 3.44.1 (`.github/workflows/flutter.yml`). Note: `main` at `8672b249` did not compile (stale retrofit `*.g.dart` for revision options); the fix is on branch `fix/flutter-revision-setup-compile`. If your pin does not compile, record it and pin the nearest compiling commit, with the reason in `APP_PIN.json`.

`neet-qa-platform` (`main` = `fb2d341`):
- `neet-renderer/` (TypeScript, KaTeX 0.16.47 via npm, `hast-util-sanitize`): no de-bake of pre-rendered KaTeX, no markdown, option images dropped, structure text not math-rendered in the React components, `image_unreachable` declared but never emitted.
- `render-check/` runs DOM checks in Playwright Chromium at 800 x 1200 on the 329-row gold set only; `reports/render-check.md` is stale (pre-dates the VLM removal).
- **No paper / test identity anywhere** (no `mock_test_id`, `live_paper_questions` or test ids). You add it in `export_paper.py`.
- Tables: `questions_clean`, `work_ledger`, `review_*`, `question_edits`, `llm_suggestions` (`neet-renderer/sql/`).

`neet-question-pipeline`: its render-check sidecar calls the TS `neet-renderer`, so `render_status = auto_pass` there does not mean the app renders the question correctly. Its `domain/qa_flags.py` and `Bugs.xlsx` are the origin of most taxonomy categories (mapped in `taxonomy/render-bug-taxonomy.yaml` `maps`).

## 2. Work plan: small PRs, each on its own branch, each green before the next

Branch names `paperqa/<n>-<slug>`. Never push to `main`. Never `git stash` (use WIP commits). Keep each PR reviewable (< ~800 lines of hand-written code).

### PR 1: scaffold, pin, doctor
- `paper-review/` per the layout in `references/harness.md`; `paperqa.py` CLI (argparse, stdlib + PyYAML), `paperqa doctor`, `paperqa pin --ref/--sha/--app-version/--check/--diff`.
- `tools/sync_app.py`: `git fetch --no-recurse-submodules` (recursing into `counsellor_dashboard` hangs), worktree or sparse checkout of `flutter_app/` at the SHA into `.mentorbox/`, copy `flutter_app/assets/katex/**` to `harness/assets/katex/`, compute the `watched` hashes (git tree/blob SHAs; the `QuestionWebView(...)` argument block in `live_exam_screen.dart` by sha256 of its source text), write `APP_PIN.json`.
- `--app-version X.Y.Z+N`: `git log --format=%H -S"version: X.Y.Z+N" -- flutter_app/pubspec.yaml | tail -1`.
- Copy `probe.js`, the self-test, the taxonomy and the schemas from the skill repo with a `paper-review/VENDORED.json` (source repo, commit, sha256 per file) and `paperqa doctor` verifying it.
- **Accept:** `pin --ref main` then `pin --check` passes; editing one file under `.mentorbox/flutter_app/lib/features/shared/neet_renderer/` makes `pin --check` fail; `pin --diff` between two SHAs prints the renderer diff.

### PR 2: harness app, host, static pass, export
- `harness/` Flutter app (`ai.mentorbox.qa.render`), `pubspec.yaml` with `mentorbox: {path: ../.mentorbox/flutter_app}` and the same SDK constraint; Android config matching the app's (`minSdk 24`, `compileSdk 36`, Java 17, core-library desugaring). If the app's plugins make the harness fail to build, write down the exact error, then fall back to importing only `neet_renderer/` + `live_test_mapper.dart` + their imports through a generated `lib/vendor/` copy that `sync_app.py` refreshes and `pin --check` hashes; record the decision in `paper-review/README.md`.
- `lib/paper_host.dart`: the host from `references/harness.md` (same arguments, padding, `ListView`, dark tone as the exam screen). Set `APP_PIN.json host_reviewed_for` after you compare it with the screen's call.
- `test/static_render_test.dart` (`flutter test`): for each paper item, the app chain, then mount `PaperHost` under a fake WebView platform (adapt the monorepo's `flutter_app/test/helpers/fake_webview.dart` pattern) to capture the exact `loadHtmlString` document; write `pages/<n>.html` and one `pipeline.jsonl` line (normalised fields, rendered HTML, structure kind, flags).
- `tools/static_checks.py`: all `S-*` checks from `references/checks.md`, KaTeX compile through `node` with the pinned `katex.min.js` + `mhchem.min.js` (`throwOnError: true`, `strict: false`, `trust: false`), image prefetch with recorded results.
- `tools/export_paper.py`: read-only session (`SET default_transaction_read_only = on`); live paper = `live_paper_questions` rows of the test's current `paper_version` ordered by `number`, joined to `questions_clean`; shape `paper.json` exactly like `paper_questions` + `LivePaperQuestionSerializer.strip_answers` at the pin (read both files; reproduce, do not guess); `bank.json` with the unstripped rows for static checks only; `manifest.json` with ids, section counts and `content_sha256`. Also `--ids file.txt` for papers not yet seeded as live tests.
- Fixture: `paper-review/fixtures/synthetic-paper/` with about 30 hand-written questions covering every `S-*` and `D-*` check (reuse the probe self-test cases) and their expected check ids. Never real question text.
- **Accept:** `paperqa static --paper fixtures/synthetic-paper` reports exactly the expected checks per fixture question; two runs give byte-identical `static.jsonl`; an export against a **local** database (MentorBox `local-stack` skill) matches the Django serializer output for the same test (write that comparison as a test).

### PR 3: desktop DOM pass
- `tools/dom_scan.mjs` (Playwright pinned to the version in `neet-renderer`), serve `harness/assets/katex/` on a loopback port and rewrite only the origin in each page, viewport from the profile (width = the WebView `innerWidth` the device pass measured, 360 by default; DPR 3), readiness rule, probe, `dom-chromium.jsonl`.
- CI job (GitHub Actions in this repo): probe self-test, static + DOM on the fixture, determinism (run twice, `cmp`), catalog validation.
- **Accept:** fixture expectations met for all `D-*` checks; CI green.

### PR 4: device pass with Patrol
- Patrol per `references/patrol-and-device.md` (patrol_cli 4.8.0, patrol ^4.10.0, wiring §3, test shape §4: one `patrolTest` that loops all questions, controller via `WebViewWidget.platform.params.controller`, double JSON decode, `captureDebugPrint`, `$.takeNativeScreenshot('q<NNN>')`, `MBQA_RESULT` lines).
- `paperqa device`: apply and record the profile (§5), copy the paper to `harness/assets/paper/current.json`, run `patrol test`, parse results into `dom-android.jsonl` + `device.jsonl`, rename screenshots by tag, sha256 them; `--shard k/n`.
- `tools/visual_scan.py`: `V-BLACK`, `V-BLANK` on the WebView rectangle.
- **Accept:** on the review AVD, the fixture paper's device results equal its expectations (allowing documented `X-ENGINE-DIFF`s); two runs give identical `dom-android.jsonl`; a deliberately locked screen produces `D-NOT-READY` for every question rather than a hang.

### PR 5: merge, catalog, report, fix plan
- `tools/merge_findings.py`: finding ids, dedupe, severity rules from the taxonomy, `X-ENGINE-DIFF`, catalog matching exactly as `references/bug-catalog.md` describes (including REGRESSION), `triage.md`, `REPORT.md` skeleton from `assets/report-template.md`.
- `tools/catalog.py`: `validate` (schema + taxonomy), `add` (next id), `match --bug --runs last:N`, `render` (`CATALOG.md`). Seed `catalog/bugs.jsonl` from `catalog-template/seed-bugs.jsonl`.
- `paperqa fix plan` (data transforms → staged `fixes.json`, re-render with `--override`, drop fixes that do not clear their findings), `apply.py` (dry-run default, refuses on `before_sha256` mismatch, `--commit` only by a human) and `rollback.py` generators.
- **Accept:** on the fixture, every finding is matched or listed as new; a planned fix for a `RB-0003` markdown case clears its findings under `--override`; `apply.py` without `--commit` writes nothing (prove with a read-only role).

### PR 6: parity, and bring the dashboard renderer up to the app
- `tools/parity_scan.ts`: `P-STRUCT-KIND`, `P-FLAGS`, `P-TEXT` between `neet-renderer` `renderQuestion` and the app pipeline dump on the same rows.
- Then, one small commit per behaviour, with a vitest each, port into `neet-renderer` what the app does and the TS renderer lacks, in this order: KaTeX de-bake from `<annotation encoding="application/x-tex">`; `linkifyImageUrls` (same regex, so the same gaps: parity, not improvement); `fixMathSpacingScripts`; `repairControlCharCommands`; statement label breaks (`extractStatement`); the sanitizer allowlist (same tags and attributes as `NR/pipeline.dart`). Improvements beyond parity (markdown, option images) go to the app first, then here.
- Add a `paper-review/fixtures/parity/` set and a CI gate: parity findings on it must be 0.
- **Accept:** `paperqa parity` on the fixture and on the first real paper: 0 `P-*` findings, or each remaining one listed with a reason in the PR.

### PR 7 (MentorBox monorepo, only with the owner's go-ahead): the app fixes the catalog points at
Each its own branch and PR in the monorepo, with a regression test built from the bug's synthetic repro (MentorBox `flutter-testing` / `django-verification` skills): RB-0001 (send and read `question_type` on the live path), RB-0002 (render option images), RB-0008 (wider `linkifyImageUrls`). Not part of PRs 1-6.

### PR 8 (`neet-question-pipeline`, optional): stop producing the bug classes
Importer changes for RB-0003 (no markdown), RB-0006 (no flex layouts), RB-0011 (no `\n` layout); point its render-check sidecar at the parity-fixed renderer.

## 3. Hard constraints (all PRs)

- Never write to any database. `SELECT` only on a read-only session; local experiments on a local clone (MentorBox `local-stack` skill).
- Never commit secrets, `.env*`, dumps, paper exports of real papers to a public place, or screenshots of real questions outside the private repo. `.mentorbox/`, `runs/**/shots/`, `runs/**/pages/` are gitignored.
- No LLM/VLM in any check or verdict.
- Deterministic outputs (`references/harness.md`, "Determinism rules"); every PR that adds a check adds its fixture case first and watches it fail.
- Do not modify the MentorBox app in PRs 1-6. If a harness need looks like it requires an app change (a test seam), stop and ask; the controller and probe approach in §4 of the Patrol reference needs none.
- Do not delete, skip or loosen a test to get green.

## 4. Done means

- `paperqa all --paper fixtures/synthetic-paper --serial <emulator>` passes, twice, byte-identical, and CI is green (without the device pass).
- `paperqa all` on `<first real paper>` produces `REPORT.md`, `triage.md` and catalog occurrences, reviewed by a human.
- The skill repo's `references/harness.md` matches what you built (update it in a PR there if not).
- Your final message lists: PRs with links, what each verified (commands + exit codes), pre-existing failures you found and did not fix, deviations from the contract and why, and anything a human must still do.
