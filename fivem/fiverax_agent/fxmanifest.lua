fx_version 'cerulean'
game 'gta5'
lua54 'yes'

name 'fiverax_agent'
description 'Fiverax : relie ce serveur FiveM au panel (joueurs en direct, carte, vocal, actions, console, ressources, anticheat, bans, déploiement du Studio IA, audit)'
version '3.3.0'

server_scripts {
    'server.lua',
    'anticheat.lua',
    'audit.js'
}
client_script 'client.lua'
