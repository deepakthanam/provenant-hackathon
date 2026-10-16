'use client';

export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="max-w-[64ch] border-2 border-tape px-6 py-6">
      <h1 className="text-[24px] font-bold text-tape">The console could not load this page</h1>
      <p className="mt-2 text-[15px] text-ink-2">
        {error.message}. Check that the Provenant API is running (`pnpm dev`), then try again.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded-[3px] bg-ink px-4 py-2 text-[15px] font-semibold text-paper"
      >
        Try again
      </button>
    </div>
  );
}
