import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, sessionOwner } from "./lib/session";
export function proxy(request: NextRequest) {
  if (process.env.NEXT_PUBLIC_APP_MODE !== "production") return NextResponse.next();
  if (["/access", "/api/session"].includes(request.nextUrl.pathname)) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.next();
  if (!sessionOwner(request.cookies.get(SESSION_COOKIE)?.value))
    return NextResponse.redirect(new URL("/access", request.url));
  return NextResponse.next();
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|fonts/).*)"] };
