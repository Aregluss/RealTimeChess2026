import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'RealTimeChess invite';
export const size = {
  width: 1200,
  height: 630
};
export const contentType = 'image/png';

type InviteImageProps = {
  params: Promise<{
    gameId: string;
    code: string;
  }>;
};

export default async function InviteOpenGraphImage({ params }: InviteImageProps) {
  const { gameId } = await params;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '56px',
          background:
            'linear-gradient(145deg, #0b1020 0%, #15315f 44%, #2f9bff 100%)',
          color: '#eef6ff',
          fontFamily: 'system-ui, sans-serif'
        }}
      >
        <div style={{ fontSize: '30px', fontWeight: 700, opacity: 0.95 }}>RealTimeChess Invite</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ fontSize: '76px', lineHeight: 1.04, fontWeight: 800 }}>
            Join my
            <br />
            live chess match
          </div>
          <div style={{ fontSize: '34px', opacity: 0.92 }}>
            Game {gameId}
          </div>
        </div>
      </div>
    ),
    size
  );
}
