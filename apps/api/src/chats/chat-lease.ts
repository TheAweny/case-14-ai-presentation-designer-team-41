import type { Notification, Pool, PoolClient } from 'pg';

/** A session lock stays held across commits and is released by PostgreSQL if the process dies. */
export interface ChatLease {
  check(): Promise<void>;
  release(): Promise<void>;
}

export async function acquireChatLease(
  pool: Pool,
  chatId: string,
  controller?: AbortController,
): Promise<ChatLease | null> {
  const client: PoolClient = await pool.connect();
  const key = `chat:${chatId}`;
  let released = false;
  let failed: Error | null = null;
  const lost = (error: Error) => {
    failed = error;
    controller?.abort(error);
  };
  const notified = (notice: Notification) => {
    if (notice.channel === 'chat_turn_cancel' && notice.payload === chatId)
      controller?.abort(new Error('Cancelled by the person.'));
  };
  client.on('error', lost);
  client.on('notification', notified);
  try {
    const result = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired',
      [key],
    );
    if (!result.rows[0]?.acquired) {
      client.off('error', lost);
      client.off('notification', notified);
      client.release();
      return null;
    }
    if (controller) await client.query('LISTEN chat_turn_cancel');
  } catch (error) {
    client.off('error', lost);
    client.off('notification', notified);
    client.release(true);
    throw error;
  }
  return {
    async check() {
      if (released || failed) throw failed ?? new Error('The chat execution lease was released.');
      try {
        await client.query('SELECT 1');
      } catch (error) {
        lost(error instanceof Error ? error : new Error('The chat execution lease was lost.'));
        throw error;
      }
    },
    async release() {
      if (released) return;
      released = true;
      try {
        if (!failed) {
          if (controller) await client.query('UNLISTEN chat_turn_cancel');
          await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [key]);
        }
      } catch (error) {
        failed = error instanceof Error ? error : new Error('Cannot release chat execution lease.');
      } finally {
        client.off('error', lost);
        client.off('notification', notified);
        client.release(failed !== null);
      }
    },
  };
}
