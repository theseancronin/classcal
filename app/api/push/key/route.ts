/**
 * The VAPID public key.
 *
 * Public by design: the browser needs it to create a subscription. The private
 * half never leaves the server.
 */
import { NextResponse } from 'next/server';

import { env } from '@/server/env';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const publicKey = env().VAPID_PUBLIC_KEY;
  if (!publicKey) {
    return NextResponse.json({ error: 'push is not configured' }, { status: 503 });
  }
  return NextResponse.json({ publicKey });
}
