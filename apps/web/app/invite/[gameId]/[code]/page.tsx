import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSiteUrl, getSocialImageUrl } from '../../../../lib/metadata';

type InvitePageProps = {
  params: Promise<{
    gameId: string;
    code: string;
  }>;
};

export async function generateMetadata({ params }: InvitePageProps): Promise<Metadata> {
  const { gameId, code } = await params;
  const safeGameId = encodeURIComponent(gameId);
  const safeCode = encodeURIComponent(code);
  const invitePath = `/invite/${safeGameId}/${safeCode}`;
  const inviteSocialImage = getSocialImageUrl('invite');

  return {
    metadataBase: getSiteUrl(),
    title: 'Join my RealTimeChess game',
    description: 'Tap to jump straight into this live match.',
    openGraph: {
      title: 'Join my RealTimeChess game',
      description: 'Tap to jump straight into this live match.',
      type: 'website',
      url: invitePath,
      images: [
        {
          url: inviteSocialImage,
          width: 1200,
          height: 630,
          alt: 'RealTimeChess invite'
        }
      ]
    },
    twitter: {
      card: 'summary_large_image',
      title: 'Join my RealTimeChess game',
      description: 'Tap to jump straight into this live match.',
      images: [inviteSocialImage]
    }
  };
}

export default async function InviteRedirectPage({ params }: InvitePageProps) {
  const { gameId, code } = await params;
  const safeGameId = encodeURIComponent(gameId);
  const safeCode = encodeURIComponent(code);
  redirect(`/join?gameId=${safeGameId}&code=${safeCode}`);
}
