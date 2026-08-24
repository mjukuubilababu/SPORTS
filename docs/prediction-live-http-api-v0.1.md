# Prediction Live HTTP API v0.1

## Purpose

Adds a live 1X2 HTTP boundary to the existing prediction API. It does not create a second model. `POST /v1/predict/live` delegates to the existing `predictLive1X2()` implementation.

## Required inputs

The caller supplies an immutable frozen pre-match outcome snapshot plus a live state containing event identity, elapsed minute, current score, observation time and verified evidence. The live event ID must exactly match the frozen pre-match snapshot event ID.

This shape is compatible with the Gate1 real-time provider bridge introduced by Real-Time Live Football Provider v0.1.

## Probability semantics

The endpoint preserves the frozen pre-match home/away lambdas and applies the existing remaining-time Poisson reforecast. It returns HOME_WIN, DRAW and AWAY_WIN probabilities that form one normalized distribution, plus the most likely final score and remaining lambdas.

## Rate multipliers

HTTP v0.1 fixes home and away rate multipliers at `1.0`. A client cannot submit a non-unit multiplier. Future red-card, injury, substitution or tactical-impact multipliers must come through a separate verified event-impact pipeline with explicit evidence and calibration rather than arbitrary request fields.

## Evidence and governance

At least one verified live evidence item is required. Provider prediction output is not required or consumed. Bookmaker odds are not live model inputs. The pre-match snapshot is never rewritten, capital remains `LOCKED`, and `realMoney` remains `NO`.

## Endpoint

`POST /v1/predict/live`

The response exposes live minute/score, three-way probabilities, predicted outcome, confidence, most-likely final score, remaining lambdas and audit lineage back to the frozen pre-match signal.
