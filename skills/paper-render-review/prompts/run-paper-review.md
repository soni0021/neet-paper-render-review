# Prompt: review a paper before a mock or live test

For anyone in the org. Install the skill once (see the repo README), open Claude Code in your `neet-qa-platform` checkout (with the MentorBox monorepo cloned next to it), fill the `<...>` values, and paste everything below the line.

---

Use the `paper-render-review` skill to review a NEET paper's rendering before it goes to students. Follow the skill's steps 0-12 in order and do not skip the exit check of any step.

**Paper**
- Identity: `<live test id or slug | file with one question_id per line | pipeline mock_test_id + expected question count>`
- Render path: `live` (this is a mock / live test)
- Exam starts: `<YYYY-MM-DD HH:MM IST>`
- App builds students run: `main` and store build `<X.Y.Z+N>` (if you don't know the store build, ask me before step 2)
- Reviewer who signs: `<name>`
- Device: `<emulator AVD name | adb serial of a real phone>`

**What I want back**
1. Go / no-go against the skill's gate (step 11), first line of your answer.
2. Every blocker: question number, what a student sees, root cause layer, the fix you staged, before/after screenshot paths.
3. Majors: fixed or proposed for acceptance (I decide).
4. The staged data-fix plan (`fixes/<paper>/fixes.json` + the dry-run output). Do **not** apply it.
5. Catalog changes: new `RB-####` entries, occurrences added, regressions.
6. Anything the harness could not do (device pass skipped, image checks that failed on network, doctor items not green).
7. The PR link in `neet-qa-platform` with `REPORT.md`, `triage.md`, `findings.jsonl` and catalog changes.

**Rules (the skill has the detail; these are not negotiable)**
- Render with the app's own renderer at the pinned commit, on the `live` path. Never use the TS `neet-renderer`, the dashboard preview, a PDF or an LLM's opinion as "what the app shows".
- Deterministic checks decide. Screenshots are for me to look at.
- Read-only on every database. Do not run `apply.py --commit`, do not upload or overwrite images, do not change anything in production. Ask me when a step needs that.
- Before the first query, state which database and role you will read with (host only, never the password).
- Do not put real question text, screenshots or ids anywhere public.
- If the harness (`paper-review/` and the `paperqa` CLI) does not exist yet, stop and tell me; do not build a substitute renderer. The skill's "Commands when the harness is not built yet" section is the only allowed fallback, and the report must say the device pass did not run.
- If the paper changes while you work (manifest hash differs), stop, tell me, and restart from step 3 for the changed questions.
- Work on a branch `review/<paper>-<date>`; never push to `main`; never `git stash`.

Start with step 0: repeat back the inputs and anything missing, then run `paperqa doctor`.
