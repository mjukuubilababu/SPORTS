from __future__ import annotations
import subprocess, sys, json, hashlib, os
from pathlib import Path
from datetime import datetime, timezone

ROOT=Path(__file__).resolve().parents[1]
ART=ROOT/'artifacts'; ART.mkdir(exist_ok=True)

def run(name, cmd, cwd):
    p=subprocess.run(cmd,cwd=str(cwd),capture_output=True,text=True)
    return {'name':name,'command':cmd,'cwd':str(cwd.relative_to(ROOT)),'returncode':p.returncode,'passed':p.returncode==0,'stdout':p.stdout,'stderr':p.stderr}

results=[]
for i in range(1,7): results.append(run(f'gate{i}_acceptance',[sys.executable,f'test_gate{i}.py'],ROOT/f'packages/gate{i}'))
for name,script in [
    ('canonical_historical_truth_backfill','test_canonical_historical_pipeline.py'),
    ('cross_source_result_reconciler','test_cross_source_result_reconciler.py'),
    ('historical_closing_market_join','test_historical_closing_market_join.py'),
    ('gate2_gate3_settled_corpus','test_gate2_gate3_settled_corpus.py'),
    ('footiqo_fixture_reconciler','test_footiqo_fixture_reconciler.py'),
    ('gate3_gate4_real_robustness','test_gate3_gate4_real_robustness.py'),
    ('evaluation_freeze_challenger_protocol','test_evaluation_freeze_challenger_protocol.py'),
    ('negative_binomial_challenger','test_negbin_challenger.py'),
    ('blind_future_test_b','test_blind_future_test_b.py'),
    ('blind_future_test_b_state','verify_blind_future_test_b_state.py'),
    ('future_test_b_prematch_capture','test_future_test_b_capture.py'),
    ('future_test_b_transitions','test_future_test_b_transitions.py'),
    ('future_test_b_prematch_frozen','verify_future_test_b_prematch_frozen.py'),
]: results.append(run(name,[sys.executable,script],ROOT/'scripts'))
results.append(run('reference_e2e_verify',['npm','run','verify'],ROOT/'packages/reference-e2e'))

required=[
    ROOT/'contracts/artifact-registry.json', ROOT/'contracts/canonical-invariants.json',
    ROOT/'contracts/p002-frozen-rules.json', ROOT/'docs/ARCHITECTURE.md',
    ROOT/'contracts/blind-future-test-b-v0.1.json', ROOT/'packages/gate4/data/mls-2026-future-test-b-state-v0.1.json',
    ROOT/'contracts/future-test-b-capture-v0.1.json', ROOT/'packages/gate4/data/mls-2026-test-b-prematch-targets-2026-08-23.json',
    ROOT/'packages/gate4/data/mls-2026-test-b-prematch-frozen-2026-08-23.json'
]
struct_ok=all(p.exists() and p.stat().st_size>0 for p in required)
results.append({'name':'unified_structure','command':[],'cwd':'.','returncode':0 if struct_ok else 1,'passed':struct_ok,'stdout':f'required_files={len(required)}','stderr':''})

hashes=[]
for p in sorted(ROOT.rglob('*')):
    if not p.is_file(): continue
    rel=p.relative_to(ROOT)
    if '__pycache__' in rel.parts or rel.parts[0]=='artifacts' or p.suffix in {'.pyc','.sqlite'}: continue
    hashes.append({'path':str(rel),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size})
registry=json.loads((ROOT/'contracts/artifact-registry.json').read_text())
missing=registry['contracts_expected_but_not_physically_imported']
core_pass=all(r['passed'] for r in results); full_pass=core_pass and len(missing)==0
report={'report_version':'0.1','generated_at':datetime.now(timezone.utc).isoformat(),'core_integrated_assurance':'PROMOTE' if core_pass else 'BLOCK','full_platform_assurance':'PROMOTE' if full_pass else ('REVIEW_MISSING_IMPORTED_ARTIFACTS' if core_pass else 'BLOCK'),'capital_assurance':'LOCKED','capital_reason':'Engineering assurance is not empirical capital evidence.','tests_total':len(results),'tests_passed':sum(1 for r in results if r['passed']),'results':results,'missing_original_branch_artifacts':missing,'hash_inventory_count':len(hashes)}
(ART/'unified-verification-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
(ART/'SHA256_INVENTORY.json').write_text(json.dumps(hashes,indent=2),encoding='utf-8')
with (ART/'unified-verification.log').open('w',encoding='utf-8') as f:
    for r in results:
        f.write(f"=== {r['name']} passed={r['passed']} rc={r['returncode']} ===\n{r['stdout']}")
        if r['stderr']: f.write('\nSTDERR:\n'+r['stderr'])
        f.write('\n\n')
print(json.dumps({k:report[k] for k in ['core_integrated_assurance','full_platform_assurance','capital_assurance','tests_total','tests_passed','hash_inventory_count']},indent=2))
sys.exit(0 if core_pass else 1)
