const MIN_HALF_PROFILE_SAMPLE = 30;

function finitePositive(name, value) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name}_INVALID`);
}

function unitIntervalExclusive(name, value) {
  if (!Number.isFinite(value) || value <= 0 || value >= 1) throw new Error(`${name}_INVALID`);
}

function nonNegativeInteger(name, value) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name}_INVALID`);
}

export function deriveHalfSpecificLambdas({
  fullTimeHomeLambda,
  fullTimeAwayLambda,
  halfProfile,
  minimumSample = MIN_HALF_PROFILE_SAMPLE
}) {
  finitePositive('FULL_TIME_HOME_LAMBDA', fullTimeHomeLambda);
  finitePositive('FULL_TIME_AWAY_LAMBDA', fullTimeAwayLambda);
  nonNegativeInteger('MINIMUM_SAMPLE', minimumSample);
  if (!halfProfile || typeof halfProfile !== 'object') throw new Error('HALF_PROFILE_REQUIRED');
  nonNegativeInteger('HALF_PROFILE_SAMPLE', halfProfile.sampleSize);
  unitIntervalExclusive('HOME_FIRST_HALF_SHARE', halfProfile.homeFirstHalfGoalShare);
  unitIntervalExclusive('AWAY_FIRST_HALF_SHARE', halfProfile.awayFirstHalfGoalShare);

  const verified = halfProfile.sourceVerification?.primaryHalfStats === true
    && halfProfile.sourceVerification?.independenceFromMarket === true
    && halfProfile.sourceVerification?.preMatchOnly === true
    && halfProfile.sampleSize >= minimumSample;

  const firstHalfHomeLambda = fullTimeHomeLambda * halfProfile.homeFirstHalfGoalShare;
  const secondHalfHomeLambda = fullTimeHomeLambda - firstHalfHomeLambda;
  const firstHalfAwayLambda = fullTimeAwayLambda * halfProfile.awayFirstHalfGoalShare;
  const secondHalfAwayLambda = fullTimeAwayLambda - firstHalfAwayLambda;

  return Object.freeze({
    modelVersion: 'HALF_SPECIFIC_LAMBDA_SPLIT_V0_1',
    verified,
    minimumSample,
    sampleSize: halfProfile.sampleSize,
    sourceProfileId: halfProfile.profileId ?? null,
    sourceSeason: halfProfile.sourceSeason ?? null,
    usesBookmakerOdds: false,
    independenceFromMarket: halfProfile.sourceVerification?.independenceFromMarket === true,
    firstHalf: Object.freeze({
      homeLambda: firstHalfHomeLambda,
      awayLambda: firstHalfAwayLambda,
      expectedGoals: firstHalfHomeLambda + firstHalfAwayLambda
    }),
    secondHalf: Object.freeze({
      homeLambda: secondHalfHomeLambda,
      awayLambda: secondHalfAwayLambda,
      expectedGoals: secondHalfHomeLambda + secondHalfAwayLambda
    }),
    shares: Object.freeze({
      homeFirstHalfGoalShare: halfProfile.homeFirstHalfGoalShare,
      awayFirstHalfGoalShare: halfProfile.awayFirstHalfGoalShare,
      homeSecondHalfGoalShare: 1 - halfProfile.homeFirstHalfGoalShare,
      awaySecondHalfGoalShare: 1 - halfProfile.awayFirstHalfGoalShare
    }),
    provenance: Object.freeze({
      sources: Object.freeze([...(halfProfile.sources ?? [])]),
      verification: Object.freeze({ ...(halfProfile.sourceVerification ?? {}) })
    }),
    governance: Object.freeze({
      fullTimeLambdaNotSplitFiftyFiftyByDefault: true,
      verifiedHistoricalHalfProfileRequired: true,
      minimumSampleRequired: minimumSample,
      bookmakerOddsForbiddenFromHalfProfile: true
    })
  });
}

export const HALF_SPECIFIC_MIN_SAMPLE = MIN_HALF_PROFILE_SAMPLE;
