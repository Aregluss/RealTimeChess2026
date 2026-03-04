import { NextResponse } from 'next/server';
import { AppError, submitMove } from '@realtimechess/server-core';

function readBearerToken(request: Request): string | undefined {
  const auth = request.headers.get('authorization');
  if (!auth) {
    return undefined;
  }

  const [type, token] = auth.split(' ');
  if (type?.toLowerCase() !== 'bearer' || !token) {
    return undefined;
  }

  return token;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ gameId: string }> }
) {
  try {
    const { gameId } = await context.params;
    const body = await request.json().catch(() => ({}));
    const token = readBearerToken(request);
    const result = submitMove(gameId, body, token);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }

    return NextResponse.json({ error: 'Failed to apply move' }, { status: 500 });
  }
}
