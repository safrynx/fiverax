import Link from "next/link";
import { BookOpen, Boxes, Globe, LifeBuoy, Radar, ScanSearch, ShieldAlert, ShieldCheck, Siren, Store, Users, type LucideIcon } from "lucide-react";
import { Code, Path, Step, Tip, Warn } from "./parts";

/**
 * The tutorials of /guides: one entry per guide, in the recommended reading order. Written from what the panel,
 * the bot and the agent really do: change them together with the features.
 */

export type Guide = { slug: string; title: string; lead: string; minutes: number; icon: LucideIcon; body: (ctx: { appUrl: string }) => React.ReactNode };

export const GUIDES: Guide[] = [
  {
    slug: "demarrer",
    title: "Démarrer avec Fiverax",
    lead: "Ajoute ton serveur, invite le bot, choisis les rôles de ton staff : ton panel est prêt en 5 minutes.",
    minutes: 5,
    icon: BookOpen,
    body: () => (
      <>
        <p>Il te faut un serveur Discord sur lequel tu es <b>propriétaire</b>, <b>administrateur</b> ou as la permission <b>« Gérer le serveur »</b>. Le serveur FiveM est facultatif au début : tu le relies quand tu veux.</p>
        <Step title="Connecte-toi avec Discord">
          <p>Clique sur <b>Connexion</b> puis <b>Continuer avec Discord</b>. Fiverax lit seulement ton pseudo, ton avatar et la liste de tes serveurs Discord (pour savoir lesquels tu peux ajouter).</p>
          <Tip>Fiverax est en <b>bêta privée</b> : si la page « Tes serveurs » affiche « Bêta privée », présente ton serveur dans le formulaire. Dès que ton accès est ouvert, l&apos;ajout de serveur apparaît à la même place.</Tip>
        </Step>
        <Step title="Ajoute ton serveur">
          <p>Sur <Path>Tes serveurs</Path>, choisis ton serveur Discord dans <b>Ajouter un serveur</b>. Tu en deviens le <b>propriétaire</b> sur Fiverax : tous les droits, et tu décides qui d&apos;autre y a accès.</p>
          <p>Le serveur ne s&apos;affiche pas ? Ta liste est lue à la connexion : déconnecte-toi puis reconnecte-toi après avoir obtenu la permission sur Discord.</p>
        </Step>
        <Step title="Invite le bot et place son rôle tout en haut">
          <p>Dans <Path>Administration &gt; Configuration</Path>, clique <b>Inviter le bot sur ce serveur Discord</b>. Il demande la permission Administrateur : il en a besoin pour changer les grades, annuler un raid (recréer un salon ou un rôle) et sanctionner.</p>
          <p>Ensuite, sur Discord : <Path>Paramètres du serveur &gt; Rôles</Path>, glisse le rôle <b>Fiverax</b> <b>au-dessus de tous les autres rôles</b>, admins compris. Discord interdit à un bot de toucher un rôle placé au-dessus du sien.</p>
          <Warn>Sans ce placement, les up / down et l&apos;anti-raid échouent avec « Discord refuse : place le rôle du bot au-dessus ».</Warn>
        </Step>
        <Step title="Choisis les rôles de grade et qui accède au panel">
          <p>Dans <Path>Administration &gt; Accès &amp; rôles</Path> :</p>
          <ul>
            <li><b>Rôles de grade</b> : les rôles de ton staff (Helper, Modo, Admin…). Leur ordre est celui de Discord : plus haut sur Discord = grade plus élevé.</li>
            <li><b>Rôles d&apos;avertissement</b> : Avert 1, 2, 3 (détectés tout seuls s&apos;ils s&apos;appellent ainsi).</li>
            <li><b>Accès & permissions</b> : ajoute une personne ou un rôle, puis allume les droits un par un (voir le bilan, les logs, kick, bannir, la boutique…).</li>
          </ul>
          <p>Un membre ne peut jamais agir sur un grade égal ou supérieur au sien : la hiérarchie de Discord s&apos;applique toujours en plus des permissions.</p>
        </Step>
        <Step title="Personnalise le bot (facultatif)" id="bot">
          <p>Dans <Path>Administration &gt; Bot Discord</Path>, donne au bot <b>le nom, l&apos;avatar, la bannière et la bio de ton serveur</b> : tes membres voient « ton » bot, avec toutes les fonctions Fiverax. L&apos;aperçu montre son profil Discord avant d&apos;enregistrer, et <b>Rétablir le bot d&apos;origine</b> annule tout.</p>
          <p>Ce profil n&apos;existe que sur ton Discord : sur les autres serveurs, le bot garde le sien. Les images sont recadrées toutes seules (avatar carré, bannière au format Discord) ; les GIF animés sont acceptés jusqu&apos;à 1,5 Mo.</p>
        </Step>
        <Step title="Synchronise et relie FiveM">
          <p>Le bouton <b>Synchroniser Discord</b> de l&apos;accueil du serveur importe ton staff tout de suite (le bot le refait seul régulièrement). Il ne reste qu&apos;à <Link href="/guides/agent-fivem">installer l&apos;agent FiveM</Link> pour les joueurs en direct, l&apos;anticheat et les bans.</p>
          <p>L&apos;accueil de ton serveur affiche une <b>liste de mise en route</b> qui se coche toute seule à chaque étape.</p>
        </Step>
      </>
    )
  },
  {
    slug: "agent-fivem",
    title: "Installer l'agent FiveM",
    lead: "La ressource fiverax_agent relie ton serveur FiveM au panel : joueurs en direct, anticheat, bans, écrans, console et scanner. Aucun port à ouvrir.",
    minutes: 10,
    icon: Radar,
    body: ({ appUrl }) => (
      <>
        <p>L&apos;agent est une ressource FiveM qui appelle le panel toutes les quelques secondes en HTTPS, avec le <b>token propre à ton serveur</b>. Il fonctionne avec ESX, QBCore, Qbox ou sans framework.</p>
        <Step title="Télécharge l'agent">
          <p>Dans <Path>Administration &gt; Configuration &gt; Agent FiveM</Path>, clique <b>Télécharger l&apos;agent</b> (ou <a href="/api/agent/download">télécharge-le ici</a> une fois connecté). Dézippe et copie le dossier <code>fiverax_agent</code> dans le dossier <code>resources</code> de ton serveur.</p>
        </Step>
        <Step title="Génère le token de ton serveur">
          <p>Sur la même page, clique <b>Générer le token</b>. Il ne s&apos;affiche <b>qu&apos;une seule fois</b> : copie tout de suite le bloc proposé. Si tu le perds, génère-en un nouveau (l&apos;ancien cesse de fonctionner).</p>
        </Step>
        <Step title="Ajoute ces lignes au server.cfg">
          <p>Remplace <code>fvm_TON_TOKEN</code> par ton token :</p>
          <Code label="server.cfg">{`set fiverax_url "${appUrl}"
set fiverax_token "fvm_TON_TOKEN"
add_ace resource.fiverax_agent command allow
add_ace group.admin fiverax.bypass allow
ensure screenshot-basic
ensure fiverax_agent`}</Code>
          <ul>
            <li><code>add_ace resource.fiverax_agent command allow</code> : l&apos;agent peut démarrer / arrêter des ressources et lancer les commandes de la console depuis le panel.</li>
            <li><code>fiverax.bypass</code> : ton staff (groupe admin) n&apos;est jamais sanctionné par l&apos;anticheat.</li>
            <li><code>screenshot-basic</code> (gratuit, ressource officielle Cfx.re) : facultatif, il sert aux captures analysées par l&apos;IA et aux <b>écrans des joueurs en direct</b>.</li>
          </ul>
        </Step>
        <Step title="Redémarre et vérifie">
          <p>Redémarre le serveur (ou tape <code>refresh</code> puis <code>ensure fiverax_agent</code> dans la console). En quelques secondes, <Path>Serveur FiveM &gt; En direct</Path> affiche tes joueurs et la page Configuration indique <b>Agent en ligne</b>.</p>
        </Step>
        <h2>Options</h2>
        <div className="guide-table">
          <table>
            <thead><tr><th>Ligne du server.cfg</th><th>Effet</th></tr></thead>
            <tbody>
              <tr><td><code>set fiverax_console 0</code></td><td>Refuse les commandes console envoyées depuis le panel.</td></tr>
              <tr><td><code>set fiverax_deploy 0</code></td><td>Refuse les déploiements du Studio IA.</td></tr>
              <tr><td><code>set fiverax_files 0</code></td><td>L&apos;assistant IA ne lit ni ne modifie les fichiers (<code>1</code> : lecture seule).</td></tr>
              <tr><td><code>set fiverax_game 0</code></td><td>Refuse les actions en jeu de l&apos;assistant (argent, objets, job…).</td></tr>
              <tr><td><code>set fiverax_audit_code 0</code></td><td>Le scanner n&apos;envoie aucun code (seuls les fichiers déjà connus sont évalués).</td></tr>
              <tr><td><code>set fiverax_blackbox 0</code></td><td>Désactive la boîte noire et la commande <code>/report</code>.</td></tr>
              <tr><td><code>set fiverax_report_command &quot;report&quot;</code></td><td>Nom de la commande de report (<code>&quot;&quot;</code> : aucune).</td></tr>
            </tbody>
          </table>
        </div>
        <h2>Mettre à jour</h2>
        <p>Quand une nouvelle version sort, la page Configuration l&apos;indique. Télécharge-la, remplace le dossier <code>fiverax_agent</code> (garde ton <code>server.cfg</code> tel quel), puis <code>ensure fiverax_agent</code>.</p>
        <h2>Ça ne marche pas ?</h2>
        <ul>
          <li><b><code>[fiverax] Token refusé</code></b> dans la console : le token est faux ou a été régénéré. Génère-en un nouveau et remplace-le dans le <code>server.cfg</code>.</li>
          <li><b><code>[fiverax] fiverax_url / fiverax_token non configurés</code></b> : les lignes <code>set</code> sont absentes ou placées après <code>ensure fiverax_agent</code>. Mets-les avant.</li>
          <li><b><code>[fiverax] Panel injoignable</code></b> : ton hébergeur bloque les connexions sortantes. L&apos;agent a seulement besoin de joindre <code>{appUrl}</code> en HTTPS.</li>
          <li><b>Démarrer / arrêter une ressource ou la console ne fait rien</b> : la ligne <code>add_ace resource.fiverax_agent command allow</code> manque.</li>
          <li><b>Pas d&apos;écran ni de capture</b> : <code>screenshot-basic</code> n&apos;est pas démarré (<code>ensure screenshot-basic</code>).</li>
        </ul>
      </>
    )
  },
  {
    slug: "anticheat",
    title: "Configurer l'anticheat",
    lead: "Choisis un préréglage, règle chaque détection, surveille les écrans des suspects et bannis proprement.",
    minutes: 10,
    icon: ShieldAlert,
    body: () => (
      <>
        <p>L&apos;anticheat tourne dans l&apos;agent FiveM (côté serveur, sans rien installer chez les joueurs). Il faut donc d&apos;abord <Link href="/guides/agent-fivem">installer l&apos;agent</Link>.</p>
        <Step title="Choisis un préréglage">
          <p><Path>Sécurité &gt; Anticheat &gt; Réglages</Path> : commence par <b>Équilibré</b>. <b>Souple</b> signale sans sanctionner (idéal la première semaine), <b>Strict</b> bannit vite. La <b>couverture</b> sur 100 montre ce qui est protégé.</p>
        </Step>
        <Step title="Règle chaque détection">
          <p>Chaque détection (noclip, vitesse, godmode, armes interdites, explosions, événements piégés…) peut être <b>désactivée</b>, <b>signalée</b>, <b>kick</b> ou <b>ban</b>, avec une capture d&apos;écran en option. Le cumul passe de kick à ban au-delà d&apos;un seuil.</p>
          <Tip>Ton staff a l&apos;ACE <code>fiverax.bypass</code> ? Il n&apos;est jamais contrôlé. Un script qui téléporte un joueur peut appeler <code>exports.fiverax_agent:allowTeleport(source, secondes)</code>.</Tip>
        </Step>
        <Step title="Traite les détections">
          <p>Dans l&apos;onglet <b>Détections</b>, marque chaque cas <b>Confirmé</b> ou <b>Faux positif</b>. Le <b>réglage intelligent</b> s&apos;en sert pour te proposer d&apos;ajuster une limite ou une sanction trop sévère.</p>
        </Step>
        <Step title="Regarde l'écran des suspects en direct">
          <p>Onglet <b>Écrans en direct</b> : les joueurs connectés, les plus suspects en premier (détections des dernières 24 h). <b>Voir l&apos;écran</b> ouvre son écran en direct (≈ 1 image/seconde) ; <b>Mettre au mur</b> affiche jusqu&apos;à <b>4 écrans côte à côte</b> pour surveiller plusieurs suspects à la fois. <b>Capture</b> garde une image et l&apos;envoie à l&apos;analyse IA.</p>
          <p>Il faut <code>screenshot-basic</code> sur le serveur et la permission « Capturer l&apos;écran d&apos;un joueur ». Rien n&apos;est enregistré sauf les captures que tu gardes.</p>
        </Step>
        <Step title="Bannis, et partage avec le réseau">
          <p>Un ban vise la license, les comptes liés et les identifiants matériels ; l&apos;agent l&apos;applique à chaque connexion. Avec les <b>bans partagés</b> (<Path>Réseau Fiverax &gt; Bans partagés</Path>), tu vois si un joueur est banni ailleurs et tu peux le bloquer à la connexion quand plusieurs serveurs l&apos;ont banni.</p>
          <p>Les joueurs bannis peuvent contester depuis leur espace joueur : tu traites les contestations dans <Path>Reports &amp; replays &gt; Contestations</Path>.</p>
        </Step>
      </>
    )
  },
  {
    slug: "anti-raid",
    title: "Protéger ton Discord avec l'anti-raid",
    lead: "Le bot annule un nuke, sanctionne l'auteur, bloque les raids de comptes et nettoie les messages. Tout se règle serveur par serveur.",
    minutes: 12,
    icon: ShieldCheck,
    body: () => (
      <>
        <Warn>Prérequis : le bot est <b>Administrateur</b> et son rôle est <b>tout en haut</b> de la liste des rôles. Sinon il ne peut ni recréer un rôle, ni retirer les rôles d&apos;un admin qui casse tout.</Warn>
        <Step title="Commence en observation">
          <p><Path>Sécurité &gt; Anti-raid &gt; Réglages</Path> : active l&apos;anti-raid en mode <b>Observation</b> pendant quelques jours. Le bot signale tout ce qu&apos;il <i>aurait</i> fait, sans rien toucher : tu ajustes, puis tu passes en <b>Protection</b>.</p>
        </Step>
        <Step title="Règle chaque action surveillée">
          <p>Dans <b>Règles</b>, pour chaque action (suppression de salons ou de rôles, bans et kicks en masse, ajout de bots, webhooks, rôles dangereux…) :</p>
          <ul>
            <li><b>Toléré / Fenêtre</b> : combien d&apos;actions une personne peut faire en tant de secondes avant que le bot réagisse.</li>
            <li><b>Annuler</b> : le bot défait ce qui a été fait (rôle recréé et redonné, salon recréé, membres débannis…).</li>
            <li><b>Sanction</b> : celle de la règle (ex. bannir pour des bans en masse), la sanction générale, ou <b>aucune</b> (seulement annuler et signaler).</li>
          </ul>
        </Step>
        <Step title="Dis-lui qui est de confiance">
          <p>Ajoute les <b>personnes</b> (IDs Discord) et les <b>rôles de confiance</b> (fondateurs, gérants) : leurs actions ne sont jamais surveillées. Garde ces listes courtes : un compte de confiance piraté n&apos;est plus protégé.</p>
          <p>Les <b>rôles et salons protégés</b> font l&apos;inverse : y toucher est annulé et sanctionné dès la première fois.</p>
        </Step>
        <Step title="Choisis comment tu es prévenu">
          <ul>
            <li><b>Salon d&apos;alerte</b> (ID du salon) : chaque incident y est posté, avec la mention d&apos;un <b>rôle</b> si tu en choisis un.</li>
            <li><b>MP au propriétaire</b> du Discord à chaque incident.</li>
            <li><b>MP à la personne sanctionnée</b>, avec ton propre texte (<code>{"{serveur}"}</code>, <code>{"{sanction}"}</code> et <code>{"{raison}"}</code> sont remplacés).</li>
          </ul>
        </Step>
        <Step title="Bloque les raids de comptes">
          <p>Au-delà de X arrivées en Y secondes (ou d&apos;une vague de comptes récents, sans avatar, aux noms semblables), le bot <b>verrouille</b> le serveur : vérification au maximum, nouveaux arrivants refusés, et salons en lecture seule si tu le coches. Choisis si les arrivants du raid sont expulsés, bannis ou laissés.</p>
          <p>L&apos;<b>âge minimum du compte</b> refuse les comptes trop récents : expulsés, bannis, mis en quarantaine ou seulement signalés.</p>
        </Step>
        <Step title="Protège les messages">
          <p>Flood, mentions de masse, @everyone, liens d&apos;arnaque (faux Nitro / Steam), comptes piratés qui spamment partout et raids de messages copiés-collés : le bot supprime et applique la sanction choisie (mute, expulsion, bannissement, ou suppression seule). Tu peux aussi bloquer les invitations et les liens (avec une liste de <b>sites autorisés</b>) et une liste de <b>mots interdits</b>.</p>
          <Tip>Liens, invitations, arnaques et mots interdits demandent que le bot lise le contenu des messages. Si ces protections ne réagissent pas, signale-le nous depuis le panel.</Tip>
        </Step>
        <h2>En cas de raid</h2>
        <ul>
          <li><b>Verrouiller</b> (en haut de la page Anti-raid) : verrouillage manuel immédiat, levé à la main ou à la fin de la durée choisie.</li>
          <li><b>Sauvegardes</b> : rôles, salons et rôles des membres, automatiques toutes les N heures et à la demande. <b>Restaurer</b> remet tout en place après un nuke.</li>
          <li><b>Rendre les rôles</b> : si le bot a derank quelqu&apos;un par erreur, un clic depuis l&apos;incident lui rend ses rôles.</li>
          <li><b>Audit Discord</b> : une note sur 100 de la configuration de ton Discord (permissions de @everyone, bots administrateurs, A2F de la modération…) avec chaque correctif.</li>
        </ul>
      </>
    )
  },
  {
    slug: "boutique-tebex",
    title: "Brancher ta boutique Tebex",
    lead: "Relie ton webstore Tebex : ventes, paiements, clients et promotions dans le panel, et une vraie boutique en ligne avec le Store Creator.",
    minutes: 10,
    icon: Store,
    body: () => (
      <>
        <p>Il te faut un webstore <a href="https://tebex.io" target="_blank" rel="noopener noreferrer">Tebex</a> (gratuit) relié à ton serveur FiveM. Seuls les propriétaires du serveur voient les réglages de la boutique.</p>
        <Step title="Colle tes clés Tebex">
          <p>Dans <Path>Boutique Tebex &gt; Réglages boutique</Path> :</p>
          <ul>
            <li><b>Clé secrète</b> : dans Tebex, <Path>Integrations &gt; Game servers &gt; Edit</Path>. C&apos;est la même que <code>tebex:secret</code> dans ton <code>server.cfg</code>. Elle est stockée chiffrée.</li>
            <li><b>Token public</b> : dans Tebex, <Path>Integrations &gt; Headless API</Path> (ou l&apos;identifiant du webstore). Il sert à lire le catalogue.</li>
          </ul>
          <p>Clique <b>Tester la connexion</b> : le panel affiche ton catalogue.</p>
        </Step>
        <Step title="Branche le webhook (paiements en direct)">
          <p>Copie l&apos;<b>adresse du webhook</b> affichée dans les réglages, puis dans Tebex : <Path>Developers &gt; Webhooks &gt; Endpoints</Path>, ajoute cette adresse et coche les événements de <b>paiement</b> et d&apos;<b>abonnement</b>. Copie le <b>secret</b> que Tebex te donne dans le panel (<b>Enregistrer le secret</b>), puis clique <b>Validate</b> dans Tebex.</p>
          <p>Chaque achat, remboursement ou litige arrive alors en quelques secondes dans <Path>Boutique Tebex &gt; Paiements</Path>.</p>
        </Step>
        <Step title="Reçois les ventes sur Discord (facultatif)">
          <p>Colle l&apos;URL d&apos;un webhook Discord dans <b>Webhook Discord</b> pour recevoir les ventes et renouvellements dans un salon.</p>
        </Step>
        <Step title="Crée ta boutique en ligne">
          <p><Path>Boutique Tebex &gt; Store Creator</Path> : décris la boutique que tu veux à l&apos;IA, ou assemble-la bloc par bloc (bannière, catégories, offres, FAQ…). Choisis son adresse, prévisualise, puis <b>Publier</b> : elle est en ligne sur <code>/store/ton-adresse</code>, avec le paiement Tebex.</p>
        </Step>
        <h2>Au quotidien</h2>
        <ul>
          <li><b>Ventes</b> : chiffre d&apos;affaires, meilleures offres, derniers achats.</li>
          <li><b>Paiements</b> : notes, statut (remboursé, litige), commandes manuelles.</li>
          <li><b>Catalogue</b> : prix, désactiver une offre. <b>Promotions</b> : codes promo et cartes cadeaux.</li>
          <li><b>Clients</b> : un joueur est reconnu par son compte Cfx.re ; ses achats apparaissent aussi sur sa fiche joueur.</li>
        </ul>
      </>
    )
  },
  {
    slug: "staff",
    title: "Gérer ton équipe",
    lead: "Grades, avertissements, commentaires et bilan IA du dimanche : ton staff se gère depuis le panel, Discord suit tout seul.",
    minutes: 6,
    icon: Users,
    body: () => (
      <>
        <Step title="Monter, descendre, recruter">
          <p>Sur la fiche d&apos;un membre (<Path>Staff &gt; Équipe</Path>), <b>Up</b>, <b>Down</b>, <b>Demote</b> ou un grade précis : le bot change ses rôles Discord et l&apos;historique garde qui a fait quoi et pourquoi. <b>Recruter</b> donne le premier grade à un membre du Discord.</p>
        </Step>
        <Step title="Avertir et suivre">
          <p>Les <b>avertissements</b> (1 à 3) posent les rôles Avert sur Discord. Les <b>commentaires</b> et les <b>pastilles</b> (alerte, vigilance, positif) gardent la trace du suivi.</p>
        </Step>
        <Step title="Le bilan IA du dimanche">
          <p>Chaque dimanche soir (fuseau et heure réglables dans Configuration), l&apos;IA résume les commentaires de la semaine de chaque membre et pose une pastille. <Path>Staff &gt; Bilan hebdo</Path> les rassemble, avec le temps en vocal et en jeu.</p>
        </Step>
        <Step title="Contrôle qui fait quoi">
          <p>Les droits se donnent finement dans <Path>Administration &gt; Accès &amp; rôles</Path>, et chaque action est dans <Path>Pilotage &gt; Logs</Path>.</p>
        </Step>
      </>
    )
  },
  {
    slug: "scanner",
    title: "Scanner ton serveur et obtenir le badge",
    lead: "Un scan complet de tes ressources (backdoors, événements exploitables, configuration), un plan d'action et le badge « Protégé par Fiverax ».",
    minutes: 8,
    icon: ScanSearch,
    body: () => (
      <>
        <Step title="Lance un scan complet">
          <p><Path>Sécurité &gt; Scanner</Path> &gt; <b>Lancer un scan</b> : l&apos;agent envoie l&apos;inventaire de tes ressources et le panel les analyse (backdoors, événements serveur exploitables, injections SQL, webhooks visibles, configuration du <code>server.cfg</code>, performances). Tu obtiens un score sur 100 et chaque problème avec sa ressource, son fichier, sa ligne et son correctif.</p>
          <Tip>Le code n&apos;est jamais gardé : seuls les résultats et 3 lignes autour de chaque problème. <code>set fiverax_audit_code 0</code> empêche tout envoi de code.</Tip>
        </Step>
        <Step title="Corrige avec le plan d'action">
          <p><Path>Sécurité &gt; Protection &amp; badge</Path> classe ce qu&apos;il reste à faire, du plus grave au plus simple. <b>Expliquer et corriger avec l&apos;IA</b> détaille un problème ; le <b>kit de protection</b> s&apos;installe en un clic (garde d&apos;événements, webhooks protégés, anti-flood de connexion).</p>
        </Step>
        <Step title="Active le scan continu">
          <p>Coche le <b>scan continu</b> : relancé après chaque démarrage de ressource et deux fois par jour, avec une alerte si un problème grave apparaît.</p>
        </Step>
        <Step title="Affiche ton badge">
          <p>Selon ton niveau (Protégé, Renforcé, Forteresse), active le <b>badge public</b> et colle son code sur ton site, ton Tebex ou ton Discord. La page de vérification ne montre jamais tes problèmes, seulement ton niveau.</p>
        </Step>
      </>
    )
  },
  {
    slug: "portail-annuaire",
    title: "Annuaire, portail joueurs et votes",
    lead: "Fais venir des joueurs : fiche dans l'annuaire, avis vérifiés, votes avec récompenses en jeu et un portail pour ta communauté.",
    minutes: 8,
    icon: Globe,
    body: () => (
      <>
        <Step title="Publie ta fiche">
          <p><Path>Réseau Fiverax &gt; Fiche annuaire</Path> : nom, accroche, présentation (80 caractères minimum), connexion <code>cfx.re/join/…</code> ou Discord, logo, bannière, galerie et étiquettes. Prévisualise, puis <b>Publier</b>.</p>
        </Step>
        <Step title="Avis et votes">
          <p>Les avis sont <b>vérifiés</b> : seuls les joueurs avec au moins 1 h de jeu sur ton serveur (compte Discord lié en jeu) peuvent noter, jamais ton staff. Tu réponds publiquement à chaque avis.</p>
          <p>Les <b>votes</b> (un toutes les 2 h par joueur) classent l&apos;annuaire. Dans <b>Récompenses de vote</b>, choisis argent ou objets : l&apos;agent les donne en jeu au votant.</p>
        </Step>
        <Step title="Construis ton portail joueurs">
          <p><Path>Réseau Fiverax &gt; Portail joueurs</Path> : une page à ton nom avec des blocs (annonces, événements, boutons, règlement, FAQ, statut du serveur, statistiques du joueur), des <b>formulaires</b> (candidatures staff, whitelist…) et des <b>giveaways</b> tirés au sort automatiquement.</p>
        </Step>
        <Step title="Parraine d'autres serveurs">
          <p><Path>Réseau Fiverax &gt; Parrainage</Path> : chaque serveur qui arrive par ton lien et dont l&apos;agent accueille ses premiers joueurs te rapporte des jours « À la une » dans l&apos;annuaire.</p>
        </Step>
      </>
    )
  },
  {
    slug: "studio-ia",
    title: "Studio IA et assistant",
    lead: "Crée des interfaces, des scripts et des mappings sans coder, déploie-les en un clic, et laisse l'assistant diagnostiquer ton serveur.",
    minutes: 8,
    icon: Boxes,
    body: () => (
      <>
        <Step title="Crée une ressource">
          <p><Path>Studio IA</Path> : <b>UI Creator</b> (menus, HUD, formulaires avec aperçu en direct), <b>Script Creator</b> (blocs façon Scratch : commandes, zones, argent ESX / QBCore / Qbox…) et <b>Mapping Creator</b> (props et kits à placer sur la carte). Tout se fait à la main ou en décrivant ce que tu veux à l&apos;IA.</p>
        </Step>
        <Step title="Vérifie et déploie">
          <p>Chaque modification est vérifiée (fichiers manquants, appels dangereux, événements qui donnent de l&apos;argent sans contrôle). <b>Déployer</b> écrit la ressource dans <code>resources/[fiverax_studio]</code> et la démarre ; <b>.zip</b> la télécharge. Chaque version est gardée et restaurable.</p>
        </Step>
        <Step title="Demande de l'aide à l'assistant">
          <p><Path>Serveur FiveM &gt; Assistant IA</Path> : décris le problème (« le garage ne démarre plus »), l&apos;IA lit la console et l&apos;état des ressources, explique la cause et propose des actions à confirmer. Elle peut aussi gérer les joueurs en jeu (« rembourse 5000 $ à Tata ») et, si tu l&apos;autorises, lire et corriger les fichiers d&apos;une ressource (avec annulation en un clic).</p>
          <Tip>L&apos;IA a un quota quotidien par serveur et par compte. S&apos;il est atteint, elle répond « quota atteint » jusqu&apos;au lendemain.</Tip>
        </Step>
      </>
    )
  },
  {
    slug: "reports",
    title: "Reports et boîte noire",
    lead: "Un joueur tape /report : tu revois les dernières minutes autour de lui, comme un replay, et tu tranches.",
    minutes: 5,
    icon: Siren,
    body: () => (
      <>
        <Step title="Le joueur signale">
          <p>En jeu, <code>/report [id] raison</code>. L&apos;agent garde en mémoire les dernières minutes du serveur (positions, véhicules, tirs, morts, qui parle) et envoie la scène 10 secondes plus tard. Le staff en jeu est prévenu dans le chat.</p>
        </Step>
        <Step title="Tu revois la scène">
          <p><Path>Serveur FiveM &gt; Reports &amp; replays</Path> : carte avec lecture jusqu&apos;à ×8, trajets, tirs, morts, détections, chronologie cliquable. <b>Capturer maintenant</b> garde aussi les dernières minutes autour d&apos;un joueur sans report.</p>
        </Step>
        <Step title="Tu tranches">
          <p>Prends le report en charge, clôture-le avec une décision et une réponse que le joueur lit dans son espace joueur, ou bannis directement le joueur signalé.</p>
        </Step>
      </>
    )
  },
  {
    slug: "depannage",
    title: "Dépannage et questions",
    lead: "Les soucis les plus fréquents et leur solution en une ligne.",
    minutes: 4,
    icon: LifeBuoy,
    body: () => (
      <>
        <h2>Discord</h2>
        <ul>
          <li><b>« Discord refuse : place le rôle du bot au-dessus »</b> : Paramètres du serveur &gt; Rôles, glisse le rôle Fiverax tout en haut.</li>
          <li><b>« Bot absent »</b> sur l&apos;accueil : invite le bot depuis Configuration (permission Administrateur).</li>
          <li><b>Mon serveur Discord n&apos;apparaît pas dans la liste</b> : il te faut « Gérer le serveur » ; reconnecte-toi pour rafraîchir la liste.</li>
        </ul>
        <h2>FiveM</h2>
        <ul>
          <li><b>Agent hors ligne</b> : regarde la console du serveur, les messages commencent par <code>[fiverax]</code> (voir <Link href="/guides/agent-fivem">Installer l&apos;agent</Link>).</li>
          <li><b>L&apos;écran du joueur reste noir</b> : <code>ensure screenshot-basic</code>, et le joueur doit être en jeu (pas dans un menu de chargement).</li>
          <li><b>Un membre du staff est sanctionné par l&apos;anticheat</b> : ajoute <code>add_ace group.admin fiverax.bypass allow</code> (ou le groupe de ton staff).</li>
        </ul>
        <h2>Panel</h2>
        <ul>
          <li><b>« Session expirée »</b> : une session dure 8 h ; reconnecte-toi.</li>
          <li><b>« Bêta privée »</b> : Fiverax ouvre par vagues ; ta demande d&apos;accès est enregistrée et tu peux la modifier sur « Tes serveurs ».</li>
          <li><b>« Quota IA du jour atteint »</b> : l&apos;IA revient le lendemain (minuit UTC).</li>
          <li><b>Un bug ?</b> Clique <b>Signaler un bug</b> en bas du menu du panel : ton message arrive directement à l&apos;équipe avec la page où tu étais.</li>
        </ul>
      </>
    )
  }
];

export const guideBySlug = (slug: string) => GUIDES.find((g) => g.slug === slug) ?? null;

/** Kept for the panel's help links: the guide of each panel area. */
export const HELP: Record<string, string> = {
  setup: "/guides/demarrer",
  agent: "/guides/agent-fivem",
  anticheat: "/guides/anticheat",
  antiraid: "/guides/anti-raid",
  shop: "/guides/boutique-tebex",
  staff: "/guides/staff",
  scanner: "/guides/scanner",
  directory: "/guides/portail-annuaire",
  studio: "/guides/studio-ia",
  reports: "/guides/reports"
};
