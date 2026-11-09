fx_version 'cerulean'
game 'gta5'
lua54 'yes'

name 'fiverax_agent'
description 'Fiverax : relie ce serveur FiveM au panel (joueurs en direct, carte, vocal, actions, console, ressources, anticheat, bans, déploiement du Studio IA, audit, assistant IA, boîte noire et /report, récompenses de vote)'
version '3.8.0'

server_scripts {
    'server.lua',
    'anticheat.lua',
    'game.lua',
    'blackbox.lua',
    'audit.js',
    'files.js'
}
client_script 'client.lua'
