/**
 * Referrals: what the pages and the server share (no server imports here).
 *
 * A server shares its link (/r/<code>; the badge's public page and its directory listing carry it too). A visitor who
 * then registers a server becomes its referral. The referral counts once that server really runs: its FiveM agent
 * connected and QUALIFY_PLAYERS different players seen, within QUALIFY_WITHIN_DAYS. Then the referrer earns
 * REFERRAL_DAYS featured days in the directory and the new server WELCOME_DAYS; milestones add bonus days.
 */

export const REFERRAL_CODE_RE = /^[a-z0-9]{6,12}$/;
export const REF_COOKIE = "fvx_ref";
export const REF_COOKIE_DAYS = 30;
export const REFERRAL_DAYS = 7;
export const WELCOME_DAYS = 3;
export const QUALIFY_PLAYERS = 5;
export const QUALIFY_WITHIN_DAYS = 60;

export const MILESTONES = [
  { at: 3, days: 7, label: "Ambassadeur" },
  { at: 10, days: 30, label: "Ambassadeur Or" }
] as const;

/** Pure: the title a referrer holds for its qualified referrals (null below the first milestone). */
export function ambassadorTier(qualified: number): (typeof MILESTONES)[number] | null {
  return [...MILESTONES].reverse().find((m) => qualified >= m.at) ?? null;
}

/** Pure: bonus days earned when the qualified count reaches exactly a milestone. */
export const milestoneBonus = (qualified: number) => MILESTONES.find((m) => m.at === qualified)?.days ?? 0;

export type ReferralStatus = "pending" | "qualified" | "rejected" | "expired";
export const REFERRAL_STATUS_LABEL: Record<ReferralStatus, string> = { pending: "En attente", qualified: "Validé", rejected: "Refusé", expired: "Expiré" };

/** Pure: where the referred server stands (shown to the referrer). */
export function referralProgress(p: { agentSeen: boolean; players: number }): { done: boolean; steps: { label: string; done: boolean }[] } {
  const steps = [
    { label: "Serveur ajouté sur Fiverax", done: true },
    { label: "Agent FiveM connecté", done: p.agentSeen },
    { label: `${Math.min(p.players, QUALIFY_PLAYERS)} / ${QUALIFY_PLAYERS} joueurs différents`, done: p.players >= QUALIFY_PLAYERS }
  ];
  return { done: steps.every((s) => s.done), steps };
}

/** Pure: the message a server owner pastes on Discord to invite other owners. */
export function shareMessage(link: string, serverName: string): string {
  return `🛡️ On gère ${serverName} avec Fiverax : staff, anticheat, scanner de backdoors, boutique Tebex et annuaire des serveurs.\nScan gratuit de ton serveur et ${WELCOME_DAYS} jours « À la une » offerts dans l'annuaire avec ce lien : ${link}`;
}
