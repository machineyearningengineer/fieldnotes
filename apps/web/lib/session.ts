import { createHmac, createHash, timingSafeEqual, randomUUID } from "node:crypto";
export const SESSION_COOKIE = "fieldnotes-session";
const secret = () => {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("Session configuration missing");
  return value;
};
const signature = (value: string) =>
  createHmac("sha256", secret()).update(value).digest("base64url");
export function newSession(): string {
  const value = `${randomUUID()}.${Math.floor(Date.now() / 1000) + 86400}`;
  return `${value}.${signature(value)}`;
}
export function sessionOwner(value: string | undefined): string | null {
  if (!value || value.length > 180) return null;
  const [id, expiry, sig] = value.split(".");
  if (
    !id ||
    !/^[a-f0-9-]{36}$/.test(id) ||
    !expiry ||
    !/^\d{10}$/.test(expiry) ||
    Number(expiry) < Date.now() / 1000 ||
    !sig
  )
    return null;
  const expected = signature(`${id}.${expiry}`);
  return sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    ? id
    : null;
}
export function validAccessCode(value: string): boolean {
  const expected = process.env.DEMO_ACCESS_CODE;
  if (!expected || expected.length < 16) return false;
  const digest = (v: string) => createHash("sha256").update(v).digest();
  return timingSafeEqual(digest(value), digest(expected));
}
