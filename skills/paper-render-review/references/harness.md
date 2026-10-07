# The review harness (`neet-qa-platform/paper-review/`)

This is the contract the skill relies on. [../prompts/implement-harness.md](../prompts/implement-harness.md) builds it; if the code and this file disagree after it lands, fix whichever is wrong in the same PR.

## Layout

```
neet-qa-platform/
  paper-review/
    README.md
    APP_PIN.json                 # pinned MentorBox commits + hashes (committed)
    device-profiles.yaml         # android-360dp-api35, chromium-360css-dpr3, ... (committed)
    paperqa                      # CLI entry (python3 paperqa.py <cmd>), stdlib + PyYAML
    paperqa.py
    tools/
      sync_app.py                # pin, checkout, asset copy, drift hashes, --check, --diff
      export_paper.py            # read-only export -> papers/<paper>/
      static_checks.py           # S-* checks over raw rows + pipeline dump
      dom_scan.mjs               # Playwright Chromium + probe.js -> dom-chromium.jsonl
      visual_scan.py             # V-* on screenshots
      parity_scan.ts             # TS renderQuestion vs app pipeline -> P-*
      merge_findings.py          # dedupe, finding ids, catalog match, triage.md, REPORT.md skeleton
      catalog.py                 # validate / add / match / render CATALOG.md
    probe/probe.js               # byte-identical copy of the skill's assets/probe.js (+ VERSION)
    probe/selftest/              # the skill's self-test, run in CI
    harness/                     # Flutter app that imports the pinned MentorBox app as a path dependency
      pubspec.yaml               #   mentorbox: {path: ../.mentorbox/flutter_app}; patrol (dev)
      assets/katex/              #   copied from the pin by sync_app.py (the app's KatexServer loads assets/katex/...)
      assets/paper/current.json  #   the paper under test, copied by `paperqa device`
      lib/main.dart              #   PaperHost: question N rendered exactly like the exam screen
      lib/paper_host.dart
      test/static_render_test.dart       # flutter test: pipeline dump + captured page HTML per question
      patrol_test/render_paper_test.dart # device pass
      android/                   #   Patrol runner, orchestrator, testBuildType wiring
    catalog/bugs.jsonl           # the real bug catalog (private; schema in the skill repo)
    catalog/CATALOG.md           # generated, human-readable
    taxonomy/render-bug-taxonomy.yaml  # synced from the skill repo, version-checked
    papers/<paper>/              # manifest.json committed; paper.json / bank.json gitignored if large
    runs/<paper>/<run-id>/       # findings.jsonl, triage.md, REPORT.md committed; shots/ and pages/ gitignored
    fixes/<paper>/               # fixes.json, apply.py (dry-run default), rollback.py
  .mentorbox/                    # gitignored checkout of the MentorBox monorepo at the pin (sparse: flutter_app/)
```

Why a path dependency on the app and not a port or a copy: the app's renderer is what students see. A TypeScript port (`neet-renderer`) already drifted (no de-bake, no markdown handling, different structure rules). A copied snapshot drifts the day after it is taken. Importing `package:mentorbox/...` at a pinned SHA means "sync to latest main" is one command and zero edits.

## CLI

| Command | Does | Writes |
|---|---|---|
| `paperqa doctor` | Checks Flutter (= monorepo CI pin), patrol_cli (>= 4.8.0), patrol package (>= 4.10.0), Android SDK, AVD from the profile, Node, Python, Playwright browser, read-only DB role. | nothing |
| `paperqa pin --ref main` / `--sha <sha>` / `--app-version X.Y.Z+N` | Fetches the monorepo (no submodules), checks out the SHA under `.mentorbox/`, copies `flutter_app/assets/katex/**` into `harness/assets/katex/`, records hashes. `--app-version` resolves the commit that introduced `version: X.Y.Z+N` in `flutter_app/pubspec.yaml`. | `APP_PIN.json` |
| `paperqa pin --check` | Fails if the checkout, the renderer tree hash, the asset hashes, or the exam screen's `QuestionWebView(...)` call hash differ from `APP_PIN.json`. | nothing |
| `paperqa pin --diff [--from <sha>]` | `git diff --stat` + full diff of the watched files between the previous and the current pin. | stdout |
| `paperqa export --paper <id> --path live` | Read-only. Resolves the paper (live test id/slug via `live_paper_questions`, or an id list), shapes `paper.json` exactly like the API for that path, writes `bank.json` and `manifest.json`. | `papers/<id>/` |
| `paperqa static --paper <id>` | `flutter test harness/test/static_render_test.dart` + `static_checks.py`. | `runs/.../static.jsonl`, `pages/<n>.html`, `pipeline.jsonl` |
| `paperqa dom --paper <id> --profile <p>` | Serves `harness/assets/katex/`, loads each page, waits for stability, runs the probe. | `dom-chromium.jsonl` |
| `paperqa device --paper <id> --serial <s> --profile <p>` | Applies the profile, `patrol test`, pulls screenshots, parses `MBQA_RESULT` lines. | `dom-android.jsonl`, `device.jsonl`, `shots/` |
| `paperqa visual --run <r>` | Pixel statistics per screenshot. | `visual.jsonl` |
| `paperqa parity --paper <id>` | TS `renderQuestion` vs the app pipeline on the same rows. | `parity.jsonl` |
| `paperqa merge --run <r>` | Dedupe, ids, catalog match, severity rules, triage table, report skeleton. | `findings.jsonl`, `triage.md`, `REPORT.md` |
| `paperqa all --paper <id> --serial <s>` | static → dom → device → visual → parity → merge. | all of the above |
| `--override fixes/<paper>/fixes.json` | On static/dom/device: render with the staged after-values instead of the bank values. | a separate run dir |

Exit codes: 0 clean, 1 findings at or above `--fail-on` (default `blocker`), 2 harness error (never mix the two).

## `APP_PIN.json`

```json
{
  "repo": "soni0021/mentorbox_monorepo",
  "pins": [
    {"ref": "main", "sha": "<40 hex>", "pinned_at": "2026-10-07T06:00:00Z"},
    {"ref": "1.1.40+51", "sha": "<40 hex>", "pinned_at": "..."}
  ],
  "active": "main",
  "flutter_ci": "3.44.1",
  "katex": "0.16.11",
  "watched": {
    "flutter_app/lib/features/shared/neet_renderer": "<git tree sha>",
    "flutter_app/lib/features/live_test/data/live_test_mapper.dart": "<blob sha>",
    "flutter_app/lib/features/live_test/domain/live_test.dart": "<blob sha>",
    "flutter_app/assets/katex": "<git tree sha>",
    "exam_question_web_view_call": "<sha256 of the QuestionWebView(...) argument block in live_exam_screen.dart>"
  },
  "host_reviewed_for": "<sha256 above, set by a human after updating PaperHost>"
}
```

`pin --check` fails when `exam_question_web_view_call != host_reviewed_for`: the exam screen changed how it calls the renderer and the harness host must be re-aligned before results mean anything.

## The host (`harness/lib/paper_host.dart`)

Renders question N of `assets/paper/current.json` the way the exam screen does, nothing more:

```dart
final q = paperQuestionFromJson(json);                       // the app's mapper
final rendered = renderQuestion(q.toRenderable().toRawQuestion(),
    opts: const RenderOptions(validateMath: false));          // the app's call
QuestionWebView(
  key: ValueKey('mbqa-q${q.number}'),
  question: rendered,
  selectedIndex: null, correctIndex: -1, revealed: false, locked: false, showSolution: false,
  onPick: (_) {}, background: DarkColors.bg,
  textStyle: const TextStyle(fontSize: 16, height: 1.45, fontWeight: FontWeight.w500, color: DarkColors.ink),
)
```

inside the same horizontal padding and `ListView` as the exam screen, under the same theme tone. Other paths (`practice`, `analysis`) get their own host when someone needs them; do not make one host "configurable" into something no screen does.

## Determinism rules

- Inputs are files (`paper.json`, `APP_PIN.json`, profile). No network except image fetches; image results are cross-checked by a host HEAD/GET with fixed retries and recorded.
- Readiness is a condition, not a sleep: probe `ready().key` identical for 3 polls 100 ms apart and `settled`, timeout 10 s → `D-NOT-READY`.
- Device state is set and recorded every run: `wm size 1080x2400`, `wm density 480` (360 dp), `font_scale 1.0`, the three animation scales 0, `stay_on_while_plugged_in`, locale `en-IN`, dark tone as the exam uses. The WebView `versionName` is recorded; a major different from the profile is reported.
- Output order is (position, field order, check, locator); finding ids hash `paper|qid|field|check|locator|profile`; timestamps live only in `run.json`.
- Acceptance test for the harness: run `paperqa all` twice on the fixture paper; `findings.jsonl` must be byte-identical.
