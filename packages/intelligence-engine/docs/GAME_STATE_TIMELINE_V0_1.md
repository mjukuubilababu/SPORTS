# Game-State Timeline v0.1 — Step 2

## Purpose

Game-State Timeline turns retained provider events into an immutable, auditable chronological representation of what happened inside a match.

It is not a second live-data pipeline. Gate1 remains the owner of provider observations, and the timeline reuses the same API-Football fixture identity and the same explicit provider-to-canonical identity link already used by live orchestration.

## Existing-system integration

Step 2 extends the existing API-Football live ingestion rather than replacing it.

- Existing `fetch_live()` behavior and return contract are preserved for old callers.
- `fetch_live_with_events()` uses the same `/fixtures?live=...` request and additionally retains embedded event observations from the authenticated response.
- Existing score/time snapshots and `live_model_inputs` remain unchanged in meaning.
- The runtime artifact adds `events_n` and `events`; existing fields remain present.
- Game events do not automatically alter live rate multipliers.
- The existing explicit provider fixture → canonical event identity link is reused. Fuzzy matching remains forbidden.

## Event retention

The Gate1 normalization layer retains:

- provider fixture and competition identity;
- provider event order;
- elapsed and extra minute when supplied;
- provider team identity and derived HOME/AWAY side when exact IDs match;
- event type and detail;
- player and assist identities when supplied;
- comments when supplied;
- source fixture and event hashes;
- observation timestamp;
- raw provider type/detail in addition to canonicalized fields.

Canonical event types are:

- `GOAL`
- `CARD`
- `SUBSTITUTION`
- `VAR`
- `OTHER`

Unknown event types are not discarded. They are retained as `OTHER` and marked timeline-ineligible until their semantics are governed.

## Goal handling

Only explicitly governed goal details receive a score effect:

- `NORMAL_GOAL` → score
- `OWN_GOAL` → score using the provider-attributed event team, then reconciled against the observed match score
- `PENALTY` → score
- `MISSED_PENALTY` → no score
- unknown goal detail → retained, no inferred score change, pattern truth blocked

The event-derived score is compared with an existing provider score snapshot or, for a settled historical materialization, Canonical Match Memory truth. A mismatch does not rewrite either source. It makes the timeline ineligible as pattern truth until reconciled.

## Derived observable facts

The intelligence-engine materializer derives only facts that follow directly from the ordered events:

- score before and after each event;
- HOME_LEADING / DRAW / AWAY_LEADING state;
- opening goal;
- equalizer;
- go-ahead goal from a draw;
- comeback go-ahead after that side had previously trailed;
- lead extension;
- missed penalty;
- observed dismissal counts;
- substitution counts;
- event timing and provider-order tie breaking.

These facts are inputs for later behavioral learning. Step 2 does not claim they are predictive by themselves.

## Psychology boundary

The system does not store statements such as “team morale was low,” “players panicked,” or “the team wanted it more” as football truth unless a separately governed evidence source can establish such a claim.

Instead it retains observable state proxies such as:

- team was trailing at a given time;
- team equalized after trailing;
- team later went ahead after previously trailing;
- team played after an observed dismissal;
- score changed late in the match.

A later stage may test whether repeated verified behavior under those conditions forms a statistically useful pattern. That interpretation is not performed in Step 2.

## No-hindsight and integrity

- event observations must carry an observation timestamp;
- observations before kickoff are rejected from the game timeline;
- cross-fixture evidence is rejected;
- HOME/AWAY side must agree with explicit provider team IDs;
- source hashes are required;
- duplicate event IDs fail closed;
- provider event index is retained as the deterministic tiebreaker for events recorded at the same minute;
- the complete timeline receives a deterministic SHA-256 fingerprint;
- tampering is detected by recomputing that fingerprint.

## Pattern eligibility

A timeline becomes eligible as factual input to later pattern research only when:

- the provider-to-canonical identity link is verified;
- score reconciliation is verified;
- no score-bearing goal has unresolved semantics.

Individual ineligible or unmapped observations remain stored. They are not deleted to make the data look cleaner.

## Model boundary

Step 2 does not:

- retune M015 or any other model;
- change P002;
- change Gate1–Gate6 ownership;
- convert red cards, substitutions, VAR, or goals into live rate multipliers;
- discover patterns;
- validate patterns;
- promote a pattern;
- authorize capital or real-money execution.

A separately validated event-impact model would be required before any event-derived state could receive predictive weight.

## Next stage

Step 3 is **Behavioral State Features**: turn many verified Game-State Timelines into league-agnostic team behavior features such as response-to-trailing, lead retention, dismissal response, late-game scoring/conceding, and comeback behavior — while preserving sample size, opponent context, venue context, and uncertainty.
