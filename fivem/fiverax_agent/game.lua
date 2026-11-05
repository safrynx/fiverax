-- Fiverax: actions on connected players for the panel's AI assistant ("donne 5000 $ à Tata", "mets Bob mécano"…).
--
-- Command "game" from the panel: { op, target (server id), ... }. Works with ESX, QBCore and Qbox (detected at each
-- call), ox_inventory for items when it runs; revive / heal / teleport work without framework.
--
--   info                                   money, job and group of the player (read only)
--   give_money / remove_money  account, amount   account: cash | bank | black_money
--   give_item / remove_item    item, count
--   set_job                    job, grade
--   revive / heal
--   teleport                   x, y, z  or  to (server id of another player)
--
-- server.cfg:
--   set fiverax_game 0     # refuse every action of this file

local ALLOW = GetConvarInt('fiverax_game', 1) == 1
local ACCOUNTS = { cash = true, bank = true, black_money = true }

local function started(name)
    return GetResourceState(name) == 'started'
end

--- The framework running on this server and its player object for `src`.
local function framework(src)
    if started('qbx_core') then
        local ok, player = pcall(function() return exports.qbx_core:GetPlayer(src) end)
        return 'qbox', ok and player or nil
    end
    if started('qb-core') then
        local ok, core = pcall(function() return exports['qb-core']:GetCoreObject() end)
        return 'qbcore', ok and core and core.Functions.GetPlayer(src) or nil
    end
    if started('es_extended') then
        local ok, esx = pcall(function() return exports.es_extended:getSharedObject() end)
        return 'esx', ok and esx and esx.GetPlayerFromId(src) or nil, esx
    end
    return 'standalone', nil
end

local function needPlayer(src)
    local fw, player, extra = framework(src)
    if fw == 'standalone' then return nil, nil, nil, 'Aucun framework (ESX, QBCore, Qbox) démarré sur ce serveur' end
    if not player then return nil, nil, nil, "Le personnage du joueur n'est pas encore chargé" end
    return fw, player, extra
end

local function money(n)
    local s = tostring(math.floor(n))
    while true do
        local k
        s, k = s:gsub('^(-?%d+)(%d%d%d)', '%1 %2')
        if k == 0 then break end
    end
    return s .. ' $'
end

local function esxAccount(account)
    return account == 'cash' and 'money' or account
end

local ops = {}

ops.info = function(src)
    local fw, p = needPlayer(src)
    if not fw then return false, p end
    if fw == 'esx' then
        local parts = {}
        for _, acc in ipairs(p.getAccounts() or {}) do parts[#parts + 1] = ('%s %s'):format(acc.name == 'money' and 'liquide' or acc.name, money(acc.money or 0)) end
        local job = p.getJob() or {}
        return true, ('%s · %s · job %s (%s, grade %s) · groupe %s'):format(GetPlayerName(src), table.concat(parts, ', '), job.name or '?', job.label or '?', job.grade or '?', p.getGroup and p.getGroup() or '?')
    end
    local data = p.PlayerData or {}
    local m = data.money or {}
    local job = data.job or {}
    local grade = type(job.grade) == 'table' and (job.grade.level or job.grade.name) or job.grade
    return true, ('%s · liquide %s, banque %s · job %s (%s, grade %s) · citoyen %s'):format(
        GetPlayerName(src), money(m.cash or 0), money(m.bank or 0), job.name or '?', job.label or '?', tostring(grade or '?'), data.citizenid or '?')
end

local function changeMoney(src, p, add)
    local amount = math.floor(tonumber(p.amount) or 0)
    local account = tostring(p.account or 'cash')
    if amount <= 0 or amount > 100000000 then return false, 'Montant invalide' end
    if not ACCOUNTS[account] then return false, 'Compte invalide' end
    local fw, player = needPlayer(src)
    if not fw then return false, player end
    local reason = 'fiverax-panel'
    if fw == 'esx' then
        if add then player.addAccountMoney(esxAccount(account), amount, reason) else player.removeAccountMoney(esxAccount(account), amount, reason) end
    else
        if account == 'black_money' then return false, "Pas de compte argent sale sur QBCore / Qbox (c'est souvent un objet : give_item markedbills)" end
        local ok = add and player.Functions.AddMoney(account, amount, reason) or (not add and player.Functions.RemoveMoney(account, amount, reason))
        if ok == false then return false, 'Refusé par le framework (solde insuffisant ?)' end
    end
    return true, ('%s %s (%s) %s %s'):format(add and 'Ajouté' or 'Retiré', money(amount), account, add and 'à' or 'à', GetPlayerName(src))
end
ops.give_money = function(src, p) return changeMoney(src, p, true) end
ops.remove_money = function(src, p) return changeMoney(src, p, false) end

local function changeItem(src, p, add)
    local item = tostring(p.item or '')
    local count = math.floor(tonumber(p.count) or 1)
    if not item:match('^[%w_%-]+$') or #item > 60 then return false, 'Objet invalide' end
    if count <= 0 or count > 10000 then return false, 'Quantité invalide' end
    if started('ox_inventory') then
        local ok, res = pcall(function()
            if add then return exports.ox_inventory:AddItem(src, item, count) end
            return exports.ox_inventory:RemoveItem(src, item, count)
        end)
        if not ok or not res then return false, ('ox_inventory a refusé (%s)'):format(tostring(ok and 'objet inconnu, inventaire plein ou pas assez d\'objets' or res)) end
    else
        local fw, player = needPlayer(src)
        if not fw then return false, player end
        if fw == 'esx' then
            if add then
                if player.canCarryItem and not player.canCarryItem(item, count) then return false, "Le joueur ne peut pas porter autant (ou l'objet n'existe pas)" end
                player.addInventoryItem(item, count)
            else
                player.removeInventoryItem(item, count)
            end
        else
            local ok = add and player.Functions.AddItem(item, count) or (not add and player.Functions.RemoveItem(item, count))
            if not ok then return false, "Refusé par l'inventaire (objet inconnu, inventaire plein ou pas assez d'objets)" end
        end
    end
    return true, ('%s %dx %s %s %s'):format(add and 'Donné' or 'Retiré', count, item, add and 'à' or 'à', GetPlayerName(src))
end
ops.give_item = function(src, p) return changeItem(src, p, true) end
ops.remove_item = function(src, p) return changeItem(src, p, false) end

ops.set_job = function(src, p)
    local job = tostring(p.job or '')
    local grade = math.floor(tonumber(p.grade) or 0)
    if not job:match('^[%w_%-]+$') or #job > 50 then return false, 'Job invalide' end
    local fw, player, esx = needPlayer(src)
    if not fw then return false, player end
    if fw == 'esx' then
        if esx.DoesJobExist and not esx.DoesJobExist(job, grade) then return false, ("Le job « %s » grade %d n'existe pas"):format(job, grade) end
        player.setJob(job, grade)
    elseif fw == 'qbox' then
        local ok = pcall(function() exports.qbx_core:SetJob(player.PlayerData.citizenid, job, grade) end)
        if not ok then
            if player.Functions.SetJob(job, grade) == false then return false, ("Le job « %s » grade %d n'existe pas"):format(job, grade) end
        end
    else
        if player.Functions.SetJob(job, grade) == false then return false, ("Le job « %s » grade %d n'existe pas"):format(job, grade) end
    end
    return true, ('%s est maintenant %s (grade %d)'):format(GetPlayerName(src), job, grade)
end

ops.revive = function(src)
    -- The framework's own revive first (it resets its "dead" state), then ours (works everywhere).
    if started('esx_ambulancejob') then TriggerClientEvent('esx_ambulancejob:revive', src) end
    if started('qb-ambulancejob') then TriggerClientEvent('hospital:client:Revive', src) end
    if started('qbx_medical') then pcall(function() exports.qbx_medical:Revive(src) end) end
    if started('wasabi_ambulance') then TriggerClientEvent('wasabi_ambulance:revive', src) end
    FVX.allowTeleport(src, 10)
    TriggerClientEvent('fiverax:game:revive', src)
    return true, GetPlayerName(src) .. ' réanimé'
end

ops.heal = function(src)
    TriggerClientEvent('fiverax:game:heal', src)
    if started('esx_basicneeds') then TriggerClientEvent('esx_basicneeds:healPlayer', src) end
    if started('qb-ambulancejob') then TriggerClientEvent('hospital:client:HealInjuries', src, 'full') end
    return true, GetPlayerName(src) .. ' soigné'
end

ops.teleport = function(src, p)
    local x, y, z
    if p.to then
        local to = math.floor(tonumber(p.to) or -1)
        if not GetPlayerName(to) then return false, 'Joueur de destination déconnecté' end
        local c = GetEntityCoords(GetPlayerPed(to))
        x, y, z = c.x + 1.0, c.y, c.z
    else
        x, y, z = tonumber(p.x), tonumber(p.y), tonumber(p.z)
        if not x or not y or not z or math.abs(x) > 10000 or math.abs(y) > 10000 or z < -200 or z > 3000 then return false, 'Coordonnées invalides' end
    end
    FVX.allowTeleport(src, 10)
    local ped = GetPlayerPed(src)
    local vehicle = GetVehiclePedIsIn(ped, false)
    SetEntityCoords(vehicle ~= 0 and GetPedInVehicleSeat(vehicle, -1) == ped and vehicle or ped, x + 0.0, y + 0.0, z + 0.0, false, false, false, false)
    return true, ('%s téléporté (%.0f, %.0f, %.0f)'):format(GetPlayerName(src), x, y, z)
end

FVX.handlers = FVX.handlers or {}
FVX.handlers.game = function(p)
    if not ALLOW then return false, 'Actions sur les joueurs désactivées sur ce serveur (fiverax_game 0)' end
    local op = ops[p.op]
    if not op then return false, ('Action inconnue : %s (mets à jour fiverax_agent)'):format(tostring(p.op)) end
    local src = math.floor(tonumber(p.target) or -1)
    if not GetPlayerName(src) then return false, 'Joueur déconnecté' end
    return op(src, p)
end
