import type { ReactNode } from 'react';

/** A custody-form field: printed label above, entry below on a ruled line. */
export function Field({
  label,
  children,
  mono = false,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="border-b border-rule pb-2">
      <div className="field-label">{label}</div>
      <div className={`mt-1 text-[15px] leading-snug ${mono ? 'font-mono text-[13.5px]' : ''}`}>
        {children}
      </div>
    </div>
  );
}

/** A section of the bag label: a heading set like a form part, with room above. */
export function Part({
  title,
  aside,
  children,
  id,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section className="mt-10 first:mt-0" id={id} aria-labelledby={id ? `${id}-h` : undefined}>
      <div className="mb-3 flex items-baseline justify-between gap-4 border-b-2 border-ink pb-1.5">
        <h2 id={id ? `${id}-h` : undefined} className="text-[19px] font-bold tracking-[-0.01em]">
          {title}
        </h2>
        {aside ? <div className="text-[13px] text-ink-2">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function Mono({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`font-mono text-[13.5px] ${className}`}>{children}</span>;
}
