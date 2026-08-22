
from gate2_engine import *
import math

def assert_close(a,b,tol=1e-9):
    assert abs(a-b) <= tol, (a,b)

# Synthetic chronological sequence for two teams.
matches = [
    Match("2025-01-01",2025,"MLS","A","X",1,0),
    Match("2025-01-02",2025,"MLS","Y","B",0,2),
    Match("2025-01-08",2025,"MLS","A","Y",2,1),
    Match("2025-01-09",2025,"MLS","X","B",1,1),
    Match("2025-01-15",2025,"MLS","A","X",1,2),
    Match("2025-01-16",2025,"MLS","Y","B",2,3),
    Match("2025-01-23",2025,"MLS","A","B",4,4, o35=2.20, u35=1.62, lineup_state="PASS")
]

rows = build_features(matches)
target = rows[-1]

tests = {}
tests["warmup_pass_after_3_prior_each"] = target.warmup_pass is True

# Verify current match 4-4 is NOT included in its own prior averages.
tests["no_hindsight_home_prior"] = target.home_prior_n == 3
tests["no_hindsight_away_prior"] = target.away_prior_n == 3

# Home A at home: (1-0, 2-1, 1-2) => GF 4/3, GA 1
assert_close(target.home_home.gf, 4/3)
assert_close(target.home_home.ga, 1.0)
tests["venue_stats_correct"] = True

# B away: (2-0,1-1,3-2) from B perspective => GF 2, GA 1
assert_close(target.away_away.gf, 2.0)
assert_close(target.away_away.ga, 1.0)
tests["away_venue_stats_correct"] = True

# Venue expected total:
# home lambda = avg(A home GF=1.3333, B away GA=1.0)=1.1666667
# away lambda = avg(B away GF=2.0, A home GA=1.0)=1.5
venue_total = (4/3 + 1)/2 + (2 + 1)/2
assert_close(target.venue_home_lambda + target.venue_away_lambda, venue_total)
tests["pair_expected_formula_correct"] = True

# With only 3 prior matches, last10 and last5 are the same as overall.
overall_A_gf=(1+2+1)/3
overall_A_ga=(0+1+2)/3
overall_B_gf=(2+1+3)/3
overall_B_ga=(0+1+2)/3
l10_total = ((overall_A_gf+overall_B_ga)/2)+((overall_B_gf+overall_A_ga)/2)
expected_pre = 0.5*venue_total + 0.3*l10_total + 0.2*l10_total
assert_close(target.pre_lineup_lambda, expected_pre)
tests["frozen_50_30_20_lambda_correct"] = True

# Poisson identity
assert_close(poisson_u35(3.0), sum(math.exp(-3)*3**k/math.factorial(k) for k in range(4)))
tests["poisson_u35_correct"] = True

# De-vig identity
mp = devig_u35(2.20,1.62)
expected = (1/1.62)/((1/2.20)+(1/1.62))
assert_close(mp, expected)
tests["devig_correct"] = True

# Warm-up should fail earlier.
tests["early_rows_blocked"] = all(r.warmup_pass is False for r in rows[:6])

failed=[k for k,v in tests.items() if not v]
print(tests)
if failed:
    raise SystemExit("FAILED: "+", ".join(failed))
print("GATE2_ACCEPTANCE=PASS")
