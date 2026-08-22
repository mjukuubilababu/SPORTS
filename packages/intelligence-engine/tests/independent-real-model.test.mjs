import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  derivePreviousSeasonVenueModel,
  attachIndependentVenueModels,
  processIndependentModelMarketBatch
} from '../src/index.mjs';

const marketBatch = JSON.parse(fs.readFileSync(new URL('../data/real-market-batch-2026-08-23T001346+0300.json', import.meta.url), 'utf8'));
const modelDataset = JSON.parse(fs.readFileSync(new URL('../data/independent-model-inputs-2026-08-23.json', import.meta.url), 'utf8'));

test('previous-season venue model derives verified independent lambdas with shrinkage', () => {
  const model = derivePreviousSeasonVenueModel({
    leagueStats: modelDataset.leagueStats,
    homeStats: { matches: 19, goalsFor: 45, goalsAgainst: 14 },
    awayStats: { matches: 19, goalsFor: 29, goalsAgainst: 34 },
    priorEquivalentMatches: 5,
    contextRisk: 'HIGH',
    sourceVerification: { primaryVenueStats: true, crossCheckSeasonTotals: true, independenceFromMarket: true }
  });
  assert.equal(model.verified, true);
  assert.equal(model.usesBookmakerOdds, false);
  assert.equal(model.evidenceMaturity, 65);
  assert.ok(Math.abs(model.homeLambda - 2.49231195805606) < 1e-12);
  assert.ok(Math.abs(model.awayLambda - 1.0023907144092308) < 1e-12);
});

test('real market capture is joined to separate model dataset without mutating original capture identity', () => {
  const enriched = attachIndependentVenueModels(marketBatch, modelDataset);
  assert.equal(enriched.batchId, marketBatch.batchId);
  assert.equal(enriched.modelDatasetId, modelDataset.datasetId);
  assert.equal(enriched.events.length, 3);
  assert.ok(enriched.events.every((event) => event.model?.verified === true));
  assert.ok(enriched.events.every((event) => event.model?.usesBookmakerOdds === false));
  assert.ok(enriched.events.every((event) => event.lineupGate === 'PENDING'));
});

test('real independent model plus observed market batch processes all three events but does not qualify opening-weekend transitions', () => {
  const report = processIndependentModelMarketBatch(marketBatch, modelDataset);
  assert.equal(report.summary.eventsReceived, 3);
  assert.equal(report.summary.marketReadyEvents, 3);
  assert.equal(report.summary.modelVerifiedEvents, 3);
  assert.equal(report.summary.qualifiedSignals, 0);
  assert.equal(report.summary.states.WATCH, 3);
  assert.equal(report.modelBoard.length, 3);
});

test('Manchester City baseline produces a real model probability without market-derived lambda leakage', () => {
  const report = processIndependentModelMarketBatch(marketBatch, modelDataset);
  const city = report.modelBoard.find((row) => row.eventId === 'EPL-2026-08-23-MCI-BOU');
  assert.equal(city.predictedOutcome, 'HOME_WIN');
  assert.ok(Math.abs(city.probabilities.homeWin - 0.6986299888308779) < 1e-10);
  assert.equal(city.contextRisk, 'HIGH');
  assert.equal(city.lineupGate, 'PENDING');
});

test('Newcastle-Liverpool large direction conflict is diagnostic and does not auto-retune', () => {
  const report = processIndependentModelMarketBatch(marketBatch, modelDataset);
  const row = report.modelBoard.find((x) => x.eventId === 'EPL-2026-08-23-NEW-LIV');
  assert.equal(row.predictedOutcome, 'HOME_WIN');
  assert.equal(row.diagnostics.marketTopSelection, 'AWAY');
  assert.equal(row.diagnostics.directionConflict, true);
  assert.equal(row.diagnostics.highTransitionLargeDivergence, true);
  assert.equal(row.diagnostics.policy, 'DIAGNOSTIC_ONLY_NO_AUTOMATIC_LAMBDA_REWRITE');
});
