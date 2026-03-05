import './globals.css';
import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { getSiteUrl, getSocialImageUrl } from '../lib/metadata';

const siteSocialImage = getSocialImageUrl('site');

export const metadata: Metadata = {
  metadataBase: getSiteUrl(),
  title: {
    default: 'RealTimeChess',
    template: '%s | RealTimeChess'
  },
  description:
    'Classic chess rules with realtime piece cooldowns. Start a game and share one link to play instantly.',
  openGraph: {
    title: 'RealTimeChess',
    description:
      'Classic chess rules with realtime piece cooldowns. Start a game and share one link to play instantly.',
    type: 'website',
    siteName: 'RealTimeChess',
    url: '/',
    images: [
      {
        url: siteSocialImage,
        width: 1200,
        height: 630,
        alt: 'RealTimeChess'
      }
    ]
  },
  twitter: {
    card: 'summary_large_image',
    title: 'RealTimeChess',
    description:
      'Classic chess rules with realtime piece cooldowns. Start a game and share one link to play instantly.',
    images: [siteSocialImage]
  }
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
