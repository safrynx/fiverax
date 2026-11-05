"use client";
import Link from "next/link";
import { useEffect } from "react";
import type { StatKind } from "@/lib/directory-shared";

/** Counters of the directory: a beacon that never blocks navigation and never fails loudly. */
function beacon(slug: string, kind: StatKind | "cta") {
  try {
    const body = JSON.stringify({ slug, kind });
    if (!navigator.sendBeacon?.("/api/directory?action=track", new Blob([body], { type: "application/json" }))) {
      fetch("/api/directory?action=track", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
    }
  } catch { /* counters are best effort */ }
}

/** One view per listing and per browser tab session. */
export function TrackView({ slug }: { slug: string }) {
  useEffect(() => {
    const key = `fvx-dir-view:${slug}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch { /* storage off: count anyway */ }
    beacon(slug, "view");
  }, [slug]);
  return null;
}

/** An outgoing link of a listing (join, Discord, store, website), counted on click. */
export function TrackLink({ slug, kind, href, className, children, external = true }: {
  slug: string; kind: StatKind; href: string; className?: string; children: React.ReactNode; external?: boolean;
}) {
  return (
    <a href={href} className={className} onClick={() => beacon(slug, kind)} {...(external ? { target: "_blank", rel: "noopener noreferrer nofollow" } : {})}>
      {children}
    </a>
  );
}

/** "Add your server" calls: what the directory brings to Fiverax. */
export function CtaLink({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  return <Link href={href} className={className} onClick={() => beacon("", "cta")}>{children}</Link>;
}
