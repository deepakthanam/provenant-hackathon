import type { Metadata } from 'next';
import { JetBrains_Mono, Public_Sans, Saira_Stencil } from 'next/font/google';
import type { ReactNode } from 'react';
import { TopBand } from '@/components/top-band';
import { paypalMode } from '@/lib/api';
import './globals.css';

const publicSans = Public_Sans({ subsets: ['latin'], variable: '--font-public-sans', display: 'swap' });
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', display: 'swap' });
const stencil = Saira_Stencil({
  subsets: ['latin'],
  weight: ['600'],
  variable: '--font-stencil-face',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Provenant',
  description: 'Evidence and verdicts for disputes on AI-agent purchases',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${publicSans.variable} ${jetbrains.variable} ${stencil.variable}`}>
      <body>
        <TopBand mode={paypalMode()} />
        <main className="mx-auto max-w-[1440px] px-8 pb-24 pt-8">{children}</main>
      </body>
    </html>
  );
}
