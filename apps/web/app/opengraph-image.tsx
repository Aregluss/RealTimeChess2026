import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'RealTimeChess';
export const size = {
  width: 1200,
  height: 630
};
export const contentType = 'image/png';

export default function OpenGraphImage() {
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
            'radial-gradient(circle at 20% 20%, #2f9bff 0%, #1f7cff 35%, #0b1528 100%)',
          color: '#f4f9ff',
          fontFamily: 'system-ui, sans-serif'
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '12px',
            fontSize: '30px',
            fontWeight: 700,
            opacity: 0.95
          }}
        >
          RealTimeChess
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ fontSize: '82px', lineHeight: 1.02, fontWeight: 800 }}>
            Real-time chess.
            <br />
            No turns.
          </div>
          <div style={{ fontSize: '34px', opacity: 0.9 }}>
            Move any ready piece. Share one link to start.
          </div>
        </div>
      </div>
    ),
    size
  );
}
