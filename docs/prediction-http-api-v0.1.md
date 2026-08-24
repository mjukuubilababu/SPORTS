# Prediction HTTP API v0.1

This package exposes the existing intelligence engine over a minimal HTTP JSON boundary.

## Endpoints

- `GET /health`
- `POST /v1/predict`

`POST /v1/predict` delegates to `orchestrateModelProbabilities()`. The API does not implement or duplicate Poisson, Negative Binomial, reliability, correlation-family, EV, or market-circularity logic.

The request supplies event/market/selection identity, kickoff timestamp, frozen verified model observations, offered odds, and evidence confidence. The response returns probability, break-even probability, EV, evidence maturity, critical blocks, model-family counts and model snapshot audit lineage.

## Governance

- market odds cannot be used to construct model probability;
- each model must have immutable pre-kickoff provenance accepted by the orchestrator;
- same-family correlation collapse remains inside the orchestrator;
- responses are `Cache-Control: no-store`;
- request bodies are capped at 1 MiB;
- the API cannot unlock capital or execute real-money actions;
- `capitalState=LOCKED` and `realMoney=NO` are explicit response fields.
