import { AppError, getGameState, subscribeToGameEvents } from '@realtimechess/server-core';

export const runtime = 'nodejs';

type EventsRouteContext = {
  params: Promise<{ gameId: string }>;
};

export async function GET(_request: Request, context: EventsRouteContext): Promise<Response> {
  try {
    const { gameId } = await context.params;
    const initialState = await getGameState(gameId);
    let unsubscribe: (() => Promise<void>) | null = null;
    let keepAlive: ReturnType<typeof setInterval> | null = null;

    const stream = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        const encoder = new TextEncoder();

        const send = (eventName: string, payload: unknown) => {
          controller.enqueue(encoder.encode(`event: ${eventName}\n`));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        };

        send('state', initialState);

        unsubscribe = await subscribeToGameEvents(gameId, (event) => {
          send('state', event.state);
        });

        keepAlive = setInterval(() => {
          controller.enqueue(encoder.encode(': ping\n\n'));
        }, 10_000);
      },
      cancel: async () => {
        if (keepAlive) {
          clearInterval(keepAlive);
        }
        if (unsubscribe) {
          await unsubscribe();
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive'
      }
    });
  } catch (error) {
    if (error instanceof AppError) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: error.statusCode,
        headers: {
          'content-type': 'application/json'
        }
      });
    }

    return new Response(JSON.stringify({ error: 'Failed to open event stream' }), {
      status: 500,
      headers: {
        'content-type': 'application/json'
      }
    });
  }
}
