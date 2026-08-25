from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "contracts" / "pattern-intelligence-contract-v0.1.json"
P002_PATH = ROOT / "contracts" / "p002-frozen-rules.json"
DOC_PATH = ROOT / "packages" / "intelligence-engine" / "docs" / "PATTERN_INTELLIGENCE_CONTRACT_V0_1.md"

EXPECTED_P002 = {
    "lineage": "P002",
    "status": "FROZEN_RESEARCH_RULE",
    "o25_max": 1.60,
    "u35_min": 1.55,
    "u35_max": 1.75,
    "lambda_min": 2.70,
    "lambda_max": 3.10,
    "raw_model_edge_pp_min": 5.0,
    "discovery_min_n": 30,
    "independent_validation_min_n": 30,
    "model_mls_prior_weights": [0.5, 0.5],
    "prior_equivalent_sample_size": 5,
    "lineup_lambda_adjustment": 0.10,
    "capital_effect": "NONE_UNTIL_GOVERNED_EVIDENCE",
}

EXISTING_REUSED_PATHS = [
    ROOT / "packages" / "intelligence-engine" / "src" / "evidence-graph.mjs",
    ROOT / "packages" / "intelligence-engine" / "src" / "error-taxonomy.mjs",
    ROOT / "packages" / "intelligence-engine" / "src" / "confidence-budget.mjs",
    ROOT / "packages" / "intelligence-engine" / "src" / "champion-challenger.mjs",
    ROOT / "packages" / "intelligence-engine" / "src" / "governed-learning-loop.mjs",
    ROOT / "packages" / "intelligence-engine" / "src" / "bidirectional-match-reasoning.mjs",
    ROOT / "packages" / "intelligence-engine" / "src" / "bookmaker-comparison.mjs",
    ROOT / "packages" / "intelligence-engine" / "src" / "bookmaker-learning.mjs",
    ROOT / "packages" / "intelligence-engine" / "src" / "calibrated-intelligence-adjustment.mjs",
]


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> int:
    require(CONTRACT_PATH.exists(), "PATTERN_INTELLIGENCE_CONTRACT_MISSING")
    require(DOC_PATH.exists(), "PATTERN_INTELLIGENCE_ARCHITECTURE_NOTE_MISSING")

    contract = load_json(CONTRACT_PATH)
    require(contract["contract_id"] == "PATTERN_INTELLIGENCE_CONTRACT_V0_1", "CONTRACT_ID_MISMATCH")
    require(contract["version"] == "v0.1", "CONTRACT_VERSION_MISMATCH")
    require(contract["status"] == "ARCHITECTURE_FROZEN_SPEC_ONLY", "STEP0_MUST_REMAIN_SPEC_ONLY")
    require(contract["scope"] == "GLOBAL_FOOTBALL_LEAGUE_AGNOSTIC", "CONTRACT_NOT_GLOBAL")

    construction = contract["construction_policy"]
    require(construction["additive_only_for_step_0"] is True, "STEP0_NOT_ADDITIVE_ONLY")
    require(construction["preserve_existing_system"] is True, "EXISTING_SYSTEM_NOT_PRESERVED")
    require(construction["delete_existing_artifact_without_explicit_user_approval"] is False, "DELETION_GUARD_MISSING")
    require(construction["replace_existing_artifact_without_explicit_user_approval"] is False, "REPLACEMENT_GUARD_MISSING")
    require(construction["conflict_requires_explicit_user_decision"] is True, "CONFLICT_ESCALATION_GUARD_MISSING")
    require(construction["silent_conflict_resolution"] is False, "SILENT_CONFLICT_RESOLUTION_ALLOWED")

    invariants = contract["constitutional_invariants"]
    required_true = [
        "prediction_validation_execution_are_separate",
        "all_verified_outcomes_are_retained",
        "wins_draws_losses_have_equal_truth_status",
        "correct_and_incorrect_predictions_are_retained",
        "loss_is_not_bad_data",
        "outcome_based_row_deletion_for_pattern_improvement_forbidden",
        "no_hindsight",
        "pre_match_influence_requires_available_at_not_after_prediction_cutoff",
        "frozen_predictions_are_immutable",
        "settlement_is_separate_from_prediction",
        "market_to_model_circularity_forbidden",
        "missing_data_guessing_forbidden",
        "one_match_retuning_forbidden",
        "automatic_production_self_modification_forbidden",
        "pattern_discovery_is_not_pattern_validation",
        "pattern_validation_is_not_execution_approval",
        "evidence_maturity_is_not_probability",
        "abstention_is_valid_output",
        "p002_rules_unchanged_by_pattern_intelligence",
    ]
    for key in required_true:
        require(invariants.get(key) is True, f"INVARIANT_NOT_LOCKED_{key}")
    require(invariants["real_money_unlocked_by_pattern_intelligence"] is False, "PATTERN_LAYER_UNLOCKS_REAL_MONEY")

    observation = contract["observation_contract"]
    for field in (
        "observation_id",
        "event_id",
        "entity_type",
        "entity_id",
        "observation_type",
        "value",
        "observed_at",
        "available_at",
        "source",
        "source_type",
        "is_verified",
        "provenance_id",
    ):
        require(field in observation["required_fields"], f"OBSERVATION_FIELD_MISSING_{field}")
    require("Do not discard" in observation["truth_retention_rule"], "OUTCOME_RETENTION_RULE_WEAKENED")
    require("available_at" in observation["pre_match_eligibility_rule"], "AVAILABLE_AT_CUTOFF_RULE_MISSING")

    lifecycle = contract["pattern_lifecycle"]
    states = set(lifecycle["states"])
    expected_states = {
        "DISCOVERED",
        "CANDIDATE",
        "MIN_N_MET",
        "OUT_OF_SAMPLE_TESTED",
        "FORWARD_TESTING",
        "STABLE",
        "VALIDATED",
        "REJECTED",
        "RETIRED",
    }
    require(states == expected_states, "PATTERN_LIFECYCLE_STATE_SET_CHANGED")
    forbidden = set(lifecycle["forbidden_transitions"])
    require("DISCOVERED->VALIDATED" in forbidden, "DISCOVERY_CAN_SKIP_TO_VALIDATED")
    require("REJECTED->VALIDATED" in forbidden, "REJECTED_PATTERN_CAN_SILENTLY_REVIVE")

    pattern = contract["pattern_contract"]
    require("decision weight 0" in pattern["decision_influence_rule"], "UNVALIDATED_PATTERN_WEIGHT_NOT_ZERO")
    require("independent validation" in pattern["decision_influence_rule"], "INDEPENDENT_VALIDATION_NOT_REQUIRED")
    require("may not silently become independent model truth" in pattern["market_pattern_boundary"], "MARKET_CIRCULARITY_BOUNDARY_MISSING")

    anti_hallucination = contract["anti_pattern_hallucination"]
    for key in (
        "multiple_testing_risk_must_be_recorded",
        "data_snooping_must_be_recorded",
        "feature_definition_must_be_frozen_before_confirmatory_test",
        "discovery_and_confirmatory_samples_must_be_separated",
        "effect_size_and_uncertainty_required",
        "sample_n_required",
        "forward_test_required_before_validated_state",
        "failed_patterns_are_retained_for_learning",
        "manual_storytelling_without_evidence_cannot_promote_pattern",
    ):
        require(anti_hallucination.get(key) is True, f"ANTI_PATTERN_HALLUCINATION_GUARD_MISSING_{key}")

    bundle = contract["cross_market_and_bundle_boundary"]
    require(bundle["dependency_adjustment_required_before_bundle_claims"] is True, "DEPENDENCY_ADJUSTMENT_NOT_REQUIRED")
    require(bundle["correlated_legs_must_not_be_counted_as_independent_evidence"] is True, "CORRELATED_LEGS_COUNTED_AS_INDEPENDENT")
    require(bundle["bundle_constructor_may_not_bypass_individual_market_validation"] is True, "BUNDLE_CAN_BYPASS_MARKET_VALIDATION")
    require(bundle["paper_only_until_separately_governed"] is True, "BUNDLE_NOT_PAPER_ONLY")

    done = contract["step_0_definition_of_done"]
    require(done["runtime_pattern_mining_implemented"] is False, "STEP0_FALSELY_CLAIMS_PATTERN_MINER")
    require(done["existing_artifacts_deleted"] == 0, "STEP0_DELETION_CLAIM_NONZERO")
    require(done["existing_canonical_owners_replaced"] == 0, "STEP0_OWNER_REPLACEMENT_CLAIM_NONZERO")
    require(done["next_stage_after_step_0"] == "STEP_1_CANONICAL_MATCH_MEMORY", "NEXT_STAGE_MISMATCH")

    p002 = load_json(P002_PATH)
    require(p002 == EXPECTED_P002, "P002_FROZEN_RULES_CHANGED")

    for path in EXISTING_REUSED_PATHS:
        require(path.exists(), f"EXISTING_REUSED_CAPABILITY_MISSING_{path.name}")

    print(json.dumps({
        "contract": contract["contract_id"],
        "status": contract["status"],
        "scope": contract["scope"],
        "existing_reused_capabilities_n": len(EXISTING_REUSED_PATHS),
        "p002_unchanged": True,
        "existing_artifacts_deleted": 0,
        "existing_canonical_owners_replaced": 0,
        "runtime_pattern_mining_implemented": False,
        "next_stage": done["next_stage_after_step_0"],
        "result": "PASS",
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
