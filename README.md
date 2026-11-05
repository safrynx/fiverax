# Dashboard FiveM (ex-GTASUN Staff Manager)

Dashboard **multi-serveurs** de gestion de serveurs FiveM : staff, grades, avertissements, activité (vocal Discord + temps de jeu), bilan IA hebdomadaire.
Un **serveur** du panel = un serveur Discord + (optionnellement) un serveur FiveM. Toutes les données sont rangées par serveur.

Trois dossiers indépendants :

| Dossier | Rôle | Hébergement |
|---|---|---|
| [`site/`](site) | Panel web (Next.js) + base libSQL (Turso en prod). Il possède **toutes les données**, rangées par serveur. | Vercel / un serveur Node |
| [`bot/`](bot) | **Un seul** bot Discord pour tous les serveurs. Il surveille les serveurs Discord enregistrés sur le site et **envoie tout au site par API**. Aucune base de données. | N'importe où (VPS, conteneur…), il suffit qu'il joigne le site |
| [`fivem/`](fivem) | Ressource `fiverax_agent` : relie chaque serveur FiveM au site (`/api/fivem/agent`) avec le **token propre à son serveur**. Joueurs en direct, carte & vocal, kick, messages, annonces, ressources, console, **anticheat**, **bans** et déploiement du **Studio IA**. | Chaque serveur FiveM |

## Comment ils se parlent
```
Discord (N serveurs) ──► bot ──(HTTPS, Bearer BOT_API_TOKEN, guildId dans chaque message)──► site ──► base
FiveM (1 par serveur) ──(HTTPS, Bearer <token du serveur>)────────────────────────────────► site
```
- Le bot demande au site la liste des serveurs Discord à surveiller (`POST /api/bot/servers`, toutes les 5 min) et ignore les autres.
- Chaque message du bot (`sync`, `member`, `voice`, `playtime`) indique son `guildId` ; le site le range dans le bon serveur. `heartbeat` liste les serveurs où le bot est présent, ce qui permet au panel d'afficher « bot absent » serveur par serveur.
- `tick` (10 min) : nettoyage des sessions FiveM, puis bilan IA du dimanche **de chaque serveur, dans son propre fuseau horaire**.
- Le token d'un agent FiveM désigne son serveur : un agent ne peut jamais écrire dans un autre serveur.
- L'agent FiveM **interroge** le site (toutes les 2 s quand quelqu'un regarde les pages « En direct », 8 s sinon) : il envoie connexions, déconnexions, console et résultats, et reçoit les actions en attente. Aucun port à ouvrir, compatible Vercel. Une action non récupérée en 2 min est abandonnée (jamais exécutée en retard). L'ancien endpoint `/api/fivem` (agent 1.x) marche toujours.
- `server.cfg` : `set fiverax_url "https://…"`, `set fiverax_token "fvm_…"`, `add_ace resource.fiverax_agent command allow`, `ensure fiverax_agent` (les lignes exactes sont données dans Configuration). `set fiverax_console 0` refuse la console depuis le panel, `set fiverax_deploy 0` les déploiements du Studio IA, `set fiverax_audit_code 0` l'envoi de code pour le scanner, `set fiverax_files 0` l'accès de l'assistant IA aux fichiers (`1` : lecture seule).
- `add_ace group.admin fiverax.bypass allow` : le staff n'est jamais contrôlé par l'anticheat. `ensure screenshot-basic` (facultatif) : captures d'écran analysées par l'IA. Un script qui téléporte un joueur peut appeler `exports.fiverax_agent:allowTeleport(source, secondes)`.

## Sécurité
- **Anticheat** (agent FiveM, réglé dans Sécurité > Anticheat) : protection des événements (pièges + anti-spam), contrôle des événements du jeu (entités, explosions, armes données/retirées, éjections, particules, projectiles, dégâts), contrôle des joueurs toutes les 2 s (godmode, vie/armure, super saut, invisibilité, multiplicateurs de dégâts, armes et skins interdits, vitesse, téléportation), module client (heartbeat, ressources injectées, spectate, vision). Chaque détection : désactivée / signalée / kick / ban, avec capture d'écran en option.
- **Captures IA** : `screenshot-basic` + le modèle de vision de `AI_BASE_URL` / `AI_API_KEY` (`AI_VISION_MODEL`, par défaut `meta-llama/llama-4-scout-17b-16e-instruct` sur Groq). Gardées 30 jours. Le ban automatique sur l'avis de l'IA seule est désactivé par défaut.
- **Bans** : sur la license, les comptes liés et les identifiants matériels ; appliqués par l'agent à la connexion (liste gardée en cache sur le serveur FiveM si le panel est injoignable).
- **Carte & vocal** : positions toutes les 2 s, qui parle, radio et appels (pma-voice). Fond de carte : `MAP_IMAGE_URL` (atlas GTA V 8192 px), sinon une grille avec les lieux principaux. Aucun audio n'est capté.
- **Anti-raid Discord** (bot, Sécurité > Anti-raid, désactivé par défaut) : lit le journal d'audit en temps réel ; au-delà de ce qu'une règle tolère, annule tout (rôle recréé et redonné à ses membres, salon recréé, rôles remis, membres débannis, webhooks et bots supprimés…) et sanctionne l'auteur (derank / kick / ban ; rôles rendables depuis le panel). Raids de comptes : verrouillage temporaire. Le bot doit être **Administrateur**, avec son rôle **tout en haut**.
- **Écran en direct** : le staff voit l'écran d'un joueur (≈ 1 image/s via `screenshot-basic`) depuis En direct, la carte ou sa fiche ; le flux s'arrête 15 s après la fermeture, rien n'est stocké. **Geler** un joueur le bloque sur place.
- **Anticheat, en plus** : durée des bans de l'anticheat, cumul de détections (kick puis ban au seuil), alertes vers un webhook Discord, règles de connexion (serveur verrouillé avec liste blanche, Discord/Steam obligatoire, pseudos interdits), journal des connexions refusées, ressource arrêtée chez un seul joueur, détections affichées sur la carte, **comptes liés** (même PC ou même Discord/Steam) sur la fiche joueur.
- **Anti-raid, en plus** : sanctions quarantaine (rôle dédié) et mute, rôles et salons protégés (toute modification annulée dès la première), permissions de salons modifiées en masse, protection des messages (flood, mentions de masse, @everyone, invitations et liens — ces deux derniers demandent `BOT_MESSAGE_CONTENT=1` et l'intent « Message Content »), alerte en MP au propriétaire, **verrouillage manuel** depuis le panel (vérification max, arrivants expulsés, salons en lecture seule), **sauvegardes** des rôles/salons/rôles des membres (auto toutes les N h + manuelle) et **restauration** après un nuke. Le bot récupère les commandes du panel toutes les 15 s.

## Scanner
Sécurité > Scanner : un scan complet du serveur, un rapport avec un **score sur 100** (global et par catégorie), les problèmes classés par gravité (critique, haute, moyenne, info) avec la ressource, le fichier, la ligne, l'explication et le correctif, et l'historique des scores.
- **Sécurité** : backdoors (code téléchargé puis exécuté, noms cachés en `\x..` ou via `_G[...]`, panels connus type cipher-panel, `os.execute` / `io.popen` / `child_process`, `add_ace` / `add_principal` par le code, secrets lus puis envoyés en HTTP, code obfusqué), événements serveur exploitables (montant / objet pris dans les paramètres du client, récompense sans vérification), injections SQL, webhooks et clés lisibles par les joueurs, logique de paiement / permission côté client.
- **Configuration** : `sv_scriptHookAllowed`, ACE données à tout le monde ou `resource.X command`, RCON, `sv_endpointprivacy`, `sv_enforceGameBuild`, artifacts en retard (comparés aux builds recommandés de Cfx.re).
- **Performance** : boucles `Wait(0)` inutiles, requêtes SQL dans des boucles, `GetDistanceBetweenCoords`, fichiers streamés de plus de 16 Mo, assets streamés en double.
- **Maintenance** : `__resource.lua`, `fx_version` obsolète, Lua 5.4 absent, mysql-async / ghmattimysql, natives dépréciées, dépendances manquantes ou arrêtées, ordre des `ensure`, ressources en double, noms d'événements en conflit, ressources sous escrow (signalées « protégées, non analysables »).
- **Comment** : l'agent 3.3 (`audit.js`, JavaScript serveur) envoie l'inventaire (fichiers, tailles, SHA-256, manifests, `server.cfg` avec tous les secrets masqués) ; le panel demande seulement les fichiers qu'il n'a **jamais** analysés, pour aucun serveur (réputation par hash), vérifie que chaque contenu correspond à son hash, l'analyse avec les règles puis l'oublie. Seuls les résultats et 3 lignes autour de chaque problème sont gardés (30 derniers scans). L'IA ne reçoit que ces 3 lignes, à la demande (« Expliquer et corriger avec l'IA »).
- **Scan continu** (case à cocher) : relancé après un démarrage de ressource et deux fois par jour ; un nouveau problème critique ou haut est envoyé sur le webhook d'alertes de l'anticheat.
- `set fiverax_audit_code 0` : mode confidentiel, aucun code ne quitte le serveur (seuls les fichiers déjà connus sont évalués).

## Studio IA
Trois créateurs (menu « Studio IA », permissions « Studio » et « Déployer »), chacun **à la main** (sans coder) ou **avec l'IA** (on décrit en français, elle écrit la ressource), puis on la télécharge en `.zip` ou on la **déploie** sur le serveur en un clic.
- **UI Creator** : page NUI (HTML/CSS/JS) + `client.lua`. **Mode simple** : un modèle (menu, HUD, compteur de vitesse, formulaire, panneau d'infos) puis des éléments empilés (titre, texte, bouton qui ferme ou lance une commande, jauge vie / armure / vitesse, champ, image), position, couleurs, ouverture (toujours affichée, commande ou touche) ; le panel écrit la page. **Aperçu en direct** en 1920×1080 sur un fond de jeu, dans un cadre isolé : boutons « messages du jeu » (comme `SendNUIMessage`), journal des callbacks NUI et des erreurs JavaScript.
- **Script Creator** : **blocs façon Scratch** (Blockly) : événements (commande, touche, zone, arrivée en jeu, mort, minuterie), actions joueur et véhicule, argent (ESX / QBCore / Qbox), annonces, conditions, boucles. Les commandes tournent côté serveur (droits vérifiés, argent donné par le serveur), le reste côté client ; un bloc mal placé est signalé. Ou l'IA : `fxmanifest`, `config`, client, serveur, README pour Standalone / ESX / QBCore / Qbox, le serveur ne faisant jamais confiance au client.
- **Mapping Creator** : éditeur vue de dessus (glisser, tourner, dupliquer), **catalogue de props et kits prêts à poser** (barrage de police, stand, terrasse, barbecue, chantier) à glisser sur la carte, centre posé sur un lieu ou **la position d'un joueur en jeu** ; l'IA compose ou modifie la scène. Le panel écrit lui-même le `client.lua` (objets figés qui apparaissent quand un joueur approche).
- **Blocs / mode simple ↔ code** : les fichiers d'une création visuelle sont générés (lecture seule) ; « Code » les rend modifiables à la main, et une demande à l'IA fait passer la création en code (les blocs restent dans l'historique).
- **Vérifications** à chaque modification : fichiers déclarés absents, blocs Lua non fermés, appels dangereux (`os.execute`…), événements réseau qui donnent de l'argent ou des objets sans contrôle ; bouton « Corriger avec l'IA ».
- **Versions** : chaque demande à l'IA, modification ou restauration est gardée (40 dernières) et restaurable.
- **Déploiement** : l'agent (3.2) écrit la ressource dans `resources/[fiverax_studio]/<nom>` (à côté de son propre dossier), fait `refresh` puis la (re)démarre. Il ne touche jamais une ressource du même nom hors de ce dossier. `set fiverax_deploy 0` le refuse. Modèle IA : `AI_CODE_MODEL` (sinon `AI_MODEL`), longueur de réponse `AI_CODE_MAX_TOKENS` (8000).

## Assistant IA
Page « Serveur FiveM > Assistant IA » (permission « Console du serveur et assistant IA »). On décrit un problème en jeu (ressource qui ne démarre pas, erreur de script, job cassé…) ; l'IA lit la console (erreurs en priorité), l'état des ressources et le dernier scan, explique la cause et propose des actions en un clic (commande console, démarrer / redémarrer une ressource, toujours après confirmation).
- **Gestion en jeu** : on parle naturellement (« rembourse 5000 $ à Tata », « mets Bob mécano grade 2 », « réanime Lucas », « téléporte Tata sur Bob », « combien a Bob en banque ? »). L'IA retrouve le joueur parmi les connectés et propose les actions : argent (liquide, banque, argent sale), objets, job, réanimer, soigner, téléporter, infos du joueur (permission « Gérer les joueurs en jeu »), message privé, gel, kick, annonce (leurs permissions habituelles). Chaque action est confirmée (« Tout exécuter » pour plusieurs), son résultat revient dans la conversation et dans les logs. L'agent 3.6 (`game.lua`) détecte ESX, QBCore ou Qbox et ox_inventory ; seulement les joueurs connectés. `set fiverax_game 0` refuse ces actions.
- **Fichiers** (permission « Laisser l'assistant IA lire et modifier les fichiers des ressources ») : l'IA demande à lire la liste des fichiers d'une ressource ou certains fichiers ; l'agent 3.5 (`files.js`) les envoie et l'IA continue avec leur contenu. Elle propose ensuite une modification (remplacements précis ou fichier complet) affichée en **diff** : « Appliquer et redémarrer », « Appliquer sans redémarrer » ou « Ignorer ».
- **Sécurité** : seulement des fichiers texte (`.lua`, `.js`, `.json`, `.html`, `.css`, `.cfg`, `.sql`…) dans le dossier de la ressource (pas de `..`), jamais `fiverax_agent`. Avant d'écrire, l'agent vérifie que chaque fichier est encore celui que l'IA a lu (SHA-256) : sinon rien n'est écrit. Il garde une copie `<fichier>.fiverax.bak`. Chaque lecture et écriture est dans les logs.
- **Annuler** : chaque modification appliquée garde le contenu d'avant et s'annule en un clic (historique en bas de la page).
- `set fiverax_files 1` : l'IA peut lire mais pas modifier ; `set fiverax_files 0` : ni l'un ni l'autre.

## Reports & boîte noire
Page « Serveur FiveM > Reports & replays » (permission « Traiter les reports des joueurs et revoir les incidents »). Agent **3.7** (`blackbox.lua`).
- **Boîte noire** : l'agent garde en mémoire les dernières minutes du serveur (`set fiverax_blackbox_seconds 300`, 60 à 900) : position, cap, vie, armure, véhicule, qui parle, radio et appel de chaque joueur toutes les 2 s, plus les coups et les morts entre joueurs (tueur et arme, signalés par le client de la victime), connexions, déconnexions et détections. Rien ne part tant qu'il n'y a pas d'incident. Aucun son.
- **`/report [id] raison`** en jeu (nom de la commande : `set fiverax_report_command`, `""` pour aucune ; les scripts de report existants peuvent appeler `exports.fiverax_agent:report(source, cible, raison)`). 10 s plus tard, l'agent envoie la fenêtre au panel, limitée aux joueurs passés à moins de 300 m des personnes concernées. Le staff en jeu (`add_ace group.admin fiverax.staff allow`) est prévenu dans le chat, et le webhook d'alertes de l'anticheat reçoit le report. Un report toutes les 2 min par joueur.
- **Captures** : « Capturer maintenant » (autour d'un joueur ou de tout le serveur) et, automatiquement, chaque kick ou ban de l'anticheat (3 dernières minutes).
- **Replay** : carte avec lecture, vitesse ×1 à ×8, trajets, tirs (traits), morts (croix), détections, qui parle ; chronologie cliquable (tirs regroupés, armes nommées) ; distances entre les personnes concernées. Prise en charge, clôture avec une décision et une réponse au joueur, ban direct du signalé.
- Les replays sont gardés 30 jours (gzip), les reports restent. `set fiverax_blackbox 0` désactive la boîte noire et `/report`.

## Espace joueur
`/joueur` : un joueur se connecte avec Discord et voit, sur chaque serveur où son Discord est relié à FiveM, son temps de jeu, ses sessions, ses bans (raison, durée), ses `/report` et la réponse du staff, ses votes et leurs récompenses. Jamais ses identifiants, son IP, les détections ni les notes du staff.
- **Contester un ban** : une contestation à la fois par ban, 7 jours d'attente après un refus. Le staff la traite dans Reports & replays > Contestations de ban (permission « Bannir ») : accepter lève le ban, la réponse est lue par le joueur. Le webhook d'alertes reçoit chaque contestation.

## Annuaire public
`/annuaire` liste les serveurs qui utilisent Fiverax : c'est une vitrine pour eux et un canal d'acquisition pour Fiverax (appels « Référencer mon serveur » sur chaque page, comptés).
- **Fiche** (menu Réseau Fiverax > Fiche annuaire, permission « Gérer la fiche du serveur dans l'annuaire public ») : nom, adresse `/annuaire/<slug>`, accroche, présentation, logo, bannière, galerie, connexion FiveM (`cfx.re/join/…` ou `ip:port`), Discord, site, étiquettes, framework, langue, âge minimum. Aperçu avant publication ; publiable dès qu'il y a une accroche, une présentation et une connexion ou un Discord.
- **En direct** : joueurs connectés (agent), joueurs différents sur 7 jours ; masquable.
- **Avis vérifiés** : connexion Discord, au moins 1 h de jeu sur le serveur d'après les sessions de l'agent (compte Discord lié en jeu), jamais par le staff du serveur. Un avis par compte (modifiable), réponse publique du serveur. 3 signalements de comptes différents masquent l'avis jusqu'à la modération des admins de la plateforme (même page).
- **Mise en avant** : créneaux « À la une » posés par les admins de la plateforme (`PANEL_OWNER_IDS`) pour l'instant ; le paiement viendra plus tard (`directory_featured.source`).
- **Votes** : un vote par compte Discord et par serveur toutes les 2 h (la même règle pour tous, pour un classement juste), comptes Discord de plus de 30 jours, une seule adresse réseau par fenêtre (gardée hachée). Les votes du mois classent l'annuaire (« Top votes ») et comptent dans la pertinence.
- **Récompenses de vote** (Fiche annuaire > Récompenses de vote) : jusqu'à 3 lignes argent (liquide, banque, argent sale) ou objets, données en jeu par l'agent 3.7 au joueur dont le Discord est relié à FiveM, une minute après sa connexion s'il n'était pas en jeu (attente maximale 7 jours). Un échec avant tout don est retenté (5 fois), un don n'est jamais refait.
- **Statistiques** (30 jours) : vues de la fiche, clics Rejoindre, Discord, boutique, site. Données structurées (note moyenne) et `sitemap.xml` pour le référencement.

## Qui voit quoi
- **N'importe qui** se connecte avec Discord et **ajoute son serveur** : seulement un serveur Discord où il est propriétaire, administrateur ou a « Gérer le serveur » (limite `MAX_SERVERS_PER_USER`, 5 par défaut). Il en devient propriétaire et la page Configuration le guide (bot, rôles, équipe, FiveM).
- **Administrateurs de la plateforme** (`PANEL_OWNER_IDS` dans `site/.env`, facultatif) : tous les serveurs, tous les droits, sans limite, ajout manuel de n'importe quel serveur Discord.
- **Propriétaires d'un serveur** (le créateur, puis ceux qu'il ajoute) : tous les droits sur ce serveur, ses pages « Configuration » et « Accès & rôles », et peuvent le supprimer (avec toutes ses données).
- **Accès & permissions** (personnes ou rôles Discord) : définis séparément pour chaque serveur.

## Migration depuis la version mono-serveur
Automatique au premier démarrage (migration `013_multi_server`) : toutes les données existantes passent dans le serveur `default`, relié au `DISCORD_GUILD_ID` de l'ancien `.env`. L'ancien `FIVEM_AGENT_TOKEN`, `GRADE_ROLE_MAPPING_JSON` et `DISCORD_STAFF_ROLE_IDS` continuent de fonctionner, **pour ce serveur uniquement**.
Le site et le bot doivent être mis à jour **ensemble** (le format des messages du bot a changé).

## Mise en route locale
```bash
cd site && npm install && npm run dev      # http://localhost:3000
cd bot  && npm install && npm start        # dans un second terminal
```
Voir `site/README.md` et `bot/README.md` pour la configuration détaillée.

## Si le site est arrêté
Le bot réessaie (3 tentatives par message). Les événements vocaux perdus sont rattrapés par la synchronisation complète suivante (au maximum 30 min d'écart), et au redémarrage du bot tout est resynchronisé.
