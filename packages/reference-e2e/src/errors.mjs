export class ContractError extends Error { constructor(message, details={}) { super(message); this.name='ContractError'; this.details=details; } }
export class AuthorizationError extends Error { constructor(message='DENY_BY_DEFAULT') { super(message); this.name='AuthorizationError'; } }
export class StateTransitionError extends Error { constructor(from,to) { super(`ILLEGAL_STATE_TRANSITION:${from}->${to}`); this.name='StateTransitionError'; } }
export class ImmutableArtifactError extends Error { constructor(kind,id) { super(`IMMUTABLE_ARTIFACT:${kind}:${id}`); this.name='ImmutableArtifactError'; } }
