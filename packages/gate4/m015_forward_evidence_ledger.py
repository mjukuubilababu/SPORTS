from __future__ import annotations

from copy import deepcopy
from hashlib import sha256
import json
from typing import Dict, Iterable, List, Set

from m015_forward_validation import (
    FROZEN_SIGNAL_STATE,
    SETTLED_STATE,
    evaluate_forward_set,
    verify_frozen_prediction,
    verify_settled_row,
)


LEDGER_VERSION = "M015_FORWARD_EVIDENCE_LEDGER_V0_1"
LEDGER_STATE = "APPEND_ONLY_FORWARD_EVIDENCE"


def _canonical_json(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _hash(value: object) -> str:
    return sha256(_canonical_json(value).encode("utf-8")).hexdigest()


def empty_ledger(registration: Dict) -> Dict:
    return {
        "ledger_version": LEDGER_VERSION,
        "state": LEDGER_STATE,
        "challenger_id": registration["challenger_id"],
        "model_id": registration["model_id"],
        "model_version": registration["model_version"],
        "specification_sha256": registration["specification_sha256"],
        "entries": [],
        "summary": {
            "frozen_pending_settlement": 0,
            "settled_independent_n": 0,
        },
        "governance": {
            "append_only": True,
            "prediction_overwrite_forbidden": True,
            "settlement_overwrite_forbidden": True,
            "consumed_holdout_overlap_forbidden": True,
            "incomplete_rows_do_not_count": True,
            "automatic_promotion": False,
            "decision_weight": 0.0,
        },
    }


def _validate_header(ledger: Dict, registration: Dict) -> None:
    if ledger.get("ledger_version") != LEDGER_VERSION:
        raise ValueError("M015_LEDGER_VERSION_MISMATCH")
    if ledger.get("state") != LEDGER_STATE:
        raise ValueError("M015_LEDGER_STATE_INVALID")
    for field in ("challenger_id", "model_id", "model_version", "specification_sha256"):
        if ledger.get(field) != registration.get(field):
            raise ValueError(f"M015_LEDGER_REGISTRATION_MISMATCH_{field.upper()}")
    if not isinstance(ledger.get("entries"), list):
        raise ValueError("M015_LEDGER_ENTRIES_REQUIRED")


def _entry_match_ids(ledger: Dict) -> Set[str]:
    ids: Set[str] = set()
    for entry in ledger["entries"]:
        match_id = str(entry.get("match_id") or "")
        if not match_id:
            raise ValueError("M015_LEDGER_ENTRY_MATCH_ID_REQUIRED")
        if match_id in ids:
            raise ValueError("M015_LEDGER_DUPLICATE_MATCH_ID")
        ids.add(match_id)
    return ids


def _entry_payload(entry: Dict) -> Dict:
    payload = dict(entry)
    payload.pop("entry_fingerprint_sha256", None)
    return payload


def _fingerprint_entry(entry: Dict) -> Dict:
    out = dict(entry)
    out["entry_fingerprint_sha256"] = _hash(_entry_payload(out))
    return out


def verify_entry(entry: Dict) -> bool:
    fingerprint = str(entry.get("entry_fingerprint_sha256") or "")
    return bool(fingerprint) and fingerprint == _hash(_entry_payload(entry))


def _recompute_summary(ledger: Dict) -> Dict:
    pending = 0
    settled = 0
    for entry in ledger["entries"]:
        if entry.get("state") == FROZEN_SIGNAL_STATE:
            pending += 1
        elif entry.get("state") == SETTLED_STATE:
            settled += 1
        else:
            raise ValueError("M015_LEDGER_ENTRY_STATE_INVALID")
    ledger["summary"] = {
        "frozen_pending_settlement": pending,
        "settled_independent_n": settled,
    }
    return ledger


def append_frozen_prediction(
    ledger: Dict,
    registration: Dict,
    frozen_prediction: Dict,
    *,
    forbidden_match_ids: Iterable[str] = (),
) -> Dict:
    _validate_header(ledger, registration)
    existing_ids = _entry_match_ids(ledger)
    if not verify_frozen_prediction(frozen_prediction):
        raise ValueError("M015_LEDGER_FROZEN_PREDICTION_INVALID")
    match_id = str(frozen_prediction["match_id"])
    if match_id in {str(x) for x in forbidden_match_ids}:
        raise ValueError("M015_LEDGER_CONSUMED_HOLDOUT_OVERLAP")
    if match_id in existing_ids:
        raise ValueError("M015_LEDGER_PREDICTION_OVERWRITE_FORBIDDEN")

    out = deepcopy(ledger)
    out["entries"].append(_fingerprint_entry(dict(frozen_prediction)))
    out["entries"] = sorted(
        out["entries"],
        key=lambda x: (str(x.get("kickoff_at", "")), str(x.get("match_id", ""))),
    )
    return _recompute_summary(out)


def append_settlement(ledger: Dict, registration: Dict, settled_row: Dict) -> Dict:
    _validate_header(ledger, registration)
    _entry_match_ids(ledger)
    if not verify_settled_row(settled_row):
        raise ValueError("M015_LEDGER_SETTLED_ROW_INVALID")
    match_id = str(settled_row["match_id"])

    index = None
    for i, entry in enumerate(ledger["entries"]):
        if str(entry.get("match_id")) == match_id:
            index = i
            break
    if index is None:
        raise ValueError("M015_LEDGER_SETTLEMENT_WITHOUT_FROZEN_PREDICTION")

    existing = ledger["entries"][index]
    if not verify_entry(existing):
        raise ValueError("M015_LEDGER_EXISTING_ENTRY_TAMPERED")
    if existing.get("state") == SETTLED_STATE:
        raise ValueError("M015_LEDGER_SETTLEMENT_OVERWRITE_FORBIDDEN")
    if existing.get("state") != FROZEN_SIGNAL_STATE:
        raise ValueError("M015_LEDGER_EXISTING_ENTRY_STATE_INVALID")
    if existing.get("prediction_fingerprint_sha256") != settled_row.get("prediction_fingerprint_sha256"):
        raise ValueError("M015_LEDGER_SETTLEMENT_PREDICTION_FINGERPRINT_MISMATCH")

    out = deepcopy(ledger)
    out["entries"][index] = _fingerprint_entry(dict(settled_row))
    return _recompute_summary(out)


def validate_ledger(
    ledger: Dict,
    registration: Dict,
    *,
    forbidden_match_ids: Iterable[str] = (),
) -> Dict:
    _validate_header(ledger, registration)
    forbidden = {str(x) for x in forbidden_match_ids}
    _entry_match_ids(ledger)
    pending: List[Dict] = []
    settled: List[Dict] = []

    for entry in ledger["entries"]:
        if not verify_entry(entry):
            raise ValueError("M015_LEDGER_ENTRY_TAMPERED")
        match_id = str(entry["match_id"])
        if match_id in forbidden:
            raise ValueError("M015_LEDGER_CONSUMED_HOLDOUT_OVERLAP")
        payload = dict(entry)
        payload.pop("entry_fingerprint_sha256", None)
        if entry.get("state") == FROZEN_SIGNAL_STATE:
            if not verify_frozen_prediction(payload):
                raise ValueError("M015_LEDGER_FROZEN_PREDICTION_INVALID")
            pending.append(payload)
        elif entry.get("state") == SETTLED_STATE:
            if not verify_settled_row(payload):
                raise ValueError("M015_LEDGER_SETTLED_ROW_INVALID")
            settled.append(payload)
        else:
            raise ValueError("M015_LEDGER_ENTRY_STATE_INVALID")

    expected = {
        "frozen_pending_settlement": len(pending),
        "settled_independent_n": len(settled),
    }
    if ledger.get("summary") != expected:
        raise ValueError("M015_LEDGER_SUMMARY_MISMATCH")

    evaluation = evaluate_forward_set(
        registration,
        settled,
        forbidden_match_ids=forbidden,
    )
    return {
        "ledger_version": LEDGER_VERSION,
        "ledger_valid": True,
        "entry_n": len(ledger["entries"]),
        "pending_n": len(pending),
        "settled_n": len(settled),
        "evaluation": evaluation,
        "governance": {
            "incomplete_rows_excluded_from_independent_n": True,
            "append_only_integrity_verified": True,
            "duplicate_match_ids_blocked": True,
            "consumed_holdout_overlap_blocked": True,
            "decision_weight": 0.0,
            "automatic_promotion": False,
        },
    }
