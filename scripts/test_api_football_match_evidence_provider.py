from __future__ import annotations

import copy
import json
import sys
import unittest
import urllib.parse
from unittest import mock
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "gate1"))

import api_football_match_evidence_provider as provider_module
from api_football_match_evidence_provider import (
    VERSION,
    build_runtime_envelope,
    fetch_provider_package,
    fetch_runtime_envelope,
)


CAPTURED = "2026-09-10T12:00:00.000Z"
KICKOFF = "2026-09-10T15:00:00.000Z"
CUTOFF = "2026-09-10T14:45:00.000Z"


def fixture_row(
    fixture_id: int,
    date: str,
    home_id: int,
    home_name: str,
    away_id: int,
    away_name: str,
    home_goals,
    away_goals,
    *,
    status: str = "FT",
    league_id: int = 39,
) -> dict:
    return {
        "fixture": {"id": fixture_id, "date": date, "status": {"short": status}},
        "league": {"id": league_id, "season": 2026},
        "teams": {
            "home": {"id": home_id, "name": home_name},
            "away": {"id": away_id, "name": away_name},
        },
        "goals": {"home": home_goals, "away": away_goals},
    }


def response(*rows: dict) -> dict:
    return {"errors": {}, "response": list(rows)}


def target() -> dict:
    return {
        "eventId": "CANONICAL-EVENT-1001",
        "providerFixtureId": 1001,
        "kickoffAt": KICKOFF,
        "predictionCutoff": CUTOFF,
        "homeTeamId": 10,
        "homeTeam": "HOME FC",
        "awayTeamId": 20,
        "awayTeam": "AWAY FC",
    }


def provider_package() -> dict:
    return {
        "provider": "API_FOOTBALL",
        "acquiredAt": CAPTURED,
        "events": [{
            "providerFixtureId": 1001,
            "targetFixture": response(fixture_row(
                1001, KICKOFF, 10, "HOME FC", 20, "AWAY FC", None, None, status="NS"
            )),
            "homeHistory": response(
                fixture_row(901, "2026-09-01T15:00:00Z", 10, "HOME FC", 30, "OPP A", 2, 0),
                fixture_row(902, "2026-08-25T15:00:00Z", 31, "OPP B", 10, "HOME FC", 1, 1),
            ),
            "awayHistory": response(
                fixture_row(911, "2026-09-02T15:00:00Z", 32, "OPP C", 20, "AWAY FC", 0, 2),
                fixture_row(912, "2026-08-24T15:00:00Z", 20, "AWAY FC", 33, "OPP D", 1, 2),
            ),
            "h2h": response(
                fixture_row(921, "2026-08-01T15:00:00Z", 10, "HOME FC", 20, "AWAY FC", 1, 0),
                fixture_row(922, "2026-01-01T15:00:00Z", 20, "AWAY FC", 10, "HOME FC", 2, 2),
            ),
        }],
    }


class ApiFootballMatchEvidenceProviderTests(unittest.TestCase):
    def test_maps_exact_provider_documents_to_existing_runtime_envelope(self):
        envelope = build_runtime_envelope([target()], provider_package(), captured_at=CAPTURED)
        self.assertEqual(envelope["runtimeVersion"], VERSION)
        batch = envelope["providerBatch"]
        event = batch["events"][0]
        evidence = event["evidence"]

        self.assertEqual(batch["provider"], "API_FOOTBALL")
        self.assertEqual(batch["sourceType"], "PROVIDER_API_REPLAY")
        self.assertFalse(batch["verified"])
        self.assertEqual(event["eventId"], "CANONICAL-EVENT-1001")
        self.assertEqual(event["providerEventId"], "1001")
        self.assertEqual(evidence["homeRecentMatches"][0]["goalsFor"], 2)
        self.assertEqual(evidence["homeRecentMatches"][1]["goalsFor"], 1)
        self.assertEqual(len(evidence["homeHomeMatches"]), 1)
        self.assertEqual(evidence["awayRecentMatches"][0]["goalsFor"], 2)
        self.assertEqual(len(evidence["awayAwayMatches"]), 1)
        self.assertEqual(evidence["h2hMatches"][1]["goalsFor"], 2)
        self.assertEqual(evidence["h2hMatches"][1]["goalsAgainst"], 2)
        self.assertEqual(evidence["restDays"], {"home": 9, "away": 8})
        self.assertIsNone(evidence["xG"])
        self.assertIsNone(evidence["lineups"])
        self.assertIsNone(evidence["injuries"])
        self.assertEqual(evidence["marketObservations"], [])
        self.assertIsNone(event["model"])
        self.assertEqual(len(event["providerSourceFingerprint"]), 64)
        self.assertTrue(event["sourceReference"].endswith(event["providerSourceFingerprint"]))
        self.assertEqual(
            envelope["timingByEvent"]["CANONICAL-EVENT-1001"]["predictionCutoff"],
            CUTOFF,
        )
        serialized = json.dumps(envelope)
        self.assertNotIn('"errors"', serialized)
        self.assertNotIn('"response"', serialized)
        self.assertNotIn("APISPORTS_KEY", serialized)
        self.assertFalse(envelope["governance"]["rawProviderPayloadPersisted"])
        self.assertEqual(envelope["governance"]["capitalState"], "LOCKED")
        self.assertEqual(envelope["governance"]["realMoney"], "NO")

    def test_only_coupled_authenticated_fetch_can_verify_and_replay_cannot_self_promote(self):
        documents = provider_package()["events"][0]

        def fake_transport(url, headers, timeout):
            query = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
            if query.get("id") == ["1001"]:
                return documents["targetFixture"]
            if query.get("team") == ["10"]:
                return documents["homeHistory"]
            if query.get("team") == ["20"]:
                return documents["awayHistory"]
            if query.get("h2h") == ["10-20"]:
                return documents["h2h"]
            raise AssertionError("unexpected query: " + url)

        with mock.patch.object(provider_module, "_now_utc", return_value=CAPTURED):
            acquired = fetch_provider_package(
                api_key="super-secret-provider-key",
                targets=[target()],
                transport=fake_transport,
            )
        replayed = build_runtime_envelope([target()], acquired, captured_at=CAPTURED)
        self.assertEqual(replayed["providerBatch"]["sourceType"], "PROVIDER_API_REPLAY")
        self.assertFalse(replayed["providerBatch"]["verified"])
        self.assertTrue(replayed["governance"]["offlineReplay"])

        with (
            mock.patch.object(provider_module, "_now_utc", return_value=CAPTURED),
            mock.patch.object(provider_module, "_open_json", side_effect=fake_transport),
        ):
            authenticated = fetch_runtime_envelope(
                api_key="super-secret-provider-key",
                targets=[target()],
            )
        self.assertEqual(authenticated["providerBatch"]["sourceType"], "PROVIDER_API")
        self.assertTrue(authenticated["providerBatch"]["verified"])
        self.assertTrue(authenticated["governance"]["authenticatedAcquisition"])

    def test_package_acquisition_time_is_required_and_exactly_bound_to_capture(self):
        missing = provider_package()
        del missing["acquiredAt"]
        with self.assertRaisesRegex(ValueError, "API_FOOTBALL_PACKAGE_ACQUIRED_AT_REQUIRED"):
            build_runtime_envelope([target()], missing, captured_at=CAPTURED)
        late = provider_package()
        late["acquiredAt"] = "2026-09-10T13:00:00.000Z"
        with self.assertRaisesRegex(ValueError, "API_FOOTBALL_PACKAGE_CAPTURE_TIME_MISMATCH"):
            build_runtime_envelope([target()], late, captured_at=CAPTURED)

    def test_same_inputs_and_capture_version_are_deterministic(self):
        first = build_runtime_envelope([target()], provider_package(), captured_at=CAPTURED)
        second = build_runtime_envelope([target()], provider_package(), captured_at=CAPTURED)
        self.assertEqual(first, second)

    def test_changed_raw_payload_keeps_identity_but_changes_exact_source_fingerprint(self):
        original = build_runtime_envelope([target()], provider_package(), captured_at=CAPTURED)
        altered_package = provider_package()
        altered_package["events"][0]["homeHistory"]["response"][0]["goals"]["home"] = 3
        altered = build_runtime_envelope([target()], altered_package, captured_at=CAPTURED)
        left = original["providerBatch"]["events"][0]
        right = altered["providerBatch"]["events"][0]
        self.assertEqual(left["evidenceSnapshotId"], right["evidenceSnapshotId"])
        self.assertNotEqual(left["providerSourceFingerprint"], right["providerSourceFingerprint"])
        self.assertNotEqual(left["evidence"], right["evidence"])

    def test_h2h_must_contain_both_target_teams(self):
        package = provider_package()
        package["events"][0]["h2h"]["response"][0]["teams"]["away"] = {"id": 99, "name": "UNRELATED FC"}
        with self.assertRaisesRegex(ValueError, "API_FOOTBALL_H2H_TARGET_PAIR_MISMATCH"):
            build_runtime_envelope([target()], package, captured_at=CAPTURED)

    def test_target_identity_mismatch_rejected(self):
        package = provider_package()
        package["events"][0]["targetFixture"]["response"][0]["teams"]["home"]["id"] = 999
        with self.assertRaisesRegex(ValueError, "API_FOOTBALL_TARGET_TEAM_ID_MISMATCH"):
            build_runtime_envelope([target()], package, captured_at=CAPTURED)

    def test_post_kickoff_history_is_rejected_not_silently_filtered(self):
        package = provider_package()
        package["events"][0]["homeHistory"]["response"][0]["fixture"]["date"] = "2026-09-10T16:00:00Z"
        with self.assertRaisesRegex(ValueError, "API_FOOTBALL_POST_KICKOFF_HISTORY_REJECTED"):
            build_runtime_envelope([target()], package, captured_at=CAPTURED)

    def test_post_capture_pre_kickoff_history_is_rejected(self):
        package = provider_package()
        package["events"][0]["homeHistory"]["response"][0]["fixture"]["date"] = "2026-09-10T13:00:00Z"
        with self.assertRaisesRegex(ValueError, "API_FOOTBALL_POST_CAPTURE_HISTORY_REJECTED"):
            build_runtime_envelope([target()], package, captured_at=CAPTURED)

    def test_non_settled_history_is_rejected(self):
        package = provider_package()
        package["events"][0]["homeHistory"]["response"][0]["fixture"]["status"]["short"] = "NS"
        with self.assertRaisesRegex(ValueError, "API_FOOTBALL_HOME_HISTORY_NON_SETTLED_FIXTURE_REJECTED"):
            build_runtime_envelope([target()], package, captured_at=CAPTURED)

    def test_live_target_and_late_capture_are_rejected(self):
        live = provider_package()
        live["events"][0]["targetFixture"]["response"][0]["fixture"]["status"]["short"] = "1H"
        with self.assertRaisesRegex(ValueError, "API_FOOTBALL_TARGET_NOT_PREMATCH"):
            build_runtime_envelope([target()], live, captured_at=CAPTURED)
        late = provider_package()
        late["acquiredAt"] = "2026-09-10T14:50:00.000Z"
        with self.assertRaisesRegex(ValueError, "API_FOOTBALL_CAPTURE_AFTER_PREDICTION_CUTOFF"):
            build_runtime_envelope(
                [target()], late, captured_at="2026-09-10T14:50:00Z"
            )

    def test_provider_package_identity_is_exact(self):
        package = provider_package()
        package["provider"] = "OTHER_PROVIDER"
        with self.assertRaisesRegex(ValueError, "API_FOOTBALL_PROVIDER_PACKAGE_PROVIDER_MISMATCH"):
            build_runtime_envelope([target()], package, captured_at=CAPTURED)

    def test_duplicate_and_non_exact_package_sets_are_rejected(self):
        duplicated = provider_package()
        duplicated["events"].append(copy.deepcopy(duplicated["events"][0]))
        with self.assertRaisesRegex(ValueError, "API_FOOTBALL_PROVIDER_PACKAGE_DUPLICATE_FIXTURE_ID"):
            build_runtime_envelope([target()], duplicated, captured_at=CAPTURED)
        extra = provider_package()
        extra["events"].append({
            **copy.deepcopy(extra["events"][0]),
            "providerFixtureId": 1002,
        })
        with self.assertRaisesRegex(ValueError, "API_FOOTBALL_PROVIDER_PACKAGE_TARGET_SET_NOT_EXACT"):
            build_runtime_envelope([target()], extra, captured_at=CAPTURED)

    def test_authenticated_acquisition_uses_only_required_documented_fixture_queries(self):
        package = provider_package()
        documents = package["events"][0]
        seen = []

        def fake_transport(url, headers, timeout):
            seen.append((url, dict(headers), timeout))
            query = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
            if query.get("id") == ["1001"]:
                return documents["targetFixture"]
            if query.get("team") == ["10"]:
                return documents["homeHistory"]
            if query.get("team") == ["20"]:
                return documents["awayHistory"]
            if query.get("h2h") == ["10-20"]:
                return documents["h2h"]
            raise AssertionError("unexpected query: " + url)

        acquired = fetch_provider_package(
            api_key="super-secret-provider-key",
            targets=[target()],
            transport=fake_transport,
        )
        self.assertEqual(acquired["requestCount"], 4)
        self.assertFalse(acquired["apiKeyPersisted"])
        self.assertEqual(len(acquired["acquiredAt"]), 24)
        self.assertTrue(acquired["acquiredAt"].endswith("Z"))
        self.assertNotIn("super-secret-provider-key", json.dumps(acquired))
        self.assertEqual({row[1]["x-apisports-key"] for row in seen}, {"super-secret-provider-key"})
        self.assertTrue(all(row[2] == 20 for row in seen))
        history_queries = [
            urllib.parse.parse_qs(urllib.parse.urlparse(row[0]).query)
            for row in seen
            if "team=" in row[0] or "h2h=" in row[0]
        ]
        self.assertTrue(all(query["status"] == ["AET-FT-PEN"] for query in history_queries))

    def test_empty_history_remains_explicit_unknown_without_failure(self):
        package = provider_package()
        package["events"][0]["homeHistory"] = response()
        package["events"][0]["awayHistory"] = response()
        package["events"][0]["h2h"] = response()
        envelope = build_runtime_envelope([target()], package, captured_at=CAPTURED)
        evidence = envelope["providerBatch"]["events"][0]["evidence"]
        self.assertEqual(evidence["homeRecentMatches"], [])
        self.assertEqual(evidence["awayRecentMatches"], [])
        self.assertEqual(evidence["h2hMatches"], [])
        self.assertEqual(evidence["restDays"], {"home": None, "away": None})


if __name__ == "__main__":
    unittest.main(verbosity=2)
