# Unified Multi-Model Probability Orchestrator v0.1

## Purpose

`probabilisticBrain()` intentionally remains a small probability/EV calculator. This orchestrator is the governed adapter that prepares independently generated model probabilities before they reach the brain.

It does not train models, change model probabilities, select a betting market, or unlock capital.

## Required model identity

Every model observation must identify the same event, market and selection as the orchestration target. It also carries model version, immutable snapshot ID/hash, source, correlation family and frozen timestamp.

The model must explicitly declare `usesMarketOdds=false`. A market-derived probability cannot be smuggled in as a model probability.

## Reliability

Each model supplies bounded 0–1 evidence factors:

`baseWeight × validation × calibration × freshness × drift × availability`

A zero factor makes the model unable to influence the output. These values are governance inputs backed by model validation; this component does not invent them or retune them.

## Correlation control

Model variants in the same correlation family are visible in the audit but are collapsed before the brain. Their family probability is a reliability-weighted mean. The family receives at most the strongest active member's raw effective weight, so adding correlated variants cannot create additive voting power.

Independent families such as a Poisson count model and a preregistered Negative Binomial challenger can each contribute separately when their reliability gates permit it.

## Market separation

The offered decimal odds are passed only after the model probability aggregation. Changing offered odds may change break-even probability and EV, but cannot change the aggregated model probability.

## Fail closed

The orchestrator rejects target mismatches, market-derived model inputs, post-kickoff model freezes, missing provenance, duplicate model versions, duplicate snapshot IDs, invalid probabilities/reliability factors and invalid decimal odds.

If every model family has zero reliability, the result is `WAIT`.

## Governance

No automatic retuning, self-modification, champion promotion or capital unlock occurs here. Probability remains separate from validation and execution. `realMoney` remains `NO`.
