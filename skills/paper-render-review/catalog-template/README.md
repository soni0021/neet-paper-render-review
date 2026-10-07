# Catalog template

The real bug catalog lives in the private QA repo (`neet-qa-platform/paper-review/catalog/bugs.jsonl`), because its occurrences name real question ids. This folder holds what is safe to share:

| File | What |
|---|---|
| [bug.schema.json](bug.schema.json) | JSON Schema for one catalog entry (`RB-####`): signature, root cause, fix recipe, synthetic repro, occurrences. |
| [finding.schema.json](finding.schema.json) | JSON Schema for one finding line in a run's `findings.jsonl`. |
| [seed-bugs.jsonl](seed-bugs.jsonl) | 12 known bug classes from MentorBox reviews and code reading up to 2026-10-07, with synthetic repros only. Start a new catalog from this file. |
| [example-finding.json](example-finding.json) | One valid finding. |

Validate a catalog:

```bash
python3 -m pip install jsonschema pyyaml
python3 - <<'EOF'
import json, jsonschema, yaml
schema = json.load(open('skills/paper-render-review/catalog-template/bug.schema.json'))
tax = yaml.safe_load(open('skills/paper-render-review/taxonomy/render-bug-taxonomy.yaml'))
v = jsonschema.Draft202012Validator(schema)
for n, line in enumerate(open('skills/paper-render-review/catalog-template/seed-bugs.jsonl'), 1):
    bug = json.loads(line)
    for e in v.iter_errors(bug):
        print(n, bug.get('id'), e.message)
    assert bug['category'] in tax['categories'], bug['id']
    assert all(c in tax['checks'] for c in bug['signature']['checks']), bug['id']
print('ok')
EOF
```

Rules (full text in [../references/bug-catalog.md](../references/bug-catalog.md)):

- Append-only, ordered by id, ids never reused.
- `synthetic_repro.input` is hand-written. Never paste real question text, even into the private catalog's repro field (occurrences carry the real ids instead).
- A `fixed-in-app` bug keeps matching: a hit on a pin that contains the fix is reported as a regression.
