import test from 'node:test'; import assert from 'node:assert/strict';
import { normalizeProviderEvent } from '../src/contracts.mjs';
import { AuthorizationError } from '../src/errors.mjs';
import { authorize } from '../src/security.mjs';
const base={providerEventId:'x',provider:'1xBet',competitionId:'MLS',seasonId:'2025',kickoffAt:'2025-05-11T00:00:00Z',homeTeam:'A',awayTeam:'B',observedAt:'2025-05-10T23:00:00Z',market:{o25:1.5,o35:2.2,u35:1.6},source:{verified:true}};
test('data contract rejects evidence observed at/after kickoff',()=>assert.throws(()=>normalizeProviderEvent({...base,observedAt:'2025-05-11T00:00:00Z'}),/FUTURE_OR_LATE_EVIDENCE/));
test('security is default deny',()=>assert.throws(()=>authorize('unknown.actor','paper:execute'),AuthorizationError));
test('known identity still cannot perform ungranted action',()=>assert.throws(()=>authorize('svc.ingestion','paper:execute'),AuthorizationError));
