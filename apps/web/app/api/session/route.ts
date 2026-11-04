import { cookies } from "next/headers";
import { SESSION_COOKIE, newSession, validAccessCode } from "../../../lib/session";
const attempts = new Map<string, { count: number; until: number }>();
export async function POST(request: Request) {
  if (
    process.env.NEXT_PUBLIC_APP_MODE !== "production" ||
    request.headers.get("origin") !== new URL(request.url).origin
  )
    return new Response(null, { status: 403 });
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const now = Date.now();
  for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
  const current = attempts.get(ip) ?? { count: 0, until: now + 60_000 };
  if (current.count >= 10 || attempts.size > 1000)
    return new Response("Try again shortly.", { status: 429 });
  attempts.set(ip, { ...current, count: current.count + 1 });
  if (Number(request.headers.get("content-length") ?? 0) > 1024)
    return new Response(null, { status: 413 });
  const raw = await request.text();
  if (raw.length > 1024) return new Response(null, { status: 413 });
  const code = new URLSearchParams(raw).get("code") ?? "";
  if (!validAccessCode(code))
    return Response.redirect(new URL("/access?invalid=1", request.url), 303);
  (await cookies()).set(SESSION_COOKIE, newSession(), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 86400,
  });
  return Response.redirect(new URL("/discover", request.url), 303);
}
