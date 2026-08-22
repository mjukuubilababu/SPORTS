
import json
from gate1_engine import gate1_acceptance_tests

tests = gate1_acceptance_tests()
failed = [k for k,v in tests.items() if not v]
print(json.dumps(tests, indent=2))
if failed:
    raise SystemExit("FAILED: " + ", ".join(failed))
print("GATE1_ACCEPTANCE=PASS")
