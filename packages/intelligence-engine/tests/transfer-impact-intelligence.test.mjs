import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTeamTransferAudit,
  buildMatchTransferAudit,
  transferAuditToFeatureSet
} from '../src/transfer-impact-intelligence.mjs';
import { deriveTeamMatchSignals } from '../src/team-match-feature-signals.mjs';
import { buildTeamMatchIntelligence } from '../src/team-match-intelligence.mjs';

const AS_OF = '2026-08-24T18:00:00Z';

function player(playerId, roles, overrides={}) {
  return {
    playerId, roles, priorMinutesShare: 0.72, capability: 0.76, sampleSize: 20,
    competitionAdjustment: 1, source: 'VERIFIED_PLAYER_STATS', observedAt: '2026-08-24T12:00:00Z',
    effectiveAt: '2026-08-20T00:00:00Z', verified: true, ...overrides
  };
}
function roster(before, after, overrides={}) {
  return {
    beforeRosterIds: before, afterRosterIds: after, source: 'OFFICIAL_ROSTER',
    observedAt: '2026-08-24T13:00:00Z', verified: true, allMaterialMovesCovered: true, ...overrides
  };
}
function side(teamId, inId, outId, role='ST') {
  return {
    teamId,
    incoming: [player(inId,[role], { capability: 0.82 })],
    outgoing: [player(outId,[role], { capability: 0.70 })],
    rosterAudit: roster([outId, `${teamId}-KEEP`],[inId, `${teamId}-KEEP`])
  };
}

test('builds complete bilateral transfer audit and activates TRANSFER_IMPACT', () => {
  const audit = buildMatchTransferAudit({
    eventId:'E1', asOf:AS_OF, observedAt:'2026-08-24T14:00:00Z', source:'TRANSFER_AUDIT_SOURCES',
    home:side('HOME','H-IN','H-OUT','ST'), away:side('AWAY','A-IN','A-OUT','CB')
  });
  assert.equal(audit.complete,true);
  assert.equal(audit.verified,true);
  assert.equal(audit.home.governance.transferFeesUsed,false);
  assert.equal(audit.home.governance.reputationScoresUsed,false);
  const transferImpact = transferAuditToFeatureSet(audit);
  const signals = deriveTeamMatchSignals({ transferImpact });
  assert.equal(signals.length,1);
  assert.equal(signals[0].domain,'TRANSFER_IMPACT');
  const intel = buildTeamMatchIntelligence({ eventId:'E1', asOf:AS_OF, featureSet:{transferImpact}, minimumSample:5 });
  const row = intel.domainBoard.find(x=>x.domain==='TRANSFER_IMPACT');
  assert.equal(row.state,'ACTIVE');
  assert.ok(!intel.missingDomains.includes('TRANSFER_IMPACT'));
});

test('role replacement fit rewards exact role over unrelated role', () => {
  const exact = buildTeamTransferAudit({ ...side('T','IN','OUT','ST'), asOf:AS_OF });
  const unrelated = buildTeamTransferAudit({
    teamId:'T', asOf:AS_OF,
    incoming:[player('IN',['CB'],{capability:0.82})], outgoing:[player('OUT',['ST'],{capability:0.70})],
    rosterAudit:roster(['OUT','KEEP'],['IN','KEEP'])
  });
  assert.ok(exact.incoming[0].roleFit > unrelated.incoming[0].roleFit);
  assert.ok(exact.netImpact > unrelated.netImpact);
});

test('verified no-transfer audit is neutral and complete', () => {
  const audit = buildTeamTransferAudit({
    teamId:'T', asOf:AS_OF, incoming:[], outgoing:[],
    rosterAudit:roster(['P1','P2'],['P1','P2'])
  });
  assert.equal(audit.complete,true);
  assert.equal(audit.netImpact,0.5);
  assert.equal(audit.incoming.length,0);
  assert.equal(audit.outgoing.length,0);
});

test('fails closed on incomplete or unverified evidence', () => {
  assert.throws(()=>buildTeamTransferAudit({
    ...side('T','IN','OUT'), asOf:AS_OF,
    rosterAudit:roster(['OUT','KEEP'],['IN','KEEP'],{allMaterialMovesCovered:false})
  }), /ROSTER_AUDIT_INCOMPLETE_MATERIAL_MOVES/);
  assert.throws(()=>buildTeamTransferAudit({
    teamId:'T', asOf:AS_OF,
    incoming:[player('IN',['ST'],{verified:false})], outgoing:[player('OUT',['ST'])],
    rosterAudit:roster(['OUT','KEEP'],['IN','KEEP'])
  }), /INCOMING_PLAYER_NOT_VERIFIED/);
});

test('fails closed on hindsight and roster mismatch', () => {
  assert.throws(()=>buildTeamTransferAudit({
    teamId:'T', asOf:AS_OF,
    incoming:[player('IN',['ST'],{observedAt:'2026-08-25T00:00:00Z'})], outgoing:[player('OUT',['ST'])],
    rosterAudit:roster(['OUT','KEEP'],['IN','KEEP'])
  }), /INCOMING_PLAYER_OBSERVED_AFTER_AS_OF/);
  assert.throws(()=>buildTeamTransferAudit({
    teamId:'T', asOf:AS_OF,
    incoming:[player('IN',['ST'])], outgoing:[player('OUT',['ST'])],
    rosterAudit:roster(['OUT','KEEP'],['OTHER','KEEP'])
  }), /INCOMING_NOT_IN_AFTER_ROSTER_IN/);
});

test('fails closed on duplicate/both-direction player identity', () => {
  assert.throws(()=>buildTeamTransferAudit({
    teamId:'T', asOf:AS_OF,
    incoming:[player('X',['ST'])], outgoing:[player('X',['ST'])],
    rosterAudit:roster(['X','KEEP'],['X','KEEP'])
  }), /TRANSFER_PLAYER_BOTH_IN_AND_OUT/);
});

test('feature output cannot silently authorize lambda rewrite', () => {
  const audit = buildMatchTransferAudit({
    asOf:AS_OF, home:side('HOME','H-IN','H-OUT'), away:side('AWAY','A-IN','A-OUT')
  });
  const feature = transferAuditToFeatureSet(audit);
  assert.match(feature.notes,/NO_LAMBDA_REWRITE_WITHOUT_CALIBRATION/);
  assert.equal(audit.home.governance.uncalibratedOutputMayRewriteLambda,false);
  assert.equal(audit.governance.lambdaRewriteRequiresIndependentCalibration,true);
});
