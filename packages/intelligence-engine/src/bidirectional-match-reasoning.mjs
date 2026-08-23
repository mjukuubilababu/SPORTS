import { poissonProbability } from './outcome-1x2.mjs';

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function binaryEntropy(p) {
  if (p <= 0 || p >= 1) return 0;
  return -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
}

function roundKey(line) {
  return String(line).replace('.', '_');
}

function assertLine(line) {
  if (!Number.isFinite(line) || line < 0 || Math.abs((line * 2) - Math.round(line * 2)) > 1e-9) {
    throw new Error('INVALID_MARKET_LINE');
  }
}

function normalizeMatrix(rows) {
  const mass = rows.reduce((sum, row) => sum + row.probability, 0);
  if (!(mass > 0)) throw new Error('SCORE_DISTRIBUTION_EMPTY');
  return rows.map((row) => ({ ...row, probability: row.probability / mass }));
}

export function buildScoreDistribution({ homeLambda, awayLambda, maxGoals = 12 }) {
  if (!Number.isFinite(homeLambda) || homeLambda < 0) throw new Error('HOME_LAMBDA_INVALID');
  if (!Number.isFinite(awayLambda) || awayLambda < 0) throw new Error('AWAY_LAMBDA_INVALID');
  if (!Number.isInteger(maxGoals) || maxGoals < 4 || maxGoals > 30) throw new Error('MAX_GOALS_INVALID');
  const rows = [];
  for (let homeGoals = 0; homeGoals <= maxGoals; homeGoals += 1) {
    const pHome = poissonProbability(homeLambda, homeGoals);
    for (let awayGoals = 0; awayGoals <= maxGoals; awayGoals += 1) {
      rows.push({
        homeGoals,
        awayGoals,
        totalGoals: homeGoals + awayGoals,
        probability: pHome * poissonProbability(awayLambda, awayGoals)
      });
    }
  }
  return Object.freeze({
    homeLambda,
    awayLambda,
    maxGoals,
    rows: Object.freeze(normalizeMatrix(rows).map(Object.freeze))
  });
}

function probabilityOf(distribution, predicate) {
  return clamp01(distribution.rows.reduce((sum, row) => sum + (predicate(row) ? row.probability : 0), 0));
}

function makePair({ id, family, affirmativeLabel, counterLabel, affirmativeProbability, metadata = {} }) {
  const p = clamp01(affirmativeProbability);
  const q = clamp01(1 - p);
  const preferredIsAffirmative = p >= q;
  const preferredProbability = preferredIsAffirmative ? p : q;
  const counterProbability = preferredIsAffirmative ? q : p;
  return Object.freeze({
    id,
    family,
    affirmative: Object.freeze({ label: affirmativeLabel, probability: p }),
    counter: Object.freeze({ label: counterLabel, probability: q }),
    preferred: Object.freeze({
      label: preferredIsAffirmative ? affirmativeLabel : counterLabel,
      probability: preferredProbability,
      opposingProbability: counterProbability,
      direction: preferredIsAffirmative ? 'AFFIRMATIVE' : 'COUNTER',
      probabilityMargin: preferredProbability - counterProbability,
      uncertainty: binaryEntropy(preferredProbability),
      certaintyScore: 1 - binaryEntropy(preferredProbability)
    }),
    metadata: Object.freeze({ ...metadata })
  });
}

function outcomeProbabilities(distribution) {
  return {
    homeWin: probabilityOf(distribution, (r) => r.homeGoals > r.awayGoals),
    draw: probabilityOf(distribution, (r) => r.homeGoals === r.awayGoals),
    awayWin: probabilityOf(distribution, (r) => r.homeGoals < r.awayGoals)
  };
}

function exactTotalDistribution(distribution) {
  const totals = {};
  for (const row of distribution.rows) {
    totals[row.totalGoals] = (totals[row.totalGoals] ?? 0) + row.probability;
  }
  return Object.freeze(Object.fromEntries(
    Object.entries(totals).map(([goals, probability]) => [goals, probability])
  ));
}

function topCorrectScores(distribution, limit) {
  return Object.freeze([...distribution.rows]
    .sort((a, b) => b.probability - a.probability)
    .slice(0, limit)
    .map((r) => Object.freeze({
      score: `${r.homeGoals}-${r.awayGoals}`,
      homeGoals: r.homeGoals,
      awayGoals: r.awayGoals,
      probability: r.probability
    })));
}

function teamReality(distribution, side, outcome) {
  const home = side === 'HOME';
  const goals = (r) => home ? r.homeGoals : r.awayGoals;
  const conceded = (r) => home ? r.awayGoals : r.homeGoals;
  const winP = home ? outcome.homeWin : outcome.awayWin;
  const loseP = home ? outcome.awayWin : outcome.homeWin;
  return Object.freeze({
    side,
    expectedGoals: home ? distribution.homeLambda : distribution.awayLambda,
    scoreAtLeastOne: probabilityOf(distribution, (r) => goals(r) >= 1),
    failToScore: probabilityOf(distribution, (r) => goals(r) === 0),
    scoreAtLeastTwo: probabilityOf(distribution, (r) => goals(r) >= 2),
    scoreAtLeastThree: probabilityOf(distribution, (r) => goals(r) >= 3),
    win: winP,
    notWin: 1 - winP,
    lose: loseP,
    notLose: 1 - loseP,
    cleanSheet: probabilityOf(distribution, (r) => conceded(r) === 0),
    concedeAtLeastOne: probabilityOf(distribution, (r) => conceded(r) >= 1),
    concedeAtLeastTwo: probabilityOf(distribution, (r) => conceded(r) >= 2)
  });
}

export function buildBidirectionalMatchReasoning({
  eventId = null,
  homeTeam = 'HOME',
  awayTeam = 'AWAY',
  homeLambda,
  awayLambda,
  maxGoals = 12,
  totalLines = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5],
  teamTotalLines = [0.5, 1.5, 2.5, 3.5],
  correctScoreLimit = 8
}) {
  if (!Number.isInteger(correctScoreLimit) || correctScoreLimit < 1 || correctScoreLimit > 30) {
    throw new Error('CORRECT_SCORE_LIMIT_INVALID');
  }
  totalLines.forEach(assertLine);
  teamTotalLines.forEach(assertLine);
  const distribution = buildScoreDistribution({ homeLambda, awayLambda, maxGoals });
  const outcome = outcomeProbabilities(distribution);
  const home = teamReality(distribution, 'HOME', outcome);
  const away = teamReality(distribution, 'AWAY', outcome);
  const bttsYes = probabilityOf(distribution, (r) => r.homeGoals >= 1 && r.awayGoals >= 1);
  const noGoal = probabilityOf(distribution, (r) => r.totalGoals === 0);
  const homeOnly = probabilityOf(distribution, (r) => r.homeGoals >= 1 && r.awayGoals === 0);
  const awayOnly = probabilityOf(distribution, (r) => r.homeGoals === 0 && r.awayGoals >= 1);
  const totalOdd = probabilityOf(distribution, (r) => r.totalGoals % 2 === 1);

  const pairs = [];
  const add = (x) => pairs.push(makePair(x));
  add({ id: 'HOME_WIN_VS_NOT_WIN', family: 'MATCH_RESULT', affirmativeLabel: `${homeTeam} WIN`, counterLabel: `${homeTeam} NOT WIN`, affirmativeProbability: outcome.homeWin });
  add({ id: 'AWAY_WIN_VS_NOT_WIN', family: 'MATCH_RESULT', affirmativeLabel: `${awayTeam} WIN`, counterLabel: `${awayTeam} NOT WIN`, affirmativeProbability: outcome.awayWin });
  add({ id: 'DRAW_VS_NOT_DRAW', family: 'MATCH_RESULT', affirmativeLabel: 'DRAW', counterLabel: 'NOT DRAW', affirmativeProbability: outcome.draw });
  add({ id: 'HOME_LOSE_VS_NOT_LOSE', family: 'MATCH_RESULT', affirmativeLabel: `${homeTeam} LOSE`, counterLabel: `${homeTeam} NOT LOSE`, affirmativeProbability: outcome.awayWin });
  add({ id: 'AWAY_LOSE_VS_NOT_LOSE', family: 'MATCH_RESULT', affirmativeLabel: `${awayTeam} LOSE`, counterLabel: `${awayTeam} NOT LOSE`, affirmativeProbability: outcome.homeWin });
  add({ id: 'HOME_SCORE_VS_FAIL', family: 'TEAM_SCORING', affirmativeLabel: `${homeTeam} SCORE`, counterLabel: `${homeTeam} FAIL TO SCORE`, affirmativeProbability: home.scoreAtLeastOne });
  add({ id: 'AWAY_SCORE_VS_FAIL', family: 'TEAM_SCORING', affirmativeLabel: `${awayTeam} SCORE`, counterLabel: `${awayTeam} FAIL TO SCORE`, affirmativeProbability: away.scoreAtLeastOne });
  add({ id: 'HOME_CLEAN_SHEET_VS_CONCEDE', family: 'CLEAN_SHEET', affirmativeLabel: `${homeTeam} CLEAN SHEET`, counterLabel: `${homeTeam} CONCEDE`, affirmativeProbability: home.cleanSheet });
  add({ id: 'AWAY_CLEAN_SHEET_VS_CONCEDE', family: 'CLEAN_SHEET', affirmativeLabel: `${awayTeam} CLEAN SHEET`, counterLabel: `${awayTeam} CONCEDE`, affirmativeProbability: away.cleanSheet });
  add({ id: 'BTTS_YES_VS_NO', family: 'BTTS', affirmativeLabel: 'BTTS YES', counterLabel: 'BTTS NO', affirmativeProbability: bttsYes });

  const totals = {};
  for (const line of totalLines) {
    const over = probabilityOf(distribution, (r) => r.totalGoals > line);
    const key = roundKey(line);
    totals[key] = Object.freeze({ line, over, under: 1 - over });
    add({ id: `TOTAL_${key}_OVER_VS_UNDER`, family: 'TOTAL_GOALS', affirmativeLabel: `OVER ${line}`, counterLabel: `UNDER ${line}`, affirmativeProbability: over, metadata: { line } });
  }

  const homeTotals = {};
  const awayTotals = {};
  for (const line of teamTotalLines) {
    const homeOver = probabilityOf(distribution, (r) => r.homeGoals > line);
    const awayOver = probabilityOf(distribution, (r) => r.awayGoals > line);
    const key = roundKey(line);
    homeTotals[key] = Object.freeze({ line, over: homeOver, under: 1 - homeOver });
    awayTotals[key] = Object.freeze({ line, over: awayOver, under: 1 - awayOver });
    add({ id: `HOME_TOTAL_${key}`, family: 'HOME_TEAM_TOTAL', affirmativeLabel: `${homeTeam} OVER ${line}`, counterLabel: `${homeTeam} UNDER ${line}`, affirmativeProbability: homeOver, metadata: { line } });
    add({ id: `AWAY_TOTAL_${key}`, family: 'AWAY_TEAM_TOTAL', affirmativeLabel: `${awayTeam} OVER ${line}`, counterLabel: `${awayTeam} UNDER ${line}`, affirmativeProbability: awayOver, metadata: { line } });
  }

  const strongestTruths = Object.freeze([...pairs]
    .sort((a, b) => (b.preferred.probability - a.preferred.probability) || (b.preferred.certaintyScore - a.preferred.certaintyScore))
    .map((pair, index) => Object.freeze({
      rank: index + 1,
      pairId: pair.id,
      family: pair.family,
      conclusion: pair.preferred.label,
      probability: pair.preferred.probability,
      counterProbability: pair.preferred.opposingProbability,
      probabilityMargin: pair.preferred.probabilityMargin,
      uncertainty: pair.preferred.uncertainty,
      certaintyScore: pair.preferred.certaintyScore
    })));

  return Object.freeze({
    reasoningVersion: 'BIDIRECTIONAL_MATCH_REASONING_V0_1',
    eventId,
    homeTeam,
    awayTeam,
    model: Object.freeze({ homeLambda, awayLambda, expectedTotalGoals: homeLambda + awayLambda, maxGoals }),
    teamReality: Object.freeze({ home, away }),
    matchReality: Object.freeze({
      homeWin: outcome.homeWin,
      draw: outcome.draw,
      awayWin: outcome.awayWin,
      homeNotLose: outcome.homeWin + outcome.draw,
      awayNotLose: outcome.awayWin + outcome.draw,
      decisiveResult: outcome.homeWin + outcome.awayWin,
      bttsYes,
      bttsNo: 1 - bttsYes,
      noGoal,
      homeOnlyScores: homeOnly,
      awayOnlyScores: awayOnly,
      bothScore: bttsYes,
      totalOdd,
      totalEven: 1 - totalOdd,
      totals: Object.freeze(totals),
      homeTeamTotals: Object.freeze(homeTotals),
      awayTeamTotals: Object.freeze(awayTotals),
      exactTotalGoals: exactTotalDistribution(distribution),
      topCorrectScores: topCorrectScores(distribution, correctScoreLimit)
    }),
    bidirectionalPairs: Object.freeze(pairs),
    strongestTruths,
    governance: Object.freeze({
      teamAndMatchAnalysisBeforeMarket: true,
      everyBinaryClaimHasCounterClaim: true,
      negativeOutcomesAreFirstClassPredictions: true,
      bookmakerOddsUsedInReasoning: false,
      probabilityIsNotGuarantee: true
    })
  });
}
