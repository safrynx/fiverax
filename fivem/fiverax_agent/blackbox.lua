-- Fiverax black box: the last minutes of the server, kept in memory, sent to the panel as a replay when needed.
--
-- Every 2 s, each player's position, heading, health, armour, vehicle, voice (talking, radio, call). Between samples,
-- the hits and deaths between players, joins, leaves and anticheat detections. Nothing is sent until:
--   * a player uses /report [id] <raison>  (or a script calls exports.fiverax_agent:report(source, cible, raison))
--   * the staff asks for a capture from the panel (command "blackbox")
--   * the anticheat kicks or bans someone
-- Then the window is sent to the panel (POST /api/fivem/agent/blackbox), with the players around the people involved.
--
-- server.cfg:
--   set fiverax_blackbox_seconds 300        # minutes kept in memory, in seconds (60 to 900)
--   set fiverax_report_command "report"     # name of the in-game command ("" : no command, use the export)
--   add_ace group.admin fiverax.staff allow # who receives the reports in game
--   set fiverax_blackbox 0                  # disable the black box and /report

local ENABLED = GetConvarInt('fiverax_blackbox', 1) == 1
local KEEP = math.max(60, math.min(900, GetConvarInt('fiverax_blackbox_seconds', 300)))
local COMMAND = GetConvar('fiverax_report_command', 'report')
local SAMPLE_MS = 2000
local AROUND = 300.0          -- metres: players further than this from everyone involved are left out of a report
local AFTER_REPORT = 10       -- seconds recorded after a report before sending it (what happened right after)
local REPORT_COOLDOWN = 120   -- seconds between two reports of the same player
local MAX_EVENTS = 3000

if not ENABLED then return end

local frames = {}             -- { t, p = { {id, x, y, z, h, hp, ar, flags, radio, call, vehicle}, ... } }
local events = {}             -- { t, k, a, b, w, d, x }
local known = {}              -- [server id] = { name, session, seen }
local pedOwner = {}           -- [ped handle] = server id (refreshed at each sample)
local lastReport = {}
local lastAutoCapture = {}
local lastDeath = {}

local function push(event)
    event.t = event.t or os.time()
    events[#events + 1] = event
    if #events > MAX_EVENTS then table.remove(events, 1) end
end

local function trim()
    local limit = os.time() - KEEP
    while frames[1] and frames[1].t < limit do table.remove(frames, 1) end
    while events[1] and events[1].t < limit do table.remove(events, 1) end
    for id, info in pairs(known) do
        if info.seen < limit then known[id] = nil end
    end
end

-- ---- sampling ----

local function sample()
    local now = os.time()
    local players = {}
    pedOwner = {}
    for _, raw in ipairs(GetPlayers()) do
        local src = tonumber(raw)
        local ped = GetPlayerPed(src)
        if ped and ped ~= 0 and DoesEntityExist(ped) then
            pedOwner[ped] = src
            local c = GetEntityCoords(ped)
            local hp = GetEntityHealth(ped)
            local state = Player(src).state
            local flags = 0
            if state['fvx:talking'] == true then flags = flags | 1 end
            -- A player's ped has 200 health points and dies at 100 or below.
            if hp <= 100 then flags = flags | 2 end
            local vehicle = GetVehiclePedIsIn(ped, false)
            if vehicle and vehicle ~= 0 then flags = flags | 4 end
            local info = FVX.client and FVX.client[src]
            players[#players + 1] = {
                src, math.floor(c.x + 0.5), math.floor(c.y + 0.5), math.floor(c.z + 0.5), math.floor(GetEntityHeading(ped)),
                hp, GetPedArmour(ped), flags,
                type(state.radioChannel) == 'number' and state.radioChannel or 0,
                type(state.callChannel) == 'number' and state.callChannel or 0,
                (flags & 4) ~= 0 and info and info.vehicle or ''
            }
            local entry = known[src]
            if entry then
                entry.seen = now
                entry.session = FVX.sessions[src] or entry.session
            else
                known[src] = { name = GetPlayerName(src) or '?', session = FVX.sessions[src], seen = now }
            end
        end
    end
    frames[#frames + 1] = { t = now, p = players }
    trim()
end

CreateThread(function()
    while true do
        local ok, err = pcall(sample)
        if not ok then print('[fiverax] Boîte noire : ' .. tostring(err)) end
        Wait(SAMPLE_MS)
    end
end)

-- ---- what happens between samples ----

AddEventHandler('weaponDamageEvent', function(sender, data)
    if WasEventCanceled() then return end -- refused by the anticheat: no damage was done
    sender = tonumber(sender)
    local target = data.hitGlobalId or (data.hitGlobalIds and data.hitGlobalIds[1])
    if not sender or not target or target == 0 then return end
    local victimPed = NetworkGetEntityFromNetworkId(target)
    local victim = victimPed and pedOwner[victimPed]
    if not victim or victim == sender then return end
    push({ k = 'hit', a = sender, b = victim, w = tonumber(data.weaponType) or 0, d = tonumber(data.weaponDamage) or 0, x = data.willKill and 'kill' or nil })
end)

-- Death reported by the victim's client (killer and cause), at most one every 3 s per player.
RegisterNetEvent('fiverax:bb:death', function(killer, cause)
    local src = source
    local now = os.time()
    if lastDeath[src] and now - lastDeath[src] < 3 then return end
    lastDeath[src] = now
    killer = math.floor(tonumber(killer) or 0)
    if killer ~= 0 and (killer == src or not GetPlayerName(killer)) then killer = 0 end
    push({ k = 'death', a = killer, b = src, w = math.floor(tonumber(cause) or 0) })
end)

AddEventHandler('playerJoining', function() push({ k = 'join', a = source }) end)
AddEventHandler('playerDropped', function(reason)
    local src = source
    push({ k = 'leave', a = src, x = reason and tostring(reason):sub(1, 80) or nil })
    lastReport[src], lastAutoCapture[src], lastDeath[src] = nil, nil, nil
end)

-- ---- sending a window to the panel ----

local function sourceOfSession(session)
    for src, s in pairs(FVX.sessions) do
        if s == session then return src end
    end
    return nil
end

local function partyOf(src)
    if not src then return nil end
    local info = known[src]
    local name = GetPlayerName(src) or (info and info.name)
    if not name then return nil end
    return { id = src, name = name, session = FVX.sessions[src] or (info and info.session) }
end

-- Players who came within AROUND metres of one of `centers` during the window (everyone when no center).
local function involved(window, centers)
    local keep = {}
    if not centers or #centers == 0 then
        for _, f in ipairs(window) do
            for _, p in ipairs(f.p) do keep[p[1]] = true end
        end
        return keep
    end
    for _, c in ipairs(centers) do keep[c] = true end
    for _, f in ipairs(window) do
        local at = {}
        for _, p in ipairs(f.p) do
            for _, c in ipairs(centers) do
                if p[1] == c then at[#at + 1] = p end
            end
        end
        for _, p in ipairs(f.p) do
            if not keep[p[1]] then
                for _, c in ipairs(at) do
                    local dx, dy, dz = p[2] - c[2], p[3] - c[3], p[4] - c[4]
                    if dx * dx + dy * dy + dz * dz <= AROUND * AROUND then
                        keep[p[1]] = true
                        break
                    end
                end
            end
        end
    end
    return keep
end

local function window(seconds, centers)
    local from = os.time() - seconds
    local picked = {}
    for _, f in ipairs(frames) do
        if f.t >= from then picked[#picked + 1] = f end
    end
    local keep = involved(picked, centers)
    local outFrames = {}
    for _, f in ipairs(picked) do
        local list = {}
        for _, p in ipairs(f.p) do
            if keep[p[1]] then list[#list + 1] = p end
        end
        outFrames[#outFrames + 1] = { t = f.t, p = list }
    end
    local outEvents = {}
    for _, e in ipairs(events) do
        if e.t >= from and ((e.a and keep[e.a]) or (e.b and keep[e.b])) then outEvents[#outEvents + 1] = e end
    end
    local players = {}
    for id in pairs(keep) do
        local p = partyOf(id)
        if p then players[#players + 1] = p end
    end
    return outFrames, outEvents, players
end

local function send(body, attempt, cb)
    attempt = attempt or 1
    PerformHttpRequest(FVX.url .. '/api/fivem/agent/blackbox', function(status, response)
        if status == 200 then
            local ok, data = pcall(json.decode, response or '')
            if cb then cb(true, ok and data or {}) end
            return
        end
        if status ~= 400 and status ~= 401 and attempt < 5 then
            SetTimeout(30000 * attempt, function() send(body, attempt + 1, cb) end)
        else
            print(('[fiverax] Boîte noire : envoi refusé par le panel (HTTP %s)'):format(status))
            if cb then cb(false, nil) end
        end
    end, 'POST', json.encode(body), FVX.headers)
end

local function ref()
    return ('%d-%d-%d'):format(os.time(), math.random(100000, 999999), math.random(100000, 999999))
end

--- Send the last `seconds` around `centers` (server ids) to the panel.
local function capture(opts, cb)
    local centers = {}
    for _, src in ipairs({ opts.reporter, opts.target, opts.center }) do
        if src then centers[#centers + 1] = src end
    end
    local outFrames, outEvents, players = window(opts.seconds or KEEP, centers)
    send({
        ref = ref(), kind = opts.kind, command = opts.command, reason = opts.reason, detection = opts.detection, at = opts.at or os.time(),
        reporter = partyOf(opts.reporter), target = partyOf(opts.target), center = opts.center, players = players, frames = outFrames, events = outEvents
    }, 1, cb)
end

-- ---- /report ----

local function notifyStaff(text)
    for _, raw in ipairs(GetPlayers()) do
        local id = tonumber(raw)
        if IsPlayerAceAllowed(id, 'fiverax.staff') then
            TriggerClientEvent('chat:addMessage', id, { color = { 212, 176, 106 }, multiline = true, args = { 'Report', text } })
        end
    end
end

local function reply(src, text)
    if src and src > 0 then TriggerClientEvent('chat:addMessage', src, { color = { 212, 176, 106 }, multiline = true, args = { 'Fiverax', text } }) end
end

--- A player reports a problem (optionally against another player). Returns ok, message.
local function report(src, target, reason)
    src = math.floor(tonumber(src) or 0)
    if src <= 0 or not GetPlayerName(src) then return false, 'Joueur inconnu' end
    reason = tostring(reason or ''):gsub('[%c]', ' '):sub(1, 500)
    if #reason < 3 then return false, 'Explique le problème en quelques mots.' end
    local now = os.time()
    if lastReport[src] and now - lastReport[src] < REPORT_COOLDOWN then
        return false, ('Attends encore %d s avant un nouveau report.'):format(REPORT_COOLDOWN - (now - lastReport[src]))
    end
    target = target and math.floor(tonumber(target) or 0) or nil
    if target and (target <= 0 or target == src or not (GetPlayerName(target) or known[target])) then target = nil end
    lastReport[src] = now
    push({ k = 'report', a = src, b = target, x = reason:sub(1, 80) })
    local who = GetPlayerName(src)
    notifyStaff(('%s (#%d)%s : %s'):format(who, src, target and (' signale ' .. (GetPlayerName(target) or '?') .. ' (#' .. target .. ')') or '', reason))
    -- A few seconds more, then the window goes to the panel.
    SetTimeout(AFTER_REPORT * 1000, function()
        capture({ kind = 'report', reporter = src, target = target, reason = reason, at = now }, function(ok, data)
            if ok and data and data.id then reply(src, ('Report #%s transmis au staff, avec le replay des dernières minutes.'):format(data.id))
            elseif not ok then reply(src, "Ton report n'a pas pu être envoyé au panel, préviens le staff sur Discord.") end
        end)
    end)
    return true, 'Report envoyé au staff.'
end

exports('report', report)

if COMMAND ~= '' then
    RegisterCommand(COMMAND, function(src, args)
        if src <= 0 then return print('[fiverax] /' .. COMMAND .. ' : commande réservée aux joueurs') end
        local target = tonumber(args[1])
        if target then table.remove(args, 1) end
        if #args == 0 then
            return reply(src, ('Utilisation : /%s [id du joueur] <ce qui se passe>'):format(COMMAND))
        end
        local ok, message = report(src, target, table.concat(args, ' '))
        reply(src, message)
    end, false)
end

-- ---- captures asked by the panel ----

FVX.handlers = FVX.handlers or {}
FVX.handlers.blackbox = function(p, id)
    local seconds = math.max(30, math.min(KEEP, math.floor(tonumber(p.seconds) or KEEP)))
    local center = p.center and math.floor(tonumber(p.center) or -1) or nil
    if center and not (GetPlayerName(center) or known[center]) then center = nil end
    if #frames == 0 then return false, "La boîte noire n'a encore rien enregistré (ressource démarrée à l'instant)" end
    capture({ kind = 'manual', command = id, center = center, seconds = seconds, reason = p.reason })
    return true, ('Capture des %d dernières secondes envoyée'):format(seconds)
end

-- ---- anticheat: a kick or a ban sends the minutes before ----

local pushEvent = FVX.pushEvent
FVX.pushEvent = function(event)
    pushEvent(event)
    if event.type ~= 'detection' then return end
    local src = event.session and sourceOfSession(event.session)
    if src then push({ k = 'detection', a = src, x = event.kind }) end
    if not src or (event.action ~= 'kick' and event.action ~= 'ban') then return end
    local now = os.time()
    if lastAutoCapture[src] and now - lastAutoCapture[src] < 300 then return end
    lastAutoCapture[src] = now
    -- Right away: the player is about to be dropped (their frames stay in memory anyway).
    capture({ kind = 'detection', target = src, detection = event.kind, seconds = math.min(KEEP, 180), reason = ('Anticheat : %s (%s)'):format(event.kind, event.action) })
end
