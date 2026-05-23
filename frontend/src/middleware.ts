import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Basic in-memory rate limiting for demonstration.
// In a real production Edge environment, you'd use a global store like Redis (Upstash) or Cloudflare Workers KV.
const ipRateLimitMap = new Map<string, { count: number; resetTime: number }>();

const RATE_LIMIT = 50; // Max requests per window
const WINDOW_MS = 60 * 1000; // 1 minute window

export function middleware(request: NextRequest) {
  // Get IP address from headers (Next.js automatically handles standard proxy headers)
  const ip = request.ip || request.headers.get('x-forwarded-for') || 'unknown';

  if (ip !== 'unknown') {
    const now = Date.now();
    const rateLimitData = ipRateLimitMap.get(ip) || { count: 0, resetTime: now + WINDOW_MS };

    // Reset window if passed
    if (now > rateLimitData.resetTime) {
      rateLimitData.count = 0;
      rateLimitData.resetTime = now + WINDOW_MS;
    }

    rateLimitData.count++;
    ipRateLimitMap.set(ip, rateLimitData);

    if (rateLimitData.count > RATE_LIMIT) {
      return new NextResponse('Too Many Requests - Blocked by Edge Middleware', {
        status: 429,
        headers: {
          'Retry-After': Math.ceil((rateLimitData.resetTime - now) / 1000).toString(),
        },
      });
    }
  }

  return NextResponse.next();
}

// See "Matching Paths" below to learn more
export const config = {
  // Match all request paths except for static assets
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
