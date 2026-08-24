from __future__ import annotations

import hashlib
import json
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'packages'/'gate1'))
from current_multileague_fixtures_results import SOURCES,parse_current_snapshot
from espn_current_fixture_provider import parse_scoreboard,source_by_competition as espn_source_by_competition,source_url as espn_source_url

LOOKBACK_DAYS=7
LOOKAHEAD_DAYS=14


def fetch(url):
    req=urllib.request.Request(url,headers={'User-Agent':'SPORTS-Decision-Intelligence-Research/0.1','Accept':'application/json,text/csv,*/*'})
    with urllib.request.urlopen(req,timeout=20) as r:
        return r.read()


def fetch_json(url):
    return json.loads(fetch(url).decode('utf-8'))


def _date_window(observed_dt):
    start=observed_dt.date()-timedelta(days=LOOKBACK_DAYS)
    end=observed_dt.date()+timedelta(days=LOOKAHEAD_DAYS)
    cursor=start
    while cursor<=end:
        yield cursor.strftime('%Y%m%d')
        cursor+=timedelta(days=1)


def discover_secondary(competition_id, observed, observed_dt):
    source=espn_source_by_competition(competition_id)
    dates=list(_date_window(observed_dt))
    outcomes=[]
    with ThreadPoolExecutor(max_workers=6) as pool:
        future_map={pool.submit(fetch_json,espn_source_url(source,date)):date for date in dates}
        for future in as_completed(future_map):
            date=future_map[future]
            url=espn_source_url(source,date)
            try:
                payload=future.result()
                parsed=parse_scoreboard(payload,source=source,observed_at=observed,request_url=url)
                outcomes.append((date,url,parsed,None))
            except (urllib.error.HTTPError,urllib.error.URLError,TimeoutError,ValueError,json.JSONDecodeError) as exc:
                outcomes.append((date,url,None,type(exc).__name__+':'+str(exc)))

    rows_by_id={}
    live_skipped=0
    request_errors=[]
    for date,url,parsed,error in sorted(outcomes,key=lambda row:row[0]):
        if error:
            request_errors.append({'date':date,'reason':error})
            continue
        live_skipped+=parsed.live_events_skipped_n
        for row in parsed.rows:
            prior=rows_by_id.get(row.provider_fixture_id)
            if prior and prior.source_event_sha256!=row.source_event_sha256:
                raise ValueError(f"ESPN_CURRENT_CROSS_DATE_EVENT_CONFLICT_{row.provider_fixture_id}")
            rows_by_id[row.provider_fixture_id]=row
    rows=list(rows_by_id.values())
    success_n=len(dates)-len(request_errors)
    if rows:
        availability='AVAILABLE_SECONDARY_DISCOVERY'
    elif success_n>0:
        availability='SECONDARY_AVAILABLE_EMPTY_WINDOW'
    else:
        availability='UNAVAILABLE_OR_UNPARSABLE'
    return {
        'availability':availability,
        'provider':'ESPN_SITE_SCOREBOARD',
        'source_class':source.source_class,
        'source_url_template':f"https://site.api.espn.com/apis/site/v2/sports/soccer/{source.league_slug}/scoreboard?dates=YYYYMMDD&limit=100",
        'window':{'lookback_days':LOOKBACK_DAYS,'lookahead_days':LOOKAHEAD_DAYS,'start':dates[0],'end':dates[-1]},
        'requests_n':len(dates),'request_success_n':success_n,'request_failure_n':len(request_errors),'request_errors':request_errors[:5],
        'rows_n':len(rows),'scheduled_n':sum(r.state=='SCHEDULED' for r in rows),'settled_n':sum(r.state=='SETTLED' for r in rows),
        'live_in_play_n':0,'live_events_skipped_n':live_skipped,'live_in_play_supported':False,
        'discovery_only':True,'strict_gate1_eligible':False,'bookmaker_data_used':False,'provider_prediction_used':False,
        'row_hash_inventory':[r.source_event_sha256 for r in rows],
    }


def main(argv):
    out=Path(argv[1]) if len(argv)>1 else ROOT/'artifacts'/'current-multileague-discovery-v0.1.json'
    out.parent.mkdir(parents=True,exist_ok=True)
    observed_dt=datetime.now(timezone.utc)
    observed=observed_dt.isoformat().replace('+00:00','Z')
    leagues={}
    for source in SOURCES:
        primary_failure=None
        try:
            raw=fetch(source.source_url)
            rows=parse_current_snapshot(raw.decode('utf-8-sig'),source=source,observed_at=observed)
            leagues[source.competition_id]={
                'availability':'AVAILABLE_PRIMARY','provider':'FOOTBALL_DATA_CO_UK','source_class':'PUBLIC_RESEARCH_DATASET',
                'source_url':source.source_url,'raw_sha256':hashlib.sha256(raw).hexdigest(),
                'rows_n':len(rows),'scheduled_n':sum(r.state=='SCHEDULED' for r in rows),'settled_n':sum(r.state=='SETTLED' for r in rows),
                'live_in_play_n':0,'live_events_skipped_n':0,'live_in_play_supported':False,
                'discovery_only':False,'strict_gate1_eligible':True,'bookmaker_data_used':False,'provider_prediction_used':False,
            }
            continue
        except (urllib.error.HTTPError,urllib.error.URLError,TimeoutError,ValueError) as exc:
            primary_failure=type(exc).__name__+':'+str(exc)

        try:
            fallback=discover_secondary(source.competition_id,observed,observed_dt)
            fallback['primary_source_url']=source.source_url
            fallback['primary_failure']=primary_failure
            leagues[source.competition_id]=fallback
        except (urllib.error.HTTPError,urllib.error.URLError,TimeoutError,ValueError) as exc:
            leagues[source.competition_id]={
                'availability':'UNAVAILABLE_OR_UNPARSABLE','provider':'NONE','primary_source_url':source.source_url,'primary_failure':primary_failure,
                'secondary_failure':type(exc).__name__+':'+str(exc),'rows_n':0,'scheduled_n':0,'settled_n':0,
                'live_in_play_n':0,'live_events_skipped_n':0,'live_in_play_supported':False,
                'discovery_only':True,'strict_gate1_eligible':False,'bookmaker_data_used':False,'provider_prediction_used':False,
            }

    rows_available=lambda row: row['rows_n']>0 and row['availability'] in {'AVAILABLE_PRIMARY','AVAILABLE_SECONDARY_DISCOVERY'}
    report={
        'report_version':'CURRENT_MULTILEAGUE_SOURCE_DISCOVERY_V0_2','observed_at':observed,'season':'2026/27','leagues':leagues,
        'available_n':sum(rows_available(v) for v in leagues.values()),
        'primary_available_n':sum(v['availability']=='AVAILABLE_PRIMARY' for v in leagues.values()),
        'secondary_discovery_available_n':sum(v['availability']=='AVAILABLE_SECONDARY_DISCOVERY' for v in leagues.values()),
        'strict_gate1_eligible_n':sum(v.get('strict_gate1_eligible') and rows_available(v) for v in leagues.values()),
        'governance':{
            'availability_discovery_not_coverage_guarantee':True,
            'secondary_source_is_public_unofficial':True,
            'secondary_source_discovery_only':True,
            'secondary_source_not_strict_gate1_eligible':True,
            'secondary_live_events_skipped_to_dedicated_live_pipeline':True,
            'complete_strict_truth_coverage_claimed':False,
            'live_in_play_claimed':False,
            'bookmaker_data_used':False,
            'provider_prediction_used':False,
            'capital_effect':'NONE'
        }
    }
    out.write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps({'available_n':report['available_n'],'primary_available_n':report['primary_available_n'],'secondary_discovery_available_n':report['secondary_discovery_available_n'],'leagues':leagues},indent=2))
    return 0

if __name__=='__main__': raise SystemExit(main(sys.argv))
