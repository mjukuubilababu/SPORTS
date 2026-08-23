# Real MLS 2026 Historical Research Runtime v0.1

## Purpose

Run a real, reproducible Gate1 -> Gate2 -> Gate3 research benchmark without substituting synthetic market probabilities.

## Data design

### 2025 warm-up history

The runtime downloads two exact reviewed public Git blobs:

- MLSOpenSkill `mls-2025.csv`, blob `022c9bc83a3196adc702bf84a64217571b087630`.
- OpenFootball `2025/mls.json`, blob `2896d283601615739418575cbe6b6c9b316a3151`.

The existing cross-source reconciler requires the same normalized home/away pair, exact final score and date distance <= 1 day. These matches provide chronological feature history only. They do not invent historical market prices.

### 2026 market sample

`packages/gate1/data/footiqo-mls-2026-public-closing-snapshot-v0.1.csv` contains 25 reviewed public Footiqo MLS observations with O2.5/U2.5/O3.5/U3.5. Footiqo is already registered in Gate1 as a primary closing source with 1xBet provider semantics.

The runtime downloads FixtureDownload's public MLS 2026 UTC result CSV and accepts a Footiqo observation only when normalized teams and exact final score agree within one source-date day. The canonical match date is derived from FixtureDownload UTC kickoff and the home venue timezone rather than copied from the market page.

## Evaluation

The combined truth store is processed chronologically through Gate2. Settlement is then joined by `match_id` in Gate3.

Two reports remain separate:

- **Research report**: model probability + same-market fair probability + verified result. It can report Brier, log loss and calibration but cannot promote P002 or unlock capital.
- **Strict P002 report**: preserves the frozen Gate1 validation-N state and Gate2 final model gate. No missing lineup evidence is bypassed.

The closing U3.5 price is a closing reference price, not a claimed execution entry. CLV stays unavailable when a distinct entry price does not exist.

## Commands

```bash
python scripts/test_footiqo_fixture_reconciler.py
python scripts/run_real_2026_historical_research.py --bootstrap-reps 2000
```

The network runtime writes `artifacts/real-2026-historical-research-report.json`.

## Governance

- No odds inferred from final scores.
- No private bookmaker endpoint reverse engineering.
- No outcome in the pre-settlement feature snapshot.
- No research result may be used as a promotion result.
- Frozen P002 thresholds are unchanged.
- Capital remains locked; `real_money = NO`.
