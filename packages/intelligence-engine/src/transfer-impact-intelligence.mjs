const VERSION = 'TRANSFER_IMPACT_INTELLIGENCE_V0_1';
const MIN_PLAYER_SAMPLE = 8;
const ROLE_FAMILY = Object.freeze({
  GK: 'GK', CB: 'DEF', LB: 'DEF', RB: 'DEF', LWB: 'DEF', RWB: 'DEF',
  DM: 'MID', CM: 'MID', AM: 'MID', LM: 'WIDE', RM: 'WIDE',
  LW: 'WIDE', RW: 'WIDE', SS: 'ATT', CF: 'ATT', ST: 'ATT'
});

function clamp(value, min = 0, max = 1) { return Math.max(min, Math.min(max, value)); }
function mean(values) { return values.length ? values.reduce((a,b)=>a+b,0)/values.length : 0; }
function isoMs(value, label) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(`${label}_INVALID_TIMESTAMP`);
  return ms;
}
function shaInput(value) {
  return JSON.stringify(value, Object.keys(value).sort());
}
function assert01(name, value) {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name}_MUST_BE_0_TO_1`);
  return value;
}
function canonicalRoles(roles) {
  if (!Array.isArray(roles) || !roles.length) throw new Error('PLAYER_ROLES_REQUIRED');
  const out = [...new Set(roles.map((r)=>String(r).toUpperCase()))];
  for (const role of out) if (!ROLE_FAMILY[role]) throw new Error(`UNKNOWN_PLAYER_ROLE_${role}`);
  return out;
}
function roleFit(incomingRoles, vacancyRoles) {
  if (!vacancyRoles.length) return 0.75;
  let best = 0.4;
  for (const a of incomingRoles) for (const b of vacancyRoles) {
    if (a === b) best = Math.max(best, 1);
    else if (ROLE_FAMILY[a] === ROLE_FAMILY[b]) best = Math.max(best, 0.75);
  }
  return best;
}
function validatePlayer(row, asOfMs, direction) {
  if (!row?.playerId) throw new Error(`${direction}_PLAYER_ID_REQUIRED`);
  const roles = canonicalRoles(row.roles);
  assert01(`${direction}_PRIOR_MINUTES_SHARE`, row.priorMinutesShare);
  assert01(`${direction}_CAPABILITY`, row.capability);
  if (!Number.isInteger(row.sampleSize) || row.sampleSize < MIN_PLAYER_SAMPLE) throw new Error(`${direction}_PLAYER_SAMPLE_LT_${MIN_PLAYER_SAMPLE}`);
  if (!Number.isFinite(row.competitionAdjustment) || row.competitionAdjustment < 0.5 || row.competitionAdjustment > 1.5) {
    throw new Error(`${direction}_COMPETITION_ADJUSTMENT_INVALID`);
  }
  if (!row.source || !row.observedAt) throw new Error(`${direction}_PLAYER_PROVENANCE_REQUIRED`);
  if (row.verified !== true) throw new Error(`${direction}_PLAYER_NOT_VERIFIED`);
  if (isoMs(row.observedAt, `${direction}_OBSERVED_AT`) > asOfMs) throw new Error(`${direction}_PLAYER_OBSERVED_AFTER_AS_OF`);
  if (row.effectiveAt && isoMs(row.effectiveAt, `${direction}_EFFECTIVE_AT`) > asOfMs) throw new Error(`${direction}_TRANSFER_NOT_EFFECTIVE_AS_OF`);
  return { ...row, roles };
}
function validateRosterAudit(rosterAudit, asOfMs) {
  if (!rosterAudit) throw new Error('ROSTER_AUDIT_REQUIRED');
  if (rosterAudit.verified !== true) throw new Error('ROSTER_AUDIT_NOT_VERIFIED');
  if (rosterAudit.allMaterialMovesCovered !== true) throw new Error('ROSTER_AUDIT_INCOMPLETE_MATERIAL_MOVES');
  if (!rosterAudit.source || !rosterAudit.observedAt) throw new Error('ROSTER_AUDIT_PROVENANCE_REQUIRED');
  if (isoMs(rosterAudit.observedAt, 'ROSTER_AUDIT_OBSERVED_AT') > asOfMs) throw new Error('ROSTER_AUDIT_AFTER_AS_OF');
  const before = new Set(rosterAudit.beforeRosterIds ?? []);
  const after = new Set(rosterAudit.afterRosterIds ?? []);
  if (!before.size || !after.size) throw new Error('ROSTER_AUDIT_BEFORE_AFTER_REQUIRED');
  return { before, after };
}
function playerContribution(row, fit = 1) {
  return row.priorMinutesShare * row.capability * row.competitionAdjustment * fit;
}
function normalizedReadiness(netRaw) {
  return clamp(0.5 + 0.5 * Math.tanh(netRaw));
}

export function buildTeamTransferAudit({ teamId, asOf, incoming = [], outgoing = [], rosterAudit }) {
  if (!teamId) throw new Error('TRANSFER_TEAM_ID_REQUIRED');
  const asOfMs = isoMs(asOf, 'TRANSFER_AS_OF');
  const roster = validateRosterAudit(rosterAudit, asOfMs);
  const ins = incoming.map((x)=>validatePlayer(x, asOfMs, 'INCOMING'));
  const outs = outgoing.map((x)=>validatePlayer(x, asOfMs, 'OUTGOING'));

  const incomingIds = new Set(ins.map((x)=>x.playerId));
  const outgoingIds = new Set(outs.map((x)=>x.playerId));
  if (incomingIds.size !== ins.length || outgoingIds.size !== outs.length) throw new Error('TRANSFER_DUPLICATE_PLAYER_ID');
  for (const id of incomingIds) if (outgoingIds.has(id)) throw new Error('TRANSFER_PLAYER_BOTH_IN_AND_OUT');
  for (const row of ins) if (!roster.after.has(row.playerId)) throw new Error(`INCOMING_NOT_IN_AFTER_ROSTER_${row.playerId}`);
  for (const row of outs) if (!roster.before.has(row.playerId)) throw new Error(`OUTGOING_NOT_IN_BEFORE_ROSTER_${row.playerId}`);

  const vacancyRoles = outs.flatMap((x)=>x.roles);
  const incomingRows = ins.map((row)=>{
    const fit = roleFit(row.roles, vacancyRoles);
    return Object.freeze({ ...row, roleFit: fit, contribution: playerContribution(row, fit) });
  });
  const outgoingRows = outs.map((row)=>Object.freeze({ ...row, contributionLost: playerContribution(row, 1) }));

  const incomingImpactRaw = incomingRows.reduce((s,x)=>s+x.contribution,0);
  const outgoingLossRaw = outgoingRows.reduce((s,x)=>s+x.contributionLost,0);
  const incomingMinutes = incomingRows.reduce((s,x)=>s+x.priorMinutesShare,0);
  const outgoingMinutes = outgoingRows.reduce((s,x)=>s+x.priorMinutesShare,0);
  const churnPenalty = Math.min(0.25, outgoingMinutes * 0.15 + incomingMinutes * 0.05);
  const netRaw = incomingImpactRaw - outgoingLossRaw - churnPenalty;
  const netImpact = normalizedReadiness(netRaw);
  const incomingImpact = normalizedReadiness(incomingImpactRaw);
  const outgoingLoss = clamp(outgoingLossRaw);
  const coverage = (ins.length + outs.length) === 0 ? 1 : mean([...incomingRows, ...outgoingRows].map(()=>1));

  return Object.freeze({
    auditVersion: VERSION,
    teamId,
    asOf,
    complete: true,
    verified: true,
    netImpact,
    incomingImpact,
    outgoingLoss,
    raw: Object.freeze({ incomingImpactRaw, outgoingLossRaw, churnPenalty, netRaw, incomingMinutesShare: incomingMinutes, outgoingMinutesShare: outgoingMinutes }),
    incoming: Object.freeze(incomingRows),
    outgoing: Object.freeze(outgoingRows),
    coverage,
    rosterAudit: Object.freeze({ source: rosterAudit.source, observedAt: rosterAudit.observedAt, verified: true, allMaterialMovesCovered: true }),
    governance: Object.freeze({
      transferFeesUsed: false,
      reputationScoresUsed: false,
      bookmakerOddsUsed: false,
      roleFitDerivedFromCanonicalRoles: true,
      minutesAndCapabilityEvidenceRequired: true,
      uncalibratedOutputMayRewriteLambda: false
    })
  });
}

export function buildMatchTransferAudit({ eventId = null, asOf, source = null, observedAt = asOf, home, away }) {
  const homeAudit = buildTeamTransferAudit({ ...home, asOf });
  const awayAudit = buildTeamTransferAudit({ ...away, asOf });
  const observedMs = isoMs(observedAt, 'MATCH_TRANSFER_OBSERVED_AT');
  if (observedMs > isoMs(asOf, 'MATCH_TRANSFER_AS_OF')) throw new Error('MATCH_TRANSFER_OBSERVED_AFTER_AS_OF');
  return Object.freeze({
    auditVersion: VERSION,
    eventId,
    asOf,
    observedAt,
    source: source ?? 'COMPOSITE_VERIFIED_TRANSFER_AUDIT',
    complete: true,
    verified: true,
    home: homeAudit,
    away: awayAudit,
    correlationGroup: 'SQUAD_TRANSITION',
    minimumSampleRequired: 1,
    governance: Object.freeze({
      bothTeamsRequired: true,
      allMaterialMovesCovered: true,
      postAsOfEvidenceForbidden: true,
      rawEvidencePreserved: true,
      lambdaRewriteRequiresIndependentCalibration: true
    })
  });
}

export function transferAuditToFeatureSet(audit) {
  if (audit?.auditVersion !== VERSION || audit.complete !== true || audit.verified !== true) throw new Error('COMPLETE_VERIFIED_TRANSFER_AUDIT_REQUIRED');
  return Object.freeze({
    confidence: 0.72,
    sampleSize: 1,
    minimumSampleRequired: 1,
    observedAt: audit.observedAt,
    source: audit.source,
    verified: true,
    correlationGroup: 'SQUAD_TRANSITION',
    homeNetImpact: audit.home.netImpact,
    awayNetImpact: audit.away.netImpact,
    homeIncomingImpact: audit.home.incomingImpact,
    homeOutgoingLoss: audit.home.outgoingLoss,
    awayIncomingImpact: audit.away.incomingImpact,
    awayOutgoingLoss: audit.away.outgoingLoss,
    notes: `${VERSION}; ROLE_MINUTES_CAPABILITY_BASED; NO_FEE_OR_REPUTATION; NO_LAMBDA_REWRITE_WITHOUT_CALIBRATION`
  });
}

export const TRANSFER_IMPACT_INTELLIGENCE_VERSION = VERSION;
