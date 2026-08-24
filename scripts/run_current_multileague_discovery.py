from __future__ import annotations

import hashlib,json,sys,urllib.error,urllib.request
from datetime import datetime,timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'packages'/'gate1'))
from current_multileague_fixtures_results import SOURCES,parse_current_snapshot


def fetch(url):
    req=urllib.request.Request(url,headers={'User-Agent':'SPORTS-Decision-Intelligence-Research/0.1'})
    with urllib.request.urlopen(req,timeout=25) as r:
        return r.read()


def main(argv):
    out=Path(argv[1]) if len(argv)>1 else ROOT/'artifacts'/'current-multileague-discovery-v0.1.json'
    out.parent.mkdir(parents=True,exist_ok=True)
    observed=datetime.now(timezone.utc).isoformat().replace('+00:00','Z')
    leagues={}
    for source in SOURCES:
        try:
            raw=fetch(source.source_url)
            rows=parse_current_snapshot(raw.decode('utf-8-sig'),source=source,observed_at=observed)
            leagues[source.competition_id]={
                'availability':'AVAILABLE','source_url':source.source_url,'raw_sha256':hashlib.sha256(raw).hexdigest(),
                'rows_n':len(rows),'scheduled_n':sum(r.state=='SCHEDULED' for r in rows),'settled_n':sum(r.state=='SETTLED' for r in rows),
                'live_in_play_n':0,'live_in_play_supported':False,
            }
        except (urllib.error.HTTPError,urllib.error.URLError,TimeoutError,ValueError) as exc:
            leagues[source.competition_id]={
                'availability':'UNAVAILABLE_OR_UNPARSABLE','source_url':source.source_url,'reason':type(exc).__name__+':'+str(exc),
                'rows_n':0,'scheduled_n':0,'settled_n':0,'live_in_play_n':0,'live_in_play_supported':False,
            }
    report={
        'report_version':'CURRENT_MULTILEAGUE_SOURCE_DISCOVERY_V0_1','observed_at':observed,'season':'2026/27','leagues':leagues,
        'available_n':sum(v['availability']=='AVAILABLE' for v in leagues.values()),
        'governance':{'availability_discovery_not_coverage_guarantee':True,'live_in_play_claimed':False,'bookmaker_data_used':False,'capital_effect':'NONE'}
    }
    out.write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps({'available_n':report['available_n'],'leagues':leagues},indent=2))
    return 0

if __name__=='__main__': raise SystemExit(main(sys.argv))
