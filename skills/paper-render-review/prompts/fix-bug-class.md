# Prompt: fix one bug class everywhere it occurs

Use after a review when one catalog bug (`RB-####`) affects many questions, or to clear a category across the whole question bank before a series of tests. Fill the `<...>` values and paste below the line into Claude Code in `neet-qa-platform`.

---

Use the `paper-render-review` skill (references `bug-catalog.md`, `checks.md`, `safety-and-data.md`). Goal: fix every occurrence of catalog bug `<RB-####>` in `<one paper id | the questions listed in file X | every questions_clean row that matches the signature>`, and stop the class from coming back.

1. Read the bug entry: category, signature, root cause, fix recipe, `data_transform`, `workaround_for_old_builds`. Summarise it back to me in 3 lines.
2. Find the occurrences deterministically: run the checks in the bug's signature over the scope (`paperqa static` / `dom` for a paper; for the whole bank, a read-only batch over `questions_clean` with the same static checks). List counts per check and 5 example question ids (ids only, no text).
3. Plan the fix (`paperqa fix plan`): apply the recipe in memory, re-render every planned row with `--override` through static + DOM (+ the device pass for blockers on a sample of at least 20 rows chosen by `sha256(qid)` order), and drop any planned fix that does not clear its findings or that creates a new finding. Report: planned, cleared, dropped (with why).
4. If the root cause is in code (`app-*`, `backend-payload`, `importer`), also prepare the code fix as its own PR in the right repo, with a regression test built from the bug's `synthetic_repro`, and keep the data fix as the workaround for the store build.
5. Update the catalog: occurrences (paper ids / scope, qids, finding ids), status (`data-fix-staged`), `prs`. If you had to change the signature or recipe, explain why in `notes`.
6. Stop there. Give me the staged `fixes.json`, the dry-run output of `apply.py`, before/after screenshot pairs for 10 rows, and the PR links. I apply the data fix myself; you never run `apply.py --commit` or write to any database.

Rules: deterministic checks decide; no LLM-judged "looks fixed"; never paste real question text anywhere public; never overwrite an existing image key; branch + PR, never `main`, never `git stash`.
