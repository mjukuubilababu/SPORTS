# Player Matchup Intelligence v0.1

## Goal

This capability fills the two player-level domains that Real Football Feature Ingestion intentionally keeps pending before confirmed lineups:

- `PLAYER_MATCHUP`
- `PLAYER_QUALITY_AND_COHESION`

It is a pre-match football-analysis layer, not a betting-market layer.

## Hard entry gate

The engine requires a verified `CONFIRMED` starting XI for both teams, exactly 11 unique starters per side and exactly one goalkeeper. A predicted lineup cannot activate player intelligence.

The lineup observation must be timestamped before the effective kickoff. Player-profile observations must also be pre-kickoff. This duplicates the no-hindsight protection already present elsewhere in the canonical system so a downstream orchestration mistake cannot silently introduce post-kickoff evidence.

## Player profiles

Profiles are normalized 0..1 and must be independently attributable, verified and competition-adjusted. The default minimum sample is eight observations.

The engine does not use player name, reputation, transfer fee or club fame as a capability metric.

### Attackers

- finishing
- shot quality
- chance creation
- ball progression
- dribbling

### Midfielders

- chance creation
- ball progression
- press resistance
- ball security
- defensive duels

Midfielders may additionally contribute attacking and defensive support metrics in central tactical lanes.

### Defenders

- defensive duels
- aerial defending
- interceptions
- recovery
- ball security

### Goalkeepers

- shot stopping
- distribution
- high claims

## Tactical matchup lanes

The engine does not collapse every player into one average before comparison. It produces seven matchup lanes:

1. home left attack vs away right defence
2. home right attack vs away left defence
3. home central attack vs away central defence + goalkeeper
4. away left attack vs home right defence
5. away right attack vs home left defence
6. away central attack vs home central defence + goalkeeper
7. midfield control

This allows a team with a strong overall squad to still show a local weakness in a particular channel.

## Individual quality and cohesion

Individual quality is computed from role-specific player capability across the confirmed XI. Cohesion is separate: v0.1 uses each starter's normalized prior-team continuity, so a talented XI with many new players can differ from an equally talented XI with established continuity.

The two concepts are intentionally not merged into one raw number upstream.

## Competition adjustment

Every profile must declare `competitionAdjusted: true`. A striker's raw production in one league cannot be compared directly with a defender or goalkeeper from another league without upstream competition-strength adjustment.

## Real Football Feature Ingestion integration

`toRealFootballPlayerEvidence()` converts a ready player-intelligence snapshot into the `playerEvidence` shape already consumed by `real-football-feature-ingestion.mjs`.

Once that evidence is inserted into an event, `PLAYER_MATCHUP` and `PLAYER_QUALITY_AND_COHESION` are no longer pending. Transfer impact remains independent and can still be pending.

## Model governance

Player matchup output is football evidence. It does not silently alter lambda. Any lambda effect still requires the canonical independent calibration/impact layer with provenance and caps.

Bookmaker prices do not enter player profiles or matchup capability.

## Command

```bash
npm run player:matchup -- <confirmed-lineup-player-input.json> [output.json]
```

No real output fixture is included in v0.1 because the target matches have not yet produced confirmed starting XIs at implementation time. Synthetic data exists only inside tests.

Capital remains locked; real money remains `NO`.
