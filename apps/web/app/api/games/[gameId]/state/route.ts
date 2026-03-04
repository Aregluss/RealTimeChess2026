import { NextResponse } from 'next/server';
import { getGameState, AppError } from '@realtimechess/server-core';

export async function GET(
  _request: Request,
  context: { params: Promise<{ gameId: string }> }
) {
  try {
    const { gameId } = await context.params;
    const state = await getGameState(gameId);
    return NextResponse.json(state, { status: 200 });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }

    return NextResponse.json({ error: 'Failed to load state' }, { status: 500 });
  }
}
