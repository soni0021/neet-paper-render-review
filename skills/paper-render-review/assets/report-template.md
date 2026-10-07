# Paper render review: <paper id>

> Copy into `runs/<paper>/<run-id>/REPORT.md` and fill every `<...>`. Keep it in the private QA repo: it names real questions.

| | |
|---|---|
| Paper | `<paper id>` (`<title>`), `<N>` questions, sections `<P / C / B / Z counts>` |
| Render path | `live` (mock / live test) |
| Exam starts | `<YYYY-MM-DD HH:MM IST>`; data-fix deadline `<T-24h>` |
| Paper hash | `content_sha256 = <hex>` (export `<timestamp>`); **still equal at sign-off: yes / no** |
| App pins | main `<sha>`; store build `<X.Y.Z+N>` = `<sha>` (renderer diff between them: `<none / files>`) |
| Harness | neet-qa-platform `<sha>`, probe `<mbqa-probe/x.y.z>`, taxonomy v`<n>` |
| Profiles | `android-360dp-api35` (WebView `<versionName>`), `chromium-360css-dpr3` (Chromium `<version>`) |
| Reviewer | `<name>` |

## Gate

| Rule | Result |
|---|---|
| 0 open blockers on every pinned build | `<pass / fail: n left>` |
| Every major fixed or accepted by name with a reason | `<pass / fail>` |
| Paper unchanged since export (`content_sha256`) | `<pass / fail>` |
| Device pass ran on every question | `<pass / fail: why not>` |
| **Verdict** | **GO / NO-GO** |

## Counts

| Category | Blocker | Major | Minor | Info | Matched bugs | New bugs |
|---|---|---|---|---|---|---|
| `<STRUCT.TYPE_MISSING_ON_PATH>` | `<n>` | | | | `RB-0001` | |
| ... | | | | | | |
| **Total** | | | | | | |

Questions with no finding: `<n>` / `<N>`.

## Blockers

One block per blocker (before and after the fix):

### Q`<n>` `<qid>`: `<category>` (`<RB-#### or NEW>`)
- Seen as: `<check ids, layers>`; `<one sentence: what a student sees>`
- Root cause: `<layer>`, `<evidence>`
- Fix: `<data / app / ...>`, `<what exactly>`, staged in `fixes/<paper>/fixes.json` entry `<k>`
- Screenshots: `shots/q<nnn>.png` (before), `<after run>/shots/q<nnn>.png` (after)
- Status: `<fixed in data by <name> on <date> | waiting for apply | accepted by <name>: <reason>>`

## Majors accepted without a fix

| Q | Category | Why accepted | Accepted by |
|---|---|---|---|

## Staged fixes

- `fixes/<paper>/fixes.json`: `<n>` rows, `apply.py` dry-run output attached below, `rollback.py` generated.
- Images to upload to NEW keys: `<list>`.
- Applied by `<name>` at `<time>`: `<yes / not yet>`.

## Catalog changes

- New bugs: `<RB-####: title>`
- Occurrences appended: `<RB-####>` x `<n>`
- Regressions: `<RB-#### on pin <sha>>`
- Taxonomy / check changes proposed: `<PR link or none>`

## Parity (dashboard vs app)

`<n>` `P-*` findings: `<summary: what the dashboard showed differently and the follow-up issue>`

## Limitations of this run

`<doctor items not green, profiles not run, questions that timed out, network failures during image checks>`

## Human spot-check

`<name>` viewed every blocker and major before/after pair and these 10 clean questions (first 10 by sha256(paper_id + qid)): `<list>`, on `<device>`. Result: `<ok / issues>`.

Signed: `<reviewer>`, `<date time>`.
