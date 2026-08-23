# Real Football Feature Ingestion v0.1

## Purpose

This layer turns real football observations into normalized inputs for Team & Match Intelligence before any bookmaker-market mapping. It does not select bets and it cannot rewrite model lambdas without separate verified calibration.

## Analysis order

1. Preserve raw historical and current observations with provenance.
2. Normalize statistical features against the full source competition, not only the target teams.
3. Build attack-v-defence, shot quality, temporal, home/away, club-strength, H2H and match-pattern inputs.
4. Add verified current context such as manager continuity, squad transition and availability.
5. Keep incomplete player and transfer domains pending instead of inventing values.
6. Send the resulting feature set into Team & Match Intelligence.
7. Preserve supporting and counter evidence and suppress correlated evidence in the composite.
8. Only after team reasoning may probabilities and bookmaker markets be compared.

## Current real dataset

`packages/intelligence-engine/data/real-football-features-epl-2025-26-to-2026-08-23.json`

It contains 2025/26 EPL observations for Manchester City, AFC Bournemouth, Brighton & Hove Albion, Aston Villa, Newcastle United and Liverpool FC, plus current pre-match context for the three 23 August 2026 fixtures.

The full historical season ended on 24 May 2026. Statistical normalization uses league-wide 20-team bounds for xG, xGA, shots, shots on target, goals, goals against, points and temporal scoring/conceding measures.

## Active domains in v0.1

- Team cohesion: transparent current-context heuristic using manager continuity, squad transition risk and verified availability counts. This is explanation-only until calibrated.
- Attack vs defence: xG, goals, shots and shots on target versus opponent xGA/goals-against vulnerability.
- Temporal scoring/defending: first-15, last-10 and second-half scoring/conceding plus lead retention.
- League and club strength: same-league fixtures have no artificial league-quality differential; club strength uses prior-season league performance.
- Shot/chance quality: xG per shot, SOT rate and opponent defensive vulnerability.
- Position/home-away/environment: prior-season position strength and venue goal-difference profile. Subjective psychology remains neutral unless objectively measured.
- H2H: recent five-match record with explicit relevance weighting.
- Match-statistics patterns: scoring consistency, clean-sheet rate and lead-retention behavior.

## Pending domains

### Player matchup

Blocked until confirmed verified starting lineups and usable player-level matchup statistics exist. A predicted lineup cannot activate this domain.

### Player quality + cohesion

Blocked until a verified player-quality layer is available. Club reputation or player fame is not a substitute.

### Transfer impact

Current event records preserve known transition facts, but the normalized transfer-impact domain is blocked until a complete in/out audit captures role importance and minutes replacement. Partial transfer-news lists cannot create a net-impact score.

## Per-signal sample requirements

Statistical evidence uses the normal minimum-sample rule. A verified one-off context fact such as a manager change or confirmed absence can explicitly set `minimumSampleRequired: 1`. It still requires source, timestamp, confidence and verification.

This prevents the engine from rejecting legitimate current facts simply because they are not repeated observations, without weakening the rules for statistical evidence.

## Lead retention

Direct evidence is preferred. Newcastle currently has direct partial-season evidence that 22 points had been dropped from winning positions by 22 March 2026. That direct observation is labeled with its partial-season scope. Where direct dropped-points evidence is unavailable, v0.1 uses a clearly labeled late-concession proxy based on goals conceded in the final 10 minutes.

## Correlation control

Attack-v-defence and shot/chance-quality features intentionally share `CHANCE_CREATION_AND_PREVENTION`. They remain separately visible for explanation, but the Team & Match Intelligence composite counts the shared evidence family once. This prevents xG, shots, SOT and related variables from creating artificial confidence through repeated counting.

## Model governance

The output of this layer is football evidence, not an automatic model rewrite. Raw or normalized football intelligence cannot change lambda without independently verified out-of-sample calibration. Bookmaker odds are forbidden from football-feature calibration.

Incomplete feature coverage prevents `ROBUST_MODEL_TRUTH`; the engine may still expose a `MODEL_LEAN` while the missing evidence is collected.

## Commands

From `packages/intelligence-engine`:

```bash
npm run real:football-features
npm run real:football-features:write
```

The first prints the report. The second writes `data/real-football-feature-output-2026-08-23.json`.

## Current expected readiness

For the three current fixtures, player and complete transfer domains remain pending before confirmed lineups and complete audits. Therefore v0.1 is expected to produce `ANALYSIS_PARTIAL`, not to manufacture mature certainty.

Capital effect remains `NONE`; real money remains `NO`.
