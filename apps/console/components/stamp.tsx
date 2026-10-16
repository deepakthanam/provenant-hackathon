import { VERDICT_COLOR, VERDICT_LABEL } from '@/lib/format';
import type { Verdict } from '@/lib/types';

/** A verdict, rubber-stamped in its own ink. */
export function Stamp({ verdict, size = 'sm' }: { verdict: Verdict | null; size?: 'sm' | 'lg' }) {
  if (!verdict) {
    return <span className="text-sm text-ink-3">Not yet judged</span>;
  }
  const color = VERDICT_COLOR[verdict];
  const lg = size === 'lg';
  return (
    <span
      className={`inline-flex items-center self-center whitespace-nowrap border-2 font-bold uppercase leading-[1.2] ${
        verdict === 'INSUFFICIENT_EVIDENCE' ? 'hatch' : ''
      } ${lg ? 'rounded-[4px] px-3.5 py-1.5 text-[17px] tracking-[0.08em]' : 'rounded-[3px] px-2 py-[3px] text-[12px] tracking-[0.07em]'}`}
      style={{
        color,
        borderColor: color,
        backgroundColor: `color-mix(in srgb, ${color} 7%, transparent)`,
        boxShadow: lg ? `inset 0 0 0 2px var(--color-paper), inset 0 0 0 3px ${color}` : undefined,
      }}
    >
      {VERDICT_LABEL[verdict]}
    </span>
  );
}
