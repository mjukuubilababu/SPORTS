# Live Provider Orchestration Runtime v0.1

## Purpose

Connects the existing Gate1 real-time provider artifact to the existing frozen pre-match/live 1X2 model without guessing fixture identity.

## Inputs

1. A live provider artifact produced by the documented API-Football Gate1 adapter.
2. Explicit verified pre-match identity links. Each link binds one API-Football fixture ID to one canonical event ID and carries provider home/away team IDs, exact kickoff UTC, a pre-kickoff observation timestamp and the frozen pre-match outcome snapshot.

## Identity rules

There is no fuzzy name matching. Provider fixture ID, provider home team ID, provider away team ID and kickoff UTC must match the identity link exactly. A missing identity link returns `WAIT`; conflicting identity evidence is rejected.

This prevents a live score from being silently attached to the wrong canonical event.

## Temporal rules

The identity link must exist before kickoff. The pre-match prediction must be frozen before kickoff. The live observation cannot predate the frozen pre-match snapshot.

## Prediction behavior

Only `LIVE_IN_PLAY` snapshots are reforecast. Scheduled, settled or other non-live snapshots are skipped by this runtime. Live prediction delegates to the existing `predictLive1X2()` implementation with home and away rate multipliers fixed at `1.0`.

Provider prediction output and bookmaker odds are forbidden from the live model input. Any future event-impact multiplier requires a separate verified and calibrated pipeline.

## Runtime

`npm run live:orchestrate -- <provider-artifact.json> <prematch-links.json> [output.json]`

The result contains predictions, waits, rejected identity/data rows, skipped non-live rows and explicit governance state.

A real provider network run still requires `APISPORTS_KEY` to produce the upstream provider artifact. This orchestration runtime itself does not store or need the provider credential.

Capital remains `LOCKED`; `realMoney` remains `NO`.
