# Behavioral State Features v0.1 — Step 3

## Purpose

Step 3 converts settled, verified Canonical Match Memory + Game-State Timeline pairs into descriptive team behavior features. It is the bridge between “what happened inside each match” and later governed pattern discovery.

This layer does **not** decide that a behavior predicts the next match. It measures behavior faithfully, preserves denominators and uncertainty, and keeps both sides of every eligible match.

## Every match produces both sides

For every eligible settled match, the corpus materializes two observations:

- HOME team observation;
- AWAY team observation.

A win, draw, or loss is never removed because of the outcome. The same event sequence is interpreted from each team’s side, which means the winner’s behavior and the loser’s behavior are stored with equal structural importance.

Structurally valid but truth-ineligible match pairs are retained with exclusion reasons and feature influence `0`. Tampered or cross-match pairs fail closed.

## Required input chain

A match contributes feature truth only when:

1. Canonical Match Memory fingerprint verifies;
2. Game-State Timeline fingerprint verifies;
3. both belong to the same canonical match id;
4. Match Memory is verified Pattern Truth;
5. the timeline is Pattern Truth eligible;
6. the timeline score is reconciled as `VERIFIED`;
7. the timeline expected score came from `CANONICAL_MATCH_MEMORY_TRUTH`;
8. the source is settled rather than a partial in-play snapshot.

This prevents incomplete live state from masquerading as final team behavior.

## Per-team match observation

For each side, Step 3 records:

- canonical date, season and league;
- subject team and opponent;
- HOME/AWAY venue side;
- final WIN/DRAW/LOSS and score for/against;
- whether the team ever led or trailed;
- first lead/trailing minute;
- whether a lead was surrendered;
- whether the team later recovered a win after surrendering a lead;
- whether points were dropped after leading;
- whether the team equalized after trailing;
- whether it produced a comeback go-ahead;
- whether it recovered a non-loss or win after trailing;
- opening goal scored/conceded;
- late goals scored/conceded;
- dismissal context;
- goals after the team’s first observed dismissal;
- substitutions and first substitution minute;
- goals scored/conceded in six period bins.

Every observation retains its source Timeline and Match Memory fingerprints and receives its own deterministic fingerprint.

## Lead behavior is opportunity-based

The system does not divide every lead statistic by total matches.

Examples:

- `lead_surrender_rate = lead_surrendered_n / led_match_n`
- `points_dropped_after_leading_rate = points_dropped_after_leading_n / led_match_n`
- `lead_surrender_recovery_win_rate = recovered_win_after_surrender_n / lead_surrendered_n`

This matters because a team that led once in ten matches does not have ten lead-retention opportunities.

## Trailing response is also opportunity-based

Examples:

- `equalize_after_trailing_rate = equalized_after_trailing_n / trailed_match_n`
- `nonloss_after_trailing_rate = recovered_nonloss_n / trailed_match_n`
- `win_after_trailing_rate = recovered_win_n / trailed_match_n`
- `comeback_go_ahead_rate = comeback_go_ahead_n / trailed_match_n`

A zero-opportunity metric is `null`, not fabricated as 0% or 100%.

## Uncertainty and sample size

Every binary proportion carries:

- successes;
- opportunity count;
- point rate;
- Wilson 95% interval;
- sample state.

The frozen P002 discovery minimum remains `N=30`. Step 3 does not hide profiles below 30; it labels them `DESCRIPTIVE_ONLY_INSUFFICIENT_FOR_PATTERN_DISCOVERY`.

Reaching 30 matches only makes the profile sample available to a later discovery stage. It does **not** prove a pattern and does not give the feature predictive weight.

## Temporal behavior

The retained period bins are:

- 0–15;
- 16–30;
- 31–45+;
- 46–60;
- 61–75;
- 76–90+.

A “late goal” is currently an observable event at elapsed minute 76 or later. Counts and per-match rates are retained separately for scoring and conceding.

## Home/away and opponent context

Each profile preserves full HOME and AWAY splits. It also preserves one opponent-context row per match rather than collapsing opponents into an unexplained average.

Opponent strength adjustment is intentionally not invented in Step 3. Later stages may join the retained opponent identity to governed opponent-strength evidence and test whether the behavior survives that adjustment.

## Dismissal and substitution context

Observed dismissals are factual match-state context, not automatic causal explanations. Step 3 can measure what followed a dismissal but does not claim the dismissal caused the later score.

Substitution timing is retained descriptively. Player-level substitution quality or tactical intent requires separate verified player/tactical evidence.

## Psychology boundary

Step 3 does not create features named “confidence,” “panic,” “morale,” “desire,” or similar mind-reading labels from match results.

It measures observable responses to states such as trailing, leading, equalizing, conceding late, or playing after a dismissal. A later governed statistical stage may test whether those repeated observable responses are stable.

## Existing intelligence integration

The existing intelligence engine already has a `TEMPORAL_SCORING_DEFENDING` domain. Step 3 profiles declare that as their future integration target, but the bridge is frozen as:

- `DESCRIPTIVE_NOT_SIGNAL`;
- automatic injection `false`;
- automatic impact assignment `false`;
- decision weight `0`.

This avoids turning descriptive rates into predictive impact merely because a compatible domain already exists.

## Market and model boundary

Behavioral State Features do not use bookmaker prices to derive team behavior. They do not retune M015 or another model, change P002, alter Gate1–6 ownership, promote a pattern, or unlock capital.

## Next stage

Step 4 is **Pattern Discovery Candidates**. It may search the Step 3 feature corpus for repeated behavioral relationships, but only with explicit sample sizes, comparison groups, multiple-testing controls, chronology/no-hindsight, and zero automatic promotion.
