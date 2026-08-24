# Current Multi-League Fixtures & Results v0.1

This capability adds a current-season snapshot boundary for EPL, La Liga, Serie A, Bundesliga and Ligue 1.

The source contract deliberately distinguishes **current snapshot** from **live in-play feed**. A Football-Data CSV row with no final score is `SCHEDULED`; a row with both final goals is `SETTLED`. This adapter never emits `LIVE` or an in-play score because the source is not treated as a real-time live-score provider.

Every fixture has competition-scoped identity and SHA-256 row provenance. Partial final scores, duplicate fixture identities and division mismatches fail closed.

`run_current_multileague_discovery.py` probes the registered 2026/27 source URLs and records each competition as `AVAILABLE` or `UNAVAILABLE_OR_UNPARSABLE`. Unavailable sources do not cause invented fixtures and do not imply the competition is unsupported by the system architecture; they only describe that source snapshot at the recorded observation time.

No bookmaker data, prediction qualification, model promotion or capital state is changed by this capability. A future documented real-time provider is required before `LIVE_IN_PLAY` can be activated.
