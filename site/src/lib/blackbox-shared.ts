/**
 * Black box: what the panel and the replay page share (no server imports here).
 *
 * The agent (blackbox.lua) samples every player every 2 s and keeps the last minutes in memory, with the hits and
 * deaths between players. A report (/report in game), a capture asked from the panel or an anticheat kick / ban sends
 * that window to the panel, which keeps it as a replay.
 */

/** One player in a frame: [server id, x, y, z, heading, health, armour, flags, radio, call, vehicle label]. */
export type FramePlayer = [number, number, number, number, number, number, number, number, number, number, string];
export type Frame = { t: number; p: FramePlayer[] };

export const FLAG_TALKING = 1;
export const FLAG_DEAD = 2;
export const FLAG_VEHICLE = 4;

export type CaptureEventKind = "hit" | "death" | "join" | "leave" | "detection" | "report";
/** `a`: author (attacker, killer, reporter), `b`: victim / target, `w`: weapon hash, `d`: damage, `x`: detail. */
export type CaptureEvent = { t: number; k: CaptureEventKind; a?: number; b?: number; w?: number; d?: number; x?: string };

export type CapturePlayer = { id: number; name: string; playerId: number | null };

export type Capture = {
  from: number;
  to: number;
  /** When the report was made (unix seconds), for the "before / after" of the timeline. */
  at: number;
  /** Server ids of the people involved: who reported, who is reported (or caught by the anticheat), who the staff picked. */
  reporter?: number | null;
  target?: number | null;
  center?: number | null;
  players: CapturePlayer[];
  frames: Frame[];
  events: CaptureEvent[];
};

export const REPORT_KINDS = ["report", "manual", "detection"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export const REPORT_STATUSES = ["open", "claimed", "closed"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];
export const REPORT_OUTCOMES = ["sanctioned", "warned", "no_action", "invalid"] as const;
export type ReportOutcome = (typeof REPORT_OUTCOMES)[number];

export const KIND_LABEL: Record<ReportKind, string> = { report: "Report joueur", manual: "Capture staff", detection: "Anticheat" };
export const STATUS_LABEL: Record<ReportStatus, string> = { open: "À traiter", claimed: "Pris en charge", closed: "Clos" };
export const OUTCOME_LABEL: Record<ReportOutcome, string> = { sanctioned: "Sanction appliquée", warned: "Avertissement", no_action: "Rien à reprocher", invalid: "Report abusif" };

export type ReportSummary = {
  id: number;
  kind: ReportKind;
  status: ReportStatus;
  reason: string;
  reporterName: string | null;
  reporterPlayerId: number | null;
  targetName: string | null;
  targetPlayerId: number | null;
  detection: string | null;
  createdAt: string;
  hasCapture: boolean;
  captureFrom: string | null;
  captureTo: string | null;
  capturePlayers: number;
  captureEvents: number;
  claimedName: string | null;
  closedName: string | null;
  closedAt: string | null;
  outcome: ReportOutcome | null;
  verdict: string | null;
};

// ---- weapons ----

/** Jenkins one-at-a-time hash, as GTA computes model and weapon hashes (unsigned). */
export function joaat(text: string): number {
  let h = 0;
  for (const ch of text.toLowerCase()) {
    h = (h + ch.charCodeAt(0)) >>> 0;
    h = (h + (h << 10)) >>> 0;
    h = (h ^ (h >>> 6)) >>> 0;
  }
  h = (h + (h << 3)) >>> 0;
  h = (h ^ (h >>> 11)) >>> 0;
  return (h + (h << 15)) >>> 0;
}

const WEAPONS: Record<string, string> = {
  UNARMED: "Poings", KNIFE: "Couteau", NIGHTSTICK: "Matraque", HAMMER: "Marteau", BAT: "Batte", CROWBAR: "Pied-de-biche", GOLFCLUB: "Club de golf",
  BOTTLE: "Bouteille", DAGGER: "Dague", HATCHET: "Hachette", KNUCKLE: "Poing américain", MACHETE: "Machette", SWITCHBLADE: "Cran d'arrêt",
  WRENCH: "Clé à molette", BATTLEAXE: "Hache de combat", POOLCUE: "Queue de billard", STONE_HATCHET: "Hache en pierre", FLASHLIGHT: "Lampe torche",
  PISTOL: "Pistolet", PISTOL_MK2: "Pistolet Mk II", COMBATPISTOL: "Pistolet de combat", APPISTOL: "Pistolet automatique", STUNGUN: "Taser",
  PISTOL50: "Pistolet .50", SNSPISTOL: "Pistolet SNS", SNSPISTOL_MK2: "Pistolet SNS Mk II", HEAVYPISTOL: "Pistolet lourd", VINTAGEPISTOL: "Pistolet vintage",
  FLAREGUN: "Pistolet de détresse", MARKSMANPISTOL: "Pistolet de précision", REVOLVER: "Revolver", REVOLVER_MK2: "Revolver Mk II",
  DOUBLEACTION: "Revolver double action", CERAMICPISTOL: "Pistolet en céramique", NAVYREVOLVER: "Revolver de la Navy", GADGETPISTOL: "Pistolet Perico",
  MICROSMG: "Micro-SMG", SMG: "SMG", SMG_MK2: "SMG Mk II", ASSAULTSMG: "SMG d'assaut", COMBATPDW: "PDW de combat", MACHINEPISTOL: "Pistolet mitrailleur",
  MINISMG: "Mini SMG", PUMPSHOTGUN: "Fusil à pompe", PUMPSHOTGUN_MK2: "Fusil à pompe Mk II", SAWNOFFSHOTGUN: "Fusil à canon scié",
  ASSAULTSHOTGUN: "Fusil d'assaut à pompe", BULLPUPSHOTGUN: "Fusil à pompe bullpup", MUSKET: "Mousquet", HEAVYSHOTGUN: "Fusil lourd",
  DBSHOTGUN: "Fusil double canon", AUTOSHOTGUN: "Fusil automatique", COMBATSHOTGUN: "Fusil de combat", ASSAULTRIFLE: "Fusil d'assaut",
  ASSAULTRIFLE_MK2: "Fusil d'assaut Mk II", CARBINERIFLE: "Carabine", CARBINERIFLE_MK2: "Carabine Mk II", ADVANCEDRIFLE: "Fusil avancé",
  SPECIALCARBINE: "Carabine spéciale", SPECIALCARBINE_MK2: "Carabine spéciale Mk II", BULLPUPRIFLE: "Fusil bullpup", BULLPUPRIFLE_MK2: "Fusil bullpup Mk II",
  COMPACTRIFLE: "Fusil compact", MILITARYRIFLE: "Fusil militaire", HEAVYRIFLE: "Fusil lourd", TACTICALRIFLE: "Fusil tactique", MG: "Mitrailleuse",
  COMBATMG: "Mitrailleuse de combat", COMBATMG_MK2: "Mitrailleuse de combat Mk II", GUSENBERG: "Gusenberg", SNIPERRIFLE: "Fusil de sniper",
  HEAVYSNIPER: "Sniper lourd", HEAVYSNIPER_MK2: "Sniper lourd Mk II", MARKSMANRIFLE: "Fusil de précision", MARKSMANRIFLE_MK2: "Fusil de précision Mk II",
  PRECISIONRIFLE: "Fusil de précision", RPG: "Lance-roquettes", GRENADELAUNCHER: "Lance-grenades", MINIGUN: "Minigun", FIREWORK: "Lance-feux d'artifice",
  RAILGUN: "Railgun", HOMINGLAUNCHER: "Lance-missiles", COMPACTLAUNCHER: "Lance-grenades compact", RAYPISTOL: "Pistolet à rayons",
  GRENADE: "Grenade", BZGAS: "Gaz BZ", MOLOTOV: "Cocktail Molotov", STICKYBOMB: "Bombe collante", PROXMINE: "Mine de proximité", PIPEBOMB: "Bombe artisanale",
  SMOKEGRENADE: "Fumigène", FLARE: "Fusée éclairante", PETROLCAN: "Jerrican", FIREEXTINGUISHER: "Extincteur", SNOWBALL: "Boule de neige", BALL: "Balle",
  RUN_OVER_BY_CAR: "Écrasé par un véhicule", RAMMED_BY_CAR: "Percuté par un véhicule", FALL: "Chute", DROWNING: "Noyade", DROWNING_IN_VEHICLE: "Noyade (véhicule)",
  EXPLOSION: "Explosion", FIRE: "Feu", BLEEDING: "Hémorragie", BARBED_WIRE: "Barbelés", ANIMAL: "Animal", COUGAR: "Puma", ELECTRIC_FENCE: "Clôture électrique",
  HIT_BY_WATER_CANNON: "Canon à eau", EXHAUSTION: "Épuisement", HELI_CRASH: "Crash d'hélicoptère"
};

const WEAPON_BY_HASH = new Map<number, string>(Object.entries(WEAPONS).map(([name, label]) => [joaat(`WEAPON_${name}`), label]));

/** Readable weapon / cause of death from its hash (signed or unsigned, as Lua sends it). */
export function weaponLabel(hash: number | undefined | null): string | null {
  if (hash === undefined || hash === null || !Number.isFinite(hash) || hash === 0) return null;
  return WEAPON_BY_HASH.get(hash >>> 0) ?? null;
}

// ---- replay maths (pure) ----

/** Index of the last frame at or before `t` (-1 before the first one). Frames are sorted by time. */
export function frameIndexAt(frames: Frame[], t: number): number {
  let lo = 0, hi = frames.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

export type PlayerAt = {
  id: number; x: number; y: number; z: number; heading: number; health: number; armour: number;
  talking: boolean; dead: boolean; inVehicle: boolean; radio: number; call: number; vehicle: string;
};

const toPlayerAt = (p: FramePlayer): PlayerAt => ({
  id: p[0], x: p[1], y: p[2], z: p[3], heading: p[4], health: p[5], armour: p[6],
  talking: (p[7] & FLAG_TALKING) !== 0, dead: (p[7] & FLAG_DEAD) !== 0, inVehicle: (p[7] & FLAG_VEHICLE) !== 0,
  radio: p[8], call: p[9], vehicle: p[10]
});

/** Shortest turn from one heading to another (degrees), for a smooth rotation. */
function lerpAngle(a: number, b: number, k: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return a + d * k;
}

/** Frames further apart than this are not blended (the player teleported, or the agent missed samples). */
const MAX_BLEND_GAP = 6;

/** Everyone's position at time `t`, blended between the two frames around it. */
export function playersAt(frames: Frame[], t: number): PlayerAt[] {
  const i = frameIndexAt(frames, t);
  if (i < 0) return [];
  const a = frames[i];
  const b = frames[i + 1];
  const k = b && b.t > a.t && b.t - a.t <= MAX_BLEND_GAP ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 0;
  const next = new Map((b?.p ?? []).map((p) => [p[0], p]));
  return a.p.map((p) => {
    const cur = toPlayerAt(p);
    const n = k > 0 ? next.get(p[0]) : undefined;
    if (!n) return cur;
    return { ...cur, x: cur.x + (n[1] - cur.x) * k, y: cur.y + (n[2] - cur.y) * k, z: cur.z + (n[3] - cur.z) * k, heading: lerpAngle(cur.heading, n[4], k) };
  });
}

/** A player's positions between two times (trail on the map). */
export function trailOf(frames: Frame[], id: number, from: number, to: number): [number, number][] {
  const out: [number, number][] = [];
  const start = Math.max(0, frameIndexAt(frames, from));
  for (let i = start; i < frames.length && frames[i].t <= to; i++) {
    const p = frames[i].p.find((x) => x[0] === id);
    if (p) out.push([p[1], p[2]]);
  }
  return out;
}

export const distance = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** "hh:mm:ss" of a unix time, in Paris time. */
export const clock = (unix: number) => new Date(unix * 1000).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** "-1:05" / "+0:12" relative to the report. */
export function relative(seconds: number): string {
  const s = Math.round(seconds);
  const abs = Math.abs(s);
  return `${s < 0 ? "−" : "+"}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")}`;
}
