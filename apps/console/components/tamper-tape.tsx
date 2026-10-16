import type { VerifyResult } from '@/lib/types';

const TAPE_TEXT = 'EVIDENCE · SEALED · DO NOT TAMPER · ';

function TapeText() {
  return (
    <span
      className="whitespace-nowrap font-stencil text-[13px] tracking-[0.18em] text-tape-ink/90"
      aria-hidden
    >
      {TAPE_TEXT.repeat(14)}
    </span>
  );
}

/**
 * The seal across a bundle. Intact tape means every hash, signature and chain link verified;
 * a failed check tears it (once, on arrival) and exposes what broke.
 */
export function TamperTape({ verify }: { verify: VerifyResult | null }) {
  if (!verify) {
    return (
      <div className="flex h-11 items-center border border-dashed border-ink-3 px-4 text-sm text-ink-2">
        No evidence bundle is linked to this dispute, so there is no seal to check.
      </div>
    );
  }
  if (verify.ok) {
    return (
      <div
        className="relative h-11 overflow-hidden bg-tape shadow-[0_1px_2px_rgba(20,20,20,0.25)]"
        role="status"
      >
        <div className="absolute inset-0 flex items-center opacity-25">
          <TapeText />
        </div>
        <div className="relative flex h-full items-center">
          <div className="flex h-full items-center gap-3 bg-tape pl-4 pr-5 text-tape-ink shadow-[8px_0_10px_-4px_var(--color-tape)]">
            <span className="font-stencil text-[15px] tracking-[0.14em]">SEAL INTACT</span>
            <span className="hidden text-[13px] sm:inline">
              {verify.events} signed entries · chain position {verify.chain_position} · key{' '}
              {verify.signer_fingerprint}
            </span>
          </div>
        </div>
      </div>
    );
  }
  const broken = verify.failures[0] ?? 'verification failed';
  // Two pieces with ragged inner edges; the gap shows the paper and what broke.
  const left = 'polygon(0 0, 46% 0, 44% 22%, 47% 41%, 43.5% 63%, 46.5% 82%, 44% 100%, 0 100%)';
  const right = 'polygon(55% 0, 100% 0, 100% 100%, 54% 100%, 56.5% 78%, 53.5% 57%, 56% 36%, 53% 17%)';
  return (
    <div className="relative" role="alert">
      <div className="relative h-11">
        <div className="tape-left-torn absolute inset-0 overflow-hidden bg-tape" style={{ clipPath: left }}>
          <div className="flex h-full items-center px-4 opacity-40">
            <TapeText />
          </div>
        </div>
        <div className="tape-right-torn absolute inset-0 overflow-hidden bg-tape" style={{ clipPath: right }}>
          <div className="flex h-full items-center px-4 opacity-40">
            <TapeText />
          </div>
        </div>
        <div className="absolute inset-y-0 left-1/2 flex -translate-x-1/2 items-center">
          <span className="border-2 border-tape bg-paper px-2 font-stencil text-[18px] tracking-[0.2em] text-tape">
            VOID
          </span>
        </div>
      </div>
      <p className="mt-2 text-[14px] text-tape">
        <span className="font-semibold">Seal broken.</span> {broken}
        {verify.failures.length > 1 ? ` (+${verify.failures.length - 1} more)` : ''}
      </p>
    </div>
  );
}
