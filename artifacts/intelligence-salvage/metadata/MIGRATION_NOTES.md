# MIGRATION_NOTES

Discovery/preservation only. No canonical files were edited and no migration was applied.

## Global governance
- Do not change P002 frozen thresholds.
- Do not promote live/paper observations into validation.
- Capital gate remains LOCKED.
- Do not replace canonical implementations automatically.
- Treat v0.3.0 market-anchor logic as superseded inside this lineage; v0.3.1 is the corrected local behavior.

## Market Surface / Target-Line Anchor
- NAME: Market Surface / Target-Line Anchor
- VERSION: v0.3.1
- PATH/FILENAME: selected-originals/Betting_Intelligence_v0.4.3_Later_Season_Recency.xlsx#Market_Surface_v0.3.1
- CLASSIFICATION: UNIQUE_HERE
- WHY IMPORTANT: Direct exact-line de-vig and cross-line λ inconsistency detection are not explicit in the canonical summary.
- CANONICAL COUNTERPART: Market Intelligence / market probability logic
- DIFFERENCE: v0.3.1 replaces indirect O2.5→U3.5 inference with direct O/U3.5 fair probability; cross-line λ gap becomes uncertainty signal.
- DEPENDENCIES: Same-book paired odds; timestamp integrity; market-line identifiers
- INVARIANTS: Never mix books/timestamps; target market line is primary anchor; old v0.3.0 indirect anchor is superseded; no capital promotion.
- TEST STATUS: Formula scan PASS; market-surface gate WATCH/FAIL by design.
- MIGRATION RISK: HIGH

## Confidence Budget
- NAME: Confidence Budget
- VERSION: v0.3.2
- PATH/FILENAME: selected-originals/Betting_Intelligence_v0.4.3_Later_Season_Recency.xlsx#Confidence_Budget_v0.3.2
- CLASSIFICATION: UNIQUE_HERE
- WHY IMPORTANT: Separates epistemic/evidence maturity from event probability and encodes hard promotion blockers.
- CANONICAL COUNTERPART: Assurance / capital gate
- DIFFERENCE: Adds penalty budget + critical-block count.
- DEPENDENCIES: Validation N; calibration status; drift; provider consistency; execution price
- INVARIANTS: Confidence score is not win probability; any critical block keeps promotion blocked.
- TEST STATUS: Authored/executed; promotion status BLOCKED, not PASS.
- MIGRATION RISK: MEDIUM

## Champion/Challenger Governance
- NAME: Champion/Challenger Governance
- VERSION: v0.3.2
- PATH/FILENAME: selected-originals/Betting_Intelligence_v0.4.3_Later_Season_Recency.xlsx#Champion_Challenger_v0.3.2
- CLASSIFICATION: UNIQUE_HERE
- WHY IMPORTANT: Explicit market-as-champion governance is not listed in the canonical summary.
- CANONICAL COUNTERPART: Evaluation/Learning
- DIFFERENCE: Challengers must beat market OOS before replacing/receiving material weight.
- DEPENDENCIES: OOS predictions; Brier/LogLoss/CLV/ROI
- INVARIANTS: No model promoted for sophistication or one-match performance.
- TEST STATUS: Authored; M011 challenger benchmark executed and failed.
- MIGRATION RISK: MEDIUM

## Source Quorum / Conflict Detector
- NAME: Source Quorum / Conflict Detector
- VERSION: v0.3.3
- PATH/FILENAME: selected-originals/Betting_Intelligence_v0.4.3_Later_Season_Recency.xlsx#Source_Quorum_v0.3.3
- CLASSIFICATION: UNIQUE_HERE
- WHY IMPORTANT: Specific source-quorum contract prevents guessed live state.
- CANONICAL COUNTERPART: Data Quality / Assurance
- DIFFERENCE: Tier-A minute+timestamp OR two independent exact-score agreement; conflicts preserve NULL.
- DEPENDENCIES: Source tiers; timestamps; event minute; independent-source identity
- INVARIANTS: Evidence > convenience; conflicts cannot be silently resolved; live state cannot rewrite pre-match.
- TEST STATUS: Authored/executed; current live verification gate FAIL correctly blocks model.
- MIGRATION RISK: MEDIUM

## Adaptive Reliability Weights
- NAME: Adaptive Reliability Weights
- VERSION: v0.3.3
- PATH/FILENAME: selected-originals/Betting_Intelligence_v0.4.3_Later_Season_Recency.xlsx#Adaptive_Weights_v0.3.3
- CLASSIFICATION: UNIQUE_HERE
- WHY IMPORTANT: Reliability multipliers create an explicit machine-governed ensemble influence layer.
- CANONICAL COUNTERPART: Model Intelligence / ensemble
- DIFFERENCE: effective weight = base×validation×calibration×freshness×drift×availability; M011/M012 remain 0.
- DEPENDENCIES: Model registry; validation/calibration/drift/freshness/availability signals
- INVARIANTS: Missing/unvalidated models can collapse to zero; current numeric base weights are provisional.
- TEST STATUS: Formula scan PASS; no OOS weight learning yet.
- MIGRATION RISK: HIGH

## Error Taxonomy
- NAME: Error Taxonomy
- VERSION: v0.3.3
- PATH/FILENAME: selected-originals/Betting_Intelligence_v0.4.3_Later_Season_Recency.xlsx#Error_Taxonomy_v0.3.3
- CLASSIFICATION: UNIQUE_HERE
- WHY IMPORTANT: Granular causal attribution can prevent incorrect retraining after variance/event shocks.
- CANONICAL COUNTERPART: Settlement/Attribution/Evaluation
- DIFFERENCE: Adds calibration/distribution/team-strength/finishing/event-shock/price/data/drift classes.
- DEPENDENCIES: Settlement; xG/process labels; events; CLV
- INVARIANTS: One result diagnoses but cannot retune parameters.
- TEST STATUS: Schema authored; downstream attribution not fully executed for settled match.
- MIGRATION RISK: LOW

## Probabilistic Brain
- NAME: Probabilistic Brain
- VERSION: v0.4.0
- PATH/FILENAME: selected-originals/Betting_Intelligence_v0.4.3_Later_Season_Recency.xlsx#Probabilistic_Brain_v0.4.0
- CLASSIFICATION: UNIQUE_HERE
- WHY IMPORTANT: Separates forecast probability, uncertainty envelope, evidence maturity and economic value.
- CANONICAL COUNTERPART: Model/Decision Intelligence
- DIFFERENCE: Adds reliability-weighted brain P, model envelope/spread, break-even and price EV alongside evidence blockers.
- DEPENDENCIES: Market surface; adaptive weights; confidence budget
- INVARIANTS: Probability != maturity != EV; capital gate independent; paper-only when blocked.
- TEST STATUS: Formula scan PASS; current EV/gates FAIL as intended.
- MIGRATION RISK: HIGH

## Evidence Graph
- NAME: Evidence Graph
- VERSION: v0.4.0
- PATH/FILENAME: selected-originals/Betting_Intelligence_v0.4.3_Later_Season_Recency.xlsx#Evidence_Graph_v0.4.0
- CLASSIFICATION: UNIQUE_HERE
- WHY IMPORTANT: Explicit evidence/provenance graph fields are not declared canonically.
- CANONICAL COUNTERPART: Evidence-gated lineage / Assurance
- DIFFERENCE: Each node has source tier, timestamp state, verification, decision weight, dependency.
- DEPENDENCIES: Source registry; model outputs; gates
- INVARIANTS: Unverified evidence cannot be promoted; provenance retained.
- TEST STATUS: Schema populated; no standalone unit-test file.
- MIGRATION RISK: MEDIUM

## Self Evaluation / Model Humility
- NAME: Self Evaluation / Model Humility
- VERSION: v0.4.0
- PATH/FILENAME: selected-originals/Betting_Intelligence_v0.4.3_Later_Season_Recency.xlsx#Self_Evaluation_v0.4.0
- CLASSIFICATION: UNIQUE_HERE
- WHY IMPORTANT: Machine self-checks explicitly block overclaiming and manual bypass.
- CANONICAL COUNTERPART: Assurance/Governance
- DIFFERENCE: Questions calibration, OOS superiority, distribution adequacy, price value and missing-data guesses.
- DEPENDENCIES: Evidence graph; calibration; validation; source quorum
- INVARIANTS: Critical gates cannot be manually overridden; no predictive-superiority claim without OOS proof.
- TEST STATUS: Authored/executed as gate table; several FAIL/WATCH states correctly remain.
- MIGRATION RISK: MEDIUM

## Bayesian Team Memory M011
- NAME: Bayesian Team Memory M011
- VERSION: v0.4.1
- PATH/FILENAME: selected-originals/Betting_Intelligence_v0.4.3_Later_Season_Recency.xlsx#Bayesian_Memory_v0.4.1 + Dynamic_Strength_v0.4.1
- CLASSIFICATION: UNIQUE_HERE
- WHY IMPORTANT: Hierarchical posterior attack/defense memory and explicit uncertainty are absent from the declared canonical list.
- CANONICAL COUNTERPART: Model Intelligence
- DIFFERENCE: Gamma-Poisson slow/venue memories, posterior SD, uncertainty propagation.
- DEPENDENCIES: Historical GF/GA; league prior; chronology
- INVARIANTS: Prior/context hyperparameters provisional; decision weight 0 until OOS; no one-match tuning.
- TEST STATUS: Walk-forward benchmark later executed and FAIL vs market; therefore 0 weight.
- MIGRATION RISK: HIGH

## Walk-Forward Bayesian Challenger
- NAME: Walk-Forward Bayesian Challenger
- VERSION: v0.4.2
- PATH/FILENAME: selected-originals/Betting_Intelligence_v0.4.3_Later_Season_Recency.xlsx#Walk_Forward_Bayes_v0.4.2 + Bayes_Governance_v0.4.2
- CLASSIFICATION: UNIQUE_HERE
- WHY IMPORTANT: Concrete chronological challenger evaluation is reusable and contains negative evidence that should not be lost.
- CANONICAL COUNTERPART: Evaluation/Learning
- DIFFERENCE: Fixed 2025 prior; every row predicts before its result; Brier/LogLoss vs market; prior-dominance flags.
- DEPENDENCIES: Chronological match rows; market O/U3.5 odds; fixed prior
- INVARIANTS: No future leakage; no hyperparameter selection on same seed; N>=3 validation pool requirement; market champion retained on failure.
- TEST STATUS: TEST_EXECUTED; TEST_FAIL: Bayes worse than market; validation N=0.
- MIGRATION RISK: HIGH

## Exact Team Chronology Data
- NAME: Exact Team Chronology Data
- VERSION: v0.4.3
- PATH/FILENAME: selected-originals/Betting_Intelligence_v0.4.3_Later_Season_Recency.xlsx#Team_Chronology_v0.4.3
- CLASSIFICATION: UNIQUE_HERE
- WHY IMPORTANT: Reusable research data: 38 exact pre-current SKC/STL rows with source links and season-total reconciliation.
- CANONICAL COUNTERPART: Canonical acquired match data
- DIFFERENCE: Small, match-specific sequence not known to exist canonically.
- DEPENDENCIES: FootyStats team pages; team IDs/names; dates/results
- INVARIANTS: Current match excluded; future leakage prohibited; research-only, not full-league validation.
- TEST STATUS: Reconciliation PASS for SKC 18/48 and STL 27/25.
- MIGRATION RISK: MEDIUM

## Recency Memory M012 / Change Point
- NAME: Recency Memory M012 / Change Point
- VERSION: v0.4.3
- PATH/FILENAME: selected-originals/Betting_Intelligence_v0.4.3_Later_Season_Recency.xlsx#Decay_Memory_v0.4.3 + Change_Point_v0.4.3 + Recency_Governance_v0.4.3
- CLASSIFICATION: UNIQUE_HERE
- WHY IMPORTANT: Time-decay and change-point challenger reduces small-venue overreaction and encodes anti-cherry-picking.
- CANONICAL COUNTERPART: Model/Regime Intelligence
- DIFFERENCE: Half-lives 3/5/8/12/20 evaluated diagnostically; STL recent attack shift flagged; all decision weights 0.
- DEPENDENCIES: Exact team chronology; prior; market anchor
- INVARIANTS: Half-life cannot be selected from current match; OOS selection required; venue-only 73.5% stays diagnostic and unpromoted.
- TEST STATUS: Formula scan PASS; chronology/robustness checks PASS; value gate FAIL; OOS selection missing.
- MIGRATION RISK: HIGH
