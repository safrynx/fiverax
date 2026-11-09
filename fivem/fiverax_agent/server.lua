-- Fiverax agent: links this FiveM server to its panel.
--
-- Every few seconds the agent calls the panel (POST <fiverax_url>/api/fivem/agent) with what happened since the
-- previous call (players joining / leaving, anticheat detections, console lines, results of actions) and, now and
-- then, a snapshot of the server (players with their position and voice, resources). The answer holds the actions
-- queued from the panel, the delay before the next call and, when they changed, the anticheat settings and the bans.
-- The agent always opens the connection: no port to open.
--
-- server.cfg:
--   set fiverax_url "https://ton-panel.example"
--   set fiverax_token "fvm_..."                       # token of this server (panel > Configuration)
--   add_ace resource.fiverax_agent command allow      # needed for console commands and resources
--   add_ace group.admin fiverax.bypass allow          # staff never flagged by the anticheat
--   set fiverax_console 0                             # optional: refuse console commands from the panel
--   set fiverax_deploy 0                              # optional: refuse Studio deployments from the panel
--   set fiverax_audit_code 0                          # optional: audit without ever sending code (see audit.js)
--   set fiverax_game 0                                # optional: the AI assistant may not give money / items / jobs (game.lua)
--   set fiverax_files 1                               # optional: the AI assistant may read but not change files (0: neither)
--   ensure screenshot-basic                           # optional: screenshots analysed by the AI
--   add_ace group.admin fiverax.staff allow           # optional: receive the /report of the players in game (blackbox.lua)
--   ensure fiverax_agent

local VERSION = '3.8.0'
local RESOURCE = GetCurrentResourceName()

-- The 1.x convars (gtasun_staff_api_url pointed at /api/fivem) still work.
local function baseUrl()
    local url = GetConvar('fiverax_url', '')
    if url == '' then url = GetConvar('gtasun_staff_api_url', ''):gsub('/api/fivem/?$', '') end
    return (url:gsub('/+$', ''))
end

local URL = baseUrl()
local TOKEN = GetConvar('fiverax_token', '')
if TOKEN == '' then TOKEN = GetConvar('gtasun_staff_api_token', '') end
local ALLOW_CONSOLE = GetConvarInt('fiverax_console', 1) == 1
local ALLOW_DEPLOY = GetConvarInt('fiverax_deploy', 1) == 1
local HEADERS = { ['Content-Type'] = 'application/json', ['Authorization'] = 'Bearer ' .. TOKEN }

local STATE_EVERY = 15   -- seconds between two snapshots when nothing changed (and nobody watches)
local MAX_EVENTS = 300
local MAX_CONSOLE = 500
local BANS_FILE = 'bans_cache.json'

-- Shared with anticheat.lua (same Lua state).
FVX = {
    sessions = {},       -- [server id] = session id
    joinedAt = {},       -- [server id] = os.time() of the join
    client = {},         -- [server id] = { zone, vehicle } reported by the client module
    settings = nil,      -- anticheat settings from the panel (nil until loaded)
    network = nil,       -- Fiverax network mode ({ mode = 'off' | 'alert' | 'block' }, nil: not a member)
    secRev = 0,
    url = URL,
    headers = HEADERS
}

local events = {}
local consoleLines = {}
local results = {}
local dirty = true
local lastState = 0
local interval = 8
local watched = false
local booted = false
local warnedAuth = false
local bansByIdentifier, bansByToken = {}, {}

local function stripColors(text)
    return (text:gsub('%^%d', ''))
end

function FVX.pushEvent(event)
    if #events >= MAX_EVENTS then table.remove(events, 1) end
    events[#events + 1] = event
end

function FVX.identifiers(src)
    local out = {}
    for _, id in ipairs(GetPlayerIdentifiers(src)) do
        if id:sub(1, 3) ~= 'ip:' then out[#out + 1] = id end
    end
    return out
end

function FVX.tokens(src)
    local out = {}
    for i = 0, (GetNumPlayerTokens(src) or 0) - 1 do
        local token = GetPlayerToken(src, i)
        if token then out[#out + 1] = token end
    end
    return out
end

local function playerJoined(src)
    if FVX.sessions[src] then return end
    local session = ('%d-%d-%d'):format(src, os.time(), math.random(100000, 999999))
    FVX.sessions[src] = session
    FVX.joinedAt[src] = os.time()
    FVX.pushEvent({ type = 'join', session = session, name = GetPlayerName(src) or '?', identifiers = FVX.identifiers(src), tokens = FVX.tokens(src), timestamp = os.time() })
    dirty = true
end

local function playerLeft(src, reason)
    local session = FVX.sessions[src]
    FVX.client[src] = nil
    if not session then return end
    FVX.sessions[src], FVX.joinedAt[src] = nil, nil
    FVX.pushEvent({ type = 'leave', session = session, reason = reason and tostring(reason):sub(1, 200) or nil, timestamp = os.time() })
    dirty = true
end

AddEventHandler('playerJoining', function() playerJoined(source) end)
AddEventHandler('playerDropped', function(reason) playerLeft(source, reason) end)
AddEventHandler('onResourceStart', function() dirty = true end)
AddEventHandler('onResourceStop', function() dirty = true end)

RegisterConsoleListener(function(channel, message)
    message = stripColors(message or ''):gsub('%s+$', '')
    if message == '' then return end
    if #consoleLines >= MAX_CONSOLE then table.remove(consoleLines, 1) end
    consoleLines[#consoleLines + 1] = { channel = channel and channel:sub(1, 60) or nil, message = message:sub(1, 4000) }
end)

-- ---- bans: refused at connection, from the list the panel sends (cached on disk if the panel is unreachable) ----

local function indexBans(list)
    bansByIdentifier, bansByToken = {}, {}
    for _, ban in ipairs(list or {}) do
        for _, id in ipairs(ban.ids or {}) do bansByIdentifier[id] = ban end
        for _, token in ipairs(ban.tokens or {}) do bansByToken[token] = ban end
    end
end

local function banActive(ban)
    return ban and (ban.expires == nil or ban.expires == json.null or ban.expires > os.time())
end

function FVX.findBan(src)
    for _, id in ipairs(GetPlayerIdentifiers(src)) do
        if banActive(bansByIdentifier[id]) then return bansByIdentifier[id] end
    end
    for _, token in ipairs(FVX.tokens(src)) do
        if banActive(bansByToken[token]) then return bansByToken[token] end
    end
    return nil
end

function FVX.banMessage(ban)
    local message = (FVX.settings and FVX.settings.banMessage) or 'Tu es banni de ce serveur.'
    message = message .. '\nRaison : ' .. tostring(ban.reason or '?')
    if ban.expires and ban.expires ~= json.null then message = message .. '\nFin : ' .. os.date('%d/%m/%Y %H:%M', ban.expires) end
    if ban.id then message = message .. ('\nRéférence : #%s'):format(ban.id) end
    return message
end

-- Ban right now (detection) without waiting for the panel: kept until the panel's list replaces it.
function FVX.localBan(src, reason)
    local ban = { id = nil, reason = reason, ids = FVX.identifiers(src), tokens = FVX.tokens(src) }
    for _, id in ipairs(ban.ids) do bansByIdentifier[id] = ban end
    for _, token in ipairs(ban.tokens) do bansByToken[token] = ban end
    return ban
end

-- Identifiers listed in the settings (connection.whitelist): let in while the server is locked, never checked.
function FVX.whitelisted(src)
    local list = FVX.settings and FVX.settings.connection and FVX.settings.connection.whitelist
    if not list or #list == 0 then return false end
    local set = {}
    for _, id in ipairs(list) do set[id] = true end
    for _, id in ipairs(GetPlayerIdentifiers(src)) do
        if set[id] then return true end
    end
    return false
end

local function hasIdentifier(src, prefix)
    for _, id in ipairs(GetPlayerIdentifiers(src)) do
        if id:sub(1, #prefix) == prefix then return true end
    end
    return false
end

-- Why this player may not join (nil: welcome).
local function refusal(src, name)
    local ban = FVX.findBan(src)
    if ban then return FVX.banMessage(ban), 'banni' end
    local conn = FVX.settings and FVX.settings.connection
    if not conn or FVX.whitelisted(src) then return nil end
    if conn.locked then return conn.lockMessage, 'serveur verrouillé' end
    if conn.requireDiscord and not hasIdentifier(src, 'discord:') then
        return 'Relie ton compte Discord à FiveM (Paramètres > Comptes liés) pour rejoindre ce serveur.', 'Discord manquant'
    end
    if conn.requireSteam and not hasIdentifier(src, 'steam:') then
        return 'Lance Steam avant FiveM pour rejoindre ce serveur.', 'Steam manquant'
    end
    local clean = (name or ''):gsub('%^%d', '')
    if (conn.minNameLength or 0) > 0 and #clean < conn.minNameLength then
        return ('Ton pseudo doit faire au moins %d caractères.'):format(conn.minNameLength), 'pseudo trop court'
    end
    local lower = clean:lower()
    for _, word in ipairs(conn.blockedNames or {}) do
        if word ~= '' and lower:find(word:lower(), 1, true) then return 'Ce pseudo n\'est pas autorisé sur ce serveur.', 'pseudo interdit : ' .. word end
    end
    return nil
end

-- Fiverax network, "block" mode: ask the panel whether this player is banned on enough other servers.
-- The player is let in when the panel does not answer within a few seconds (a down panel never locks the server).
local function networkRefusal(src)
    if not FVX.network or FVX.network.mode ~= 'block' or FVX.whitelisted(src) then return nil end
    local done, answer = false, nil
    PerformHttpRequest(URL .. '/api/fivem/agent/network', function(status, body)
        if done then return end
        done = true
        if status == 200 and body then
            local ok, data = pcall(json.decode, body)
            if ok and type(data) == 'table' then answer = data end
        end
    end, 'POST', json.encode({ identifiers = FVX.identifiers(src), tokens = FVX.tokens(src) }), HEADERS)
    local deadline = GetGameTimer() + 4000
    while not done and GetGameTimer() < deadline do Wait(50) end
    done = true
    if answer and answer.blocked then
        return tostring(answer.message or 'Connexion refusée par le réseau Fiverax.'), 'réseau Fiverax'
    end
    return nil
end

AddEventHandler('playerConnecting', function(name, _, deferrals)
    local src = source
    deferrals.defer()
    Wait(0)
    local message, why = refusal(src, name)
    if not message and FVX.network and FVX.network.mode == 'block' then
        deferrals.update('Vérification du réseau Fiverax…')
        message, why = networkRefusal(src)
    end
    if not message then return deferrals.done() end
    deferrals.done(message)
    local conf = FVX.settings and FVX.settings.detections and FVX.settings.detections.connection_refused
    if not conf or conf.action ~= 'off' then
        FVX.pushEvent({ type = 'refused', name = name or '?', reason = why, identifiers = FVX.identifiers(src), timestamp = os.time() })
    end
end)

local function applySecurity(security)
    FVX.secRev = security.rev or 0
    FVX.settings = security.anticheat
    FVX.network = security.network ~= json.null and security.network or nil
    indexBans(security.bans)
    SaveResourceFile(RESOURCE, BANS_FILE, json.encode(security.bans or {}), -1)
    if FVX.onSettings then FVX.onSettings(FVX.settings) end
    -- A ban added from the panel drops the player if they are in game.
    for _, id in ipairs(GetPlayers()) do
        local ban = FVX.findBan(tonumber(id))
        if ban then DropPlayer(id, FVX.banMessage(ban)) end
    end
end

-- ---- snapshot ----

local function playerState(src)
    local entry = { id = src, name = GetPlayerName(src) or '?', ping = GetPlayerPing(src), session = FVX.sessions[src] }
    local ped = GetPlayerPed(src)
    if ped and ped ~= 0 and DoesEntityExist(ped) then
        local c = GetEntityCoords(ped)
        entry.pos = { math.floor(c.x * 10) / 10, math.floor(c.y * 10) / 10, math.floor(c.z * 10) / 10 }
        entry.heading = math.floor(GetEntityHeading(ped))
        entry.health = GetEntityHealth(ped)
        entry.armour = GetPedArmour(ped)
    end
    local info = FVX.client[src]
    if info then
        entry.zone = info.zone
        entry.vehicle = info.vehicle
    end
    local state = Player(src).state
    entry.talking = state['fvx:talking'] == true
    -- pma-voice
    if type(state.radioChannel) == 'number' and state.radioChannel > 0 then entry.radio = state.radioChannel end
    if type(state.callChannel) == 'number' and state.callChannel > 0 then entry.call = state.callChannel end
    return entry
end

local function snapshot()
    local players = {}
    for _, id in ipairs(GetPlayers()) do players[#players + 1] = playerState(tonumber(id)) end
    local resources = {}
    for i = 0, GetNumResources() - 1 do
        local name = GetResourceByFindIndex(i)
        if name then resources[#resources + 1] = { name = name, state = GetResourceState(name) } end
    end
    local hostname = GetConvar('sv_projectName', '')
    if hostname == '' then hostname = GetConvar('sv_hostname', '') end
    return {
        hostname = stripColors(hostname):sub(1, 300),
        maxClients = GetConvarInt('sv_maxclients', 32),
        uptime = math.floor(GetGameTimer() / 1000),
        build = GetConvar('version', ''):sub(1, 40),
        players = players,
        resources = resources
    }
end

-- ---- screenshots (screenshot-basic), analysed by the panel's AI ----

-- cb(ok, message) once uploaded (or failed).
function FVX.screenshot(src, reason, cb)
    cb = cb or function() end
    if GetResourceState('screenshot-basic') ~= 'started' then return cb(false, 'screenshot-basic n\'est pas démarré sur ce serveur') end
    local name, session = GetPlayerName(src), FVX.sessions[src]
    if not name then return cb(false, 'Joueur déconnecté') end
    exports['screenshot-basic']:requestClientScreenshot(src, { encoding = 'jpg', quality = 0.6 }, function(err, data)
        if err or type(data) ~= 'string' then return cb(false, 'Capture impossible : ' .. tostring(err)) end
        local body = json.encode({ session = session, target = src, name = name, reason = reason, image = data })
        PerformHttpRequest(URL .. '/api/fivem/agent/screenshot', function(status)
            cb(status == 200, status == 200 and 'Capture envoyée' or ('Le panel a refusé la capture (HTTP %s)'):format(status))
        end, 'POST', body, HEADERS)
    end)
end

-- ---- live screen: frames sent while the panel watches ----

local streaming = {}

local function streamScreen(src)
    if streaming[src] then return end
    streaming[src] = true
    CreateThread(function()
        local started = os.time()
        while streaming[src] and GetPlayerName(src) and os.time() - started < 600 do
            local p = promise.new()
            exports['screenshot-basic']:requestClientScreenshot(src, { encoding = 'jpg', quality = 0.35 }, function(err, data)
                p:resolve(not err and data or nil)
            end)
            local data = Citizen.Await(p)
            if not data then break end
            local sent = promise.new()
            PerformHttpRequest(URL .. '/api/fivem/agent/frame', function(status, body)
                local ok, decoded = pcall(json.decode, body or '')
                sent:resolve(status == 200 and ok and decoded and decoded.continue == true)
            end, 'POST', json.encode({ target = src, name = GetPlayerName(src) or '?', image = data }), HEADERS)
            if not Citizen.Await(sent) then break end
            Wait(250)
        end
        streaming[src] = nil
    end)
end

AddEventHandler('playerDropped', function() streaming[source] = nil end)

-- ---- Studio: creations written to <resources>/[fiverax_studio]/<name> ----

local STUDIO_MARK = '.fiverax.json'   -- files of the last deployment: also marks the folder as the Studio's

local function studioRoot()
    local own = (GetResourcePath(RESOURCE) or ''):gsub('\\', '/')
    local parent = own:match('^(.*)/[^/]+$')
    return parent and (parent .. '/[fiverax_studio]') or nil
end

-- Paths only ever hold [%w_.-/] (checked before), so quoting them is enough.
local function makeDir(path)
    if package.config:sub(1, 1) == '\\' then
        local win = (path:gsub('/', '\\'))
        os.execute(('if not exist "%s" mkdir "%s"'):format(win, win))
    else
        os.execute(("mkdir -p '%s'"):format(path))
    end
end

local function readJson(path)
    local file = io.open(path, 'rb')
    if not file then return nil end
    local content = file:read('a')
    file:close()
    local ok, data = pcall(json.decode, content or '')
    return ok and data or nil
end

local function deploy(p)
    if not ALLOW_DEPLOY then return false, 'Déploiement désactivé sur ce serveur (fiverax_deploy 0)' end
    if not io or not os or not os.execute then return false, "Ce serveur n'autorise pas l'écriture de fichiers : télécharge le .zip depuis le panel" end
    local name = tostring(p.resource or '')
    if #name > 48 or name == RESOURCE or not name:match('^[a-z0-9][a-z0-9_%-]+$') then return false, 'Nom de ressource invalide' end
    local root = studioRoot()
    if not root then return false, 'Dossier des ressources introuvable' end
    local dir = root .. '/' .. name
    if GetResourceState(name) ~= 'missing' then
        local existing = (GetResourcePath(name) or ''):gsub('\\', '/')
        if existing:sub(1, #root) ~= root then
            return false, ('Une ressource « %s » existe déjà hors du Studio : change son nom dans le panel'):format(name)
        end
    end

    local files, wanted = p.files or {}, {}
    for _, f in ipairs(files) do
        local path = tostring(f.path or '')
        if path:find('..', 1, true) or not path:match('^[%w_%-][%w_%.%-/]*$') then return false, 'Chemin refusé : ' .. path end
        wanted[path] = true
    end
    makeDir(dir)
    for _, f in ipairs(files) do
        makeDir((dir .. '/' .. f.path):match('^(.*)/[^/]+$'))
        local file, err = io.open(dir .. '/' .. f.path, 'wb')
        if not file then return false, ('Écriture impossible (%s) : %s'):format(f.path, tostring(err)) end
        file:write(f.content or '')
        file:close()
    end
    -- Files of the previous deployment that are gone from the creation.
    for _, old in ipairs(readJson(dir .. '/' .. STUDIO_MARK) or {}) do
        if type(old) == 'string' and not wanted[old] and not old:find('..', 1, true) then os.remove(dir .. '/' .. old) end
    end
    local list = {}
    for path in pairs(wanted) do list[#list + 1] = path end
    local mark = io.open(dir .. '/' .. STUDIO_MARK, 'wb')
    if mark then
        mark:write(json.encode(list))
        mark:close()
    end

    ExecuteCommand('refresh')
    local state = GetResourceState(name)
    if state == 'missing' then return false, 'Fichiers écrits mais FiveM ne voit pas la ressource (dossier : ' .. dir .. ')' end
    if state == 'started' or state == 'starting' then StopResource(name) end
    local ok = StartResource(name)
    dirty = true
    if not ok then return false, name .. ' : fichiers écrits mais le démarrage a échoué (erreur dans la console du serveur)' end
    return true, ('%s déployée et démarrée (%d fichiers)'):format(name, #files)
end

-- ---- actions from the panel: each returns ok, message ----

local function online(target)
    return GetPlayerName(target) ~= nil
end

local handlers = {
    kick = function(p)
        if not online(p.target) then return false, 'Joueur déconnecté' end
        DropPlayer(p.target, p.reason)
        return true, 'Joueur expulsé'
    end,
    dm = function(p)
        if not online(p.target) then return false, 'Joueur déconnecté' end
        TriggerClientEvent('chat:addMessage', p.target, { color = { 212, 176, 106 }, multiline = true, args = { 'Staff', p.message } })
        return true, 'Message envoyé'
    end,
    announce = function(p)
        TriggerClientEvent('chat:addMessage', -1, { color = { 212, 176, 106 }, multiline = true, args = { 'Annonce', p.message } })
        return true, 'Annonce envoyée'
    end,
    resource = function(p)
        if p.name == RESOURCE then return false, "L'agent ne peut pas agir sur lui-même" end
        if GetResourceState(p.name) == 'missing' then return false, 'Ressource introuvable (essaie « Recharger la liste »)' end
        local ok = true
        if p.action == 'stop' or p.action == 'restart' then ok = StopResource(p.name) end
        if ok and (p.action == 'start' or p.action == 'restart') then ok = StartResource(p.name) end
        dirty = true
        return ok, ('%s : %s'):format(p.name, GetResourceState(p.name))
    end,
    refresh = function()
        ExecuteCommand('refresh')
        dirty = true
        return true, 'Liste des ressources rechargée'
    end,
    screenshot = function(p)
        if not online(p.target) then return false, 'Joueur déconnecté' end
        if GetResourceState('screenshot-basic') ~= 'started' then return false, 'Installe et démarre screenshot-basic sur le serveur FiveM' end
        FVX.screenshot(p.target, 'manual')
        return true, 'Capture en cours'
    end,
    screen = function(p)
        if not online(p.target) then return false, 'Joueur déconnecté' end
        if GetResourceState('screenshot-basic') ~= 'started' then return false, 'Installe et démarre screenshot-basic sur le serveur FiveM' end
        streamScreen(p.target)
        return true, 'Écran en direct démarré'
    end,
    freeze = function(p)
        if not online(p.target) then return false, 'Joueur déconnecté' end
        local ped = GetPlayerPed(p.target)
        if not ped or ped == 0 then return false, 'Personnage introuvable' end
        FreezeEntityPosition(ped, p.on == true)
        local vehicle = GetVehiclePedIsIn(ped, false)
        if vehicle and vehicle ~= 0 then FreezeEntityPosition(vehicle, p.on == true) end
        return true, p.on and 'Joueur gelé' or 'Joueur dégelé'
    end,
    console = function(p)
        if not ALLOW_CONSOLE then return false, 'Console désactivée sur ce serveur (fiverax_console 0)' end
        ExecuteCommand(p.command)
        return true, 'Commande exécutée'
    end,
    deploy = deploy,
    audit = function(p)
        TriggerEvent('fiverax:audit', p.scanId) -- audit.js does the collection
        return true, 'Scan lancé'
    end,
    -- Read / change the files of a resource for the AI assistant: files.js does it and reports to the panel.
    files = function(p, id)
        TriggerEvent('fiverax:files', id, p)
        return true, 'Transmis'
    end
}

local function run(command)
    local handler = handlers[command.kind] or (FVX.handlers and FVX.handlers[command.kind])
    if not handler then return { id = command.id, ok = false, message = 'Action inconnue : mets à jour fiverax_agent' } end
    local payload = command.payload or {}
    -- JSON numbers may decode as floats ("3.0" once turned into a player source string).
    if payload.target then payload.target = math.floor(tonumber(payload.target) or -1) end
    local success, ok, message = pcall(handler, payload, command.id)
    if not success then return { id = command.id, ok = false, message = tostring(ok):sub(1, 2000) } end
    return { id = command.id, ok = ok and true or false, message = message }
end

-- ---- the call to the panel ----

local function prepend(list, items, max)
    local merged = {}
    for _, v in ipairs(items) do merged[#merged + 1] = v end
    for _, v in ipairs(list) do merged[#merged + 1] = v end
    while #merged > max do table.remove(merged, 1) end
    return merged
end

-- Returns how long to wait before the next call (seconds).
local function call()
    local sentEvents, sentConsole, sentResults = events, consoleLines, results
    events, consoleLines, results = {}, {}, {}
    local body = { version = VERSION, boot = not booted or nil, secRev = FVX.secRev, events = sentEvents, console = sentConsole, results = sentResults }
    if dirty or watched or os.time() - lastState >= STATE_EVERY then
        body.state = snapshot()
        dirty, lastState = false, os.time()
    end

    local p = promise.new()
    PerformHttpRequest(URL .. '/api/fivem/agent', function(status, response)
        p:resolve({ status = status, body = response })
    end, 'POST', json.encode(body), HEADERS)
    local res = Citizen.Await(p)

    if res.status < 200 or res.status >= 300 then
        -- Keep what was not delivered for the next call (console lines are best effort).
        events = prepend(events, sentEvents, MAX_EVENTS)
        results = prepend(results, sentResults, 100)
        if body.state then dirty = true end
        if res.status == 401 then
            if not warnedAuth then print('[fiverax] Token refusé : vérifie fiverax_token (panel > Configuration).') end
            warnedAuth = true
        elseif res.status == 0 then
            print('[fiverax] Panel injoignable : ' .. URL)
        else
            print(('[fiverax] Le panel a répondu HTTP %s'):format(res.status))
        end
        return 15
    end

    booted, warnedAuth = true, false
    local data = json.decode(res.body or '') or {}
    if type(data.interval) == 'number' then interval = math.max(1, math.min(60, data.interval)) end
    watched = data.watch == true
    if type(data.security) == 'table' then applySecurity(data.security) end
    local commands = data.commands or {}
    for _, command in ipairs(commands) do results[#results + 1] = run(command) end
    -- Report the results right away rather than at the next tick.
    if #commands > 0 then return 0.5 end
    return interval
end

CreateThread(function()
    if URL == '' or TOKEN == '' then
        print('[fiverax] fiverax_url / fiverax_token non configurés : agent inactif.')
        return
    end
    math.randomseed(os.time())
    -- Bans of the previous run, enforced until the panel answers.
    local cached = LoadResourceFile(RESOURCE, BANS_FILE)
    if cached then indexBans(json.decode(cached)) end
    -- Players already connected (the resource was restarted).
    for _, id in ipairs(GetPlayers()) do playerJoined(tonumber(id)) end
    print(('[fiverax] Agent %s relié à %s'):format(VERSION, URL))
    while true do
        local ok, wait = pcall(call)
        if not ok then
            print('[fiverax] Erreur : ' .. tostring(wait))
            wait = 15
        end
        Wait(math.floor(wait * 1000))
    end
end)
