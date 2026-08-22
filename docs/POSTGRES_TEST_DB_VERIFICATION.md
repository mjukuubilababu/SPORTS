# PostgreSQL TEST Migration Verification

This is the final engineering assurance step for infrastructure migrations `0009` through `0014`.

## Requirements
- PostgreSQL TEST database (never production)
- `psql` installed
- `TEST_DATABASE_URL` set

## Command
```bash
TEST_DATABASE_URL='postgresql://...' python scripts/verify_postgres_migrations.py
```

The verifier creates an isolated schema, applies migrations in strict order, records a migration ledger, re-applies them to verify idempotency, verifies catalog objects, runs negative constraint tests, verifies immutable triggers, tests transactional rollback, emits evidence, and drops the schema.

A PASS here is an engineering migration assurance only. It does not unlock real capital.
