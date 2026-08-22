# Failure Recovery Rules v0.1
1. Never convert timeout into success.
2. Never skip a required upstream contract because downstream is waiting.
3. Never retry forever.
4. Never replay by overwriting immutable artifacts.
5. Never process stale market data as current.
6. Never let one provider outage become global pipeline corruption.
7. Preserve dead-letter events for diagnosis and controlled replay.
8. Prefer degraded mode over fabricated completeness.
9. Circuit breakers protect downstream truth, not just uptime.
10. Every recovery action is traceable and reproducible.
