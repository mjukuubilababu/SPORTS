# Current Multi-League Fixtures & Results v0.1

This capability adds a current-season snapshot boundary for EPL, La Liga, Serie A, Bundesliga and Ligue 1.

The source contract deliberately distinguishes **current snapshot** from **live in-play feed**. A Football-Data CSV row with no final score is `SCHEDULED`; a row with both final goals is `SETTLED`. This adapter never emits `LIVE` or an in-play score because the source is not treated as a real-time live-score provider.

Every primary fixture has competition-scoped identity and SHA-256 row provenance. Partial final scores, duplicate fixture identities and division mismatches fail closed.

## Primary-first discovery

`run_current_multileague_discovery.py` probes Football-Data.co.uk first. If the 2026/27 primary file is available and parsable, it remains the current snapshot source for that competition.

The August 2026 discovery showed that several top-flight 2026/27 files were not yet published by the primary source. Repeating the same missing URL cannot create real coverage, so the discovery layer now has a secondary public scoreboard fallback.

## Secondary discovery fallback

When the primary source is unavailable or unparsable, the system queries the public ESPN site scoreboard for a bounded window of 7 days behind the observation date and 14 days ahead.

This fallback is deliberately classified as `PUBLIC_UNOFFICIAL_SCOREBOARD`, `discovery_only=true`, and `strict_gate1_eligible=false`. It may discover real current fixtures/results and provider identities, but it does **not** silently become strict Gate1 truth. A separate verification step is required before those secondary rows may be treated as strict model input.

The fallback stores provider event/team identity and SHA-256 event provenance. Unknown statuses, malformed identities and settled rows without complete scores fail closed. ESPN events whose state is currently in-play are counted and skipped; they belong to the dedicated authenticated live-provider pipeline and do not create a second live model path.

The discovery report therefore separates:

- primary strict current-source availability;
- secondary discovery availability;
- overall fixture discovery availability;
- strict Gate1-eligible coverage.

Unavailable sources remain explicit and never cause fabricated fixtures.

No bookmaker data, provider prediction output, model promotion, P002 rule, Gate4 threshold, Test B state or capital state is changed by this capability. `realMoney` remains `NO`.
