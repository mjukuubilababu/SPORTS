-- Integration defect fix: assurance gate evaluates criticality on TestResult.
-- Original 0013 artifact is preserved unchanged under packages/infrastructure-original/.
ALTER TABLE test_results_v01
  ADD COLUMN IF NOT EXISTS critical boolean NOT NULL DEFAULT false;
