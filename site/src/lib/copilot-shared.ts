/**
 * Copilote IA (the panel-wide assistant): what the browser receives. Client-safe (no DB).
 *
 * Every action is written by the panel from the AI's validated proposal (never by the AI itself) and is run by the
 * browser through the panel's usual API, after the admin confirmed it: the routes enforce permissions and hierarchy
 * exactly as when the admin clicks the button themselves.
 */

type Base = {
  /** Catalog entry (warn_add, ban, announce…). */
  key: string;
  /** Short button text. */
  label: string;
  /** What the action does, written by the panel (shown in the confirmation). */
  description: string;
  /** Punishes, removes or locks something: the confirmation is shown in red. */
  danger: boolean;
};

export type CopilotAction =
  /** POST /api/s/:serverId/<path> with this JSON body. */
  | (Base & { via: "api"; path: string; body: Record<string, unknown> })
  /** A command for the FiveM agent (POST command?kind=…), followed until the agent answers. */
  | (Base & { via: "command"; kind: string; payload: Record<string, unknown> })
  /** A page of the panel to open (no confirmation). */
  | (Base & { via: "link"; href: string });

export type CopilotReply = {
  answer: string;
  actions: CopilotAction[];
  /** What the panel looked up for the AI during this turn (kept in the conversation for the next questions). */
  lookups: string[];
  /** Actions the AI proposed that the panel refused, and why. */
  rejected: string[];
};
