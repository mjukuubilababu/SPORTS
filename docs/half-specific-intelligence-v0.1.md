# Half-Specific Intelligence v0.1

## Purpose

This capability extends the match-first reasoning engine into first-half, second-half, and cross-half outcomes without fabricating half probabilities from bookmaker prices or blindly splitting full-time expected goals 50/50.

## Required evidence

A half profile is eligible only when it is independent from bookmaker markets, pre-match only, based on primary half statistics, and has at least 30 observations. The profile supplies the historical share of team goals occurring in the first half. The remainder becomes the second-half share.

For each team:

`first-half lambda + second-half lambda = full-time lambda`

## Analysis order

1. Independent full-time team model produces home/away lambdas.
2. Verified historical half profile determines first-half and second-half shares.
3. Separate first-half and second-half score distributions are generated.
4. Bidirectional reasoning is run independently for each half.
5. A joint two-half distribution produces HT/FT, half-with-more-goals, and win-either/both-halves probabilities.
6. Only then can available bookmaker half-markets be mapped and priced.
7. Evidence, lineup, context and final pre-match gates remain authoritative.

## Supported market families

- First-half 1X2
- Second-half 1X2
- First/second-half Over/Under
- First/second-half Double Chance
- First/second-half BTTS
- First-half Correct Score
- Half-Time / Full-Time
- Half With More Goals
- Home/Away Win Both Halves
- Home/Away Win Either Half

## Explicitly not inferred

Player goalscorer, cards and corners still require their own event models. No probability is created merely because a bookmaker offers the market.

## Safeguards

- No blind 50/50 half split.
- Minimum historical sample: 30.
- Bookmaker odds cannot be used to derive half shares.
- Missing/unverified profile keeps half markets blocked.
- HT/FT is calculated from the joint half-score path, not by multiplying independent HT and FT headline probabilities.
- Probability ranking remains separate from market value ranking.
- This is paper-only research capability; capital remains locked.
