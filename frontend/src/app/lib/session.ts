import { sealData, unsealData } from "iron-session";

// Must be at least 32 characters. In production, use a strong random secret.
const COOKIE_SECRET =
  process.env.COOKIE_SECRET ?? "this-is-a-secret-key-at-least-32-chars!";

/**
 * Encrypt a string value so it can be safely stored in a cookie.
 * Even if the cookie is copied, the value is useless without COOKIE_SECRET.
 */
export async function encrypt(value: string): Promise<string> {
  return sealData(value, { password: COOKIE_SECRET, ttl: 0 });
}

/**
 * Decrypt a previously encrypted cookie value.
 */
export async function decrypt(sealed: string): Promise<string> {
  return unsealData<string>(sealed, { password: COOKIE_SECRET, ttl: 0 });
}
