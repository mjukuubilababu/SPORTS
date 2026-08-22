const CANONICAL_1X2 = Object.freeze(['HOME', 'DRAW', 'AWAY']);

function validOdd(value) {
  return Number.isFinite(value) && value > 1;
}

function validateCanonicalOdds(odds) {
  if (!odds || typeof odds !== 'object') throw new Error('ODDS_OBJECT_REQUIRED');
  for (const selection of CANONICAL_1X2) {
    if (!validOdd(odds[selection])) throw new Error(`INVALID_${selection}_ODDS`);
  }
  return {
    HOME: odds.HOME,
    DRAW: odds.DRAW,
    AWAY: odds.AWAY
  };
}

export function canonicalize1X2Snapshot(snapshot) {
  if (!snapshot?.provider) throw new Error('PROVIDER_REQUIRED');

  if (snapshot.odds) {
    return {
      ...snapshot,
      odds: validateCanonicalOdds(snapshot.odds),
      adaptation: {
        mode: 'ALREADY_CANONICAL',
        canonicalOrder: [...CANONICAL_1X2]
      }
    };
  }

  if (!Array.isArray(snapshot.rawOdds) || !Array.isArray(snapshot.rawOrder)) {
    throw new Error('RAW_ODDS_AND_ORDER_REQUIRED');
  }
  if (snapshot.rawOdds.length !== 3 || snapshot.rawOrder.length !== 3) {
    throw new Error('RAW_1X2_LENGTH_INVALID');
  }

  const normalizedOrder = snapshot.rawOrder.map((selection) => String(selection).toUpperCase());
  if (new Set(normalizedOrder).size !== 3 || !CANONICAL_1X2.every((selection) => normalizedOrder.includes(selection))) {
    throw new Error('RAW_1X2_ORDER_INVALID');
  }

  const odds = {};
  for (let index = 0; index < normalizedOrder.length; index += 1) {
    const value = snapshot.rawOdds[index];
    if (!validOdd(value)) throw new Error('INVALID_RAW_ODDS');
    odds[normalizedOrder[index]] = value;
  }

  return {
    ...snapshot,
    odds: validateCanonicalOdds(odds),
    adaptation: {
      mode: 'EXPLICIT_RAW_ORDER_MAPPING',
      rawOrder: normalizedOrder,
      canonicalOrder: [...CANONICAL_1X2]
    }
  };
}
