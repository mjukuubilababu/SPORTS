from __future__ import annotations
import argparse,json,os,re,shutil,subprocess,sys,tempfile,uuid
from pathlib import Path
from datetime import datetime, timezone
ROOT=Path(__file__).resolve().parents[1]
ART=ROOT/'artifacts'/'migrations'; ART.mkdir(parents=True,exist_ok=True)
MIGS=sorted(ROOT.glob('packages/infrastructure/*/*/migrations/*.sql'), key=lambda p: int(p.name[:4]))
EXPECTED=['0009','0010','0011','0012','0013','0014']

def run_psql(url, sql, label):
    p=subprocess.run(['psql',url,'-v','ON_ERROR_STOP=1','-X','-qAt','-c',sql],capture_output=True,text=True)
    return {'label':label,'returncode':p.returncode,'passed':p.returncode==0,'stdout':p.stdout,'stderr':p.stderr}

def run_file(url, schema, path, label):
    wrapper=f'SET search_path TO "{schema}", public;\n'+path.read_text(encoding='utf-8')
    with tempfile.NamedTemporaryFile('w',suffix='.sql',delete=False) as f:
        f.write(wrapper); tmp=f.name
    try:
        p=subprocess.run(['psql',url,'-v','ON_ERROR_STOP=1','-X','-qAt','-f',tmp],capture_output=True,text=True)
        return {'label':label,'file':str(path.relative_to(ROOT)),'returncode':p.returncode,'passed':p.returncode==0,'stdout':p.stdout,'stderr':p.stderr}
    finally:
        os.unlink(tmp)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--database-url',default=os.getenv('TEST_DATABASE_URL') or os.getenv('DATABASE_URL'))
    ap.add_argument('--keep-schema',action='store_true')
    args=ap.parse_args()
    if not shutil.which('psql'):
        print(json.dumps({'decision':'BLOCK_ENVIRONMENT','reason':'psql not installed'},indent=2)); return 2
    if not args.database_url:
        print(json.dumps({'decision':'BLOCK_ENVIRONMENT','reason':'TEST_DATABASE_URL/DATABASE_URL not provided'},indent=2)); return 2
    versions=[p.name[:4] for p in MIGS]
    if versions!=EXPECTED:
        print(json.dumps({'decision':'BLOCK','reason':'migration order mismatch','actual':versions,'expected':EXPECTED},indent=2)); return 1
    schema='di_assurance_'+uuid.uuid4().hex[:12]
    results=[]
    try:
        results.append(run_psql(args.database_url,f'CREATE SCHEMA "{schema}"; CREATE TABLE "{schema}".schema_migrations(version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now(), file_name text NOT NULL);','create_isolated_schema'))
        if not results[-1]['passed']: raise RuntimeError('schema creation failed')
        for p in MIGS:
            r=run_file(args.database_url,schema,p,f'apply_{p.name[:4]}'); results.append(r)
            if not r['passed']: raise RuntimeError(f'migration failed: {p.name}')
            v=p.name[:4]
            q=run_psql(args.database_url,f'''SET search_path TO "{schema}", public; INSERT INTO schema_migrations(version,file_name) VALUES ('{v}','{p.name}') ON CONFLICT(version) DO NOTHING;''',f'ledger_{v}'); results.append(q)
            if not q['passed']: raise RuntimeError('ledger write failed')
        # Re-apply verifies migration idempotency.
        for p in MIGS:
            r=run_file(args.database_url,schema,p,f'reapply_{p.name[:4]}'); results.append(r)
            if not r['passed']: raise RuntimeError(f'idempotent reapply failed: {p.name}')
        # Catalog verification.
        expected_tables=['system_events_v01','stage_runs_v01','identities_v01','security_audit_events_v01','build_artifacts_v01','deployment_results_v01','capacity_envelopes_v01','test_cases_v01','test_results_v01','assurance_gate_results_v01']
        arr=','.join("'%s'"%x for x in expected_tables)
        cat=run_psql(args.database_url,f'''SELECT count(*) FROM information_schema.tables WHERE table_schema='{schema}' AND table_name IN ({arr});''','catalog_tables'); results.append(cat)
        table_count=int(cat['stdout'].strip() or '0') if cat['passed'] else 0
        # 0014 schema check.
        crit=run_psql(args.database_url,f'''SELECT is_nullable||':'||data_type||':'||column_default FROM information_schema.columns WHERE table_schema='{schema}' AND table_name='test_results_v01' AND column_name='critical';''','critical_column'); results.append(crit)
        critical_ok=crit['passed'] and crit['stdout'].strip().startswith('NO:boolean:false')
        # Constraint negative tests: each command should FAIL.
        negative=[]
        neg_sql=[
          ('schema_version_constraint',f'''SET search_path TO "{schema}",public; INSERT INTO system_events_v01(event_id,event_type,schema_version,occurred_at,observed_at,producer,stage,correlation_id,idempotency_key,entity_type,entity_id,payload,lineage_refs,attempt,status) VALUES ('00000000-0000-0000-0000-000000000001','X','9.9',now(),now(),'t','s','c','i','e','1','{{}}','[]',0,'PENDING');'''),
          ('confidence_bounds',f'''SET search_path TO "{schema}",public; INSERT INTO capacity_forecasts_v01(forecast_id,generated_at,window_start,window_end,expected_matches,expected_peak_rps,expected_peak_quotes_per_second,expected_storage_gb,confidence) VALUES ('bad',now(),now(),now(),1,1,1,1,1.5);'''),
          ('poison_score_bounds',f'''SET search_path TO "{schema}",public; INSERT INTO poisoning_signals_v01(signal_id,detected_at,source_id,scope,anomaly_type,severity,score,action) VALUES ('00000000-0000-0000-0000-000000000002',now(),'s','x','a','HIGH',1.2,'BLOCK');''')]
        for name,sql in neg_sql:
            r=run_psql(args.database_url,sql,name); r['expected_failure']=True; r['passed_as_assertion']=r['returncode']!=0; negative.append(r)
        # Immutable trigger test: insert valid audit then UPDATE should fail.
        ins=run_psql(args.database_url,f'''SET search_path TO "{schema}",public; INSERT INTO security_audit_events_v01(event_id,occurred_at,identity_id,action,resource,environment,outcome,reason_codes) VALUES ('00000000-0000-0000-0000-000000000003',now(),'tester','READ','x','TEST','ALLOW','[]');''','insert_security_audit'); results.append(ins)
        upd=run_psql(args.database_url,f'''SET search_path TO "{schema}",public; UPDATE security_audit_events_v01 SET outcome='DENY' WHERE event_id='00000000-0000-0000-0000-000000000003';''','immutable_security_audit_update')
        immutable_ok=upd['returncode']!=0
        # Transaction rollback behavior.
        rb=run_psql(args.database_url,f'''BEGIN; SET search_path TO "{schema}",public; CREATE TABLE rollback_probe(id int); ROLLBACK; SELECT count(*) FROM information_schema.tables WHERE table_schema='{schema}' AND table_name='rollback_probe';''','transaction_rollback_probe'); results.append(rb)
        rollback_ok=rb['passed'] and rb['stdout'].strip().endswith('0')
        ledger=run_psql(args.database_url,f'''SELECT string_agg(version,',' ORDER BY version) FROM "{schema}".schema_migrations;''','ledger_order'); results.append(ledger)
        ledger_ok=ledger['passed'] and ledger['stdout'].strip()==','.join(EXPECTED)
        checks={
          'all_migrations_apply':all(r['passed'] for r in results if r['label'].startswith('apply_')),
          'idempotent_reapply':all(r['passed'] for r in results if r['label'].startswith('reapply_')),
          'expected_catalog_tables':table_count==len(expected_tables),
          'critical_column_0014':critical_ok,
          'constraint_negative_tests':all(x['passed_as_assertion'] for x in negative),
          'immutable_trigger_blocks_update':ins['passed'] and immutable_ok,
          'transaction_rollback':rollback_ok,
          'migration_ledger_exact':ledger_ok
        }
        decision='PASS' if all(checks.values()) else 'BLOCK'
        report={'report_version':'0.1','generated_at':datetime.now(timezone.utc).isoformat(),'database':'REDACTED','schema':schema,'versions':EXPECTED,'checks':checks,'results':results,'negative_assertions':negative,'decision':decision}
        (ART/'postgres-migration-verification.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
        print(json.dumps(report,indent=2))
        return 0 if decision=='PASS' else 1
    except Exception as e:
        report={'report_version':'0.1','generated_at':datetime.now(timezone.utc).isoformat(),'schema':schema,'decision':'BLOCK','error':str(e),'results':results}
        (ART/'postgres-migration-verification.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
        print(json.dumps(report,indent=2)); return 1
    finally:
        if args.database_url and shutil.which('psql') and not args.keep_schema:
            run_psql(args.database_url,f'DROP SCHEMA IF EXISTS "{schema}" CASCADE;','cleanup')

if __name__=='__main__': sys.exit(main())
