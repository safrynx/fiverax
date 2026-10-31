// Fiverax: collector of the server audit (panel > Sécurité > Scanner).
//
// Server-side JavaScript runs on Node inside FXServer: fs, crypto and zlib do the work without blocking the Lua thread.
//  1. inventory: every resource, its manifest, the size and SHA-256 of its files, server.cfg with every secret masked.
//     No code is sent at this step.
//  2. the panel answers with the hashes it has never analysed; only those files are sent (the others are already
//     known, from this server or another one). The panel analyses them and does not keep them.
//  3. done: the panel builds the report.
//
// server.cfg:
//   set fiverax_audit_code 0     # confidential mode: never send any file content (only the inventory)

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const http = require('http');
const https = require('https');
const { promisify } = require('util');

const gzip = promisify(zlib.gzip);
const SELF = GetCurrentResourceName();
const VERSION = '3.3.0';

function baseUrl() {
    let url = GetConvar('fiverax_url', '');
    if (!url) url = GetConvar('gtasun_staff_api_url', '').replace(/\/api\/fivem\/?$/, '');
    return url.replace(/\/+$/, '');
}
const BASE = baseUrl();
const TOKEN = GetConvar('fiverax_token', '') || GetConvar('gtasun_staff_api_token', '');
const SEND_CODE = GetConvarInt('fiverax_audit_code', 1) === 1;

const CODE_EXT = new Set(['.lua', '.js', '.mjs', '.cjs', '.ts', '.json', '.html', '.htm', '.cfg', '.sql', '.xml', '.yml', '.yaml']);
const STREAM_EXT = new Set(['.ytd', '.ydr', '.yft', '.ydd', '.ybn', '.ymap', '.ytyp', '.ycd', '.ynv', '.awc', '.gfx']);
const SKIP_DIRS = new Set(['node_modules', '.git', '.github', '.vscode', '.idea']);
const MAX_FILE = 3 * 1024 * 1024;
const MAX_FILES = 4000;
const BATCH_BYTES = 3 * 1024 * 1024;

const log = (msg) => console.log(`[fiverax] Scanner : ${msg}`);
const pause = () => new Promise((resolve) => setTimeout(resolve, 0));

function post(phase, body) {
    return gzip(Buffer.from(JSON.stringify(body))).then((data) => new Promise((resolve, reject) => {
        const url = new URL(`${BASE}/api/fivem/agent/audit?phase=${phase}`);
        const lib = url.protocol === 'http:' ? http : https;
        const req = lib.request(url, {
            method: 'POST',
            timeout: 90000,
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}`, 'x-fiverax-gzip': '1', 'Content-Length': data.length }
        }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                let json = null;
                try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { /* not JSON */ }
                if (res.statusCode >= 200 && res.statusCode < 300) resolve(json || {});
                else reject(new Error(`le panel a répondu HTTP ${res.statusCode}${json && json.error ? ` (${json.error})` : ''}`));
            });
        });
        req.on('timeout', () => req.destroy(new Error('délai dépassé')));
        req.on('error', reject);
        req.end(data);
    }));
}

// ---- manifests ----

function meta(res, key) {
    const out = [];
    for (const k of [key, `${key}s`]) {
        const n = GetNumResourceMetadata(res, k) || 0;
        for (let i = 0; i < n; i++) {
            const v = GetResourceMetadata(res, k, i);
            if (v) out.push(String(v));
        }
    }
    return [...new Set(out)];
}

function globToRe(glob) {
    let re = '';
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i];
        if (c === '*') {
            if (glob[i + 1] === '*') {
                re += '.*';
                i++;
                if (glob[i + 1] === '/') i++;
            } else re += '[^/]*';
        } else if ('\\^$+?.()|{}[]'.includes(c)) re += `\\${c}`;
        else re += c;
    }
    return new RegExp(`^${re}$`, 'i');
}

/** Which side loads each file, from the manifest (then from the folder names). */
function roleFinder(res) {
    const rules = [];
    const addAll = (key, role) => {
        for (const g of meta(res, key)) if (!g.startsWith('@')) rules.push([globToRe(g.replace(/^\.?\//, '')), role]);
    };
    addAll('shared_script', 'shared');
    addAll('server_script', 'server');
    addAll('client_script', 'client');
    addAll('ui_page', 'ui');
    addAll('file', 'ui');
    return (p) => {
        for (const [re, role] of rules) if (re.test(p)) return role === 'ui' && p.endsWith('.lua') ? 'other' : role;
        if (/(^|\/)(server|sv)([/_.-]|$)/i.test(p)) return 'server';
        if (/(^|\/)(client|cl)([/_.-]|$)/i.test(p)) return 'client';
        if (/(^|\/)(html|ui|nui|web)\//i.test(p)) return 'ui';
        return 'other';
    };
}

async function walk(root, rel, out) {
    let entries;
    try {
        entries = await fsp.readdir(rel ? path.join(root, rel) : root, { withFileTypes: true });
    } catch (e) {
        return;
    }
    for (const e of entries) {
        if (out.list.length >= MAX_FILES) {
            out.truncated = true;
            return;
        }
        const p = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) {
            if (!SKIP_DIRS.has(e.name)) await walk(root, p, out);
        } else if (e.isFile()) out.list.push(p);
    }
}

// ---- server.cfg ----

const SECRET_KEY = /(key|token|pass|secret|webhook|connection|license|api|auth|rcon|mysql|database|url)/i;

function redact(text) {
    return text.split(/\r?\n/).map((line) => {
        const m = /^(\s*(?:set|sets|setr)\s+)(\S+)(\s+)(.+)$/i.exec(line);
        if (m && SECRET_KEY.test(m[2])) return `${m[1]}${m[2]}${m[3]}"***"`;
        if (/^\s*(rcon_password|sv_licenseKey|steam_webApiKey|sv_tebexSecret)\b/i.test(line)) return line.replace(/^(\s*\S+\s+).*/, '$1"***"');
        return line.replace(/https:\/\/(canary\.|ptb\.)?discord(app)?\.com\/api\/webhooks\/\S+/gi, '"***"');
    }).join('\n');
}

async function readCfg() {
    const candidates = [path.join(process.cwd(), 'server.cfg')];
    let dir = GetResourcePath(SELF) || '';
    for (let i = 0; i < 5 && dir; i++) {
        dir = path.dirname(dir);
        candidates.push(path.join(dir, 'server.cfg'));
    }
    const start = candidates.find((c) => fs.existsSync(c));
    if (!start) return [];
    const out = [];
    const queue = [start];
    const seen = new Set();
    while (queue.length && out.length < 8) {
        const file = queue.shift();
        if (seen.has(file)) continue;
        seen.add(file);
        let text;
        try { text = (await fsp.readFile(file, 'utf8')).slice(0, 200000); } catch (e) { continue; }
        out.push({ path: path.relative(path.dirname(start), file).replace(/\\/g, '/') || 'server.cfg', content: redact(text) });
        for (const m of text.matchAll(/^\s*exec\s+("?)([^"\s@][^"\s]*)\1/gim)) {
            for (const base of [path.dirname(file), process.cwd()]) {
                const next = path.resolve(base, m[2]);
                if (fs.existsSync(next)) {
                    queue.push(next);
                    break;
                }
            }
        }
    }
    return out;
}

// ---- the audit ----

let running = false;

async function run(scanId, auto) {
    if (running || !BASE || !TOKEN) return;
    running = true;
    const started = Date.now();
    try {
        const resources = [];
        const where = new Map(); // key -> absolute path, relative path
        const count = GetNumResources();
        for (let i = 0; i < count; i++) {
            const name = GetResourceByFindIndex(i);
            if (!name || name === SELF) continue;
            const root = GetResourcePath(name);
            if (!root || !fs.existsSync(root)) continue;
            const walked = { list: [], truncated: false };
            await walk(root, '', walked);
            const roleOf = roleFinder(name);
            const files = [];
            let isProtected = false;
            for (const p of walked.list) {
                const ext = path.extname(p).toLowerCase();
                // Escrow (Tebex): a ".fxap" file at the root ("extname" of a dotfile is empty).
                if (ext === '.fxap' || path.basename(p) === '.fxap') isProtected = true;
                const kind = CODE_EXT.has(ext) ? 'code' : STREAM_EXT.has(ext) ? 'stream' : null;
                if (!kind) continue;
                const abs = path.join(root, p);
                let size = 0;
                try { size = (await fsp.stat(abs)).size; } catch (e) { continue; }
                const file = { p, size, role: roleOf(p), kind };
                if (kind === 'code' && size <= MAX_FILE) {
                    try {
                        const buf = await fsp.readFile(abs);
                        file.hash = crypto.createHash('sha256').update(buf).digest('hex');
                        if (buf.subarray(0, 4).toString('latin1') === 'FXAP') file.enc = true;
                        const key = `${file.hash}:${file.role}:${ext}`;
                        if (!where.has(key)) where.set(key, { abs, p });
                    } catch (e) { /* unreadable: listed without hash */ }
                }
                files.push(file);
            }
            const fx = meta(name, 'fx_version')[0];
            resources.push({
                name,
                state: GetResourceState(name),
                meta: {
                    fx_version: fx,
                    lua54: meta(name, 'lua54')[0],
                    dependencies: meta(name, 'dependency').slice(0, 100),
                    legacy: !fs.existsSync(path.join(root, 'fxmanifest.lua')) && fs.existsSync(path.join(root, '__resource.lua')),
                    version: meta(name, 'version')[0]
                },
                protected: isProtected || undefined,
                truncated: walked.truncated || undefined,
                files
            });
            await pause();
        }

        const convars = {};
        for (const k of ['version', 'sv_scriptHookAllowed', 'sv_enforceGameBuild', 'onesync', 'sv_endpointprivacy', 'sv_maxclients', 'gamename']) {
            const v = GetConvar(k, '');
            if (v) convars[k] = v;
        }
        const inventory = {
            scanId: scanId || null,
            auto: auto || undefined,
            agent: VERSION,
            confidential: !SEND_CODE,
            convars,
            rcon: GetConvar('rcon_password', '') !== '',
            cfg: await readCfg(),
            resources
        };
        log(`${resources.length} ressources inventoriées`);
        const answer = await post('inventory', inventory);
        scanId = answer.scanId;

        const need = Array.isArray(answer.need) ? answer.need : [];
        let batch = [];
        let bytes = 0;
        let sent = 0;
        const flush = async () => {
            if (!batch.length) return;
            await post('files', { scanId, files: batch });
            sent += batch.length;
            batch = [];
            bytes = 0;
        };
        for (const { key } of need) {
            const file = where.get(key);
            if (!file) continue;
            let content;
            try { content = await fsp.readFile(file.abs, 'utf8'); } catch (e) { continue; }
            if (bytes + content.length > BATCH_BYTES) await flush();
            batch.push({ key, path: file.p, content });
            bytes += content.length;
        }
        await flush();
        const done = await post('done', { scanId });
        log(`terminé en ${Math.round((Date.now() - started) / 1000)} s : ${sent} fichier(s) analysé(s), score ${done.score}/100`);
    } catch (e) {
        log(`échec : ${e.message}`);
        if (scanId) post('error', { scanId, message: String(e.message || e) }).catch(() => {});
    } finally {
        running = false;
    }
}

// From the panel (Lua agent, command "audit").
on('fiverax:audit', (scanId) => {
    run(Number(scanId) || null, false);
});

// Continuous audit: after resources start (debounced), and twice a day. The panel decides (setting "scan continu").
let timer = null;
function schedule() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
        if (running || !BASE || !TOKEN) return;
        try {
            const answer = await post('ping', {});
            if (answer.go) run(null, true);
        } catch (e) { /* panel unreachable: next time */ }
    }, 60000);
}
on('onServerResourceStart', (name) => {
    if (name !== SELF && process.uptime() > 180) schedule();
});
setInterval(schedule, 12 * 3600 * 1000);
setTimeout(schedule, 5 * 60 * 1000);
