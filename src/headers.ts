/** Small, safe defaults on every response (static assets get the same from public/_headers on Workers). */
export const SECURITY_HEADERS: Record<string, string> = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' };
