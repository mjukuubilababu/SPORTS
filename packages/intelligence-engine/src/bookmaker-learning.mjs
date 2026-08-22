function mean(values) {
  return values.length ? values.reduce((a,b)=>a+b,0)/values.length : null;
}

function selectionKeys(rows) {
  const keys = new Set();
  for (const row of rows) {
    for (const key of Object.keys(row.fair ?? {})) keys.add(key);
  }
  return [...keys];
}

function brierForOutcome(fair, actualOutcome) {
  if (!fair || !actualOutcome || !(actualOutcome in fair)) return null;
  const keys = Object.keys(fair);
  return keys.reduce((sum, key) => sum + (fair[key] - (key === actualOutcome ? 1 : 0)) ** 2, 0) / keys.length;
}

export function buildBookmakerLearningProfile(observations, { disagreementThreshold = 0.03 } = {}) {
  if (!Array.isArray(observations) || observations.length === 0) {
    return { status:'WAIT', reason:'NO_OBSERVATIONS', profiles:{} };
  }

  const byProvider = new Map();
  for (const row of observations) {
    if (!row?.provider || !row.fair || !row.consensusFair || !Number.isFinite(row.overround)) continue;
    if (!byProvider.has(row.provider)) byProvider.set(row.provider, []);
    byProvider.get(row.provider).push(row);
  }

  const profiles = {};
  for (const [provider, rows] of byProvider.entries()) {
    const keys = selectionKeys(rows);
    const signedBiasBySelection = {};
    const meanAbsoluteDeviationBySelection = {};
    for (const key of keys) {
      const diffs = rows
        .filter((r)=>Number.isFinite(r.fair?.[key]) && Number.isFinite(r.consensusFair?.[key]))
        .map((r)=>r.fair[key]-r.consensusFair[key]);
      signedBiasBySelection[key] = mean(diffs);
      meanAbsoluteDeviationBySelection[key] = mean(diffs.map(Math.abs));
    }
    const briers = rows.map((r)=>brierForOutcome(r.fair,r.actualOutcome)).filter(Number.isFinite);
    const maxGaps = rows.map((r)=>{
      const diffs=Object.keys(r.fair).filter((k)=>Number.isFinite(r.consensusFair?.[k])).map((k)=>Math.abs(r.fair[k]-r.consensusFair[k]));
      return diffs.length ? Math.max(...diffs) : 0;
    });
    profiles[provider] = {
      provider,
      observations: rows.length,
      averageOverround: mean(rows.map((r)=>r.overround)),
      signedBiasBySelection,
      meanAbsoluteDeviationBySelection,
      disagreementRate: maxGaps.filter((x)=>x>=disagreementThreshold).length / rows.length,
      outcomeBrier: briers.length ? mean(briers) : null,
      outcomeSamples: briers.length,
      interpretation: 'DESCRIPTIVE_NOT_CAUSAL'
    };
  }

  const providerProfiles = Object.values(profiles);
  const peerMeanOverround = mean(providerProfiles.map((p)=>p.averageOverround).filter(Number.isFinite));
  for (const profile of providerProfiles) {
    const patterns = [];
    if (Number.isFinite(peerMeanOverround) && profile.averageOverround - peerMeanOverround >= 0.015) {
      patterns.push({code:'WIDER_MARGIN_THAN_PEER_MEAN',evidence:{gap:profile.averageOverround-peerMeanOverround}});
    }
    for (const [selection,bias] of Object.entries(profile.signedBiasBySelection)) {
      if (Number.isFinite(bias) && Math.abs(bias)>=0.015) {
        patterns.push({code:'SYSTEMATIC_SELECTION_SHADE',selection,direction:bias>0?'HIGHER_FAIR_PROBABILITY':'LOWER_FAIR_PROBABILITY',evidence:{meanSignedBias:bias}});
      }
    }
    profile.patterns = patterns;
  }

  return {
    status:'PASS',
    profiles,
    peerMeanOverround,
    policy:'LEARN_PATTERNS_NOT_UNOBSERVED_INTENT'
  };
}
