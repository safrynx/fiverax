-- Fiverax anticheat: server-side layers, driven by the settings of the panel (Sécurité > Anticheat > Réglages).
--
--   1. Event protection: honeypot events (only cheats fire them), rate limits on protected events, and events acting
--      on another player (handcuff, revive, jail, bill…) fired on someone far away ("cuff all" menus).
--   2. Game events: entity creation, explosions, weapons given / removed, ejections, particles, projectiles,
--      damage (distance, rapid fire, mass kills), checked and cancelled here (OneSync).
--   3. Player checks every 2 s: godmode, health / armour, super jump, invisibility, damage modifiers, weapons and
--      skins, speed, teleports, noclip, and the speed of the vehicle they drive.
--   4. Client module (client.lua): heartbeat, resources injected by an executor, spectate, vision.
--
-- Each detection has an action set on the panel: off, log (recorded only), kick or ban; with "Capture" a screenshot
-- is taken first (screenshot-basic) and analysed by the AI. Players with the ACE `fiverax.bypass` are never checked.
--
-- Other resources may allow a teleport: exports.fiverax_agent:allowTeleport(source, seconds)

local WINDOW = 10            -- seconds of the rate limits
local SPAWN_GRACE = 60       -- seconds after joining without player checks (loading, spawn)
local HEARTBEAT_TIMEOUT = 45 -- seconds without heartbeat from the client module

local settings = nil
local honeypots, protected, weapons, models, peds, explosions = {}, {}, {}, {}, {}, {}
local targeted = {}          -- [event] = max distance (meters) to the player it acts on
local registered = {}
local counters = {}          -- [src][name] = { start, count, flagged }
local lastFlag = {}          -- [src:kind] = os.time()
local positions = {}         -- [src] = { x, y, z, at, ped }
local hiddenSince = {}       -- [src] = os.time() when the ped became invisible
local heartbeats = {}        -- [src] = { at, token }
local teleportAllowed = {}   -- [src] = os.time() until which teleports are fine
local noclipStreak = {}      -- [src] = consecutive checks moving without real speed
local dropping = {}

local function hashSet(list)
    local set = {}
    for _, name in ipairs(list or {}) do set[GetHashKey(name)] = name end
    return set
end

local function nameSet(list)
    local set = {}
    for _, name in ipairs(list or {}) do set[name] = true end
    return set
end

local function setting(kind)
    if not settings or not settings.enabled or not settings.detections then return nil end
    local conf = settings.detections[kind]
    if not conf or conf.action == 'off' then return nil end
    return conf
end

local function exempt(src)
    return not src or src <= 0 or not GetPlayerName(src) or IsPlayerAceAllowed(src, 'fiverax.bypass') or FVX.whitelisted(src)
end

-- Should this kind of thing be blocked for this player? (detection on, player not exempt)
local function guarded(kind, src)
    return setting(kind) ~= nil and not exempt(src)
end

local function drop(src, message)
    if dropping[src] then return end
    dropping[src] = true
    DropPlayer(src, message)
end

--- Report a detection and apply its action (log / kick / ban). Repeated "log" detections are throttled.
local function detect(src, kind, details)
    local conf = setting(kind)
    if not conf or exempt(src) or dropping[src] then return end
    local key = src .. ':' .. kind
    if lastFlag[key] and os.time() - lastFlag[key] < 30 then return end
    lastFlag[key] = os.time()

    local event = { type = 'detection', session = FVX.sessions[src], name = GetPlayerName(src) or '?', kind = kind, action = conf.action, details = details or {}, timestamp = os.time() }
    local ped = GetPlayerPed(src)
    if ped and ped ~= 0 and DoesEntityExist(ped) then
        local c = GetEntityCoords(ped)
        event.pos = { c.x, c.y, c.z }
    end
    FVX.pushEvent(event)
    print(('[fiverax] Anticheat : %s (#%d) -> %s [%s]'):format(GetPlayerName(src) or '?', src, kind, conf.action))

    local punish = nil
    if conf.action == 'ban' then
        FVX.localBan(src, 'Anticheat : ' .. kind)
        punish = settings.banMessage
    elseif conf.action == 'kick' then
        punish = 'Anticheat : comportement anormal détecté.'
    end

    if conf.screenshot then
        -- Take the screenshot before dropping the player (at most 6 s).
        local done = false
        FVX.screenshot(src, kind, function() done = true end)
        if punish then
            CreateThread(function()
                local waited = 0
                while not done and waited < 6000 do Wait(200) waited = waited + 200 end
                drop(src, punish)
            end)
        end
    elseif punish then
        drop(src, punish)
    end
end

--- Count one occurrence; true when the player is over the limit in the current window.
local function over(src, name, limit)
    counters[src] = counters[src] or {}
    local c = counters[src][name]
    local now = os.time()
    if not c or now - c.start >= WINDOW then
        c = { start = now, count = 0 }
        counters[src][name] = c
    end
    c.count = c.count + 1
    return c.count > limit, c.count
end

-- ---- 1. events ----

-- An event named "<resource>:…" belongs to that resource when it runs: legit players use it.
local function ownedByRunningResource(event)
    local prefix = event:match('^([^:]+):')
    return prefix ~= nil and GetResourceState(prefix) == 'started'
end

-- An event acting on another player (first argument = their server id): that player must be close. -1 is everyone.
local function checkTargeted(src, event, target)
    if not setting('event_distance') or exempt(src) then return end
    local t = tonumber(target)
    if not t then return end
    if t == -1 then return detect(src, 'event_distance', { event = event, cible = 'tous les joueurs' }) end
    if t == src or t <= 0 or not GetPlayerName(t) then return end
    local a, b = GetPlayerPed(src), GetPlayerPed(t)
    if not a or a == 0 or not b or b == 0 then return end
    local distance = #(GetEntityCoords(a) - GetEntityCoords(b))
    if distance > targeted[event] then
        detect(src, 'event_distance', { event = event, cible = GetPlayerName(t), distance = math.floor(distance) })
    end
end

local function watchEvent(event)
    if registered[event] then return end
    registered[event] = true
    RegisterNetEvent(event)
    AddEventHandler(event, function(target)
        local src = tonumber(source)
        if not src or src <= 0 then return end
        if honeypots[event] and not ownedByRunningResource(event) then
            detect(src, 'event_honeypot', { event = event })
        end
        if protected[event] and settings then
            local isOver, count = over(src, 'ev:' .. event, settings.limits.eventsPer10s)
            if isOver then detect(src, 'event_spam', { event = event, count = count }) end
        end
        if targeted[event] and settings then checkTargeted(src, event, target) end
    end)
end

FVX.onSettings = function(s)
    settings = s
    honeypots, protected = nameSet(s.honeypotEvents), nameSet(s.protectedEvents)
    weapons, models, peds = hashSet(s.blacklistedWeapons), hashSet(s.blacklistedModels), hashSet(s.blacklistedPeds)
    explosions = {}
    for _, t in ipairs(s.blockedExplosions or {}) do explosions[t] = true end
    targeted = {}
    for _, e in ipairs(s.targetedEvents or {}) do
        if type(e) == 'table' and type(e.event) == 'string' then targeted[e.event] = tonumber(e.maxDistance) or 15 end
    end
    -- Handlers cannot be removed: an event taken off the lists is simply ignored by the handler.
    for event in pairs(honeypots) do watchEvent(event) end
    for event in pairs(protected) do watchEvent(event) end
    for event in pairs(targeted) do watchEvent(event) end
end

-- ---- 2. game events (OneSync) ----

AddEventHandler('entityCreating', function(entity)
    if not settings then return end
    local owner = NetworkGetFirstEntityOwner(entity)
    if not owner or owner <= 0 then return end
    local model = GetEntityModel(entity)
    if models[model] and guarded('blacklisted_entity', owner) then
        CancelEvent()
        detect(owner, 'blacklisted_entity', { model = models[model] })
        return
    end
    if guarded('entity_spam', owner) then
        local isOver, count = over(owner, 'entities', settings.limits.entitiesPer10s)
        if isOver then
            CancelEvent()
            detect(owner, 'entity_spam', { count = count })
        end
    end
end)

AddEventHandler('explosionEvent', function(sender, ev)
    sender = tonumber(sender)
    if not settings or not sender then return end
    if (ev.isInvisible or explosions[ev.explosionType]) and guarded('explosion', sender) then
        CancelEvent()
        detect(sender, 'explosion', { type = ev.explosionType, invisible = ev.isInvisible or false })
        return
    end
    if guarded('explosion_spam', sender) then
        local isOver, count = over(sender, 'explosions', settings.limits.explosionsPer10s)
        if isOver then
            CancelEvent()
            detect(sender, 'explosion_spam', { count = count })
        end
    end
end)

AddEventHandler('giveWeaponEvent', function(sender, data)
    sender = tonumber(sender)
    if guarded('give_weapon', sender) then
        CancelEvent()
        detect(sender, 'give_weapon', { weapon = data and data.weaponType })
    end
end)

local function weaponRemoval(sender)
    sender = tonumber(sender)
    if guarded('remove_weapon', sender) then
        CancelEvent()
        detect(sender, 'remove_weapon', {})
    end
end
AddEventHandler('removeWeaponEvent', weaponRemoval)
AddEventHandler('removeAllWeaponsEvent', weaponRemoval)

AddEventHandler('clearPedTasksEvent', function(sender, data)
    sender = tonumber(sender)
    if guarded('clear_ped_tasks', sender) then
        CancelEvent()
        detect(sender, 'clear_ped_tasks', { immediately = data and data.immediately or false })
    end
end)

AddEventHandler('ptFxEvent', function(sender)
    sender = tonumber(sender)
    if not settings or not guarded('ptfx_spam', sender) then return end
    local isOver, count = over(sender, 'ptfx', settings.limits.ptfxPer10s)
    if isOver then
        CancelEvent()
        detect(sender, 'ptfx_spam', { count = count })
    end
end)

AddEventHandler('startProjectileEvent', function(sender)
    sender = tonumber(sender)
    if not settings or not guarded('projectile_spam', sender) then return end
    local isOver, count = over(sender, 'projectiles', settings.limits.projectilesPer10s)
    if isOver then
        CancelEvent()
        detect(sender, 'projectile_spam', { count = count })
    end
end)

-- Is the entity hit by this damage event a player's ped? (true when the native is missing: count it)
local function hitsPlayer(data)
    local id = data.hitGlobalId or (data.hitGlobalIds and data.hitGlobalIds[1])
    if not id or id == 0 then return false end
    local victim = NetworkGetEntityFromNetworkId(id)
    if not victim or victim == 0 or not DoesEntityExist(victim) or GetEntityType(victim) ~= 1 then return false end
    local ok, isPlayer = pcall(IsPedAPlayer, victim)
    if not ok then return true end
    return isPlayer == true or isPlayer == 1
end

AddEventHandler('weaponDamageEvent', function(sender, data)
    sender = tonumber(sender)
    if not settings or not sender or exempt(sender) or type(data) ~= 'table' then return end
    -- Rapid fire / magic bullet: too many hits in 10 s. Beyond the limit the hits are blocked.
    if setting('damage_spam') then
        local isOver, count = over(sender, 'hits', settings.limits.damagePer10s)
        if isOver then
            CancelEvent()
            detect(sender, 'damage_spam', { coups = count, weapon = data.weaponType })
            return
        end
    end
    -- "Kill all": too many players killed in 10 s. Beyond the limit the killing hits are blocked.
    if data.willKill and setting('kill_spam') and hitsPlayer(data) then
        local isOver, count = over(sender, 'kills', settings.limits.killsPer10s)
        if isOver then
            CancelEvent()
            detect(sender, 'kill_spam', { kills = count, weapon = data.weaponType })
            return
        end
    end
    if not setting('damage_distance') then return end
    local target = data.hitGlobalId or (data.hitGlobalIds and data.hitGlobalIds[1])
    if not target or target == 0 then return end
    local victim = NetworkGetEntityFromNetworkId(target)
    local ped = GetPlayerPed(sender)
    if not victim or victim == 0 or not DoesEntityExist(victim) or ped == 0 then return end
    local distance = #(GetEntityCoords(ped) - GetEntityCoords(victim))
    if distance > settings.limits.damageDistance then
        CancelEvent()
        detect(sender, 'damage_distance', { distance = math.floor(distance), weapon = data.weaponType })
    end
end)

-- ---- 3. player checks ----

local function try(fn, ...)
    local ok, value = pcall(fn, ...)
    return ok and value or nil
end

local function checkPlayer(src, now)
    local ped = GetPlayerPed(src)
    if not ped or ped == 0 or not DoesEntityExist(ped) then return end
    local health = GetEntityHealth(ped)

    if setting('godmode') and try(GetPlayerInvincible, src) then detect(src, 'godmode', {}) end
    if setting('health') and (health > 200 or GetPedArmour(ped) > 100) then detect(src, 'health', { health = health, armour = GetPedArmour(ped) }) end
    if setting('superjump') and try(IsPlayerUsingSuperJump, src) then detect(src, 'superjump', {}) end

    if setting('invisible') then
        if not IsEntityVisible(ped) then
            hiddenSince[src] = hiddenSince[src] or now
            if now - hiddenSince[src] >= 10 then detect(src, 'invisible', { seconds = now - hiddenSince[src] }) end
        else
            hiddenSince[src] = nil
        end
    end

    if setting('damage_modifier') then
        local weapon = try(GetPlayerWeaponDamageModifier, src) or 1.0
        local melee = try(GetPlayerMeleeWeaponDamageModifier, src) or 1.0
        if weapon > 1.05 or melee > 1.05 then detect(src, 'damage_modifier', { weapon = weapon, melee = melee }) end
    end

    if setting('blacklisted_weapon') then
        local weapon = GetSelectedPedWeapon(ped)
        if weapons[weapon] then
            RemoveWeaponFromPed(ped, weapon)
            detect(src, 'blacklisted_weapon', { weapon = weapons[weapon] })
        end
    end

    local model = GetEntityModel(ped)
    if setting('blacklisted_ped') and peds[model] then detect(src, 'blacklisted_ped', { model = peds[model] }) end

    -- The vehicle this player drives: a land vehicle or a boat faster than the limit (planes and helicopters are free).
    local vehicle = GetVehiclePedIsIn(ped, false)
    if vehicle ~= 0 and setting('vehicle_speed') and GetPedInVehicleSeat(vehicle, -1) == ped then
        local kind = try(GetVehicleType, vehicle)
        if kind ~= 'plane' and kind ~= 'heli' and kind ~= 'blimp' then
            local v = GetEntityVelocity(vehicle)
            local speed = math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
            if speed > settings.limits.vehicleSpeed then
                detect(src, 'vehicle_speed', { kmh = math.floor(speed * 3.6), limite = math.floor(settings.limits.vehicleSpeed * 3.6), type = kind })
            end
        end
    end

    -- Speed, teleport and noclip, on foot only; a new ped (respawn) or a dead player resets the reference.
    local c = GetEntityCoords(ped)
    local prev = positions[src]
    positions[src] = { x = c.x, y = c.y, z = c.z, at = now, ped = ped }
    if not prev or prev.ped ~= ped or health <= 100 or vehicle ~= 0 or (teleportAllowed[src] or 0) >= now then
        noclipStreak[src] = nil
        return
    end
    local dt = math.max(1, now - prev.at)
    local moved = math.sqrt((c.x - prev.x) ^ 2 + (c.y - prev.y) ^ 2)
    local climb = c.z - prev.z
    local falling = -climb > 20 -- parachute, fall
    if moved > settings.limits.teleportDistance then
        noclipStreak[src] = nil
        return detect(src, 'teleport', { distance = math.floor(moved) })
    elseif not falling and moved / dt > settings.limits.footSpeed then
        detect(src, 'speedhack', { speed = math.floor(moved / dt * 10) / 10, limit = settings.limits.footSpeed })
    end

    -- Noclip: the ped keeps travelling while its real (synced) speed stays near zero, because the cheat moves it by
    -- setting its position. Three checks in a row (6 s): a script teleport is one jump and never counts.
    if setting('noclip') then
        local travelled = math.sqrt(moved * moved + climb * climb)
        local v = GetEntityVelocity(ped)
        local real = math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
        local attached = try(GetEntityAttachedTo, ped)
        if not falling and travelled / dt >= settings.limits.noclipDistance / 2 and real < 3.0 and (not attached or attached == 0) then
            noclipStreak[src] = (noclipStreak[src] or 0) + 1
            if noclipStreak[src] >= 3 then
                noclipStreak[src] = 0
                detect(src, 'noclip', { metres = math.floor(travelled), vitesse = math.floor(real * 10) / 10 })
            end
        else
            noclipStreak[src] = nil
        end
    end
end

CreateThread(function()
    while true do
        Wait(2000)
        if settings and settings.enabled then
            local now = os.time()
            for _, id in ipairs(GetPlayers()) do
                local src = tonumber(id)
                if not exempt(src) and now - (FVX.joinedAt[src] or now) >= SPAWN_GRACE then
                    local ok, err = pcall(checkPlayer, src, now)
                    if not ok then print('[fiverax] Anticheat : ' .. tostring(err)) end
                    -- The client module stopped answering (resource stopped on the client by a cheat).
                    local hb = heartbeats[src]
                    if hb and hb.at and now - hb.at > HEARTBEAT_TIMEOUT then
                        detect(src, 'heartbeat', { silence = now - hb.at })
                        heartbeats[src] = { at = nil }
                    elseif not hb and now - (FVX.joinedAt[src] or now) > 240 then
                        -- Never heard from the client module: blocked before it even started.
                        detect(src, 'heartbeat', { never = true })
                        heartbeats[src] = { at = nil }
                    end
                end
            end
        end
    end
end)

-- Random screenshots (setting "ai.randomEveryMinutes").
CreateThread(function()
    local last = os.time()
    while true do
        Wait(30000)
        local every = settings and settings.enabled and settings.ai and settings.ai.randomEveryMinutes or 0
        if every > 0 and os.time() - last >= every * 60 then
            last = os.time()
            local candidates = {}
            for _, id in ipairs(GetPlayers()) do
                local src = tonumber(id)
                if not exempt(src) then candidates[#candidates + 1] = src end
            end
            if #candidates > 0 then FVX.screenshot(candidates[math.random(#candidates)], 'random') end
        end
    end
end)

-- ---- 4. client module ----

RegisterNetEvent('fiverax:ac:ready', function()
    local src = source
    local token = ('%x%x'):format(math.random(0, 0x7fffffff), math.random(0, 0x7fffffff))
    heartbeats[src] = { at = os.time(), token = token }
    TriggerClientEvent('fiverax:ac:init', src, token)
end)

RegisterNetEvent('fiverax:ac:hb', function(token, info)
    local src = source
    local hb = heartbeats[src]
    if not hb or token ~= hb.token then return end
    hb.at = os.time()
    if type(info) == 'table' then
        FVX.client[src] = { zone = type(info.zone) == 'string' and info.zone:sub(1, 80) or nil, vehicle = type(info.vehicle) == 'string' and info.vehicle:sub(1, 60) or nil }
        if info.spectate then detect(src, 'spectate', {}) end
        if info.nightvision or info.thermal then detect(src, 'vision', { night = info.nightvision or false, thermal = info.thermal or false }) end
    end
end)

RegisterNetEvent('fiverax:ac:resource', function(name)
    local src = source
    if type(name) ~= 'string' then return end
    -- A resource the server does not have started on the client: injected by an executor.
    if GetResourceState(name) == 'missing' then detect(src, 'injected_resource', { resource = name:sub(1, 80) }) end
end)

-- A resource stopped on one client only (a menu stopping protections). Restarts done by the server are not.
local serverStopped = {}
AddEventHandler('onResourceStop', function(name) serverStopped[name] = os.time() end)
AddEventHandler('onResourceStart', function(name) serverStopped[name] = os.time() end)

RegisterNetEvent('fiverax:ac:resstop', function(name)
    local src = source
    if type(name) ~= 'string' or dropping[src] then return end
    if os.time() - (serverStopped[name] or 0) < 30 then return end
    if GetResourceState(name) == 'started' then detect(src, 'resource_stop', { resource = name:sub(1, 80) }) end
end)

AddEventHandler('playerDropped', function()
    local src = source
    counters[src], positions[src], hiddenSince[src], heartbeats[src], teleportAllowed[src], dropping[src] = nil, nil, nil, nil, nil, nil
    noclipStreak[src] = nil
    for key in pairs(lastFlag) do
        if key:find('^' .. src .. ':') then lastFlag[key] = nil end
    end
end)

-- Same, from the agent's own files (game.lua: teleport / revive from the panel).
FVX.allowTeleport = function(src, seconds)
    teleportAllowed[tonumber(src)] = os.time() + (tonumber(seconds) or 5)
end

exports('allowTeleport', function(src, seconds)
    teleportAllowed[tonumber(src)] = os.time() + (tonumber(seconds) or 5)
end)
