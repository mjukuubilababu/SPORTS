from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "gate1"))

from api_football_match_evidence_provider import (
    VERSION,
    build_runtime_envelope,
    fetch_provider_package,
)


def _read_json(path: str) -> object:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _targets(payload: object) -> list[dict]:
    if isinstance(payload, list):
        rows = payload
    elif isinstance(payload, dict):
        rows = payload.get("targets")
    else:
        rows = None
    if not isinstance(rows, list) or not rows:
        raise ValueError("API_FOOTBALL_TARGETS_REQUIRED")
    return rows


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Acquire and map authenticated API-Football prematch evidence into the existing PostgreSQL runtime envelope."
    )
    parser.add_argument("targets", help="JSON file containing canonical targets.")
    parser.add_argument("output", help="Sanitized canonical runtime envelope output.")
    parser.add_argument(
        "--package-file",
        help="Offline raw provider package for deterministic verification; live acquisition is used when omitted.",
    )
    parser.add_argument(
        "--captured-at",
        help="Required with --package-file. Live acquisition uses the package acquisition completion time.",
    )
    parser.add_argument("--timeout", type=int, default=20)
    parser.add_argument("--fetch-last", type=int, default=20)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    targets = _targets(_read_json(args.targets))
    if args.package_file:
        if not args.captured_at:
            raise ValueError("API_FOOTBALL_OFFLINE_CAPTURED_AT_REQUIRED")
        provider_package = _read_json(args.package_file)
        captured_at = args.captured_at
    else:
        if args.captured_at:
            raise ValueError("API_FOOTBALL_LIVE_CAPTURED_AT_OVERRIDE_FORBIDDEN")
        provider_package = fetch_provider_package(
            api_key=os.environ.get("APISPORTS_KEY", ""),
            targets=targets,
            timeout=args.timeout,
            fetch_last=args.fetch_last,
        )
        captured_at = provider_package["acquiredAt"]

    envelope = build_runtime_envelope(
        targets,
        provider_package,
        captured_at=captured_at,
        authenticated=not bool(args.package_file),
    )
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(envelope, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "runtimeVersion": VERSION,
        "output": str(output),
        "events": len(envelope["providerBatch"]["events"]),
        "rawProviderPayloadPersisted": False,
        "authenticatedAcquisition": not bool(args.package_file),
        "offlineReplay": bool(args.package_file),
        "providerPredictionUsed": False,
        "bookmakerOddsUsed": False,
        "capitalState": "LOCKED",
        "realMoney": "NO",
    }, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({
            "status": "FAILED_CLOSED",
            "error": str(error),
            "capitalState": "LOCKED",
            "realMoney": "NO",
        }), file=sys.stderr)
        raise SystemExit(1)
