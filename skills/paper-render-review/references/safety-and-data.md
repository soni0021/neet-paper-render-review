# Safety, data handling and what may be published

Read this before the first database query of a review, and again before any commit or push. Every rule here comes from a real incident or a hard constraint in the MentorBox repos.

## 1. Databases are read-only for a review

- Every query a review runs is a `SELECT`. Open the session read-only first, so a mistake fails instead of writing:
  ```sql
  SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY;
  SET default_transaction_read_only = on;
  ```
  With `psql`, use `PGOPTIONS='-c default_transaction_read_only=on' psql "$DATABASE_URL" ...`.
- `public.questions` (the question bank's source table) is **immutable** for the QA pipeline. Nothing in a review writes to it, even through `questions_clean` tooling.
- The production Django database (live tests, test papers, attempts) is **never** written by an agent. That includes `UPDATE`, `INSERT`, `DELETE`, `ALTER`, `TRUNCATE`, a Django `migrate`, a management command with side effects, and "just one row" fixes.
- A data fix is a **staged artifact**, not a write:
  1. `fixes/<paper>/fixes.json`: one entry per question with `qid`, `field`, `before_sha256`, `after`, the bug id it closes (`RB-####`) and the evidence (finding ids and the after-fix render).
  2. `fixes/<paper>/apply.py` that **defaults to a dry run**, prints the diff, refuses to run when any row's current `sha256` differs from `before_sha256` (someone edited it since), and writes only with `--commit`.
  3. `fixes/<paper>/rollback.py` generated from the same `before` values.
  4. Only a named human runs `apply.py --commit`, after reading the dry-run output. The agent asks and waits; it never runs it on its own initiative, even when it has the credentials.
- Prefer a local clone of the database to experiment against. Seed a private test there, render it, and confirm the fix before anything is staged for production.

## 2. Secrets

- Connection strings, API keys, signing keys, dart-define files and `.env*` files are read by **name** through environment variables. Never print their values, paste them into a prompt, a log, a report, a catalog entry, a commit or an issue.
- If a credential file turns out to be tracked in git, reading it by key name is fine. Copying a value out of it is not. Report the file to the repo owner (privately, never in a public issue) so the secret can be rotated.
- A harness build that embeds a database credential (for example a direct-DB mock-test path) is extractable from the APK. Use a read-only, single-table role, and never install such a build on a device you do not control.

## 3. What may go into which repository

| Content | Public skill repo (this one) | Private QA repo (`neet-qa-platform`) | Never committed |
|---|---|---|---|
| Skill, prompts, taxonomy, catalog schema, synthetic examples | yes | copy allowed | |
| Real question text, options, solutions, paper exports | **no** | yes (`papers/`, gitignored if large) | |
| Screenshots of real questions | **no** | yes (or artifact storage) | |
| Bug catalog entries with real question ids | **no** | yes (`catalog/bugs.jsonl`) | |
| Renderer source copied from the app | **no** | yes (pinned vendor copy) | |
| Hostnames, bucket names, account ids, phone numbers, student data | **no** | no | yes |
| Credentials of any kind | **no** | no | yes |

Before any push to the public skill repo, run its `tools/validate.py` (it scans for hosts, keys, connection strings and phone numbers). Synthetic examples are written by hand to show the shape of a bug (for example `$\frac{a}{b}$` wrapped in baked KaTeX markup), never copied from a real paper.

## 4. No AI in the verdict

`neet-qa-platform` forbids LLM, VLM or AI judgement inside the QA pipeline. This skill follows that rule:

- Whether a question passes, and every finding's category, comes from **deterministic checks** (fixed code, fixed inputs, fixed device profile) plus **human review**.
- An agent may run the harness, read its output, match findings to the catalog, write the triage table, draft a fix and write a regression test. An agent never marks a question "renders fine" from looking at a screenshot. A screenshot is evidence for a human, not an oracle.
- The dashboard's advisory "Ask AI" button is out of scope here and must not be wired into this workflow.

## 5. Git hygiene (MentorBox and neet-qa repos)

- Work on a branch and open a PR. Never push to `main`: in the MentorBox monorepo a push to `main` deploys the backend (including `migrate` on production) and DeepTutor.
- Never run `git stash` (the stash stack is shared across worktrees and once leaked unrelated work into a ticket branch). Use a WIP commit.
- Never delete, skip or loosen a test to get green. A wrong test is fixed on purpose, with the reason written down.

## 6. Live and mock tests

- Freeze the paper before you review it: record its question ids and a content hash (`sha256` over the canonical JSON of every rendered field, ordered by question position). The review report states the hash. If the hash changes after review, the review is void and must be rerun on the changed questions at least.
- Students on an older app build cannot get a renderer fix before the test. For them, the only lever is a data fix. Every blocker on the store build therefore needs a data fix or an explicit, recorded decision to accept it.
- Private QA copies of a live test (seeded so a reviewer can open it on a phone) are cancelled or expired after the real test. The report lists any that were created.
