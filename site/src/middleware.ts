import { NextResponse, type NextRequest } from "next/server";

/**
 * CSRF, in depth. The session cookie is SameSite=Lax, so other sites cannot send it with a POST; on top of that,
 * every state-changing call to the API must come from the site itself: a browser says where a request comes from
 * (Sec-Fetch-Site, Origin) and those headers cannot be set by a page. Calls without them (old browsers, scripts)
 * carry no victim's cookie and fall back to the route's own authentication.
 *
 * Not concerned: the server-to-server routes, authenticated by a token or a signature, never by the cookie
 * (bot, FiveM agent, Tebex webhooks).
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const MACHINE_ROUTES = [/^\/api\/bot\//, /^\/api\/fivem(?:\/|$)/, /^\/api\/tebex\/webhook\//];

function allowedOrigins(req: NextRequest): Set<string> {
  const origins = new Set([req.nextUrl.origin]);
  try {
    if (process.env.APP_URL) origins.add(new URL(process.env.APP_URL).origin);
  } catch {
    /* malformed APP_URL: the request's own origin only */
  }
  return origins;
}

export function middleware(req: NextRequest) {
  if (SAFE_METHODS.has(req.method)) return NextResponse.next();
  const path = req.nextUrl.pathname;
  if (MACHINE_ROUTES.some((re) => re.test(path))) return NextResponse.next();

  const site = req.headers.get("sec-fetch-site");
  const origin = req.headers.get("origin");
  const crossSite = (site !== null && site !== "same-origin" && site !== "none") || (origin !== null && !allowedOrigins(req).has(origin));
  if (crossSite) return NextResponse.json({ error: "csrf" }, { status: 403 });
  return NextResponse.next();
}

export const config = { matcher: ["/api/:path*"] };
