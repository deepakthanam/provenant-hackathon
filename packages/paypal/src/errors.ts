export interface PayPalErrorDetail {
  field?: string;
  issue?: string;
  description?: string;
  value?: string;
}

/** A non-2xx PayPal response. `debugId` is what PayPal support asks for. */
export class PayPalError extends Error {
  constructor(
    readonly status: number,
    /** PayPal's error `name`, e.g. UNPROCESSABLE_ENTITY, RESOURCE_NOT_FOUND, PERMISSION_DENIED. */
    readonly errorName: string,
    message: string,
    readonly debugId: string | undefined,
    readonly details: PayPalErrorDetail[] = [],
  ) {
    super(`${errorName}: ${message}${debugId ? ` (debug_id ${debugId})` : ''}`);
    this.name = 'PayPalError';
  }

  get retryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }

  get isPermissionError(): boolean {
    return (
      this.status === 401 ||
      this.status === 403 ||
      this.errorName === 'PERMISSION_DENIED' ||
      this.errorName === 'NOT_AUTHORIZED'
    );
  }

  toJSON() {
    return {
      status: this.status,
      name: this.errorName,
      message: this.message,
      debug_id: this.debugId,
      details: this.details,
    };
  }
}

/** Thrown before calling PayPal when the needed HATEOAS link is absent from the dispute. */
export class ActionNotAvailableError extends Error {
  constructor(
    readonly rel: string,
    readonly disputeStatus: string,
    readonly disputeStage: string | undefined,
  ) {
    super(
      `ACTION_NOT_AVAILABLE: no "${rel}" link (status ${disputeStatus}, stage ${disputeStage ?? 'unknown'})`,
    );
    this.name = 'ActionNotAvailableError';
  }
}

/** Sandbox dispute creation is limited release; explains the manual fallback. */
export class SandboxDisputeCreationUnavailable extends Error {
  constructor(readonly paypalError: PayPalError) {
    super(
      'PayPal refused sandbox dispute creation (limited release: needs the DISPUTE_CREATE scope and a ' +
        'PayPal-Auth-Assertion JWT). Fallback: log in to https://www.sandbox.paypal.com as the sandbox ' +
        'personal (buyer) account, open Activity → the payment → "Report a problem", then let the poller ' +
        `or the webhook pick it up. PayPal said: ${paypalError.message}`,
      { cause: paypalError },
    );
    this.name = 'SandboxDisputeCreationUnavailable';
  }
}
