import { can } from "./auth";
import type { SessionUser } from "./types";
import { COMMANDS } from "./agent";
import type { AllowedKinds } from "./troubleshoot";

const KINDS = ["console", "resource", "announce", "game", "kick", "dm", "freeze"] as const;

/** The assistant's action kinds this user may run: the permission of the panel command behind each one. */
export function allowedKinds(user: SessionUser): string[] {
  return KINDS.filter((k) => can(user, COMMANDS[k].permission));
}

export const allowedSet = (user: SessionUser): AllowedKinds => new Set(allowedKinds(user)) as AllowedKinds;
