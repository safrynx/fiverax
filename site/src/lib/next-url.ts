/**
 * Where a visitor goes back after logging in with Discord: only the public pages that ask for a login (directory
 * listing to review or vote, player portal and the servers' own portals, free scan result). A fixed list, so the login can never redirect elsewhere (open redirect).
 */
const NEXT_RE = /^(?:\/annuaire(?:\/[a-z0-9-]{3,40})?(?:#(?:avis|vote))?|\/joueur(?:\/[a-z0-9-]{3,40})?(?:#[a-z-]{2,20})?|\/scan(?:\/[A-Za-z0-9_-]{16,32})?)$/;

export const isSafeNext = (next: string | null | undefined): next is string => Boolean(next && NEXT_RE.test(next));
