# Real Player Profile Ingestion v0.1

This capability converts verified raw player statistics into the normalized role-specific profiles required by `Player Matchup Intelligence`.

## Normalization

Players are compared only against verified players in the same phase-role cohort: ATTACK, MIDFIELD, DEFENCE or GOALKEEPER. Each required raw metric is converted to an empirical percentile, then adjusted by an explicit competition-strength factor around neutral 0.5.

This avoids player-name, transfer-fee, reputation or bookmaker-derived scoring.

## Minimum evidence

- player sample size >= 8;
- role normalization cohort >= 5;
- source and observed timestamp required;
- player observation must be at or before `asOf`;
- source bundle and player row must be verified;
- prior-team minutes share is required for continuity;
- competition-strength factor must be between 0.5 and 1.5.

Availability, when supplied, must also be verified and pre-match.

## Role metrics

ATTACK uses goals/90, xG/shot, xA/90, progressive actions/90 and successful dribbles/90.

MIDFIELD uses xA/90, progressive passes/90, pressure-retention rate, pass-completion rate and defensive-duel win rate, with optional attacking/defensive support metrics.

DEFENCE uses defensive-duel win rate, aerial win rate, interceptions/90, recoveries/90 and pass completion.

GOALKEEPER uses goals prevented/90, long-pass completion and high claims/90.

## Integration

The output profile map includes the exact normalized fields expected by `buildConfirmedLineupPlayerIntelligence()`, together with `verified=true`, `competitionAdjusted=true`, sample size, source, observation time, availability fitness and team continuity.

`playerProfilesForConfirmedXi()` extracts exactly the 22 confirmed starters and fails if any profile is missing.

## Governance

Bookmaker odds, market prices, reputation scores and transfer fees are rejected as player-profile inputs. The generated player intelligence remains explanatory until independently calibrated; it cannot silently rewrite lambdas. Capital state is unchanged and real-money execution remains disabled.
