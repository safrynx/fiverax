/**
 * Where a visitor goes back after logging in with Discord: only the public pages that ask for a login (directory
 * listing to review or vote, player portal). A fixed list, so the login can never redirect elsewhere (open redirect).
 */
const NEXT_RE = /^(?:\/annuaire(?:\/[a-z0-9-]{3,40})?(?:#(?:avis|vote))?|\/joueur(?:#[a-z-]{2,20})?)$/;

export const isSafeNext = (next: string | null | undefined): next is string => Boolean(next && NEXT_RE.test(next));
