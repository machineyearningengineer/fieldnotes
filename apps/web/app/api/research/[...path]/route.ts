import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { SESSION_COOKIE, sessionOwner } from "../../../../lib/session";
import { cloudIdentity } from "../../../../lib/cloud-identity";
export const runtime = "nodejs";
export const maxDuration = 60;
async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const requestId = randomUUID();
  const failure = (status: number, code: string, message: string) =>
    Response.json(
      { version: 1, code, message, retryable: status >= 500, requestId, traceId: requestId },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  if (process.env.NEXT_PUBLIC_APP_MODE !== "production")
    return failure(503, "INTERNAL", "Local API routing is unavailable.");
  const owner = sessionOwner((await cookies()).get(SESSION_COOKIE)?.value);
  if (!owner)
    return failure(401, "FORBIDDEN", "Open the app and enter the demonstration access code.");
  const { path } = await context.params;
  const route = path.join("/");
  if (!/^(health|tasks(?:\/[a-f0-9-]{36}(?:\/(events|recent))?)?)$/.test(route))
    return failure(404, "NOT_FOUND", "This endpoint does not exist.");
  if (request.method !== "GET" && request.headers.get("origin") !== new URL(request.url).origin)
    return failure(403, "FORBIDDEN", "Origin not allowed.");
  try {
    const headers = new Headers({
      Authorization: `Bearer ${await cloudIdentity()}`,
      "X-Research-Owner": owner,
    });
    for (const name of [
      "content-type",
      "idempotency-key",
      "if-none-match",
      "last-event-id",
      "accept",
    ]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    const body = request.method === "GET" ? undefined : await request.text();
    if (body && Buffer.byteLength(body) > 4096)
      return failure(413, "INVALID_INPUT", "This request is too large.");
    const upstream = await fetch(`${process.env.API_ORIGIN}/${route}`, {
      method: request.method,
      headers,
      body,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(58_000)]),
    });
    const responseHeaders = new Headers({ "Cache-Control": "private, no-cache, no-transform" });
    for (const name of ["content-type", "etag", "x-request-id", "retry-after"]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch {
    return failure(502, "INTERNAL", "The research service could not be reached. Try again.");
  }
}
export { proxy as GET, proxy as POST, proxy as PATCH };
