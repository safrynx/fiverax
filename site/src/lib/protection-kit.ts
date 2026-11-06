import type { StudioFile } from "./studio-shared";
import type { KitKey } from "./protection-shared";

/**
 * Protection kit: small, readable FiveM resources Fiverax hands to a server (Studio creation, deploy or .zip).
 * Written by hand and fixed (no AI): server-side only, no HTTP except the Discord webhook relay, standalone (any
 * framework). Each one passes the scanner's rules and the Studio checks (tested in core.test.ts).
 */

const manifest = (name: string, description: string) => `fx_version 'cerulean'
game 'gta5'
lua54 'yes'

name '${name}'
author 'Fiverax'
description '${description}'
version '1.0.0'

server_script 'server.lua'
`;

const EVENT_GUARD = `-- fvx_event_guard · kit de protection Fiverax
-- Vérifications à appeler au début d'un événement serveur, AVANT de donner quoi que ce soit au joueur.
--
--   RegisterNetEvent('shop:buy', function(item, count)
--       local src = source
--       if not exports.fvx_event_guard:check(src, 'shop:buy', {
--           cooldown = 1000,                          -- 1 appel par seconde au maximum
--           perMinute = 20,                           -- et 20 par minute
--           coords = vector3(25.7, -1347.3, 29.5),    -- le joueur doit être près du magasin
--           maxDistance = 10.0,
--           amount = count, min = 1, max = 50         -- quantité entière entre 1 et 50
--       }) then return end
--       -- le prix vient de TA config côté serveur, jamais des paramètres envoyés par le client
--   end)
--
-- Chaque refus est écrit dans la console et déclenche l'événement serveur 'fvx_event_guard:blocked' (src, nom, raison).
--   set fvx_guard_log 0    pas de message dans la console
--   set fvx_guard_kick 3   kick après 3 refus en une minute (0 : jamais, par défaut)

local players = {}
local LOG = GetConvarInt('fvx_guard_log', 1) == 1
local KICK_AT = GetConvarInt('fvx_guard_kick', 0)

local function stateOf(src)
    local s = players[src]
    if not s then
        s = { last = {}, window = {}, refused = {} }
        players[src] = s
    end
    return s
end

local function refuse(src, name, why)
    local s = stateOf(src)
    local now = GetGameTimer()
    local kept = {}
    for _, t in ipairs(s.refused) do
        if now - t < 60000 then kept[#kept + 1] = t end
    end
    kept[#kept + 1] = now
    s.refused = kept
    if LOG then
        print(('^3[fvx_event_guard]^7 %s (id %s) bloqué sur %s : %s'):format(GetPlayerName(src) or '?', src, name, why))
    end
    TriggerEvent('fvx_event_guard:blocked', src, name, why)
    if KICK_AT > 0 and #kept >= KICK_AT then
        DropPlayer(tostring(src), "Trop d'actions refusées par la protection du serveur.")
    end
    return false
end

local function check(src, name, opts)
    src = tonumber(src)
    name = tostring(name or '?')
    if not src or src <= 0 or not GetPlayerName(src) then return false end
    if type(opts) ~= 'table' then opts = {} end
    local s = stateOf(src)
    local now = GetGameTimer()

    if opts.cooldown and s.last[name] and now - s.last[name] < opts.cooldown then
        return refuse(src, name, 'trop rapide')
    end
    if opts.perMinute then
        local w = s.window[name]
        if not w or now - w.start >= 60000 then
            w = { start = now, count = 0 }
            s.window[name] = w
        end
        w.count = w.count + 1
        if w.count > opts.perMinute then return refuse(src, name, "trop d'appels par minute") end
    end
    if opts.coords and opts.maxDistance then
        local ped = GetPlayerPed(src)
        if not ped or ped == 0 then return refuse(src, name, 'joueur introuvable') end
        local c = opts.coords
        local target = vector3(c.x or c[1] or 0.0, c.y or c[2] or 0.0, c.z or c[3] or 0.0)
        if #(GetEntityCoords(ped) - target) > opts.maxDistance then return refuse(src, name, 'trop loin') end
    end
    if opts.amount ~= nil then
        local a = tonumber(opts.amount)
        if not a or a ~= a or a == math.huge or a == -math.huge then return refuse(src, name, 'montant invalide') end
        if opts.integer ~= false and math.floor(a) ~= a then return refuse(src, name, 'montant non entier') end
        if a < (opts.min or 0) or a > (opts.max or 1000000) then return refuse(src, name, 'montant hors limites') end
    end
    s.last[name] = now
    return true
end

exports('check', check)

AddEventHandler('playerDropped', function()
    players[source] = nil
end)
`;

const WEBHOOKS = `-- fvx_webhooks · kit de protection Fiverax
-- Les webhooks Discord restent dans server.cfg, jamais dans un fichier envoyé aux joueurs :
--   set fvx_webhook_logs "<url du webhook>"
--   set fvx_webhook_reports "<url du webhook>"
--   set fvx_webhooks_client "reports"     -- salons utilisables depuis un script client (séparés par des virgules)
--
-- Côté serveur :  exports.fvx_webhooks:send('logs', 'Texte')   ou   exports.fvx_webhooks:send('logs', { embeds = { ... } })
-- Côté client  :  TriggerServerEvent('fvx_webhooks:client', 'reports', 'Texte')
--                 (le nom et l'id du joueur sont ajoutés, 1 message toutes les 10 s, jamais de mention @everyone)

local HOSTS = { 'discord.com', 'discordapp.com', 'ptb.discord.com', 'canary.discord.com' }
local queue = {}
local lastClient = {}

local function urlOf(channel)
    if type(channel) ~= 'string' or not channel:match('^[%w_%-]+$') then return nil end
    local url = GetConvar('fvx_webhook_' .. channel, '')
    for _, host in ipairs(HOSTS) do
        local prefix = 'https://' .. host .. '/api/webhooks/'
        if url:sub(1, #prefix) == prefix and url:sub(#prefix + 1):match('^%d+/[%w_%-]+$') then return url end
    end
    return nil
end

local function send(channel, payload)
    local url = urlOf(channel)
    if not url then
        print(('^1[fvx_webhooks]^7 salon « %s » inconnu : ajoute set fvx_webhook_%s "<url>" dans server.cfg'):format(tostring(channel), tostring(channel)))
        return false
    end
    if type(payload) ~= 'table' then payload = { content = tostring(payload) } end
    if payload.content then payload.content = tostring(payload.content):sub(1, 2000) end
    payload.allowed_mentions = { parse = {} }
    if #queue >= 200 then return false end
    queue[#queue + 1] = { url = url, body = json.encode(payload) }
    return true
end

exports('send', send)

-- Discord limite chaque webhook : les messages partent un par un.
CreateThread(function()
    while true do
        local item = table.remove(queue, 1)
        if item then
            PerformHttpRequest(item.url, function(status)
                if status == 429 then print('^3[fvx_webhooks]^7 Discord limite les envois : message perdu.') end
            end, 'POST', item.body, { ['Content-Type'] = 'application/json' })
            Wait(700)
        else
            Wait(250)
        end
    end
end)

local allowed = {}
for name in GetConvar('fvx_webhooks_client', ''):gmatch('[^,%s]+') do allowed[name] = true end

RegisterNetEvent('fvx_webhooks:client', function(channel, text)
    local src = source
    if type(channel) ~= 'string' or not allowed[channel] then return end
    local now = GetGameTimer()
    if lastClient[src] and now - lastClient[src] < 10000 then return end
    lastClient[src] = now
    local clean = tostring(text or ''):gsub('%c', ' '):sub(1, 1500)
    if #clean < 2 then return end
    local who = (GetPlayerName(src) or '?'):gsub('[%*_~|]', '')
    send(channel, { content = ('**%s** (id %d) : %s'):format(who, src, clean) })
end)

AddEventHandler('playerDropped', function()
    lastClient[source] = nil
end)
`;

const JOIN_GUARD = `-- fvx_join_guard · kit de protection Fiverax
-- Anti-flood de connexion et pseudos piégés. À démarrer tôt dans server.cfg (ensure fvx_join_guard).
--   set fvx_join_per_ip_minute 6   tentatives de connexion par adresse et par minute
--   set fvx_join_burst_10s 40      connexions acceptées en 10 s pour tout le serveur (au-delà : « réessaie »)
--   set fvx_join_block_html 1      refuse les pseudos contenant du HTML (< >), utilisés pour injecter du code
--                                  dans le chat, le scoreboard et les menus NUI

local PER_IP = GetConvarInt('fvx_join_per_ip_minute', 6)
local BURST = GetConvarInt('fvx_join_burst_10s', 40)
local BLOCK_HTML = GetConvarInt('fvx_join_block_html', 1) == 1
local byAddress = {}
local recent = {}

local function prune(list, now, window)
    local kept = {}
    for _, t in ipairs(list) do
        if now - t < window then kept[#kept + 1] = t end
    end
    return kept
end

local function addressOf(src)
    local ip = GetPlayerIdentifierByType(src, 'ip')
    if ip and ip ~= '' then return ip end
    local endpoint = GetPlayerEndpoint(src)
    if endpoint and endpoint ~= '' then return endpoint end
    return 'id:' .. tostring(src)
end

AddEventHandler('playerConnecting', function(name, setKickReason, deferrals)
    local src = source
    deferrals.defer()
    Wait(0)
    local now = GetGameTimer()
    local pseudo = tostring(name or '')

    if BLOCK_HTML and (pseudo:find('[<>]') or pseudo:lower():find('javascript:', 1, true)) then
        deferrals.done('Ton pseudo contient des caractères interdits (< ou >). Change-le dans les paramètres de FiveM puis reconnecte-toi.')
        return
    end
    local visible = pseudo:gsub('%s', '')
    if #visible < 2 then
        deferrals.done('Ton pseudo est vide ou trop court.')
        return
    end

    local key = addressOf(src)
    local tries = prune(byAddress[key] or {}, now, 60000)
    tries[#tries + 1] = now
    byAddress[key] = tries
    if #tries > PER_IP then
        deferrals.done('Trop de tentatives de connexion. Réessaie dans une minute.')
        return
    end

    recent = prune(recent, now, 10000)
    if #recent >= BURST then
        deferrals.done('Le serveur reçoit beaucoup de connexions en même temps. Réessaie dans quelques secondes.')
        return
    end
    recent[#recent + 1] = now
    deferrals.done()
end)

-- Ménage : les adresses sans tentative récente sont oubliées.
CreateThread(function()
    while true do
        Wait(300000)
        local now = GetGameTimer()
        for key, list in pairs(byAddress) do
            if #prune(list, now, 60000) == 0 then byAddress[key] = nil end
        end
    end
end)
`;

const readme = (title: string, body: string) => `# ${title}\n\nRessource du kit de protection Fiverax. Gratuite, sans dépendance, compatible Standalone / ESX / QBCore / Qbox.\n\n${body}\n`;

export const KIT_FILES: Record<KitKey, { name: string; files: StudioFile[] }> = {
  fvx_event_guard: {
    name: "Garde des événements (kit Fiverax)",
    files: [
      { path: "fxmanifest.lua", content: manifest("fvx_event_guard", "Fiverax : protection des événements serveur (anti-spam, distance, montants)") },
      { path: "server.lua", content: EVENT_GUARD },
      { path: "README.md", content: readme("fvx_event_guard", "1. `ensure fvx_event_guard` dans server.cfg, avant tes scripts.\n2. Au début de chaque événement qui donne de l'argent, un objet ou un job : `if not exports.fvx_event_guard:check(source, 'nom', { cooldown = 1000, coords = ..., maxDistance = 10.0 }) then return end`.\n3. Le prix et la récompense viennent de ta config serveur, jamais des paramètres de l'événement.") }
    ]
  },
  fvx_webhooks: {
    name: "Relais de webhooks (kit Fiverax)",
    files: [
      { path: "fxmanifest.lua", content: manifest("fvx_webhooks", "Fiverax : webhooks Discord gardés côté serveur") },
      { path: "server.lua", content: WEBHOOKS },
      { path: "README.md", content: readme("fvx_webhooks", "1. Révoque les webhooks trouvés par le scanner (Discord > Intégrations) et crée-en de nouveaux.\n2. Range-les dans server.cfg : `set fvx_webhook_logs \"<url>\"`.\n3. Remplace chaque appel direct par `exports.fvx_webhooks:send('logs', ...)` côté serveur, ou `TriggerServerEvent('fvx_webhooks:client', 'reports', texte)` côté client (salon listé dans `fvx_webhooks_client`).") }
    ]
  },
  fvx_join_guard: {
    name: "Anti-flood de connexion (kit Fiverax)",
    files: [
      { path: "fxmanifest.lua", content: manifest("fvx_join_guard", "Fiverax : anti-flood de connexion et pseudos piégés") },
      { path: "server.lua", content: JOIN_GUARD },
      { path: "README.md", content: readme("fvx_join_guard", "1. `ensure fvx_join_guard` tout en haut de tes ensure.\n2. Réglages facultatifs : `set fvx_join_per_ip_minute 6`, `set fvx_join_burst_10s 40`, `set fvx_join_block_html 1`.") }
    ]
  }
};
