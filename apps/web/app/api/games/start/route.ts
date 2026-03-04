import { NextResponse } from 'next/server';
import { createGame, AppError } from '@realtimechess/server-core';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const created = await createGame(body);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }

    return NextResponse.json({ error: 'Failed to create game' }, { status: 500 });
  }
}
