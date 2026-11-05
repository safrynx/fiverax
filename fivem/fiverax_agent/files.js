// Fiverax: files of the server's resources, for the troubleshooting AI (panel > Serveur FiveM > Assistant IA).
//
// The Lua agent receives a "files" command from the panel and hands it over here (TriggerEvent 'fiverax:files').
// Node's fs does the work; the result goes to POST <fiverax_url>/api/fivem/agent/files.
//
//   op = "list"   the code files of a resource (path + size), and its fxmanifest
//   op = "read"   the content of some files (text only, 512 KB max each)
//   op = "write"  write / delete files, then (optionally) restart the resource. Each file carries the SHA-256 the
//                 panel expects to find on disk ("" for a new file): if the file changed since the AI read it, nothing
//                 is written (no silent overwrite).
//
// Limits: only inside the resource's own folder, never fiverax_agent itself, only text files, no "..".
//
// server.cfg:
//   set fiverax_files 0      # refuse every read and write from the panel
//   set fiverax_files 1      # read only (the AI can look, not change)  — 2 (default): read and write

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

function baseUrl() {
    let url = GetConvar('fiverax_url', '');
    if (!url) url = GetConvar('gtasun_staff_api_url', '').replace(/\/api\/fivem\/?$/, '');
    return url.replace(/\/+$/, '');
}
const BASE = baseUrl();
const TOKEN = GetConvar('fiverax_token', '') || GetConvar('gtasun_staff_api_token', '');
const MODE = GetConvarInt('fiverax_files', 2);

const TEXT_EXT = new Set(['.lua', '.js', '.mjs', '.cjs', '.ts', '.json', '.html', '.htm', '.css', '.cfg', '.sql', '.xml', '.yml', '.yaml', '.md', '.txt', '.meta', '.vue', '.jsx', '.tsx']);
const SKIP_DIRS = new Set(['node_modules', '.git', '.github', '.vscode', '.idea', 'stream']);
const MAX_FILE = 512 * 1024;
const MAX_LIST = 1500;

const log = (msg) => console.log(`[fiverax] Fichiers : ${msg}`);
const sha = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

function post(body) {
    return gzip(Buffer.from(JSON.stringify(body))).then((data) => new Promise((resolve, reject) => {
        const url = new URL(`${BASE}/api/fivem/agent/files`);
        const lib = url.protocol === 'http:' ? http : https;
        const req = lib.request(url, {
            method: 'POST',
            timeout: 60000,
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}`, 'x-fiverax-gzip': '1', 'Content-Length': data.length }
        }, (res) => {
            res.resume();
            res.on('end', () => (res.statusCode >= 200 && res.statusCode < 300 ? resolve() : reject(new Error(`le panel a répondu HTTP ${res.statusCode}`))));
        });
        req.on('timeout', () => req.destroy(new Error('délai dépassé')));
        req.on('error', reject);
        req.end(data);
    }));
}

/** The resource's folder, or an error message. */
function rootOf(name) {
    if (typeof name !== 'string' || !/^[\w.\-[\]]{1,100}$/.test(name)) return [null, 'Nom de ressource invalide'];
    if (name === SELF) return [null, "L'agent ne modifie pas ses propres fichiers"];
    if (GetResourceState(name) === 'missing') return [null, `Ressource « ${name} » introuvable`];
    const root = GetResourcePath(name);
    if (!root) return [null, `Dossier de « ${name} » introuvable`];
    return [path.resolve(root), null];
}

/** Absolute path of a file inside the resource, or null when it would leave it / is not a text file. */
function inside(root, rel) {
    if (typeof rel !== 'string' || !rel || rel.length > 300 || rel.includes('..') || rel.includes('\\') || rel.startsWith('/') || /[\0:*?"<>|]/.test(rel)) return null;
    if (!TEXT_EXT.has(path.extname(rel).toLowerCase())) return null;
    const abs = path.resolve(root, rel);
    return abs.startsWith(root + path.sep) ? abs : null;
}

async function walk(root, rel, out) {
    let entries;
    try { entries = await fsp.readdir(rel ? path.join(root, rel) : root, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
        if (out.length >= MAX_LIST) return;
        const p = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) {
            if (!SKIP_DIRS.has(e.name)) await walk(root, p, out);
        } else if (e.isFile() && TEXT_EXT.has(path.extname(e.name).toLowerCase())) {
            try { out.push({ path: p, size: (await fsp.stat(path.join(root, p))).size }); } catch (e2) { /* vanished */ }
        }
    }
}

async function readOne(root, rel) {
    const abs = inside(root, rel);
    if (!abs) return { path: String(rel), error: 'Chemin refusé' };
    try {
        const stat = await fsp.stat(abs);
        if (stat.size > MAX_FILE) return { path: rel, error: `Fichier trop gros (${Math.round(stat.size / 1024)} Ko)` };
        const content = await fsp.readFile(abs, 'utf8');
        return { path: rel, content, hash: sha(content) };
    } catch (e) {
        return { path: rel, missing: true };
    }
}

async function list(p) {
    const [root, err] = rootOf(p.resource);
    if (!root) return { ok: false, message: err };
    const files = [];
    await walk(root, '', files);
    let manifest = await readOne(root, 'fxmanifest.lua');
    if (manifest.content === undefined) manifest = await readOne(root, '__resource.lua');
    return { ok: true, list: files, files: manifest.content !== undefined ? [manifest] : [], state: GetResourceState(p.resource) };
}

async function read(p) {
    const [root, err] = rootOf(p.resource);
    if (!root) return { ok: false, message: err };
    const paths = Array.isArray(p.paths) ? p.paths.slice(0, 20) : [];
    const files = [];
    for (const rel of paths) files.push(await readOne(root, rel));
    return { ok: true, files };
}

async function write(p) {
    if (MODE < 2) return { ok: false, message: 'Modification des fichiers désactivée sur ce serveur (fiverax_files)' };
    const [root, err] = rootOf(p.resource);
    if (!root) return { ok: false, message: err };
    const files = Array.isArray(p.files) ? p.files : [];
    // 1. Check everything before touching anything.
    const plan = [];
    for (const f of files) {
        const abs = inside(root, f.path);
        if (!abs) return { ok: false, message: `Chemin refusé : ${f.path}` };
        let current = null;
        try { current = await fsp.readFile(abs, 'utf8'); } catch (e) { /* new file */ }
        const now = current === null ? '' : sha(current);
        if (now !== String(f.expect || '')) {
            return { ok: false, message: `${f.path} a changé sur le serveur depuis sa lecture : relis-le avant de modifier`, conflict: f.path };
        }
        // Lua's json turns null into nil: a file without content is a file to delete (the panel always sends the key).
        plan.push({ abs, rel: f.path, content: typeof f.content === 'string' ? f.content : null });
    }
    // 2. Write (a copy of each old file is kept next to it: <file>.fiverax.bak).
    const written = [];
    for (const step of plan) {
        if (step.content === null) {
            try { await fsp.unlink(step.abs); } catch (e) { /* already gone */ }
        } else {
            await fsp.mkdir(path.dirname(step.abs), { recursive: true });
            try { await fsp.copyFile(step.abs, `${step.abs}.fiverax.bak`); } catch (e) { /* new file */ }
            await fsp.writeFile(step.abs, step.content, 'utf8');
        }
        written.push({ path: step.rel, hash: step.content === null ? '' : sha(step.content) });
    }
    let message = `${written.length} fichier(s) modifié(s) dans ${p.resource}`;
    if (p.restart) {
        ExecuteCommand('refresh');
        const state = GetResourceState(p.resource);
        if (state === 'started' || state === 'starting') StopResource(p.resource);
        const started = StartResource(p.resource);
        message += started ? ' · ressource redémarrée' : ' · le redémarrage a échoué (erreur dans la console)';
    }
    return { ok: true, message, written, state: GetResourceState(p.resource) };
}

const OPS = { list, read, write };

// From the Lua agent (server.lua, command "files").
on('fiverax:files', async (commandId, payload) => {
    const p = payload || {};
    let result;
    try {
        if (MODE < 1) result = { ok: false, message: 'Accès aux fichiers désactivé sur ce serveur (fiverax_files 0)' };
        else if (!OPS[p.op]) result = { ok: false, message: `Opération inconnue : ${p.op}` };
        else result = await OPS[p.op](p);
    } catch (e) {
        result = { ok: false, message: String((e && e.message) || e).slice(0, 500) };
    }
    if (!result.ok) log(`${p.op} ${p.resource} : ${result.message}`);
    try {
        await post({ commandId: Number(commandId), op: p.op, resource: p.resource, ...result });
    } catch (e) {
        log(`envoi au panel impossible : ${e.message}`);
    }
});
