#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { explorerCoinCode } from '../../packages/core/src/registry/coinTicker.js';
import { defaultRegistry } from '../../packages/core/src/registry/index.js';

const MAX_ARTWORK_BYTES = 5 * 1024 * 1024;
const RENDER_TARGET = 0.9;
const RENDERABLE_SOURCE_TYPES = new Set([
    'gif',
    'image/gif',
    'image/jpeg',
    'image/png',
    'image/webp',
    'jpeg',
    'jpg',
    'png',
    'webp',
]);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function normalizedType(value) {
    return typeof value === 'string'
        ? value.trim().toLowerCase().split(';', 1)[0]
        : '';
}

export function artworkFailureCause({
    sourceType,
    contentType,
    byteLength,
    error,
    cspDirective,
} = {}) {
    const types = [sourceType, contentType].map(normalizedType);
    if (types.some((type) => type === 'svg' || type === 'image/svg+xml')) return 'svg';
    if (types.some((type) => type === 'avif' || type === 'image/avif')) return 'avif';
    if (Number.isFinite(byteLength) && byteLength > MAX_ARTWORK_BYTES) return 'oversize';

    const directive = normalizedType(cspDirective);
    if (/(^|\s)(img-src|connect-src)(\s|$)/.test(directive)) return 'csp';

    const errorName = normalizedType(error?.name);
    const errorMessage = normalizedType(error?.message ?? error);
    if (
        errorName === 'securityerror'
        || /taint|cross[- ]origin|origin-clean/.test(errorMessage)
    ) return 'taint';

    return 'unknown';
}

export function renderedShare(results) {
    const eligible = Array.isArray(results)
        ? results.filter((result) => (
            RENDERABLE_SOURCE_TYPES.has(normalizedType(result?.sourceType))
            && result?.cause !== 'csp'
            && artworkFailureCause(result) !== 'csp'
        ))
        : [];
    const rendered = eligible.filter((result) => result.rendered === true).length;
    const share = eligible.length === 0
        ? (Array.isArray(results) && results.length > 0 ? 1 : 0)
        : rendered / eligible.length;

    return { share, reaches90Percent: share >= RENDER_TARGET };
}

export async function probeArtworkSources(sources, inspect) {
    return Promise.all(sources.map(async (source) => {
        const sourceCause = artworkFailureCause(source);
        if (sourceCause === 'svg' || sourceCause === 'avif') {
            return { ...source, rendered: false, cause: sourceCause };
        }
        let outcome;
        try {
            outcome = await inspect(source);
        } catch (error) {
            outcome = { error };
        }
        const result = { ...source, ...outcome };
        return {
            ...result,
            cause: result.rendered === true ? 'rendered' : artworkFailureCause(result),
        };
    }));
}

async function freePort() {
    const socket = createServer();
    await new Promise((accept, reject) => socket.once('error', reject).listen(0, '127.0.0.1', accept));
    const { port } = socket.address();
    await new Promise((accept) => socket.close(accept));
    return port;
}

async function waitForPage(url, child) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        if (child.exitCode !== null) throw new Error(`web dev server exited ${child.exitCode}`);
        try {
            const response = await fetch(url);
            if (response.ok) return;
        } catch {}
        await new Promise((accept) => setTimeout(accept, 100));
    }
    throw new Error('web dev server did not become ready');
}

async function stopServer(child) {
    if (child.exitCode !== null) return;
    await new Promise((accept) => {
        child.once('exit', accept);
        child.kill('SIGTERM');
    });
}

export async function startWebShell() {
    const port = await freePort();
    const pageUrl = `http://127.0.0.1:${port}`;
    const child = spawn('pnpm', [
        '-C', 'packages/web', 'dev', '--host', '127.0.0.1', '--port', String(port), '--strictPort',
    ], {
        cwd: ROOT,
        stdio: ['ignore', 'ignore', 'inherit'],
    });
    try {
        await waitForPage(pageUrl, child);
    } catch (error) {
        await stopServer(child);
        throw error;
    }
    return { pageUrl, close: () => stopServer(child) };
}

function testnetTargets() {
    return defaultRegistry().byNetworkKind('testnet').map((descriptor) => ({
        coin: explorerCoinCode(descriptor),
        explorer: descriptor.explorer.defaultUrl.replace(/\/$/, ''),
    }));
}

export async function runEngine(browserType, name, pageUrl, targets) {
    const browser = await browserType.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.goto(pageUrl);
        const raw = await page.evaluate(async ({ root, chains }) => {
            const moduleUrl = (path) => `/@fs${root}/${path}`;
            const [images, raster, csp] = await Promise.all([
                import(moduleUrl('packages/core/src/watch/watchImages.js')),
                import(moduleUrl('packages/core/src/watch/watchRaster.js')),
                import(moduleUrl('packages/web/src/csp.js')),
            ]);
            const violations = [];
            document.addEventListener('securitypolicyviolation', (event) => violations.push({
                blocked: event.blockedURI,
                directive: event.effectiveDirective,
            }));
            const meta = document.createElement('meta');
            meta.httpEquiv = 'Content-Security-Policy';
            meta.content = csp.metaContentSecurityPolicyFor();
            document.head.append(meta);

            const connectSources = csp.directivesFor()['connect-src'];
            const connectAllows = (source) => {
                const url = new URL(source, location.href);
                if (url.protocol === 'data:' || url.protocol === 'blob:') return true;
                if (url.origin === location.origin && connectSources.includes("'self'")) return true;
                return connectSources.includes(url.origin);
            };
            const decodeImage = (blob) => new Promise((accept, reject) => {
                const objectUrl = URL.createObjectURL(blob);
                const image = new Image();
                image.onload = () => {
                    image.width = image.naturalWidth;
                    image.height = image.naturalHeight;
                    image.close = () => URL.revokeObjectURL(objectUrl);
                    accept(image);
                };
                image.onerror = () => {
                    URL.revokeObjectURL(objectUrl);
                    reject(new Error('image decode failed'));
                };
                image.src = objectUrl;
            });

            const sourceType = (source) => {
                const match = String(source).match(/^data:image\/([^;,]+)|\.([a-z0-9]+)(?:[?#]|$)/i);
                return (match?.[1] || match?.[2] || '').toLowerCase().replace('svg+xml', 'svg');
            };
            const imageSources = (value, out = new Set(), key = '', parent = null) => {
                if (typeof value === 'string') {
                    const mime = String(parent?.type || parent?.content_type || '').toLowerCase();
                    if ((/^data:image\//i.test(value) || /^https?:\/\//i.test(value))
                        && (/image|icon|artwork/i.test(key) || mime.startsWith('image/'))) {
                        out.add(value);
                    }
                } else if (Array.isArray(value)) {
                    value.forEach((item) => imageSources(item, out, key, parent));
                } else if (value && typeof value === 'object') {
                    for (const [childKey, child] of Object.entries(value)) {
                        imageSources(child, out, `${key}.${childKey}`, value);
                    }
                }
                return out;
            };
            const fetchJson = async (url) => {
                const response = await fetch(url);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return response.json();
            };
            const tokens = [];
            for (const chain of chains) {
                let before = null;
                let loaded = 0;
                for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
                    const query = new URLSearchParams({ limit: '100' });
                    if (before !== null) query.set('before', before);
                    const body = await fetchJson(`${chain.explorer}/${chain.coin}/api/tokens?${query}`);
                    const rows = Array.isArray(body?.data) ? body.data : [];
                    tokens.push(...rows.map((row) => ({ chain, tick: row.tick })));
                    loaded += rows.length;
                    if (!rows.length || loaded >= Number(body.total || Infinity)) break;
                    const next = String(rows.at(-1)?.id ?? '');
                    if (!next || next === before) break;
                    before = next;
                }
            }

            const candidates = [];
            for (const token of tokens) {
                const base = `${token.chain.explorer}/${token.chain.coin}/api`;
                let detail;
                try {
                    detail = await fetchJson(`${base}/token/${encodeURIComponent(token.tick)}`);
                } catch {
                    continue;
                }
                const row = Array.isArray(detail) ? detail[0] : detail;
                const sources = imageSources(row);
                for (const file of row?.linked_files || []) {
                    if (String(file?.type || '').startsWith('image/') && file.action_index != null) {
                        sources.add(`${base}/file/${file.action_index}/raw`);
                    }
                }
                const description = row?.info?.description;
                if (/^https?:\/\//i.test(description || '')) {
                    if (!connectAllows(description)) {
                        candidates.push({
                            ...token,
                            source: description,
                            sourceType: 'metadata',
                            cspDirective: 'connect-src',
                        });
                    } else {
                        try {
                            const response = await fetch(description, { mode: 'cors' });
                            const type = response.headers.get('content-type') || '';
                            if (type.startsWith('image/')) sources.add(description);
                            else if (response.ok && type.includes('json')) {
                                imageSources(await response.json(), sources);
                            }
                        } catch {}
                    }
                }
                for (const source of sources) {
                    candidates.push({ ...token, source, sourceType: sourceType(source) });
                }
            }

            const results = [];
            for (const candidate of candidates) {
                if (candidate.sourceType === 'svg' || candidate.sourceType === 'avif') {
                    results.push({ ...candidate, rendered: false });
                    continue;
                }
                const cspDirective = candidate.cspDirective
                    || (!connectAllows(candidate.source) ? 'connect-src' : null);
                if (cspDirective) {
                    results.push({ ...candidate, rendered: false, cspDirective });
                    continue;
                }
                const violationStart = violations.length;
                let response;
                let error;
                try {
                    response = await fetch(candidate.source, { mode: 'cors' });
                    if (!response.ok) error = new Error(`HTTP ${response.status}`);
                } catch (caught) {
                    error = caught;
                }
                await new Promise((accept) => setTimeout(accept, 0));
                const violation = violations.slice(violationStart).find((item) => (
                    item.blocked === candidate.source
                    || item.directive === 'connect-src'
                    || item.directive === 'img-src'
                ));
                const blob = await images.fetchWatchImage({
                    source: candidate.source,
                    settings: { privacy: { metadataFetchEnabled: true, torRouting: false } },
                    fetchImpl: async () => {
                        if (response) return response.clone();
                        throw error;
                    },
                });
                let iconRendered = false;
                let artworkRendered = false;
                let contentType = response?.headers.get('content-type') || '';
                let byteLength;
                if (blob !== images.WATCH_IMAGE_GLYPH) {
                    contentType = blob.type || contentType;
                    byteLength = blob.size;
                    if (!['image/svg+xml', 'image/avif'].includes(contentType)
                        && byteLength <= MAX_ARTWORK_BYTES) {
                        const options = { createImageBitmap: decodeImage };
                        iconRendered = await raster.rasterWatchIcon(blob, options) !== raster.WATCH_GLYPH;
                        artworkRendered = await raster.rasterWatchArtwork(blob, options) !== raster.WATCH_GLYPH;
                    }
                }
                results.push({
                    ...candidate,
                    sourceType: candidate.sourceType || contentType,
                    contentType,
                    byteLength,
                    iconRendered,
                    artworkRendered,
                    rendered: iconRendered && artworkRendered,
                    cspDirective: violation?.directive,
                    error: error ? { name: error.name, message: error.message } : null,
                });
            }
            return results;
        }, { root: ROOT, chains: targets });
        const results = await probeArtworkSources(raw, async (result) => result);
        return { name, results, ...renderedShare(results) };
    } finally {
        await browser.close();
    }
}

async function main(argv) {
    const networkIndex = argv.indexOf('--network');
    const network = networkIndex === -1 ? 'testnet' : argv[networkIndex + 1];
    if (network !== 'testnet') throw new Error('probe-artwork only permits --network testnet');
    const server = await startWebShell();
    try {
        const { chromium, webkit } = await import('playwright');
        const engines = [];
        for (const [name, type] of [['chromium', chromium], ['webkit', webkit]]) {
            const result = await runEngine(type, name, server.pageUrl, testnetTargets());
            engines.push(result);
            const causes = result.results.filter((item) => item.cause !== 'rendered')
                .reduce((counts, item) => ({
                    ...counts,
                    [item.cause]: (counts[item.cause] || 0) + 1,
                }), {});
            console.log(`${name}: rendered ${result.results.filter((item) => item.rendered).length}/${result.results.length}; glyphs ${JSON.stringify(causes)}`);
        }
        const report = { generatedAt: new Date().toISOString(), network, engines };
        const output = resolve(ROOT, 'tmp/watch-artwork-probe.json');
        await mkdir(dirname(output), { recursive: true });
        await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
        if (engines.some((engine) => (
            !engine.reaches90Percent
            || engine.results.some((item) => item.cause === 'unknown')
        ))) process.exitCode = 1;
    } finally {
        await server.close();
    }
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
    main(process.argv.slice(2)).catch((error) => {
        console.error(error?.stack || error);
        process.exitCode = 1;
    });
}
