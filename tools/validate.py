#!/usr/bin/env python3
"""Validate this repository: taxonomy, schemas, seed catalog, probe ids, links, and
that nothing private slipped in. Run before every push; CI runs it too.

  python3 -m pip install pyyaml jsonschema
  python3 tools/validate.py
"""
import json
import re
import sys
from pathlib import Path

import jsonschema
import yaml

ROOT = Path(__file__).resolve().parents[1]
problems = []


def fail(msg):
    problems.append(msg)


# 1. Taxonomy: every check maps to a category; every category signal is a check.
tax = yaml.safe_load((ROOT / 'skills/paper-render-review/taxonomy/render-bug-taxonomy.yaml').read_text())
cats, checks = tax['categories'], tax['checks']
for cid, c in checks.items():
    if not re.fullmatch(r'[SDHVPX]-[A-Z0-9-]+', cid):
        fail(f'bad check id {cid}')
    for target in [c['category']] + [w['category'] for w in c.get('when', [])]:
        if target not in cats:
            fail(f'check {cid} -> unknown category {target}')
for name, c in cats.items():
    for key in ('title', 'student_sees', 'default_severity', 'root_cause_layers', 'signals', 'fix_playbook', 'synthetic_example'):
        if key not in c:
            fail(f'category {name} missing {key}')
    if c.get('default_severity') not in ('blocker', 'major', 'minor', 'info'):
        fail(f'category {name} bad severity')
    for s in c.get('signals', []):
        if s not in checks:
            fail(f'category {name} -> unknown signal {s}')

# 2. Probe ids == taxonomy D- ids.
probe = (ROOT / 'skills/paper-render-review/assets/probe.js').read_text()
probe_ids = set(re.findall(r"'(D-[A-Z-]+)'", probe))
tax_d = {k for k in checks if k.startswith('D-')}
if probe_ids != tax_d:
    fail(f'probe/taxonomy D- mismatch: probe-only {sorted(probe_ids - tax_d)}, taxonomy-only {sorted(tax_d - probe_ids)}')

# 3. Schemas and the seed catalog.
bug_schema = json.loads((ROOT / 'skills/paper-render-review/catalog-template/bug.schema.json').read_text())
finding_schema = json.loads((ROOT / 'skills/paper-render-review/catalog-template/finding.schema.json').read_text())
for s in (bug_schema, finding_schema):
    jsonschema.Draft202012Validator.check_schema(s)
bv = jsonschema.Draft202012Validator(bug_schema)
ids = []
for n, line in enumerate((ROOT / 'skills/paper-render-review/catalog-template/seed-bugs.jsonl').read_text().splitlines(), 1):
    bug = json.loads(line)
    ids.append(bug['id'])
    for e in bv.iter_errors(bug):
        fail(f'seed-bugs.jsonl:{n} {bug.get("id")}: {e.message[:160]}')
    if bug.get('category') not in cats:
        fail(f'{bug["id"]}: unknown category')
    for c in bug['signature']['checks']:
        if c not in checks:
            fail(f'{bug["id"]}: unknown check {c}')
if ids != sorted(ids) or len(ids) != len(set(ids)):
    fail('seed-bugs.jsonl ids must be unique and ordered')
fv = jsonschema.Draft202012Validator(finding_schema)
for e in fv.iter_errors(json.loads((ROOT / 'skills/paper-render-review/catalog-template/example-finding.json').read_text())):
    fail(f'example-finding.json: {e.message[:160]}')

# 4. Relative markdown links resolve.
for md in ROOT.rglob('*.md'):
    if 'node_modules' in md.parts:
        continue
    prose = re.sub(r'```.*?```', '', md.read_text(), flags=re.S)   # code blocks
    prose = re.sub(r'`[^`\n]*`', '', prose)                         # inline code
    for target in re.findall(r'\]\(([^)#\s]+)(?:#[^)]*)?\)', prose):
        if re.match(r'[a-z]+:', target):
            continue
        if not (md.parent / target).resolve().exists():
            fail(f'{md.relative_to(ROOT)}: broken link {target}')

# 5. Nothing private: hosts, buckets, keys, phone numbers other than the demo/placeholder ones.
PRIVATE = [
    (r'neon\.tech', 'a Neon hostname'),
    (r'amazonaws\.com', 'an AWS hostname'),
    (r'\bep-[a-z]+-[a-z]+-[a-z0-9]+\b', 'a Neon endpoint id'),
    (r'AKIA[0-9A-Z]{16}', 'an AWS access key'),
    (r'(?i)(api[_-]?key|secret|password|token)\s*[=:]\s*["\']?[A-Za-z0-9/+_\-]{16,}', 'a credential-looking assignment'),
    (r'postgres(?:ql)?://[^\s:@/]+:[^\s@/<]+@', 'a connection string with a password'),
    (r'-----BEGIN [A-Z ]*PRIVATE KEY-----', 'a private key'),
    (r'\b[6-9]\d{9}\b', 'a 10-digit mobile number'),
]
ALLOWED_NUMBERS = set()  # never whitelist a real login, not even a demo account
for f in ROOT.rglob('*'):
    if not f.is_file() or 'node_modules' in f.parts or '.git' in f.parts or f.suffix in ('.png', '.lock') or f.name == 'package-lock.json':
        continue
    text = f.read_text(errors='ignore')
    for pat, what in PRIVATE:
        for m in re.finditer(pat, text):
            if what == 'a 10-digit mobile number' and m.group(0) in ALLOWED_NUMBERS:
                continue
            if f.name == 'validate.py':
                continue
            fail(f'{f.relative_to(ROOT)}: looks like {what}: {m.group(0)[:40]}')

if problems:
    print('\n'.join('FAIL ' + p for p in problems))
    sys.exit(1)
print(f'ok: {len(checks)} checks, {len(cats)} categories, {len(ids)} seed bugs, probe ids match, links resolve, no private data found')
