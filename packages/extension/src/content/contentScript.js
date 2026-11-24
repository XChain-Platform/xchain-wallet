// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Content script: runs in the extension's isolated world for every
// matching page. Two responsibilities:
//
//   1. Inject the `xchainProvider.js` bundle into the page's main
//      world by appending a <script> tag sourced from the extension's
//      web_accessible_resources. The injected script then defines
//      `window.xchain` in the page's JS context.
//
//   2. Bridge between page (window.postMessage) and background
//      (chrome.runtime.sendMessage). Annotates every request with the
//      page's origin so the background can resolve `ConnectedSite`
//      permissions.
//
//   3. On bridge.connect only, draw the page's own icon to a small PNG
//      data URL (captureSiteIcon below) and attach it as `siteIcon`, so the
//      wallet can show the site's icon without ever fetching it.
//
// The content script does NOT implement any permission logic itself.
// It is a message relay. All policy lives in the background
// bridge handlers (§43.3 + Approvals).

(function installBridge() {
    // The manifest installs this relay in the top document only. Keep the
    // same policy here so an accidental all_frames change cannot expose a
    // second provider with the iframe's origin and permission context.
    if (window.top !== window) return;

    function isInjectablePage() {
        try {
            const protocol = window.location.protocol;
            const hostname = window.location.hostname.toLowerCase();
            const pathname = window.location.pathname;
            if ((protocol !== 'https:' && protocol !== 'http:')
                || window.location.origin === 'null'
                || document.contentType === 'application/pdf') return false;
            return hostname !== 'chromewebstore.google.com'
                && !(hostname === 'chrome.google.com' && pathname.startsWith('/webstore'));
        } catch {
            return false;
        }
    }

    if (!isInjectablePage()) return;

    const SOURCE = 'xchain-inject';
    const RESPONSE_SOURCE = 'xchain-inject-response';
    const EVENT_SOURCE = 'xchain-inject-event';
    const INJECT_PATH = 'inject/xchainProvider.js';
    const PUBLIC_TYPES = new Set([
        'bridge.connect',
        'bridge.disconnect',
        'bridge.getAccounts',
        'bridge.getAddresses',
        'bridge.getBalances',
        'bridge.getSupportedChains',
        'bridge.getActiveChains',
        'bridge.signMessage',
        'bridge.signAction',
        'bridge.signPsbt',
        'bridge.coSign',
        'bridge.login',
        'bridge.signIn',
        'bridge.parallel',
    ]);

    // The page reads these, so they never carry Chrome's own runtime text
    // ("message channel closed", "context invalidated"), which names browser
    // internals and tells a site nothing it can act on.
    const RESTARTED_MESSAGE = 'The wallet restarted before it answered. Try the request again.';
    const RELOADED_MESSAGE = 'The wallet was updated or reloaded. Reload this page and try again.';

    function isRecord(value) {
        if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
        const prototype = Object.getPrototypeOf(value);
        return prototype === Object.prototype || prototype === null;
    }

    function isBridgeError(value) {
        return isRecord(value)
            && typeof value.name === 'string'
            && typeof value.message === 'string'
            && typeof value.code === 'string';
    }

    function isBridgeEvent(message) {
        if (!isRecord(message) || message.type !== 'bridge.event') return false;
        if (message.event === 'accountsChanged') {
            return Array.isArray(message.payload) && message.payload.every((account) => (
                isRecord(account)
                && typeof account.id === 'string'
                && account.id.length > 0
                && (account.name === undefined || typeof account.name === 'string')
            ));
        }
        if (message.event === 'chainChanged') {
            return typeof message.payload === 'string' && message.payload.length > 0;
        }
        if (message.event === 'disconnect') {
            return typeof message.payload === 'string';
        }
        return false;
    }

    // Site icon capture, for bridge.connect only. The wallet shows a
    // connected site with its own icon, and it must never fetch that icon
    // itself, so the icon is drawn HERE, in the requesting page, from the
    // images the page declares: its `link rel` icon, apple-touch-icon and
    // shortcut icon entries, plus the dApp's own ConnectOpts.appIcon when it
    // names a raster image. /favicon.ico is tried only when the page already
    // loaded it. The chosen image is drawn onto a canvas and re-encoded as a
    // PNG of at most ICON_MAX_PX square and ICON_MAX_BYTES; SVG and any
    // non-raster type are refused, and a cross-origin image without CORS
    // taints the canvas, which means no icon rather than a wallet-side fetch.
    // The background re-checks the result (schemas/siteIcon.js) before it
    // reaches the approval prompt or the site's record.
    const ICON_MAX_PX = 128;
    const ICON_MIN_PX = 32;
    const ICON_MAX_BYTES = 32 * 1024;
    const ICON_TIME_BOX_MS = 1500;
    const ICON_MAX_ATTEMPTS = 4;
    const ICON_MAX_SOURCE_CHARS = 512 * 1024;
    const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';
    const RASTER_ICON_TYPES = new Set([
        'image/png', 'image/jpeg', 'image/jpg', 'image/pjpeg', 'image/webp', 'image/gif',
        'image/x-icon', 'image/vnd.microsoft.icon', 'image/ico', 'image/icon',
    ]);
    const RASTER_ICON_PATH = /\.(?:png|jpe?g|webp|gif|ico)$/i;
    const RASTER_DATA_URL = /^data:image\/(?:png|jpeg|webp|gif|x-icon|vnd\.microsoft\.icon);base64,/i;

    // The absolute URL of a raster icon candidate, or null. A declared type
    // must be a raster type; with no type the path must end in a raster
    // extension. SVG is refused either way.
    function iconCandidateUrl(raw, declaredType) {
        if (typeof raw !== 'string') return null;
        const trimmed = raw.trim();
        if (!trimmed || trimmed.length > ICON_MAX_SOURCE_CHARS) return null;
        const type = typeof declaredType === 'string' ? declaredType.trim().toLowerCase() : '';
        if (type && !RASTER_ICON_TYPES.has(type)) return null;
        if (/^data:/i.test(trimmed)) return RASTER_DATA_URL.test(trimmed) ? trimmed : null;
        let url;
        try {
            url = new URL(trimmed, document.baseURI || window.location.href || `${window.location.origin}/`);
        } catch {
            return null;
        }
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
        if (url.protocol === 'http:' && window.location.protocol === 'https:') return null;
        if (/\.svgz?$/i.test(url.pathname)) return null;
        if (!type && !RASTER_ICON_PATH.test(url.pathname)) return null;
        return url.href;
    }

    // The largest square edge a `sizes` attribute declares, or 0 (unknown,
    // "any", or only non-square entries; the loaded image is checked anyway).
    function declaredIconSize(sizes) {
        let best = 0;
        for (const token of String(sizes || '').toLowerCase().split(/\s+/)) {
            const m = /^(\d{1,4})x(\d{1,4})$/.exec(token);
            if (m && m[1] === m[2]) best = Math.max(best, Number(m[1]));
        }
        return best;
    }

    // Lower is better: the smallest known size at or above ICON_MAX_PX, then
    // the largest known size below it, then unknown sizes in page order.
    function iconPreference(size) {
        if (!size) return Number.POSITIVE_INFINITY;
        return size >= ICON_MAX_PX ? size - ICON_MAX_PX : 100000 - size;
    }

    function siteIconCandidates(declaredIcon) {
        const out = [];
        const seen = new Set();
        const add = (href, size, rank) => {
            if (!href || seen.has(href)) return;
            seen.add(href);
            out.push({ href, size, rank, order: out.length });
        };
        add(iconCandidateUrl(declaredIcon, ''), 0, 0);
        let links = [];
        try {
            links = Array.from(document.querySelectorAll('link[rel][href]'));
        } catch {
            links = [];
        }
        for (const link of links) {
            const rel = String(link.getAttribute('rel') || '').toLowerCase().split(/\s+/);
            const touch = rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed');
            // `shortcut icon` carries the `icon` token too.
            if (!touch && !rel.includes('icon')) continue;
            const href = iconCandidateUrl(link.getAttribute('href'), link.getAttribute('type'));
            // apple-touch-icon is 180px by convention when sizes is absent.
            const size = declaredIconSize(link.getAttribute('sizes')) || (touch ? 180 : 0);
            if (size && size < ICON_MIN_PX) continue;
            add(href, size, 1);
        }
        if (out.length === 0) {
            try {
                const favicon = new URL('/favicon.ico', window.location.origin).href;
                const perf = window.performance;
                if (typeof perf?.getEntriesByName === 'function' && perf.getEntriesByName(favicon).length > 0) {
                    add(favicon, 0, 2);
                }
            } catch { /* no favicon fallback */ }
        }
        out.sort((a, b) => (a.rank - b.rank)
            || (iconPreference(a.size) - iconPreference(b.size))
            || (a.order - b.order));
        return out.slice(0, ICON_MAX_ATTEMPTS);
    }

    function loadIconImage(href) {
        return new Promise((resolve) => {
            try {
                const img = new window.Image();
                // Ask for CORS only off-origin, so a same-origin icon is read
                // straight from the page's cache.
                if (!/^data:/i.test(href) && new URL(href).origin !== window.location.origin) {
                    img.crossOrigin = 'anonymous';
                }
                img.decoding = 'async';
                img.onload = () => resolve(img);
                img.onerror = () => resolve(null);
                img.src = href;
            } catch {
                resolve(null);
            }
        });
    }

    // A PNG data URL of the loaded image, or null when it is too small, not
    // square, over the byte cap at every size tried, or the canvas is tainted.
    function rasterizeIcon(img) {
        const w = Number(img?.naturalWidth) || 0;
        const h = Number(img?.naturalHeight) || 0;
        const short = Math.min(w, h);
        const long = Math.max(w, h);
        if (short < ICON_MIN_PX || long > short * 1.25) return null;
        const first = Math.min(ICON_MAX_PX, long);
        for (const side of [first, 64, ICON_MIN_PX]) {
            if (side > first) continue;
            try {
                const canvas = document.createElement('canvas');
                canvas.width = side;
                canvas.height = side;
                const ctx = canvas.getContext('2d');
                if (!ctx) return null;
                const scale = side / long;
                ctx.drawImage(img, (side - w * scale) / 2, (side - h * scale) / 2, w * scale, h * scale);
                // Throws a SecurityError on a tainted canvas: no icon.
                const url = canvas.toDataURL('image/png');
                if (typeof url !== 'string' || !url.startsWith(PNG_DATA_URL_PREFIX)) return null;
                const bytes = Math.floor(((url.length - PNG_DATA_URL_PREFIX.length) * 3) / 4);
                if (bytes <= ICON_MAX_BYTES) return url;
            } catch {
                return null;
            }
        }
        return null;
    }

    // null when the page offers no candidate (the connect relays at once);
    // otherwise a promise that settles to a PNG data URL or null within
    // ICON_TIME_BOX_MS and never rejects, so connect is never held up.
    function captureSiteIcon(declaredIcon) {
        let candidates;
        try {
            candidates = siteIconCandidates(declaredIcon);
        } catch {
            return null;
        }
        if (candidates.length === 0) return null;
        const attempt = (async () => {
            for (const candidate of candidates) {
                const img = await loadIconImage(candidate.href);
                const icon = img ? rasterizeIcon(img) : null;
                if (icon) return icon;
            }
            return null;
        })().catch(() => null);
        const timeBox = new Promise((resolve) => { setTimeout(() => resolve(null), ICON_TIME_BOX_MS); });
        return Promise.race([attempt, timeBox]);
    }

    let providerAvailable = null;
    const pendingProbes = new Set();
    const settleProvider = (available) => {
        if (providerAvailable !== null) return;
        providerAvailable = available;
        for (const respond of pendingProbes) respond({ available });
        pendingProbes.clear();
    };

    try {
        const script = document.createElement('script');
        script.src = chrome.runtime.getURL(INJECT_PATH);
        script.type = 'text/javascript';
        script.async = false;
        const finish = (available) => {
            settleProvider(available);
            try { script.remove(); } catch { /* The document may be navigating away. */ }
        };
        script.addEventListener('load', () => finish(true));
        script.addEventListener('error', () => finish(false));
        (document.head || document.documentElement).appendChild(script);
    } catch {
        settleProvider(false);
    }

    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        if (event.origin !== window.location.origin) return;
        const data = event.data;
        if (!isRecord(data)) return;
        if (data.source !== SOURCE) return;
        if (
            typeof data.id !== 'string'
            || data.id.length === 0
            || data.id.length > 128
            || typeof data.type !== 'string'
        ) return;

        const refuse = (message, code = 'INTERNAL_ERROR') => {
            window.postMessage({
                source: RESPONSE_SOURCE,
                id: data.id,
                ok: false,
                error: {
                    name: 'BridgeError',
                    message,
                    code,
                },
            }, window.location.origin);
        };

        // Trust boundary: a web page may reach ONLY the origin-gated
        // `bridge.*` surface. Refuse to relay privileged extension-internal
        // types (wallet.*, action.*, settings.*, sites.*, ...) so a hostile
        // page can't drive the popup-only handler set (which signs with the
        // pre-unlocked pool and no password). Its list is a copy of
        // publicSurface.PUBLIC_BRIDGE_TYPES, pinned equal by a unit test; the
        // background re-checks the sender against that list, so this is
        // defence-in-depth, not the sole gate.
        if (!data.type.startsWith('bridge.') || !PUBLIC_TYPES.has(data.type)) {
            // `code` is a published BridgeErrorCode, like every other failure
            // the page can see. Precise refusal detail stays in `message`.
            refuse('FORBIDDEN: message type is not available to web pages', 'INVALID_PARAMS');
            return;
        }
        if (!isRecord(data.request)) {
            refuse('INVALID_PARAMS: request must be an object', 'INVALID_PARAMS');
            return;
        }

        const request = {
            ...(data.request ?? {}),
            origin: window.location.origin,
        };
        // `siteIcon` belongs to this script alone: a value the page put in
        // its request never rides through, only what captureSiteIcon drew.
        delete request.siteIcon;

        // Post exactly one envelope on every path out of this listener: the
        // injected provider parks a promise per request with no deadline, so
        // a silent path hangs the dApp call and leaks its pending entry.
        if (data.type === 'bridge.connect' || data.type === 'bridge.login') {
            const pendingIcon = captureSiteIcon(request.appIcon);
            if (pendingIcon) {
                pendingIcon
                    .then((icon) => { if (icon) request.siteIcon = icon; }, () => { /* no icon */ })
                    .then(relayRequest);
                return;
            }
        }
        relayRequest();

        function relayRequest() {
            try {
                chrome.runtime.sendMessage({ type: data.type, request }, (response) => {
                    // Chrome surfaces chrome.runtime.lastError when the
                    // extension context is invalidated mid-request (updates,
                    // reloads). Serialize it into the same envelope so the
                    // page always gets a response.
                    const err = chrome.runtime.lastError;
                    if (err) {
                        // A worker that stopped while holding the request closes
                        // its channel; anything else here is an invalidated context.
                        refuse(/context invalidated/i.test(String(err.message || ''))
                            ? RELOADED_MESSAGE
                            : RESTARTED_MESSAGE);
                        return;
                    }
                    if (
                        !isRecord(response)
                        || typeof response.ok !== 'boolean'
                        || (response.ok === true
                            && !Object.prototype.hasOwnProperty.call(response, 'result'))
                        || (response.ok === false && !isBridgeError(response.error))
                    ) {
                        refuse('NO_RESPONSE: invalid response from background');
                        return;
                    }
                    window.postMessage({
                        source: RESPONSE_SOURCE,
                        id: data.id,
                        ok: response.ok === true,
                        result: response.result,
                        error: response.error,
                    }, window.location.origin);
                });
            } catch (e) {
                // Answer the invalidation the callback above cannot see: an
                // update, reload or disable makes sendMessage throw out of the
                // call itself, so no callback runs and lastError is never read.
                refuse(RELOADED_MESSAGE);
            }
        }
    });

    // Relay the background's live dApp events (accountsChanged and the rest,
    // sent by bridge/bridgeEvents.js with account ids and names) to the page.
    // The origin and payload checks are required trust gates, never dead code.
    if (chrome.runtime?.onMessage?.addListener) {
        chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
            if (isRecord(message) && message.type === 'xchain.contentProbe') {
                if (providerAvailable === null && typeof sendResponse === 'function') {
                    pendingProbes.add(sendResponse);
                    return true;
                }
                sendResponse?.({ available: providerAvailable === true });
                return undefined;
            }
            // The broadcaster picked this tab from a URL snapshot and addressed
            // the send by tab id, so a navigation since then means the event
            // belongs to the previous origin, not this document. This listener
            // is the only check that runs against the page actually loaded, so
            // it is the authoritative gate: drop anything not stamped for us
            if (!isRecord(message) || message.origin !== window.location.origin) return;
            if (!isBridgeEvent(message)) return;
            window.postMessage({
                source: EVENT_SOURCE,
                event: message.event,
                payload: message.payload,
            }, window.location.origin);
        });
    }
})();
