from __future__ import annotations
import json,re,hashlib,sys
from pathlib import Path
from datetime import datetime, timezone
ROOT=Path(__file__).resolve().parents[1]
ART=ROOT/'artifacts'/'migrations'; ART.mkdir(parents=True,exist_ok=True)
MIGS=sorted(ROOT.glob('packages/infrastructure/*/*/migrations/*.sql'), key=lambda p: int(p.name[:4]))
expected=['0009','0010','0011','0012','0013','0014']
rows=[]
for p in MIGS:
    txt=p.read_text(encoding='utf-8')
    prefix=p.name[:4]
    tables=re.findall(r'CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([a-zA-Z0-9_]+)',txt,re.I)
    triggers=re.findall(r'CREATE\s+TRIGGER\s+([a-zA-Z0-9_]+)',txt,re.I)
    functions=re.findall(r'CREATE\s+OR\s+REPLACE\s+FUNCTION\s+([a-zA-Z0-9_]+)',txt,re.I)
    destructive=bool(re.search(r'\b(DROP\s+TABLE|TRUNCATE|DROP\s+COLUMN)\b',txt,re.I))
    rows.append({'version':prefix,'file':str(p.relative_to(ROOT)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'tables':tables,'triggers':triggers,'functions':functions,'destructive_operation_detected':destructive})
versions=[r['version'] for r in rows]
checks={
 'versions_exact_order': versions==expected,
 'all_unique_versions': len(versions)==len(set(versions)),
 'no_destructive_table_or_column_ops': not any(r['destructive_operation_detected'] for r in rows),
 'immutable_trigger_0009': any('stage_runs_no_mutation' in r['triggers'] for r in rows if r['version']=='0009'),
 'immutable_trigger_0010': any('security_audit_no_mutation' in r['triggers'] for r in rows if r['version']=='0010'),
 'immutable_trigger_0011': any('build_artifacts_no_mutation' in r['triggers'] for r in rows if r['version']=='0011') and any('deployment_results_no_mutation' in r['triggers'] for r in rows if r['version']=='0011'),
 'immutable_trigger_0013': any('assurance_results_no_mutation' in r['triggers'] for r in rows if r['version']=='0013'),
 'repair_0014_adds_critical': any(r['version']=='0014' for r in rows) and 'ADD COLUMN IF NOT EXISTS critical boolean NOT NULL DEFAULT false' in next((Path(ROOT/r['file']).read_text() for r in rows if r['version']=='0014'),'')
}
report={'report_version':'0.1','generated_at':datetime.now(timezone.utc).isoformat(),'migration_count':len(rows),'expected_versions':expected,'actual_versions':versions,'checks':checks,'migrations':rows,'decision':'PASS' if all(checks.values()) else 'BLOCK'}
(ART/'static-migration-audit.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report,indent=2))
sys.exit(0 if report['decision']=='PASS' else 1)
