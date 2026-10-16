import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="max-w-[60ch] py-16">
      <h1 className="text-[34px] font-bold tracking-[-0.02em]">Nothing filed under that number</h1>
      <p className="mt-2 text-[16px] text-ink-2">
        The dispute or bundle you asked for is not in Provenant’s records.
      </p>
      <Link href="/" className="mt-6 inline-block font-semibold text-ink">
        Back to the dispute queue
      </Link>
    </div>
  );
}
