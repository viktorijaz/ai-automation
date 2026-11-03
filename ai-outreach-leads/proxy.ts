// Runs before every page: refreshes the login session and sends logged-out visitors to /login
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/auth"];

export async function proxy(request: NextRequest) {
  // Local development without login (DASHBOARD_ENABLED=true in .env)
  if (process.env.DASHBOARD_ENABLED === "true") return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet, headers) => {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    },
  );

  // Verifies the session token (and refreshes it if needed)
  const { data } = await supabase.auth.getClaims();
  const isPublic = PUBLIC_PATHS.some((p) => request.nextUrl.pathname.startsWith(p));
  if (!data?.claims && !isPublic) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return response;
}

// Everything except the cron route (it has its own secret) and static files
export const config = {
  matcher: ["/((?!api/process-leads|_next/static|_next/image|favicon.ico).*)"],
};
