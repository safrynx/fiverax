# Bot du Dashboard FiveM

Bot Discord du panel. **Un seul bot pour tous les serveurs** : il surveille les serveurs Discord enregistrés sur le site (liste relue toutes les 5 min) et ignore les autres. Il ne stocke rien : il envoie au site (projet `site/`) ce qu'il voit.
Pour ajouter un serveur : le créer dans le panel, puis inviter le bot sur le serveur Discord (lien dans « Configuration »). Pas besoin de redémarrer le bot.

## Ce qu'il fait
- **Synchronisation complète** de chaque serveur au démarrage puis toutes les 30 min (et dès qu'un nouveau serveur est enregistré) : rôles (noms + hiérarchie), tous les membres et leurs rôles, qui est en vocal.
- **Événements en direct** : arrivée / départ / changement de rôles d'un membre, entrée / changement / sortie de vocal.
- **Signal de vie** toutes les 30 s (le site affiche « bot hors ligne » sinon) et **tick** toutes les 10 min (tâches planifiées du site). La réponse au signal de vie donne aussi le **statut et l'activité** choisis dans `/admin/bot` (« Regarde 12 serveurs FiveM »…), appliqués dès qu'ils changent. Le nom, l'avatar, la bannière et la bio du bot (partout, ou par serveur) sont changés directement par le site.
- À l'arrêt propre (Ctrl+C / SIGTERM) : demande au site de fermer les sessions vocales ouvertes.
- **Anti-raid** de chaque serveur, avec les réglages faits dans le panel (Sécurité > Anti-raid), relus à chaque signal de vie : règles avec tolérance, sanction et annulation propres à chaque règle, personnes et rôles de confiance, rôle mentionné dans le salon d'alerte, MP à la personne sanctionnée, raids de comptes (verrouillage, arrivants expulsés / bannis / laissés), comptes trop récents, protection des messages (flood, mentions, arnaques, sites autorisés, mots interdits). **Mettre à jour le bot en même temps que le site** : un ancien bot ignore les nouveaux réglages.

## Configuration (`.env`, voir `.env.example`)
| Variable | Description |
|---|---|
| `DISCORD_BOT_TOKEN` | Token du bot |
| `FIVEM_DATABASES_JSON` | Facultatif : base MySQL du jeu par serveur Discord, pour le temps de jeu (voir `.env.example`) |
| `DISCORD_GUILD_ID` + `FIVEM_DB_*` | Facultatif, ancienne config mono-serveur du temps de jeu |
| `SITE_URL` | URL publique du site, sans `/` final (ex. `https://staff.mondomaine.fr`) |
| `BOT_API_TOKEN` | Secret partagé, **identique** à celui du `.env` du site |
| `BOT_MESSAGE_CONTENT` | `1` pour lire le contenu des messages : nécessaire aux protections invitations, liens, arnaques, mots interdits et raids de messages de l'anti-raid. Active aussi l'intent **Message Content** dans le portail développeur (au-delà de 100 serveurs, Discord demande une vérification du bot) |

Dans le portail développeur Discord, active les intents privilégiés **Server Members** et **Voice States**.
Le rôle du bot doit être **au-dessus** des rôles de grade (le site s'en sert pour les Up / Down / Recrutements).

## Lancer
```bash
npm install
npm start          # ou : npm run dev (redémarre à chaque modification)
npm test           # tests du client API
```
Node 20.6+ requis. Sur un hébergeur, la commande de démarrage est `npm start` avec les variables d'environnement ci-dessus
(si le `.env` n'est pas utilisé, retire `--env-file=.env` du script `start` dans `package.json`).
