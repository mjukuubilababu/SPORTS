from __future__ import annotations

import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'packages'/'gate1'))

from current_multileague_fixtures_results import parse_current_snapshot, source_by_competition, source_manifest


def expect_error(fn, fragment):
    try: fn()
    except ValueError as exc: assert fragment in str(exc), (fragment,str(exc))
    else: raise AssertionError(fragment)


def main()->int:
    manifest=source_manifest()
    assert len(manifest['sources']) == 5
    assert manifest['semantics']['live_in_play_supported'] is False
    epl=source_by_competition('EPL')
    text='Div,Date,Time,HomeTeam,AwayTeam,FTHG,FTAG,FTR\nE0,22/08/2026,15:00,Alpha,Beta,2,1,H\nE0,29/08/2026,17:30,Gamma,Delta,,,\n'
    rows=parse_current_snapshot(text,source=epl,observed_at='2026-08-24T19:00:00Z')
    assert len(rows)==2
    assert rows[0].state=='SETTLED' and rows[0].result=='H'
    assert rows[1].state=='SCHEDULED' and rows[1].result is None
    assert rows[0].live_in_play_supported is False
    assert rows[0].bookmaker_data_used is False
    assert len(rows[0].source_row_sha256)==64
    expect_error(lambda:parse_current_snapshot('Div,Date,HomeTeam,AwayTeam,FTHG,FTAG\nE0,22/08/2026,A,B,1,\n',source=epl,observed_at='2026-08-24T19:00:00Z'),'PARTIAL_FINAL_SCORE')
    expect_error(lambda:parse_current_snapshot(text.replace('E0,','SP1,',1),source=epl,observed_at='2026-08-24T19:00:00Z'),'DIVISION_MISMATCH')
    expect_error(lambda:parse_current_snapshot(text,source=epl,observed_at='2026-08-24T19:00:00'),'TIMEZONE_REQUIRED')
    print('CURRENT_MULTILEAGUE_FIXTURES_RESULTS=PASS')
    return 0

if __name__=='__main__': raise SystemExit(main())
