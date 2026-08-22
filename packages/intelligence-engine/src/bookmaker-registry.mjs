export const ACQUISITION_MODES = Object.freeze([
  'OFFICIAL_API',
  'LICENSED_DATA_VENDOR',
  'PUBLIC_WEB',
  'MANUAL_CAPTURE',
  'DISCOVERY_REQUIRED'
]);

export const PROVIDER_STATES = Object.freeze([
  'ACTIVE',
  'DISCOVERED',
  'UNVERIFIED',
  'UNAVAILABLE',
  'SUSPENDED'
]);

export const BOOKMAKER_REGISTRY = Object.freeze({
  BETPAWA: Object.freeze({
    id: 'BETPAWA',
    displayName: 'betPawa',
    homeMarket: 'TZ',
    acquisitionMode: 'PUBLIC_WEB',
    state: 'DISCOVERED'
  }),
  SPORTPESA: Object.freeze({
    id: 'SPORTPESA',
    displayName: 'SportPesa',
    homeMarket: 'TZ',
    acquisitionMode: 'PUBLIC_WEB',
    state: 'DISCOVERED'
  }),
  MBET: Object.freeze({
    id: 'MBET',
    displayName: 'MBet',
    homeMarket: 'TZ',
    acquisitionMode: 'DISCOVERY_REQUIRED',
    state: 'DISCOVERED'
  }),
  PARIMATCH: Object.freeze({
    id: 'PARIMATCH',
    displayName: 'Parimatch',
    homeMarket: 'TZ',
    acquisitionMode: 'PUBLIC_WEB',
    state: 'DISCOVERED'
  }),
  SOKABET: Object.freeze({
    id: 'SOKABET',
    displayName: 'SokaBet',
    homeMarket: 'TZ',
    acquisitionMode: 'DISCOVERY_REQUIRED',
    state: 'DISCOVERED'
  }),
  STAKE: Object.freeze({
    id: 'STAKE',
    displayName: 'Stake',
    homeMarket: 'GLOBAL',
    acquisitionMode: 'PUBLIC_WEB',
    state: 'DISCOVERED'
  })
});

export function registerBookmakerProvider(provider) {
  if (!provider || typeof provider !== 'object') throw new Error('INVALID_PROVIDER');
  if (!provider.id || !provider.displayName) throw new Error('PROVIDER_ID_AND_NAME_REQUIRED');
  if (!ACQUISITION_MODES.includes(provider.acquisitionMode)) throw new Error('INVALID_ACQUISITION_MODE');
  if (!PROVIDER_STATES.includes(provider.state)) throw new Error('INVALID_PROVIDER_STATE');
  return Object.freeze({ ...provider });
}

export function providerMayIngest(provider, { termsApproved = false, endpointVerified = false } = {}) {
  if (!provider) return { allowed: false, reason: 'PROVIDER_MISSING' };
  if (provider.state === 'SUSPENDED' || provider.state === 'UNAVAILABLE') {
    return { allowed: false, reason: `PROVIDER_${provider.state}` };
  }
  if (provider.acquisitionMode === 'DISCOVERY_REQUIRED') {
    return { allowed: false, reason: 'FEED_NOT_CONFIRMED' };
  }
  if (!endpointVerified) return { allowed: false, reason: 'ENDPOINT_NOT_VERIFIED' };
  if (!termsApproved) return { allowed: false, reason: 'TERMS_NOT_APPROVED' };
  return { allowed: true, reason: 'VERIFIED_AND_APPROVED' };
}
