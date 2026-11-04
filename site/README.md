# Dashboard FiveM — site

Panel multi-serveurs : connexion Discord, rôles/grades, temps vocal Discord, temps FiveM, pastilles, notes et historique des grades — pour chaque serveur enregistré.

## Serveurs
- Page d'accueil `/` : les serveurs accessibles, et **« Ajouter un serveur »** : la liste des serveurs Discord de l'utilisateur où il a « Gérer le serveur » (lue à la connexion, table `user_guilds`). Il en devient propriétaire. Limite `MAX_SERVERS_PER_USER` (5). Les administrateurs de la plateforme (`PANEL_OWNER_IDS`, facultatif) ne sont pas limités et peuvent ajouter un serveur par son ID.
- Une carte « Mise en route » guide les propriétaires (serveur Discord, bot, rôles de grade, équipe, FiveM) jusqu'à ce que tout soit prêt. Un propriétaire peut supprimer son serveur (Configuration > Zone dangereuse, en tapant son nom).
- Chaque serveur vit sous `/s/<id>` (`/s/<id>/staff`, `/report`, `/logs`, `/admin`), ses API sous `/api/s/<id>/…`.
- Dans « Configuration » d'un serveur : nom, serveur Discord, fuseau horaire et heure du bilan IA, **token de l'agent FiveM** (affiché une seule fois, seul son hash est stocké), lien d'invitation du bot.
- Mise à jour depuis la version mono-serveur : automatique, les données existantes deviennent le serveur `default` (voir le README racine).

## Prérequis
- Node.js 20+
- Une application Discord avec un bot (intents **Server Members** et **Voice States** activés dans le portail développeur)
- Un disque persistant pour SQLite (`data/`)

## Démarrage
```bash
npm install
cp .env.example .env        # puis remplir les valeurs
npm run dev                 # panel sur http://localhost:3000
```
Le **bot Discord est un projet séparé** (`../bot`) qui parle au site avec `BOT_API_TOKEN` (même valeur dans les deux `.env`).
Sans lui le site fonctionne, mais sans synchronisation des membres ni suivi du vocal.

## Configuration Discord
- **Redirect URI** du portail développeur = `DISCORD_REDIRECT_URI` (ex. `http://localhost:3000/api/auth/discord/callback`).
- Le login demande les scopes `identify guilds` : la liste des serveurs Discord de l'utilisateur, puis le bot lit ses rôles sur les serveurs enregistrés dont il est membre.
- `DISCORD_STAFF_ROLE_IDS` et `GRADE_ROLE_MAPPING_JSON` ne concernent que le serveur `default` (héritage) ; les autres se configurent dans leur page « Accès & rôles ».
- `GRADE_ROLE_MAPPING_JSON` : `{"Helper":{"roleId":"123","level":1},"Moderator":{"roleId":"456","level":2}}`.
  Sans mapping, personne ne peut changer de grade et les nouveaux membres sont mis en « Helper ».
- Le rôle du bot doit être **au-dessus** des rôles de grade dans la hiérarchie du serveur.

## FiveM
- Générer le token du serveur dans « Configuration » > Agent FiveM : le panel affiche les lignes à coller dans `server.cfg` (`gtasun_staff_api_url` et `gtasun_staff_api_token`). L'ancien `FIVEM_AGENT_TOKEN` partagé reste valable pour le serveur `default`.
- Installer la ressource `fivem/gtasun_staff_agent` (`ensure gtasun_staff_agent`).

## Accès au panel
- Accès = propriétaires (`PANEL_OWNER_IDS` dans `.env`) + personnes + rôles listés dans la page **Accès & rôles** (réservée aux propriétaires). Au premier lancement, la liste contient les 2 rôles et 2 personnes initiaux.
- Sur cette page, le propriétaire choisit aussi les **rôles de grade** (la hiérarchie vient de la position des rôles dans Discord : plus haut = grade plus élevé) et les **rôles Avert 1/2/3** (détectés par leur nom sinon). Cliquer « Actualiser depuis Discord » après avoir créé/déplacé un rôle.
- `GRADE_ROLE_MAPPING_JSON`, s'il est rempli, remplace la liste de grades de la page.

## Temps de jeu (base MySQL du serveur FiveM)
Renseigner `FIVEM_DB_URL` (+ `FIVEM_DB_TABLE`, `FIVEM_DB_DISCORD_COLUMN`, `FIVEM_DB_PLAYTIME_COLUMN`, `FIVEM_DB_PLAYTIME_UNIT`). La colonne est un total cumulé : les chiffres par semaine/période sont calculés par différence entre des relevés pris toutes les 30 min (lors des `tick` du bot ou des consultations du panel). Les périodes ne sont donc exactes qu'à partir du premier relevé. Sans `FIVEM_DB_URL`, le panel utilise l'agent FiveM.

## Rangs, avertissements, bilan
- Fiche membre : Uprank / Derank (grade voisin dans la hiérarchie), Demote (retire tous les rôles de grade/staff), ou choix d'un grade. Le rôle Discord est modifié d'abord.
- Avertissements : ajout/retrait avec raison ; le rôle Avert N remplace le précédent (max 3) ; historique conservé.
- Bilan hebdo (`/report`, `/api/report?week=0&format=json|text|csv`) : staff triés par grade, copiable pour Discord ou en CSV.

## Permissions
- Toutes les pages et API exigent une session valide **et** un rôle staff (revérifié à chaque requête depuis la base synchronisée par le bot).
- Grades et avertissements : uniquement sur un membre de niveau strictement inférieur au sien, vers un niveau strictement inférieur au sien, jamais sur soi-même. Les propriétaires ne sont pas limités par le niveau (mais pas sur eux-mêmes). Le rôle Discord est modifié d'abord ; en cas d'échec Discord, rien n'est changé dans le panel.

## Structure
- `src/app` : `/` (serveurs), `/login`, `/s/[serverId]/…` (pages d'un serveur) ; API `/api/auth/*`, `/api/servers`, `/api/s/[serverId]/*` (`staff`, `admin`, `access`, `recruit`, `report`, `review`, `reset`, `sync`), `/api/fivem`, `/api/health`
- `src/lib` : `servers` (serveurs, propriétaires, tokens FiveM), config par serveur, auth/session, base + migrations, sync, voix, FiveM
- `src/app/api/bot/*` : API réservée au bot (`servers`, `sync`, `member`, `voice`, `heartbeat`, `playtime`, `tick`, `shutdown`), authentifiée par `BOT_API_TOKEN`
- `../fivem/gtasun_staff_agent` : ressource FiveM (à installer sur le serveur FiveM)

## Boutique Tebex
Section « Boutique Tebex » de chaque serveur, reliée uniquement à Tebex. Permissions : `shop_view` (voir), `shop_manage` (paiements, catalogue, bans boutique), `shop_promos` (codes promo, cartes cadeaux) ; les réglages sont réservés aux propriétaires.
- **Réglages boutique** : clé secrète du serveur de jeu Tebex (vérifiée auprès de Tebex, stockée chiffrée AES-256-GCM), token public (catalogue, API Headless), adresse du webhook à coller dans Tebex > Developers > Webhooks avec son secret, alertes Discord (ventes / problèmes).
- **Ventes** : CA 30 j / 7 j, panier moyen, remboursements et litiges, CA par jour, meilleures ventes, objectifs communautaires, soldes, flux des webhooks (filtrable). Calculé depuis les webhooks reçus (`tebex_events`, gardés 1 an, sans e-mail ni IP).
- **Paiements** : liste paginée (Plugin API), fiche avec notes, statut (remboursé / chargeback / payé), paiement manuel (donner des packages).
- **Catalogue** : catégories et packages ; renommer, changer le prix, retirer / remettre en vente, lien d'achat direct pour un joueur.
- **Promotions** : codes promo (création, suppression) et cartes cadeaux (création, recharge, annulation, vérification).
- **Clients** : recherche par pseudo / ID Cfx.re (total dépensé, taux de chargeback, paiements, packages actifs), bans du webstore, file des commandes en attente (lecture seule : la ressource Tebex officielle du serveur FiveM livre les achats).
- **Store Creator** (permission `store_edit`) : la boutique publique du serveur, `/store/<adresse>`. Deux modes sur le même modèle : des blocs (15 types, 6 thèmes, aperçu ordinateur / mobile) ou l'IA, qui reçoit le catalogue et renvoie un design JSON, jamais du code. Le brouillon s'enregistre tout seul, « Publier » le met en ligne, l'Historique garde les 40 dernières versions. La page lit le catalogue (token public), les objectifs (clé secrète), les derniers achats (webhooks) et les joueurs en ligne (agent). Paiement par l'API Headless : panier Tebex, connexion Cfx.re, codes, puis la fenêtre de paiement Tebex.js. Les prix viennent toujours de Tebex, le design ne garde que des IDs ; liens https uniquement, aucun HTML injecté. `/store/<adresse>?draft=1` montre le brouillon à l'équipe.
- Un acheteur est relié à sa fiche joueur par son compte Cfx.re (identifiant `fivem:`) ; ses achats apparaissent sur sa fiche. Toutes les actions vont dans les Logs (groupe « Boutique »).

## Vérifications
```bash
npm run typecheck
npm test
npm run build
```

## Notes
- Le temps vocal n'est comptabilisé qu'à partir du démarrage du bot (Discord n'expose pas l'historique).
- SQLite : une seule instance de l'app avec disque persistant et sauvegardes.
- Ne jamais exposer `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_SECRET` ni `FIVEM_AGENT_TOKEN` côté navigateur.

## Recruter et reset des compteurs
- **Recruter** (page Staff) : recherche un membre du serveur par pseudo ou ID, choisis son grade de départ (par défaut le plus bas, jamais au-dessus du tien) ; le bot lui donne le rôle de grade et le rôle staff. Permission « Recruter du staff ».
- **Reset compteurs** (page Staff) : temps vocal et temps de jeu repartent de zéro à l'instant du reset, après confirmation en tapant RESET. Rien n'est supprimé : l'historique, les avertissements, les commentaires et les bilans hebdo restent. Permission « Reset des compteurs ».
