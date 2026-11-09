import { NextResponse } from "next/server";
import { AGENT_FILES, AGENT_VERSION } from "@/lib/agent-files.generated";
import { getIdentity } from "@/lib/auth";
import { zip } from "@/lib/zip";

export const runtime = "nodejs";

const readme = (appUrl: string) => `FIVERAX AGENT ${AGENT_VERSION}
=========================

Relie ton serveur FiveM au panel Fiverax : joueurs en direct, carte et vocal, anticheat, bans, écrans des joueurs,
console, ressources, scanner de sécurité, boîte noire et /report, déploiement du Studio IA.

INSTALLATION (5 minutes)
1. Copie le dossier « fiverax_agent » dans le dossier resources de ton serveur FiveM.
2. Sur le panel : ton serveur > Configuration > Agent FiveM > « Générer le token » (il ne s'affiche qu'une fois).
3. Ajoute ces lignes au server.cfg (avec TON token) :

   set fiverax_url "${appUrl}"
   set fiverax_token "fvm_TON_TOKEN"
   add_ace resource.fiverax_agent command allow
   add_ace group.admin fiverax.bypass allow
   ensure screenshot-basic
   ensure fiverax_agent

4. Redémarre le serveur (ou « refresh » puis « ensure fiverax_agent » dans la console).
5. Sur le panel, la page « En direct » affiche tes joueurs en quelques secondes.

OPTIONS (server.cfg)
   set fiverax_console 0      refuse les commandes console depuis le panel
   set fiverax_deploy 0       refuse les déploiements du Studio IA
   set fiverax_files 0        l'assistant IA ne lit ni ne modifie les fichiers (1 : lecture seule)
   set fiverax_audit_code 0   le scanner n'envoie aucun code (seuls les fichiers déjà connus sont évalués)
   set fiverax_game 0         refuse les actions en jeu de l'assistant (argent, objets, job…)
   set fiverax_blackbox 0     désactive la boîte noire et /report
   set fiverax_report_command "report"   nom de la commande de report ("" : aucune)

screenshot-basic (gratuit, https://github.com/citizenfx/screenshot-basic) est facultatif : il sert aux captures
analysées par l'IA et à l'écran des joueurs en direct.

Tutoriel complet et dépannage : ${appUrl}/guides/agent-fivem
`;

/** GET /api/agent/download — the FiveM agent as a .zip, for any logged-in account (its code holds no secret: the token is separate). */
export async function GET() {
  if (!(await getIdentity())) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const appUrl = (process.env.APP_URL || "https://fiverax.com").replace(/\/+$/, "");
  const archive = zip([
    ...AGENT_FILES.map((f) => ({ path: `fiverax_agent/${f.path}`, content: f.content })),
    { path: "LISEZMOI.txt", content: readme(appUrl) }
  ]);
  return new NextResponse(Buffer.from(archive), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="fiverax_agent-${AGENT_VERSION}.zip"`,
      "Cache-Control": "private, no-store"
    }
  });
}
