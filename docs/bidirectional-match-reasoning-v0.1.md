# Bidirectional Match Reasoning & Market Mapping v0.1

## Principle

The system must not start from a bookmaker market. It starts from independently derived team and match probabilities, evaluates each conclusion together with its counter-outcome, and maps the resulting match reality to available bookmaker markets only afterward.

## Analysis order

1. Independent team model.
2. Team reality map.
3. Bidirectional match truths.
4. Counter-outcome pressure.
5. Available market mapping.
6. Market price/fair-probability comparison.
7. Existing canonical qualification/final-prematch gates.

## Team reality

For each team v0.1 computes win/not-win, lose/not-lose, score/fail-to-score, score 2+, score 3+, clean-sheet/concede, and concede 2+ probabilities from the full-time score distribution.

## Match reality

V0.1 computes 1X2, double-chance components, BTTS yes/no, full-time totals, team totals, clean sheets, odd/even, exact total goals, team-to-score states and top correct-score probabilities.

Every binary claim carries both probability and counter-probability. Negative conclusions such as `TEAM NOT WIN`, `FAIL TO SCORE`, `BTTS NO`, `UNDER`, or `CONCEDE` are first-class predictions rather than exceptions.

## Certainty

Certainty is reduced uncertainty, not a guarantee. The engine records probability margin and binary entropy. `ROBUST_MODEL_TRUTH` additionally requires evidence maturity >=70, confirmed lineup gate PASS, and context risk below HIGH. Strong mathematics with weak context remains `MODEL_LEAN`.

## Market mapping

Current betPawa football rules expose, among others, full-time 1X2, totals, team totals, double chance, BTTS, clean sheet, correct score, team-to-score, odd/even, exact totals, and half-specific markets. V0.1 only assigns probabilities to market families derivable from the existing full-time score distribution.

First-half/second-half/HT-FT/half-with-more-goals and win-both/either-halves remain blocked until a separately validated half-specific scoring model exists. Player, card and corner markets similarly require their own event models.

## Probability versus value

The strongest match truth and the best priced market are deliberately separate rankings. A high-probability outcome is not automatically a value candidate. Edge requires a market fair probability; a value candidate additionally requires the configured minimum edge and positive expected value.

## Governance

- bookmaker odds cannot create team/model probabilities;
- unsupported markets cannot receive fabricated probabilities;
- market mapping happens after team/match reasoning;
- canonical lineup/context/evidence/market-conflict gates remain authoritative;
- capital remains locked and `realMoney` remains `NO`.
