# neet-paper-render-review

A Claude Code skill and prompts for reviewing a NEET question paper **before** a mock or live test: render every question exactly as the MentorBox Android app renders it, find rendering bugs with deterministic checks, and record each bug in a categorised catalog so the next similar bug is fixed by recipe instead of rediscovered.

Who uses it: anyone in the org who prepares a paper for students (QA reviewers, content team, engineers) and the coding agents they run.

## Why

A student sees the app's rendering, not the QA dashboard's, the PDF's, or the importer's. They differ: on the live/mock exam path the app receives no question type, so match tables and assertion-reason layouts are never built; option images are dropped; markdown shows literally; anything wider than the screen is silently clipped; very tall questions lose their bottom. Reviewing in any other renderer misses exactly these. This skill makes the app's own renderer, at a pinned commit, the oracle.

## What's inside

```
skills/paper-render-review/
  SKILL.md                       the workflow (12 steps, go / no-go gate)
  references/                    loaded on demand: render paths, harness contract, checks,
                                 Patrol + device profile, bug catalog, safety
  assets/probe.js                the deterministic DOM probe (runs in Chromium and Android WebView)
  assets/probe-selftest/         21 synthetic cases, run twice for byte-identical output
  assets/report-template.md      the review report and gate
  taxonomy/render-bug-taxonomy.yaml   44 categories, 62 check ids, mapped to existing flag names
  catalog-template/              bug + finding JSON schemas, 12 seed bugs (synthetic repros)
  prompts/
    run-paper-review.md          copy-paste prompt to review one paper
    implement-harness.md         prompt to build the harness in neet-qa-platform (8 small PRs)
    fix-bug-class.md             prompt to fix one bug class everywhere
tools/validate.py                repo validator (schemas, ids, links, no private data)
```

## Install

Into a project (recommended: the skill travels with the repo):

```bash
cd <your neet-qa-platform or mentorbox checkout>
npx --yes skills add soni0021/neet-paper-render-review -y
```

That copies the skill to `.agents/skills/paper-render-review/`, links it from `.claude/skills/` for Claude Code, and records it in `skills-lock.json` (tested 2026-10-07). In the MentorBox monorepo, whose `.claude/` holds real files only (its ADR-001), copy the folder to `.claude/skills/paper-render-review/` instead of linking it. Check with `/skills` in Claude Code.

## Use

1. **Once:** build the harness by pasting [skills/paper-render-review/prompts/implement-harness.md](skills/paper-render-review/prompts/implement-harness.md) into Claude Code in `neet-qa-platform`. It starts by asking you to confirm five assumptions.
2. **Before every mock / live test:** fill and paste [skills/paper-render-review/prompts/run-paper-review.md](skills/paper-render-review/prompts/run-paper-review.md). You get a go / no-go, the blockers with screenshots, staged data fixes (you apply them), and catalog updates.
3. **When one bug class is everywhere:** [skills/paper-render-review/prompts/fix-bug-class.md](skills/paper-render-review/prompts/fix-bug-class.md).

Running the MentorBox app and backend locally (to look at a seeded test on a phone) is a separate skill in the MentorBox monorepo: `.claude/skills/local-stack`.

## Principles

- **The app is the oracle.** Same Dart pipeline, same WebView page, same KaTeX (0.16.11, byte-identical to the app's vendored copy), at a recorded commit.
- **Deterministic.** Same inputs, same findings, byte for byte. No LLM or VLM in the verdict; screenshots are evidence for humans.
- **Read-only.** No database writes; data fixes are staged files a named human applies, with dry-run and rollback.
- **Learn once.** Every bug gets a category, a signature that matches its next occurrence, and a fix recipe.

## This repo is public

It holds only the method: no question text, no screenshots of real questions, no real question ids, no hostnames, buckets, credentials or student data. The real catalog and review reports live in the private QA repo. Before pushing, run:

```bash
python3 -m pip install pyyaml jsonschema
python3 tools/validate.py
cd skills/paper-render-review/assets/probe-selftest && npm ci && npx playwright install chromium && npm test
```

CI runs both on every push and pull request.

## Contributing

Branch, change, run the two commands above, open a PR. A new check needs a taxonomy row, a section in `references/checks.md` and a self-test case that fails without it. Never rename or reuse a check or category id.

## License

MIT, see [LICENSE](LICENSE).
