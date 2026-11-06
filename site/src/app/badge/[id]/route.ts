import { NextRequest } from "next/server";
import { badgeSvg } from "@/lib/badge-svg";
import { publicProtection } from "@/lib/protection";

export const runtime = "nodejs";

/**
 * GET /badge/<public id>.svg?style=flat — the "Protégé par Fiverax" image to embed anywhere. Cached 10 minutes by
 * browsers and CDNs. An unknown or turned off badge answers a neutral image (never an error picture on someone's site).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id.replace(/\.svg$/i, "").toLowerCase();
  const style = req.nextUrl.searchParams.get("style") === "flat" ? "flat" : "card";
  const data = await publicProtection(id).catch(() => null);
  const svg = badgeSvg(data ? { level: data.level, score: data.score, checkedAt: data.lastScanAt } : null, style);
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=600, s-maxage=600, stale-while-revalidate=3600",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
