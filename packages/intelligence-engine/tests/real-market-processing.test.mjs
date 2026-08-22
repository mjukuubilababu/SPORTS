import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canonicalize1X2Snapshot,
  processObservedMarketBatch,
  processObservedMarketEvent
} from '../src/index.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const realBatchPath = path.resolve(__dirname, '../data/real-market-batch-2026-08-23T001346+0300.json');

function loadRealBatch() {
  return JSON.parse(fs.readFileSync(realBatchPath, 'utf8'));
}

test('explicit raw order mapping canonicalizes SportPesa HOME/AWAY/DRAW safely', () => {
  const snapshot = canonicalize1X2Snapshot({
    provider: 'SPORTPESA',
    rawOdds: [3.85, 1.90, 3.95],
    rawOrder: ['HOME', 'AWAY', 'DRAW']
  });
  assert.deepEqual(snapshot.odds, { HOME: 3.85, DRAW: 3.95, AWAY: 1.90 });
  assert.equal(snapshot.adaptation.mode, 'EXPLICIT_RAW_ORDER_MAPPING');
});

test('first real observed batch is market-ready but waits for independently verified model inputs', () => {
  const report = processObservedMarketBatch(loadRealBatch());
  assert.equal(report.summary.eventsReceived, 3);
  assert.equal(report.summary.marketReadyEvents, 3);
  assert.equal(report.summary.modelVerifiedEvents, 0);
  assert.equal(report.summary.qualifiedSignals, 0);
  assert.equal(report.summary.states.WAIT, 3);
  assert.equal(report.mode, 'REAL_DATA_PAPER_ONLY');
  assert.equal(report.realMoney, 'NO');
});

test('Manchester City real capture produces multi-bookmaker fair consensus and best-price board', () => {
  const report = processObservedMarketBatch(loadRealBatch());
  const event = report.events.find((row) => row.eventId === 'EPL-2026-08-23-MCI-BOU');
  assert.equal(event.marketState, 'MARKET_READY');
  assert.deepEqual(event.bookmakerComparison.providers.sort(), ['BETPAWA', 'SPORTPESA', 'STAKE'].sort());
  assert.ok(event.bookmakerComparison.consensusFair.HOME > 0.63);
  assert.ok(event.bookmakerComparison.consensusFair.HOME < 0.65);
  assert.equal(event.bookmakerComparison.bestPrice.HOME.provider, 'SPORTPESA');
  assert.equal(event.bookmakerComparison.bestPrice.DRAW.provider, 'BETPAWA');
  assert.equal(event.bookmakerComparison.bestPrice.AWAY.provider, 'BETPAWA');
});

test('real processor will not infer a model from bookmaker odds', () => {
  const batch = loadRealBatch();
  const event = processObservedMarketEvent(batch.events[0], batch);
  assert.equal(event.state, 'WAIT');
  assert.equal(event.modelState, 'MODEL_INPUT_NOT_VERIFIED');
  assert.deepEqual(event.reasons, ['MODEL_INPUT_NOT_VERIFIED']);
  assert.equal('prediction' in event, false);
});

test('verified independent lambda inputs allow the same real-market path to reach prediction qualification', () => {
  const batch = loadRealBatch();
  const source = batch.events[0];
  const event = {
    ...source,
    model: { verified: true, homeLambda: 2.5, awayLambda: 0.7 },
    evidenceMaturity: 90,
    lineupGate: 'PASS',
    independenceVerified: true,
    correlationGroup: 'EPL-MCI-BOU'
  };
  const result = processObservedMarketEvent(event, batch);
  assert.equal(result.marketState, 'MARKET_READY');
  assert.equal(result.modelState, 'MODEL_VERIFIED');
  assert.ok(result.prediction);
  assert.equal(result.realMoney, 'NO');
  assert.notEqual(result.state, 'REJECTED');
});
