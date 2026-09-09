# Current Multi-League Fixtures & Results v0.1

This capability adds a current-season snapshot boundary for EPL, La Liga, Serie A, Bundesliga and Ligue 1.

The source contract deliberately distinguishes **current snapshot** from **live in-play feed**. A Football-Data CSV row with no final score is `SCHEDULED`; a row with both final goals is `SETTLED`. This adapter never emits `LIVE` or an in-play score because the source is not treated as a real-time live-score provider.

Every primary fixture has competition-scoped identity and SHA-256 row provenance. Partial final scores, duplicate fixture identities and division mismatches fail closed.

## Primary-first discovery

`run_current_multileague_discovery.py` probes Football-Data.co.uk first. If the 2026/27 primary file is available and parsable, it remains the current snapshot source for that competition.

The August 2026 discovery showed that several top-flight 2026/27 files were not yet published by the primary source. Repeating the same missing URL cannot create real coverage, so the discovery layer has a secondary public scoreboard fallback.

## Secondary discovery fallback

When the primary source is unavailable or unparsable, the system queries the public ESPN site scoreboard for a bounded window of 7 days behind the observation date and 14 days ahead.

ESPN by itself is classified as `PUBLIC_UNOFFICIAL_SCOREBOARD`, `discovery_only=true`, and `strict_gate1_eligible=false`. It may discover real current fixtures/results and provider identities, but it does **not** silently become strict Gate1 truth.

The fallback stores provider event/team identity and SHA-256 event provenance. Unknown statuses, malformed identities and settled rows without complete scores fail closed. ESPN events whose state is currently in-play are counted and skipped; they belong to the dedicated authenticated live-provider pipeline and do not create a second live model path.

## EPL official-site cross-source verification

EPL secondary rows have an independent verification path against the structured match feed that powers `premierleague.com`, served by the Premier League/PulseLive SDP backend for competition `8`, season `2026`.

This backend is treated conservatively as `OFFICIAL_WEBSITE_BACKEND_UNDOCUMENTED_NO_SLA`. It is official-site data, but its JSON interface is not a published public contract and can change. Therefore it is a **verification source**, not a standalone automatic promotion authority.

The SDP match schema exposes `kickoff` and a separate `kickoffTimezone`. Live verification found that `kickoff` may be an ISO timestamp without an offset. The system does **not** assume such a value is UTC. `premierleague_sdp_timezone_normalizer.py` requires the provider-supplied `kickoffTimezone`, resolves it through the IANA timezone database, applies daylight-saving rules, and converts the kickoff to UTC before identity reconciliation. If the timezone field is absent or unsupported, EPL remains discovery-only. A timezone-aware kickoff or epoch-millisecond kickoff is preserved through the existing strict parser.

The EPL reconciliation rules are strict:

- ESPN remains the discovery side of the pair;
- Premier League SDP is the independent official-site verification side;
- team identity uses an explicit provider-specific alias registry only;
- fuzzy team matching is forbidden;
- competition must resolve to Premier League competition `8`, season `2026` when season identity is present;
- naive official-site kickoff timestamps are never assumed UTC;
- provider `kickoffTimezone` is mandatory when the kickoff has no offset, and conversion is DST-aware;
- normalized kickoff UTC, canonical home-team key and canonical away-team key must match exactly;
- scheduled/settled state must match;
- a settled match must have the exact same final score on both sources;
- live SDP matches are excluded from this current-snapshot verifier and remain the responsibility of the dedicated live-provider pipeline;
- a past SDP `PreMatch` row is treated as ambiguous/delayed rather than mislabeled as scheduled;
- each source keeps independent SHA-256 event provenance.

EPL becomes league-level `strict_gate1_eligible=true` only when the bounded-window counts agree exactly: **ESPN rows = SDP rows = exact reconciled rows, with unmatched ESPN rows equal to zero**. A schema change, endpoint failure, timezone failure, team alias mismatch, kickoff mismatch, state mismatch, score mismatch or partial reconciliation leaves EPL discovery-only.

The official-site backend cannot auto-promote EPL rows by itself. The strict evidence is exact cross-source agreement under the rules above.

## Bundesliga independent cross-source verification

Bundesliga secondary rows have an independent verification path through OpenLigaDB (`bl1`, season `2026`). OpenLigaDB is treated as a separate public community database under ODbL and as a **verification source**, not as an automatic promotion authority.

The reconciliation rules are deliberately strict:

- team identity uses an explicit provider-specific alias registry only;
- fuzzy team matching is forbidden;
- competition must be Bundesliga 2026/27;
- kickoff UTC, canonical home-team key and canonical away-team key must match exactly;
- scheduled/settled state must match;
- a settled match must have the exact same final score on both sources;
- an unfinished OpenLigaDB event whose kickoff is already in the past is skipped as ambiguous/live/delayed rather than mislabeled as scheduled;
- each source keeps its own SHA-256 event provenance.

A single reconciled row may be reported as cross-source verified, but **Bundesliga becomes league-level `strict_gate1_eligible=true` only when every ESPN row in the bounded current window reconciles exactly and the unmatched count is zero**. Partial reconciliation therefore improves evidence but does not promote the league wholesale.

OpenLigaDB alone cannot make ESPN rows strict truth. The strict evidence is the exact agreement of two independent provider observations under the rules above.

## Coverage semantics

The discovery report separates:

- primary strict current-source availability;
- secondary discovery availability;
- cross-source verified availability;
- overall fixture discovery availability;
- strict Gate1-eligible league coverage;
- strict Gate1-eligible row count.

Unavailable or mismatched sources remain explicit and never cause fabricated fixtures. Serie A and Ligue 1 remain discovery-only until they receive their own independent verification path. EPL is promoted only if its live CI reconciliation meets the exact full-window rule above.

No bookmaker data, provider prediction output, model promotion, P002 rule, Gate4 threshold, Blind Test B state or capital state is changed by this capability. `realMoney` remains `NO`.
