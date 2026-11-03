// Temporary lock until Google login: a browser password prompt in front of everything except the cron route
import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

function passwordMatches(header: string | null, password: string): boolean {
  if (!header?.startsWith("Basic ")) return false;
  const decoded = Buffer.from(header.slice(6), "base64").toString();
  const given = Buffer.from(decoded.slice(decoded.indexOf(":") + 1)); // any username, check the password
  const expected = Buffer.from(password);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function proxy(request: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return NextResponse.next(); // no password set: the page itself decides (local dev)
  if (passwordMatches(request.headers.get("authorization"), password)) return NextResponse.next();
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="ai-outreach"' },
  });
}

// Everything except the cron route (it has its own secret) and static files
export const config = {
  matcher: ["/((?!api/process-leads|_next/static|_next/image|favicon.ico).*)"],
};
