from __future__ import annotations
import subprocess, sys, json, hashlib, shutil
from pathlib import Path
from datetime import datetime, timezone
ROOT=Path(__file__).resolve().parents[1]; ART=ROOT/'artifacts'; ART.mkdir(exist_ok=True)
def run(name,cmd,cwd):
 p=subprocess.run(cmd,cwd=str(cwd),capture_output=True,text=True)
 return {'name':name,'command':cmd,'cwd':str(cwd.relative_to(ROOT)),'returncode':p.returncode,'passed':p.returncode==0,'stdout':p.stdout,'stderr':p.stderr}
results=[]
for i in range(1,7): results.append(run(f'gate{i}_acceptance',[sys.executable,f'test_gate{i}.py'],ROOT/f'packages/gate{i}'))
results.append(run('reference_e2e_verify',['npm','run','verify'],ROOT/'packages/reference-e2e'))
results.append(run('migration_static_audit',[sys.executable,'scripts/migration_static_audit.py'],ROOT))
results.append(run('intelligence_engine_verify',['npm','test'],ROOT/'packages/intelligence-engine'))
results.append(run('qualified_set_contract_verify',['node','--test','tests/qualified-set.test.mjs'],ROOT/'packages/reference-e2e'))
infra=sorted((ROOT/'packages/infrastructure').glob('*/*/package.json'))
for pj in infra:
 d=pj.parent; results.append(run('infra_'+d.name,['npm','run','check'],d))
# Original transfer hash verification against transfer manifest copied into report evidence.
orig=ROOT/'packages/infrastructure-original'
expected={
'global-football-system-integration-orchestration-observability-contract-v0.1.zip':'0be4c558a1f036b06cb02127debad5818f3087cb976d3fc31368607caaecb42d',
'global-football-security-identity-access-data-governance-contract-v0.1.zip':'5ffb3fa68dbb7c09babdda28b5c3670e61abb2b9241100f2cfbc340e2515731f',
'global-football-deployment-configuration-environment-management-contract-v0.1.zip':'84797953f7c827f9e8ab7c6214bbf759dc50476f9fc0a2bb774698e1d6407779',
'global-football-capacity-scalability-cost-governance-contract-v0.1.zip':'41dafa1a4d830047f7cebd315fc30cc7f4f4261b14155c93158a4bb94726b7e0',
'global-football-testing-verification-system-assurance-contract-v0.1.zip':'c950a1060f6d7267677900354c2d9038886caa6d0c10bd7e7ad0e4d37209d28f'}
hash_checks=[]
for fn,exp in expected.items():
 p=orig/fn; act=hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None
 hash_checks.append({'file':fn,'expected':exp,'actual':act,'passed':act==exp})
# PostgreSQL migrations are present but cannot truthfully be called applied without a PostgreSQL runtime.
migrations=sorted(ROOT.glob('packages/infrastructure/*/*/migrations/*.sql'), key=lambda p:int(p.name[:4]))
migration_status={'authored_count':len(migrations),'files':[str(p.relative_to(ROOT)) for p in migrations], 'postgres_runtime_available':bool(shutil.which('psql') and shutil.which('postgres')), 'applied_to_test_db':False, 'verified_on_postgres':False}
runtime_pass=all(x['passed'] for x in results) and all(x['passed'] for x in hash_checks)
full='REVIEW_EXTERNAL_POSTGRES_TEST_REQUIRED' if runtime_pass and not migration_status['verified_on_postgres'] else ('PROMOTE' if runtime_pass else 'BLOCK')
report={'report_version':'0.5','generated_at':datetime.now(timezone.utc).isoformat(),'core_integrated_assurance':'PROMOTE' if all(x['passed'] for x in results[:8]) else 'BLOCK','infrastructure_runtime_assurance':'PROMOTE' if all(x['passed'] for x in results if x['name'].startswith('infra_')) and all(x['passed'] for x in hash_checks) else 'BLOCK','intelligence_runtime_assurance':'PROMOTE' if any(x['name']=='intelligence_engine_verify' and x['passed'] for x in results) else 'BLOCK','qualified_set_assurance':'PROMOTE' if any(x['name']=='qualified_set_contract_verify' and x['passed'] for x in results) else 'BLOCK','full_platform_assurance':full,'capital_assurance':'LOCKED','capital_reason':'Engineering assurance is not empirical capital evidence.','runtime_checks_total':len(results),'runtime_checks_passed':sum(x['passed'] for x in results),'results':results,'original_transfer_hash_checks':hash_checks,'migration_status':migration_status,'integration_defects':['artifacts/defects/DEFECT-ASSURANCE-001.json']}
(ART/'full-platform-verification-report.json').write_text(json.dumps(report,indent=2))
with (ART/'full-platform-verification.log').open('w') as f:
 for r in results:
  f.write(f"=== {r['name']} passed={r['passed']} rc={r['returncode']} ===\n{r['stdout']}\n{r['stderr']}\n")
print(json.dumps({k:report[k] for k in ['core_integrated_assurance','infrastructure_runtime_assurance','full_platform_assurance','capital_assurance','runtime_checks_total','runtime_checks_passed','migration_status']},indent=2))
sys.exit(0 if runtime_pass else 1)
