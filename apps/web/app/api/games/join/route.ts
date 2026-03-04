import { NextResponse } from 'next/server';
import { joinGame, AppError } from '@realtimechess/server-core';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const joined = await joinGame(body);
    return NextResponse.json(joined, { status: 200 });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }

    return NextResponse.json({ error: 'Failed to join game' }, { status: 500 });
  }
}
