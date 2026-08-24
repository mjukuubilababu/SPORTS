# PostgreSQL Runtime Verification v0.1

## Purpose

Static SQL review is not sufficient assurance for migrations. This capability runs the canonical infrastructure migrations against an actual isolated PostgreSQL 16 instance in GitHub Actions.

The database is ephemeral and is not a production or user database.

## Runtime flow

1. Start PostgreSQL 16 service container.
2. Wait for `pg_isready` health check.
3. Run `scripts/verify_postgres_migrations.py` with an ephemeral TEST_DATABASE_URL.
4. The verifier creates a unique schema for the run.
5. Apply migrations 0009–0014 in exact order.
6. Reapply all migrations to verify idempotency.
7. Inspect required catalog tables and the 0014 critical column.
8. Execute negative constraint tests that must fail.
9. Verify the security audit table immutable trigger blocks updates.
10. Verify transaction rollback leaves no probe table.
11. Verify the migration ledger contains exactly 0009–0014.
12. Drop the isolated schema; the CI service is destroyed after the job.

## Assurance boundary

A passing run proves the migration set executes correctly on the CI PostgreSQL version and that the asserted runtime database invariants hold. It does not by itself prove production networking, backup policy, managed-service configuration or production performance.

Capital state is unaffected and real-money execution remains disabled.
