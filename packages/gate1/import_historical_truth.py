from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

from historical_truth_importer import import_historical_rows, input_from_mapping


if len(sys.argv) != 4:
    raise SystemExit("Usage: python import_historical_truth.py <dataset_id> input.csv output.json")

_, dataset_id, input_path, output_path = sys.argv
rows = []
with Path(input_path).open(newline="", encoding="utf-8") as handle:
    for row in csv.DictReader(handle):
        rows.append(input_from_mapping(row))

store = import_historical_rows(rows, dataset_id=dataset_id)
Path(output_path).write_text(json.dumps(store, indent=2), encoding="utf-8")
print(json.dumps(store["summary"], indent=2))
