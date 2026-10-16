export class EvidenceError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'CONFLICT' | 'INVALID_SIGNATURE' | 'INVALID_STATE' | 'UNKNOWN_USER',
    message: string,
  ) {
    super(message);
    this.name = 'EvidenceError';
  }
}
