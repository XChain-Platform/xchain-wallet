// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Site icon capture in the content script (captureSiteIcon): on
// bridge.connect the relay draws the page's own declared icon to a small PNG
// inside the page and attaches it as `siteIcon`. These cases run the real
// classic-script source against a fake page realm whose Image and canvas are
// scripted, so the choice of icon, the type and size caps, SVG refusal and
// the tainted-canvas path are all observable at the sendMessage boundary.

import { afterEach, describe, expect, it, vi } from 'vitest';
import CONTENT_SRC from '../../../packages/extension/src/content/contentScript.js?raw';
import { pngDataUrl } from '../../helpers/siteIconFixtures.js';

const ORIGIN = 'https://dapp.example';

function link(attrs) {
    return { getAttribute: (name) => (Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null) };
}

/**
 * @param {object} opts
 * @param {Array<Record<string, string>>} [opts.links]
 * @param {Record<string, { w?: number, h?: number, error?: boolean, hang?: boolean, tainted?: boolean, bytes?: (side: number) => number }>} [opts.images]
 * @param {string[]} [opts.loaded] URLs the page's performance timeline already holds
 */
function fakePage({ links = [], images = {}, loaded = [] } = {}) {
    const listeners = [];
    const sent = [];
    const requested = [];
    const drawn = [];

    class FakeImage {
        constructor() {
            this.naturalWidth = 0;
            this.naturalHeight = 0;
            this.crossOrigin = null;
        }

        set src(href) {
            this._src = href;
            requested.push({ href, crossOrigin: this.crossOrigin });
            const spec = images[href];
            if (spec?.hang) return;
            setTimeout(() => {
                if (!spec || spec.error) { this.onerror?.(); return; }
                this.naturalWidth = spec.w;
                this.naturalHeight = spec.h;
                this.onload?.();
            }, 0);
        }

        get src() { return this._src; }
    }

    function fakeCanvas() {
        const canvas = { width: 0, height: 0, _img: null };
        canvas.getContext = () => ({
            drawImage: (img) => { canvas._img = img; drawn.push({ href: img.src, side: canvas.width }); },
        });
        canvas.toDataURL = (type) => {
            const spec = images[canvas._img?.src] || {};
            if (spec.tainted) {
                const err = new Error('The canvas has been tainted by cross-origin data.');
                err.name = 'SecurityError';
                throw err;
            }
            expect(type).toBe('image/png');
            const bytes = spec.bytes ? spec.bytes(canvas.width) : 200;
            return pngDataUrl(canvas.width, canvas.height, bytes);
        };
        return canvas;
    }

    const win = {
        location: { origin: ORIGIN, protocol: 'https:', hostname: 'dapp.example', pathname: '/', href: `${ORIGIN}/` },
        Image: FakeImage,
        performance: { getEntriesByName: (name) => (loaded.includes(name) ? [{ name }] : []) },
        addEventListener: (type, fn) => { if (type === 'message') listeners.push(fn); },
        postMessage: vi.fn(),
    };
    win.top = win;
    const document = {
        contentType: 'text/html',
        baseURI: `${ORIGIN}/`,
        head: { appendChild: vi.fn() },
        documentElement: { appendChild: vi.fn() },
        createElement: (tag) => (tag === 'canvas'
            ? fakeCanvas()
            : { addEventListener: vi.fn(), remove: vi.fn() }),
        querySelectorAll: () => links.map(link),
    };
    const chrome = {
        runtime: {
            getURL: (p) => `chrome-extension://ext/${p}`,
            sendMessage: (message, cb) => { sent.push(message); cb({ ok: true, result: { ok: true } }); },
            onMessage: { addListener: vi.fn() },
        },
    };
    // eslint-disable-next-line no-new-func
    new Function('window', 'document', 'chrome', CONTENT_SRC)(win, document, chrome);

    async function send(type, request = {}) {
        const before = sent.length;
        for (const fn of [...listeners]) {
            fn({ source: win, origin: ORIGIN, data: { source: 'xchain-inject', id: `id-${before}`, type, request } });
        }
        await vi.waitFor(() => expect(sent.length).toBe(before + 1), { timeout: 3000 });
        return sent[before].request;
    }

    return { send, requested, drawn };
}

afterEach(() => {
    vi.useRealTimers();
});

describe('content script site icon capture', () => {
    it('picks the smallest declared icon at or above 128 px and draws it at 128', async () => {
        const page = fakePage({
            links: [
                { rel: 'icon', href: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
                { rel: 'icon', href: '/icon-512.png', sizes: '512x512', type: 'image/png' },
                { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
                { rel: 'shortcut icon', href: '/favicon.ico' },
            ],
            images: {
                [`${ORIGIN}/apple-touch-icon.png`]: { w: 180, h: 180 },
                [`${ORIGIN}/icon-512.png`]: { w: 512, h: 512 },
            },
        });
        const request = await page.send('bridge.connect', { appName: 'dApp' });
        expect(page.requested[0].href).toBe(`${ORIGIN}/apple-touch-icon.png`);
        expect(page.requested[0].crossOrigin).toBeNull();
        expect(page.drawn[0].side).toBe(128);
        expect(request.siteIcon).toBe(pngDataUrl(128, 128, 200));
        expect(request.origin).toBe(ORIGIN);
    });

    it('prefers the dApp-declared appIcon and asks for CORS when it is off-origin', async () => {
        const declared = 'https://cdn.example/brand/logo.webp';
        const page = fakePage({
            links: [{ rel: 'icon', href: '/icon-192.png', sizes: '192x192' }],
            images: { [declared]: { w: 64, h: 64 } },
        });
        const request = await page.send('bridge.connect', { appIcon: declared });
        expect(page.requested[0]).toEqual({ href: declared, crossOrigin: 'anonymous' });
        expect(page.drawn[0].side).toBe(64);
        expect(request.siteIcon).toBe(pngDataUrl(64, 64, 200));
    });

    it('never loads an SVG or a non-raster icon', async () => {
        const page = fakePage({
            links: [
                { rel: 'icon', href: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
                { rel: 'icon', href: '/icon.svg' },
                { rel: 'icon', href: '/icon.png?x', type: 'image/svg+xml' },
                { rel: 'icon', href: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>' },
                { rel: 'icon', href: '/icon-generator' },
                { rel: 'icon', href: 'javascript:alert(1)' },
                { rel: 'stylesheet', href: '/site.png' },
            ],
        });
        const request = await page.send('bridge.connect', {
            appIcon: 'data:image/svg+xml;base64,PHN2Zy8+',
        });
        expect(page.requested).toEqual([]);
        expect(request).not.toHaveProperty('siteIcon');
    });

    it('stores no icon when the canvas is tainted', async () => {
        const href = 'https://other.example/favicon.png';
        const page = fakePage({
            links: [{ rel: 'icon', href, sizes: '64x64' }],
            images: { [href]: { w: 64, h: 64, tainted: true } },
        });
        const request = await page.send('bridge.connect', {});
        expect(page.requested).toHaveLength(1);
        expect(request).not.toHaveProperty('siteIcon');
    });

    it('steps down in size to meet the byte cap and gives up past it', async () => {
        const fits = fakePage({
            links: [{ rel: 'icon', href: '/big.png', sizes: '256x256' }],
            images: { [`${ORIGIN}/big.png`]: { w: 256, h: 256, bytes: (side) => (side > 64 ? 40000 : 9000) } },
        });
        const smaller = await fits.send('bridge.connect', {});
        expect(fits.drawn.map((d) => d.side)).toEqual([128, 64]);
        expect(smaller.siteIcon).toBe(pngDataUrl(64, 64, 9000));

        const never = fakePage({
            links: [{ rel: 'icon', href: '/huge.png', sizes: '256x256' }],
            images: { [`${ORIGIN}/huge.png`]: { w: 256, h: 256, bytes: () => 40000 } },
        });
        const none = await never.send('bridge.connect', {});
        expect(never.drawn.map((d) => d.side)).toEqual([128, 64, 32]);
        expect(none).not.toHaveProperty('siteIcon');
    });

    it('skips an image under 32 px or far from square and tries the next', async () => {
        const page = fakePage({
            links: [
                { rel: 'icon', href: '/tiny.png' },
                { rel: 'icon', href: '/banner.png' },
                { rel: 'icon', href: '/good.png' },
            ],
            images: {
                [`${ORIGIN}/tiny.png`]: { w: 16, h: 16 },
                [`${ORIGIN}/banner.png`]: { w: 400, h: 100 },
                [`${ORIGIN}/good.png`]: { w: 48, h: 48 },
            },
        });
        const request = await page.send('bridge.connect', {});
        expect(page.requested.map((r) => r.href)).toEqual([
            `${ORIGIN}/tiny.png`, `${ORIGIN}/banner.png`, `${ORIGIN}/good.png`,
        ]);
        expect(request.siteIcon).toBe(pngDataUrl(48, 48, 200));
    });

    it('tries /favicon.ico only when the page already loaded it', async () => {
        const favicon = `${ORIGIN}/favicon.ico`;
        const notLoaded = fakePage({ images: { [favicon]: { w: 32, h: 32 } } });
        await notLoaded.send('bridge.connect', {});
        expect(notLoaded.requested).toEqual([]);

        const loaded = fakePage({ images: { [favicon]: { w: 32, h: 32 } }, loaded: [favicon] });
        const request = await loaded.send('bridge.connect', {});
        expect(loaded.requested.map((r) => r.href)).toEqual([favicon]);
        expect(request.siteIcon).toBe(pngDataUrl(32, 32, 200));
    });

    it('drops a page-supplied siteIcon on every request type', async () => {
        const forged = pngDataUrl(64, 64);
        const page = fakePage();
        expect(await page.send('bridge.connect', { siteIcon: forged })).not.toHaveProperty('siteIcon');
        expect(await page.send('bridge.getAccounts', { siteIcon: forged })).not.toHaveProperty('siteIcon');
    });

    it('captures only on connect', async () => {
        const page = fakePage({
            links: [{ rel: 'icon', href: '/icon.png' }],
            images: { [`${ORIGIN}/icon.png`]: { w: 64, h: 64 } },
        });
        await page.send('bridge.getAccounts', {});
        expect(page.requested).toEqual([]);
    });

    it('relays the connect without an icon when the image never loads', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout'] });
        const page = fakePage({
            links: [{ rel: 'icon', href: '/slow.png' }],
            images: { [`${ORIGIN}/slow.png`]: { hang: true } },
        });
        const pending = page.send('bridge.connect', {});
        await vi.advanceTimersByTimeAsync(1600);
        vi.useRealTimers();
        const request = await pending;
        expect(request).not.toHaveProperty('siteIcon');
    });
});
