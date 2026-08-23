from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "gate4"))

from blind_test_set import blind_public_status, build_accumulator, freeze_test_set_b, freeze_to_dict

PREREG = ROOT / "packages" / "gate4" / "data" / "negbin-challenger-preregistration-v0.1.json"
HOLDOUT = ROOT / "packages" / "gate4" / "data" / "mls-2026-evaluation-holdout-a-v0.1.json"


def read_candidates(path: Path) -> list[dict]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict) and isinstance(payload.get("records"), list):
        return payload["records"]
    raise ValueError(f"CANDIDATE_FILE_MUST_BE_LIST_OR_RECORDS_OBJECT:{path}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("candidate_files", nargs="+", help="JSON list or {records:[...]} files")
    parser.add_argument("--internal-output", default=str(ROOT / "artifacts" / "blind-test-b-internal.json"))
    parser.add_argument("--public-output", default=str(ROOT / "artifacts" / "blind-test-b-status.json"))
    parser.add_argument("--freeze-id")
    parser.add_argument("--frozen-at")
    parser.add_argument("--freeze-output", default=str(ROOT / "artifacts" / "blind-test-b-freeze.json"))
    args = parser.parse_args()

    prereg = json.loads(PREREG.read_text(encoding="utf-8"))
    holdout = json.loads(HOLDOUT.read_text(encoding="utf-8"))
    rows: list[dict] = []
    for file_name in args.candidate_files:
        rows.extend(read_candidates(Path(file_name)))

    accumulator = build_accumulator(
        rows,
        registered_at=prereg["registered_at"],
        challenger_model_version=prereg["challenger_specification"]["model_version"],
        challenger_specification_sha256=prereg["specification_sha256"],
        forbidden_match_ids=holdout["match_ids"],
        target_n=100,
    )
    public = blind_public_status(accumulator)

    internal_output = Path(args.internal_output)
    public_output = Path(args.public_output)
    internal_output.parent.mkdir(parents=True, exist_ok=True)
    public_output.parent.mkdir(parents=True, exist_ok=True)
    internal_output.write_text(json.dumps(accumulator, indent=2), encoding="utf-8")
    public_output.write_text(json.dumps(public, indent=2), encoding="utf-8")

    output = {
        "status": public,
        "public_output": str(public_output),
        "internal_output": str(internal_output),
        "freeze_created": False,
    }

    if bool(args.freeze_id) != bool(args.frozen_at):
        raise ValueError("FREEZE_ID_AND_FROZEN_AT_MUST_BE_PROVIDED_TOGETHER")
    if args.freeze_id:
        freeze = freeze_test_set_b(accumulator, freeze_id=args.freeze_id, frozen_at=args.frozen_at)
        freeze_output = Path(args.freeze_output)
        freeze_output.parent.mkdir(parents=True, exist_ok=True)
        freeze_output.write_text(json.dumps(freeze_to_dict(freeze), indent=2), encoding="utf-8")
        output["freeze_created"] = True
        output["freeze_output"] = str(freeze_output)
        output["freeze_state"] = freeze.state
        output["freeze_fingerprint_sha256"] = freeze.cohort_fingerprint_sha256

    # No model-vs-market metrics are printed here by design.
    print(json.dumps(output, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
