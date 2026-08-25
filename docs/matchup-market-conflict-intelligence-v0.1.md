# Matchup & Market Conflict Intelligence v0.1

This fail-closed challenger/audit layer asks why an independently produced model probability, opponent-specific football evidence, and a verified market benchmark disagree. It never labels disagreement as a trap or match fixing.

## Analysis order

1. Verify the independent model snapshot is pre-match and market-free.
2. audit statistical maturity: opponent strength, venue split, current squad, non-penalty/game-state effects, schedule strength and sample size;
3. consume the existing de-correlated `TEAM_MATCH_INTELLIGENCE_V0_1` matchup result;
4. require a direct, verified, same-provider market pair before computing fair-probability disagreement;
5. audit lineup, injury, transfer, manager, fatigue and other context checks supplied upstream;
6. return `PROCEED_TO_EXISTING_CANONICAL_GATES`, `WATCH_REVERIFY`, or `ABSTAIN`.

Home/away is evidence, not a conclusion. Aggregate form cannot override an opponent-specific contradiction. Odds are a benchmark, not an outcome oracle and not a model feature.

## Safety invariants

- Runs before kickoff; post-match input is rejected.
- Missing, conflicting or immature material evidence abstains.
- Does not rewrite lambda or probability.
- Does not freeze or qualify a signal.
- Decision weight remains zero and capital effect remains none.
- Existing Gate 1–6 and forward-validation requirements remain authoritative.
