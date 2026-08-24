# Real-Time Live Football Provider v0.1

## Purpose

Adds a documented authenticated live-data boundary inside existing Gate1. The first provider adapter targets API-Football (`v3.football.api-sports.io`) and is intentionally separate from model logic.

## What enters the system

The adapter accepts provider fixture identity, competition identity, kickoff timestamp, team identity, live status, elapsed minute and current score. It hashes the raw provider fixture object and records the observation timestamp for provenance.

For a live match it can emit the exact bridge required by the existing `predictLive1X2()` function:

- `eventId`
- `minute`
- `homeScore`
- `awayScore`
- `observedAt`
- verified provider evidence

## What does not enter the model

The adapter does not call or consume the provider's prediction endpoint. Bookmaker odds are not model inputs. A score, status or elapsed minute cannot silently change home/away scoring-rate multipliers. Any multiplier must come from a separate verified event-impact model with explicit evidence.

## Authentication

Runtime authentication uses `APISPORTS_KEY` from the environment. The key is never embedded in the request URL, source files or output artifacts. The runner fails closed when the key is absent.

## Competition scope

The v0.1 registry covers EPL, La Liga, Serie A, Bundesliga and Ligue 1. Provider competition IDs are configuration metadata, not football model coefficients.

## Status semantics

Provider status is mapped to canonical states including `SCHEDULED`, `LIVE_IN_PLAY`, `SETTLED`, `POSTPONED`, `CANCELLED`, `SUSPENDED`, `INTERRUPTED` and `ABANDONED`. Unsupported statuses fail closed instead of being guessed.

## Verification state

Synthetic provider-payload tests exercise live, settled, scheduled and postponed states plus response errors, unknown leagues, missing elapsed time, partial scores and duplicate fixture IDs.

A genuine external provider runtime is not claimed until CI or another controlled runtime is configured with a valid `APISPORTS_KEY` and captures a real provider response with provenance.

Capital remains `LOCKED`; `realMoney` remains `NO`.
