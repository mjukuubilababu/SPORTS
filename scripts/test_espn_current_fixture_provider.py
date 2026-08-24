from __future__ import annotations

import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'packages'/'gate1'))

from espn_current_fixture_provider import parse_scoreboard, source_by_competition, source_manifest, source_url


def event(event_id='1001', state='pre', completed=False, home_score=None, away_score=None):
    return {
        'id':event_id,
        'date':'2026-08-29T14:00:00Z',
        'status':{'type':{'state':state,'completed':completed}},
        'competitions':[{'competitors':[
            {'id':'10','homeAway':'home','score':home_score,'team':{'id':'10','displayName':'Alpha FC'}},
            {'id':'20','homeAway':'away','score':away_score,'team':{'id':'20','displayName':'Beta FC'}},
        ]}]
    }


def expect_error(fn, fragment):
    try: fn()
    except ValueError as exc: assert fragment in str(exc), (fragment,str(exc))
    else: raise AssertionError(fragment)


def main()->int:
    src=source_by_competition('EPL')
    url=source_url(src,'20260829')
    payload={'events':[event(),event('1002','post',True,'2','1'),event('1003','in',False,'1','0')]}
    result=parse_scoreboard(payload,source=src,observed_at='2026-08-25T00:00:00Z',request_url=url)
    assert len(result.rows)==2 and result.live_events_skipped_n==1
    scheduled,settled=result.rows
    assert scheduled.state=='SCHEDULED' and scheduled.home_goals is None and scheduled.result is None
    assert settled.state=='SETTLED' and settled.home_goals==2 and settled.away_goals==1 and settled.result=='H'
    for row in result.rows:
        assert row.discovery_only is True
        assert row.strict_gate1_eligible is False
        assert row.live_in_play_supported is False
        assert row.bookmaker_data_used is False
        assert row.provider_prediction_used is False
        assert len(row.source_event_sha256)==64
        assert row.fixture_id.startswith('EPL-ESPN-')
    manifest=source_manifest()
    assert len(manifest['sources'])==5
    assert manifest['governance']['public_unofficial_source'] is True
    assert manifest['governance']['strict_gate1_eligible'] is False
    expect_error(lambda:parse_scoreboard({'events':[event('1','mystery')]},source=src,observed_at='2026-08-25T00:00:00Z',request_url=url),'STATUS_UNSUPPORTED')
    expect_error(lambda:parse_scoreboard({'events':[event('1','post',True,None,'1')]},source=src,observed_at='2026-08-25T00:00:00Z',request_url=url),'SETTLED_SCORE_REQUIRED')
    expect_error(lambda:source_url(src,'2026-08-29'),'DATE_QUERY_INVALID')
    print('ESPN_CURRENT_FIXTURE_PROVIDER=PASS')
    return 0

if __name__=='__main__': raise SystemExit(main())
