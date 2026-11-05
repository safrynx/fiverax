-- Fiverax client module: heartbeat of the anticheat, resources started on this client, voice activity and where the
-- player is (zone, vehicle) for the panel's map. Light on purpose: the real checks run on the server.

local token = nil
local talking = false

RegisterNetEvent('fiverax:ac:init', function(t)
    token = t
end)

-- Any resource starting here that the server does not run was injected (executor); the server decides.
AddEventHandler('onClientResourceStart', function(name)
    TriggerServerEvent('fiverax:ac:resource', name)
end)

-- A resource stopping here while it keeps running on the server: the server decides whether it is suspicious.
AddEventHandler('onClientResourceStop', function(name)
    if name ~= GetCurrentResourceName() then TriggerServerEvent('fiverax:ac:resstop', name) end
end)

local function zoneLabel(coords)
    local zone = GetLabelText(GetNameOfZone(coords.x, coords.y, coords.z))
    local street = GetStreetNameFromHashKey(GetStreetNameAtCoord(coords.x, coords.y, coords.z))
    if street and street ~= '' then return ('%s, %s'):format(street, zone) end
    return zone
end

local function vehicleLabel(ped)
    local vehicle = GetVehiclePedIsIn(ped, false)
    if vehicle == 0 then return nil end
    local label = GetLabelText(GetDisplayNameFromVehicleModel(GetEntityModel(vehicle)))
    if label == 'NULL' then label = GetDisplayNameFromVehicleModel(GetEntityModel(vehicle)) end
    return label
end

-- Heartbeat every 10 s with what the server cannot see by itself.
CreateThread(function()
    while not NetworkIsPlayerActive(PlayerId()) do Wait(500) end
    TriggerServerEvent('fiverax:ac:ready')
    while true do
        Wait(10000)
        if token then
            local ped = PlayerPedId()
            TriggerServerEvent('fiverax:ac:hb', token, {
                zone = zoneLabel(GetEntityCoords(ped)),
                vehicle = vehicleLabel(ped),
                spectate = NetworkIsInSpectatorMode() == 1 or NetworkIsInSpectatorMode() == true,
                nightvision = GetUsingnightvision() == 1 or GetUsingnightvision() == true,
                thermal = GetUsingseethrough() == 1 or GetUsingseethrough() == true
            })
        else
            TriggerServerEvent('fiverax:ac:ready')
        end
    end
end)

-- Who is talking, shared with the server through a state bag (only when it changes).
CreateThread(function()
    while true do
        Wait(300)
        local now = NetworkIsPlayerTalking(PlayerId())
        now = now == true or now == 1
        if now ~= talking then
            talking = now
            LocalPlayer.state:set('fvx:talking', talking, true)
        end
    end
end)

-- Black box (blackbox.lua): this player's death, with who killed them and with what.
CreateThread(function()
    local dead = false
    while true do
        Wait(250)
        local ped = PlayerPedId()
        local now = IsEntityDead(ped) or IsPedFatallyInjured(ped)
        if now and not dead then
            local killer, source = 0, GetPedSourceOfDeath(ped)
            if source ~= 0 and IsEntityAVehicle(source) then source = GetPedInVehicleSeat(source, -1) end
            if source ~= 0 and source ~= ped and IsEntityAPed(source) and IsPedAPlayer(source) then
                killer = GetPlayerServerId(NetworkGetPlayerIndexFromPed(source))
            end
            TriggerServerEvent('fiverax:bb:death', killer, GetPedCauseOfDeath(ped))
        end
        dead = now == true or now == 1
    end
end)

-- Revive / heal asked from the panel (game.lua). The server allows the teleport that a resurrection looks like.
RegisterNetEvent('fiverax:game:revive', function()
    local ped = PlayerPedId()
    local coords = GetEntityCoords(ped)
    if IsEntityDead(ped) or IsPedFatallyInjured(ped) then
        NetworkResurrectLocalPlayer(coords.x, coords.y, coords.z, GetEntityHeading(ped), true, false)
        ped = PlayerPedId()
    end
    ClearPedTasksImmediately(ped)
    SetEntityHealth(ped, GetEntityMaxHealth(ped))
    ClearPedBloodDamage(ped)
end)

RegisterNetEvent('fiverax:game:heal', function()
    local ped = PlayerPedId()
    SetEntityHealth(ped, GetEntityMaxHealth(ped))
    ClearPedBloodDamage(ped)
end)
