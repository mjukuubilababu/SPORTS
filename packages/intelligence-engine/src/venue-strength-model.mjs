const CONTEXT_CAPS = Object.freeze({ LOW: 85, MEDIUM: 75, HIGH: 65 });

function finiteNonNegative(name, value) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name}_INVALID`);
}

function positiveInteger(name, value) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name}_INVALID`);
}

function shrinkRate(goals, matches, priorRate, priorEquivalentMatches) {
  return (goals + priorRate * priorEquivalentMatches) / (matches + priorEquivalentMatches);
}

export function derivePreviousSeasonVenueModel({
  leagueStats,
  homeStats,
  awayStats,
  priorEquivalentMatches = 5,
  contextRisk = 'HIGH',
  sourceVerification = {}
}) {
  positiveInteger('LEAGUE_MATCHES', leagueStats?.matches);
  finiteNonNegative('LEAGUE_HOME_GOALS', leagueStats?.homeGoals);
  finiteNonNegative('LEAGUE_AWAY_GOALS', leagueStats?.awayGoals);
  positiveInteger('HOME_MATCHES', homeStats?.matches);
  finiteNonNegative('HOME_GF', homeStats?.goalsFor);
  finiteNonNegative('HOME_GA', homeStats?.goalsAgainst);
  positiveInteger('AWAY_MATCHES', awayStats?.matches);
  finiteNonNegative('AWAY_GF', awayStats?.goalsFor);
  finiteNonNegative('AWAY_GA', awayStats?.goalsAgainst);
  if (!Number.isInteger(priorEquivalentMatches) || priorEquivalentMatches < 0) throw new Error('PRIOR_EQUIVALENT_MATCHES_INVALID');
  if (!(contextRisk in CONTEXT_CAPS)) throw new Error('CONTEXT_RISK_INVALID');

  const leagueHomeRate = leagueStats.homeGoals / leagueStats.matches;
  const leagueAwayRate = leagueStats.awayGoals / leagueStats.matches;
  if (!(leagueHomeRate > 0) || !(leagueAwayRate > 0)) throw new Error('LEAGUE_RATE_INVALID');

  const homeFor = shrinkRate(homeStats.goalsFor, homeStats.matches, leagueHomeRate, priorEquivalentMatches);
  const homeAgainst = shrinkRate(homeStats.goalsAgainst, homeStats.matches, leagueAwayRate, priorEquivalentMatches);
  const awayFor = shrinkRate(awayStats.goalsFor, awayStats.matches, leagueAwayRate, priorEquivalentMatches);
  const awayAgainst = shrinkRate(awayStats.goalsAgainst, awayStats.matches, leagueHomeRate, priorEquivalentMatches);

  const homeAttack = homeFor / leagueHomeRate;
  const awayDefenseWeakness = awayAgainst / leagueHomeRate;
  const awayAttack = awayFor / leagueAwayRate;
  const homeDefenseWeakness = homeAgainst / leagueAwayRate;

  const homeLambda = leagueHomeRate * homeAttack * awayDefenseWeakness;
  const awayLambda = leagueAwayRate * awayAttack * homeDefenseWeakness;

  const verified = sourceVerification.primaryVenueStats === true
    && sourceVerification.crossCheckSeasonTotals === true
    && sourceVerification.independenceFromMarket === true;

  return Object.freeze({
    modelVersion: 'PREVIOUS_SEASON_VENUE_POISSON_SHRUNK_V0_1',
    verified,
    independenceFromMarket: sourceVerification.independenceFromMarket === true,
    usesBookmakerOdds: false,
    priorEquivalentMatches,
    contextRisk,
    evidenceMaturity: verified ? CONTEXT_CAPS[contextRisk] : 0,
    homeLambda,
    awayLambda,
    expectedTotalGoals: homeLambda + awayLambda,
    leagueRates: Object.freeze({ home: leagueHomeRate, away: leagueAwayRate }),
    shrunkRates: Object.freeze({ homeFor, homeAgainst, awayFor, awayAgainst }),
    strengths: Object.freeze({ homeAttack, awayDefenseWeakness, awayAttack, homeDefenseWeakness })
  });
}

export function attachIndependentVenueModels(marketBatch, modelDataset) {
  if (!marketBatch?.batchId || !Array.isArray(marketBatch.events)) throw new Error('MARKET_BATCH_INVALID');
  if (!modelDataset?.datasetId || !modelDataset?.leagueStats || !Array.isArray(modelDataset.events)) throw new Error('MODEL_DATASET_INVALID');
  const byEvent = new Map(modelDataset.events.map((x) => [x.eventId, x]));

  return {
    ...marketBatch,
    modelDatasetId: modelDataset.datasetId,
    modelDataNature: 'REAL_INDEPENDENT_HISTORICAL_TEAM_DATA',
    events: marketBatch.events.map((event) => {
      const input = byEvent.get(event.eventId);
      if (!input) return event;
      const derived = derivePreviousSeasonVenueModel({
        leagueStats: modelDataset.leagueStats,
        homeStats: input.homeStats,
        awayStats: input.awayStats,
        priorEquivalentMatches: modelDataset.priorEquivalentMatches ?? 5,
        contextRisk: input.contextRisk,
        sourceVerification: input.sourceVerification
      });
      return {
        ...event,
        model: {
          verified: derived.verified,
          homeLambda: derived.homeLambda,
          awayLambda: derived.awayLambda,
          maxGoals: 12,
          modelVersion: derived.modelVersion,
          independenceFromMarket: derived.independenceFromMarket,
          usesBookmakerOdds: false,
          sourceDatasetId: modelDataset.datasetId,
          provenance: input.provenance,
          diagnostics: derived
        },
        evidenceMaturity: derived.evidenceMaturity,
        lineupGate: input.lineupGate ?? 'PENDING',
        independenceVerified: input.crossEventIndependenceVerified === true,
        correlationGroup: input.correlationGroup ?? null,
        modelContext: {
          contextRisk: input.contextRisk,
          reasons: input.contextReasons ?? [],
          contextObservedAt: input.contextObservedAt ?? modelDataset.capturedAt,
          sources: input.contextSources ?? []
        }
      };
    })
  };
}
