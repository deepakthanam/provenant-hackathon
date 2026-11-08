import { loadEnv } from '@provenant/config';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Mono, Part } from '@/components/form';

export const metadata: Metadata = { title: 'How to use · Provenant' };

const REPO = 'https://github.com/deepakthanam/provenant-hackathon';

const VERDICTS: { code: string; color: string; when: string; action: string }[] = [
  {
    code: 'Within mandate',
    color: 'text-v-within border-v-within',
    when: 'The agent stayed inside what the user signed and the item matched the listing (buyer remorse).',
    action: 'provide-evidence, with the evidence PDF attached',
  },
  {
    code: 'Agent out of bounds',
    color: 'text-v-agent border-v-agent',
    when: 'The agent broke the mandate, e.g. paid $65 on a $50 cap without asking.',
    action: 'accept-claim (refund), booked to the agent platform under Liability',
  },
  {
    code: 'Merchant misrepresented',
    color: 'text-v-merchant border-v-merchant',
    when: 'What arrived differs from the listing the agent saw, or the merchant changed the price.',
    action: 'accept-claim (refund)',
  },
  {
    code: 'Shared fault',
    color: 'text-v-shared border-v-shared',
    when: 'The item matches the listing, but the listing and the mandate were both open to two readings.',
    action: 'make-offer (partial refund)',
  },
  {
    code: 'Insufficient evidence',
    color: 'text-v-insufficient border-v-insufficient',
    when: 'The evidence was edited after sealing, or the facts conflict, or confidence is low.',
    action: 'none: a person decides',
  },
];

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[2.5rem_1fr] gap-x-4 border-b border-rule py-5 last:border-b-0">
      <span className="font-mono text-[22px] font-semibold leading-none text-tape">
        {String(n).padStart(2, '0')}
      </span>
      <div>
        <h3 className="text-[17px] font-semibold">{title}</h3>
        <div className="mt-1.5 max-w-[72ch] space-y-2 text-[15.5px] leading-relaxed text-ink-2">
          {children}
        </div>
      </div>
    </li>
  );
}

export default function GuidePage() {
  const env = loadEnv();
  const store = env.DEMO_STORE_URL.replace(/\/$/, '');
  return (
    <>
      <h1 className="text-[34px] font-bold leading-tight tracking-[-0.02em]">How to use Provenant</h1>
      <p className="mt-2 max-w-[72ch] text-[16.5px] leading-relaxed text-ink-2">
        Provenant seals signed evidence when an AI agent buys through PayPal, then judges any dispute on that
        order against the evidence and plans the matching PayPal Disputes API call. Nothing reaches PayPal
        until the merchant approves. This page walks you through the demo in about five minutes.
      </p>

      <div className="poly mt-6 max-w-[72ch] px-6 py-4 text-[15px] leading-relaxed">
        <strong>About this demo.</strong> PayPal runs in <Mono>mock</Mono> mode here, so nothing touches real
        money, and the same code runs against the PayPal sandbox when credentials are set. The disputes were
        judged by Claude. Approving an action changes the shared demo for everyone; the data is reset
        regularly.
      </div>

      <Part title="A five-minute tour" id="tour">
        <ol className="list-none">
          <Step n={1} title="See what the agent saw">
            <p>
              Open the demo store,{' '}
              <a href={store} target="_blank" rel="noreferrer">
                Ovalwork Running
              </a>
              , and pick any box. Every fact on the label (colour, size, style, price, delivery) is also
              published as schema.org JSON-LD: open <em>What a shopping agent reads here</em> at the bottom of
              a product page. When an agent buys, Provenant snapshots exactly this, including the image.
            </p>
          </Step>
          <Step n={2} title="Open the dispute queue">
            <p>
              <Link href="/">Disputes</Link> lists every PayPal dispute on an agent order, already judged. The
              stamps across the top filter by verdict; <em>Group by verdict</em> sections the table. Click a
              row to open it.
            </p>
          </Step>
          <Step n={3} title="Agent out of bounds: the agent overspent">
            <p>
              Open the <strong>Agent out of bounds</strong> dispute. Under <em>Why this verdict</em>, the
              check <Mono>within_max_amount</Mono> failed: the user capped spending at $50 and the agent paid
              $65 without a signed confirmation.
            </p>
            <p>
              On the right, <em>Planned PayPal call</em> shows the exact request: <Mono>accept-claim</Mono>{' '}
              with a refund. Click <strong>Approve and send</strong>. The timeline records PayPal&apos;s
              response, and <Link href="/liability">Liability</Link> now books the $65 to the agent platform,
              not the merchant.
            </p>
          </Step>
          <Step n={4} title="Merchant misrepresented: the wrong item arrived">
            <p>
              Open the <strong>Merchant misrepresented</strong> dispute. <em>Claim against the snapshot</em>{' '}
              puts the listing image the agent saw (black) beside the buyer&apos;s photo (blue). Claude
              reports one material difference and cites the snapshot field it concerns:{' '}
              <Mono>offer_snapshot.attributes.color</Mono>. The merchant&apos;s own shipping record agrees.
            </p>
          </Step>
          <Step n={5} title="Shared fault and within mandate">
            <p>
              <strong>Shared fault</strong>: the buyer wanted road shoes and got a trail/road hybrid that the
              listing described accurately, so the plan is a partial refund through <Mono>make-offer</Mono>.{' '}
              <strong>Within mandate</strong>: buyer remorse on an in-mandate order, answered with{' '}
              <Mono>provide-evidence</Mono> and a generated PDF (<em>Evidence report</em>, right-hand column).
            </p>
          </Step>
          <Step n={6} title="Insufficient evidence: tampered records">
            <p>
              Open the <strong>Insufficient evidence</strong> dispute. Someone edited the sealed cart after
              signing, so the hash chain no longer verifies: the tamper tape is torn,{' '}
              <Mono>ledger_verified</Mono> fails, and Provenant refuses to judge. No PayPal call is planned.
            </p>
          </Step>
          <Step n={7} title="Inspect the evidence itself">
            <p>
              <Link href="/bundles">Bundles</Link> lists every sealed evidence bundle. Each one shows the
              user&apos;s signed mandate, the offer snapshot, the agent&apos;s decisions and the cart, every
              event signed with Ed25519 and chained with SHA-256, plus the PayPal order whose{' '}
              <Mono>custom_id</Mono> points back to it.
            </p>
          </Step>
        </ol>
      </Part>

      <Part title="The five verdicts" id="verdicts">
        <table className="w-full border-collapse text-[14.5px]">
          <thead>
            <tr className="border-b-2 border-ink text-left">
              <th className="field-label py-2 pr-4">Verdict</th>
              <th className="field-label py-2 pr-4">When</th>
              <th className="field-label py-2">PayPal action after approval</th>
            </tr>
          </thead>
          <tbody>
            {VERDICTS.map((v) => (
              <tr key={v.code} className="border-b border-rule align-top">
                <td className="py-3 pr-4">
                  <span
                    className={`inline-block whitespace-nowrap border-2 px-2 py-0.5 text-[12px] font-semibold uppercase tracking-[0.08em] ${v.color}`}
                  >
                    {v.code}
                  </span>
                </td>
                <td className="py-3 pr-4 text-ink-2">{v.when}</td>
                <td className="py-3 text-ink-2">{v.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Part>

      <Part title="What the AI does, and what it never does" id="ai">
        <ul className="max-w-[72ch] list-disc space-y-2 pl-5 text-[15.5px] leading-relaxed text-ink-2">
          <li>
            <strong className="text-ink">Claude compares.</strong> Given the snapshot (with the listing image)
            and the buyer&apos;s words and photos, it returns structured differences, each citing a real
            snapshot field. Uncited differences are dropped. Buyer content is passed as untrusted data, so
            instructions hidden in a claim change nothing.
          </li>
          <li>
            <strong className="text-ink">Rules decide.</strong> Deterministic rules pick the verdict. If rules
            and model disagree, or confidence is low, the answer is <em>Insufficient evidence</em>.
          </li>
          <li>
            <strong className="text-ink">People approve.</strong> The model never moves money and never calls
            PayPal. Every call waits for <strong>Approve and send</strong>.
          </li>
        </ul>
      </Part>

      <Part title="Run it yourself" id="run">
        <p className="max-w-[72ch] text-[15.5px] leading-relaxed text-ink-2">
          Needs Node 22+ and Git; no accounts, keys or Docker. The full instructions, including PayPal sandbox
          mode and live Claude, are in the{' '}
          <a href={REPO} target="_blank" rel="noreferrer">
            repository README
          </a>
          .
        </p>
        <pre className="mt-3 max-w-[110ch] overflow-x-auto whitespace-pre-wrap break-words border-2 border-ink bg-ink px-5 py-4 font-mono text-[13.5px] leading-relaxed text-paper">
          {`git clone ${REPO} provenant && cd provenant
corepack enable
pnpm bootstrap   # install, keys, embedded Postgres, seed
pnpm demo        # five agent purchases → five disputes → five verdicts

# watch an agent buy, with Claude parsing the request
pnpm agent "black running shoes, size 10, under $90, check with me before spending over $50"`}
        </pre>
      </Part>
    </>
  );
}
