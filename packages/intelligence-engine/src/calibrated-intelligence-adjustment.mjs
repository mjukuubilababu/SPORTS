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

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
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
  if (!intelligence?.domainBoard || !intelligence?.compositeCorrelationGroups) throw new Error('TEAM_MATCH_INTELLIGENCE_REQUIRED');
  if (!Number.isInteger(minimumCalibrationSample) || minimumCalibrationSample < 1) throw new Error('MINIMUM_CALIBRATION_SAMPLE_INVALID');
  if (!(multiplierFloor > 0 && multiplierCeiling >= multiplierFloor)) throw new Error('MULTIPLIER_BOUNDS_INVALID');

  const blocked = !calibration
    || calibration.verified !== true
    || calibration.usesBookmakerOdds === true
    || !calibration.version
    || !calibration.provenance
    || !Number.isInteger(calibration.sampleSize)
    || calibration.sampleSize < minimumCalibrationSample
    || !calibration.domainCoefficients;

  if (blocked) {
    return Object.freeze({
      version: 'CALIBRATED_TEAM_INTELLIGENCE_ADJUSTMENT_V0_1',
      adjustmentApplied: false,
      reason: 'VERIFIED_INDEPENDENT_CALIBRATION_REQUIRED',
      baseline: Object.freeze({ homeLambda, awayLambda }),
      adjusted: Object.freeze({ homeLambda, awayLambda }),
      multipliers: Object.freeze({ home: 1, away: 1 }),
      governance: Object.freeze({
        uncalibratedFootballIntelligenceCannotRewriteLambda: true,
        bookmakerOddsForbiddenFromCalibration: true
      })
    });
  }

  let homeLog = 0;
  let awayLog = 0;
  const contributions = [];
  for (const group of intelligence.compositeCorrelationGroups) {
    const coefficientRows = group.domains
      .map((domain) => {
        const coeff = calibration.domainCoefficients[domain];
        if (!coeff) return null;
        validateCoefficientRow(domain, coeff);
        return { domain, ...coeff };
      })
      .filter(Boolean);
    if (!coefficientRows.length) continue;

    const homeBeta = mean(coefficientRows.map((row) => row.homeLambdaBeta));
    const awayBeta = mean(coefficientRows.map((row) => row.awayLambdaBeta));
    const effectiveScore = group.impact * group.confidence;
    const homeContribution = effectiveScore * homeBeta;
    const awayContribution = effectiveScore * awayBeta;
    homeLog += homeContribution;
    awayLog += awayContribution;
    contributions.push(Object.freeze({
      correlationGroup: group.correlationGroup,
      domains: group.domains,
      score: group.impact,
      confidence: group.confidence,
      effectiveScore,
      homeLambdaBeta: homeBeta,
      awayLambdaBeta: awayBeta,
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
      calibrationUsesDeCorrelatedCompositeGroups: true,
      correlationFamilyContributesAtMostOnce: true,
      multiplierCapsRequired: true,
      bookmakerOddsForbiddenFromCalibration: true
    })
  });
}
