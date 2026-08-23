function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function validateCoefficientRow(domain, row) {
  if (!row || !Number.isFinite(row.homeLambdaBeta) || !Number.isFinite(row.awayLambdaBeta)) {
    throw new Error(`CALIBRATION_COEFFICIENT_INVALID_${domain}`);
  }
  if (Math.abs(row.homeLambdaBeta) > 1 || Math.abs(row.awayLambdaBeta) > 1) {
    throw new Error(`CALIBRATION_COEFFICIENT_OUT_OF_BOUNDS_${domain}`);
  }
}

export function applyCalibratedTeamIntelligence({
  homeLambda,
  awayLambda,
  intelligence,
  calibration,
  minimumCalibrationSample = 30,
  multiplierFloor = 0.8,
  multiplierCeiling = 1.2
}) {
  if (!Number.isFinite(homeLambda) || homeLambda <= 0) throw new Error('HOME_LAMBDA_INVALID');
  if (!Number.isFinite(awayLambda) || awayLambda <= 0) throw new Error('AWAY_LAMBDA_INVALID');
  if (!intelligence?.domainBoard) throw new Error('TEAM_MATCH_INTELLIGENCE_REQUIRED');
  if (!Number.isInteger(minimumCalibrationSample) || minimumCalibrationSample < 1) throw new Error('MINIMUM_CALIBRATION_SAMPLE_INVALID');
  if (!(multiplierFloor > 0 && multiplierCeiling >= multiplierFloor)) throw new Error('MULTIPLIER_BOUNDS_INVALID');

  const blocked = !calibration
    || calibration.verified !== true
    || !calibration.version
    || !calibration.provenance
    || !Number.isInteger(calibration.sampleSize)
    || calibration.sampleSize < minimumCalibrationSample
    || !calibration.domainCoefficients;

  if (blocked) {
    return Object.freeze({
      version: 'CALIBRATED_TEAM_INTELLIGENCE_ADJUSTMENT_V0_1',
      adjustmentApplied: false,
      reason: 'VERIFIED_CALIBRATION_REQUIRED',
      baseline: Object.freeze({ homeLambda, awayLambda }),
      adjusted: Object.freeze({ homeLambda, awayLambda }),
      multipliers: Object.freeze({ home: 1, away: 1 }),
      governance: Object.freeze({ uncalibratedFootballIntelligenceCannotRewriteLambda: true })
    });
  }

  let homeLog = 0;
  let awayLog = 0;
  const contributions = [];
  for (const row of intelligence.domainBoard) {
    if (row.state !== 'ACTIVE') continue;
    const coeff = calibration.domainCoefficients[row.domain];
    if (!coeff) continue;
    validateCoefficientRow(row.domain, coeff);
    const effectiveScore = row.score * row.confidence;
    const homeContribution = effectiveScore * coeff.homeLambdaBeta;
    const awayContribution = effectiveScore * coeff.awayLambdaBeta;
    homeLog += homeContribution;
    awayLog += awayContribution;
    contributions.push(Object.freeze({
      domain: row.domain,
      score: row.score,
      confidence: row.confidence,
      effectiveScore,
      homeLambdaContribution: homeContribution,
      awayLambdaContribution: awayContribution
    }));
  }

  const homeMultiplier = clamp(Math.exp(homeLog), multiplierFloor, multiplierCeiling);
  const awayMultiplier = clamp(Math.exp(awayLog), multiplierFloor, multiplierCeiling);
  const adjustedHomeLambda = homeLambda * homeMultiplier;
  const adjustedAwayLambda = awayLambda * awayMultiplier;

  return Object.freeze({
    version: 'CALIBRATED_TEAM_INTELLIGENCE_ADJUSTMENT_V0_1',
    adjustmentApplied: true,
    calibrationVersion: calibration.version,
    calibrationSampleSize: calibration.sampleSize,
    calibrationProvenance: calibration.provenance,
    baseline: Object.freeze({ homeLambda, awayLambda }),
    adjusted: Object.freeze({ homeLambda: adjustedHomeLambda, awayLambda: adjustedAwayLambda }),
    multipliers: Object.freeze({ home: homeMultiplier, away: awayMultiplier }),
    contributions: Object.freeze(contributions),
    caps: Object.freeze({ floor: multiplierFloor, ceiling: multiplierCeiling }),
    governance: Object.freeze({
      verifiedCalibrationRequired: true,
      minimumCalibrationSample,
      domainContributionsExplicit: true,
      multiplierCapsRequired: true,
      bookmakerOddsCannotCalibrateFootballIntelligence: calibration.usesBookmakerOdds !== true
    })
  });
}
