
from gate4_engine import *
import math

tests={}
tests["negbin_converges_poisson"] = abs(poisson_u35(3.0)-negbin_u35(3.0,1e6)) < 1e-5

rows=[]
for i in range(120):
    y=1 if (i%5)!=0 else 0
    regime="early" if i<40 else ("mid" if i<80 else "late")
    rows.append(ModelPrediction(
        match_id=f"m{i}", date=f"2025-{1+(i//28):02d}-{1+(i%28):02d}",
        season=2025, regime=regime, outcome_u35=y,
        market_prob=0.62, poisson_prob=0.70, negbin_prob=0.74,
        ensemble_prob=(0.79 if y==1 else 0.21),
        entry_odds=1.70, feature_values={"edge":6.0 if i<90 else 4.0}
    ))

scores=compare_models(rows)
tests["ensemble_best_logloss"] = scores["ensemble"].logloss < scores["market"].logloss
tests["ensemble_best_brier"] = scores["ensemble"].brier < scores["market"].brier
tests["champion_selection"] = choose_champion(scores)=="ensemble"

folds=walk_forward(rows,min_train=30,test_size=20)
tests["walkforward_created"] = len(folds)>0
tests["walkforward_has_scores"] = all("market" in f.scores for f in folds)

tests["three_regimes"] = len(regime_analysis(rows))==3

decision=challenger_decision(rows,"ensemble","market",min_n=100,min_walkforward_win_rate=.5,min_regime_win_rate=.5)
tests["challenger_promotes_when_dominant"] = decision.promote is True

decision2=challenger_decision(rows[:50],"ensemble","market",min_n=100,min_walkforward_win_rate=.5,min_regime_win_rate=.5)
tests["min_n_blocks"] = decision2.promote is False and decision2.pass_min_n is False

stable=threshold_stability(rows,"edge_pp",5.0,[4.5,5.5],lambda t:(lambda r:r.feature_values["edge"]>=t))
tests["threshold_result_constructed"] = stable.base_n>0 and len(stable.neighbor_n)==2

y=[r.outcome_u35 for r in rows]
base_probs={"market":[r.market_prob for r in rows],"poisson":[r.poisson_prob for r in rows],"negbin":[r.negbin_prob for r in rows]}
abl=ablation_report(base_probs,y,{"market":0.5,"poisson":0.3,"negbin":0.2})
tests["ablation_full_and_drops"] = set(abl.keys())=={"full","without_market","without_poisson","without_negbin"}
tests["scores_finite"] = all(math.isfinite(scores[m].logloss) for m in scores)

failed=[k for k,v in tests.items() if not v]
print(tests)
if failed:
    raise SystemExit("FAILED: "+", ".join(failed))
print("GATE4_ACCEPTANCE=PASS")
