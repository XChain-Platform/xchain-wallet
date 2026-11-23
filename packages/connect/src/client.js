// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: MIT

import { createPickMemory, qrOffered } from './chooserPick.js';
import { createPendingStore } from './pendingStore.js';
import { encodeQr } from './qr.js';
import { buildRequest, parseReturn, requestLink } from './request.js';
import { androidIntentUrl, pickTransport, providerReady } from './transportPick.js';

export const WEB_WALLET_URL = 'https://wallet.xchain.io/';
export const WEB_LINK_PREFIX = 'https://wallet.xchain.io/link/?uri=';
export const GET_WALLET_URL = 'https://xchain.io/wallet/';
export const PENDING_KEY = 'xchain-connect-pending';
export const CHANNEL_NAME = 'xchain-connect';

const PROVIDER_METHODS = {
    login: 'signIn',
    signMessage: 'signMessage',
    signAction: 'signAction',
    signPsbt: 'signPsbt',
};
const NETWORK_SUFFIX = { mainnet: '', testnet: 'T', regtest: 'R' };
const NETWORK_COINS = { bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' };

function failure(code, message) {
    return message === undefined ? { ok: false, error: code } : { ok: false, error: code, message };
}

function token(randomBytes) {
    const bytes = randomBytes === undefined
        ? globalThis.crypto.getRandomValues(new Uint8Array(16))
        : randomBytes(16);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function detectPlatform(win) {
    const agent = win?.navigator?.userAgent ?? '';
    if (/android/i.test(agent)) return 'android';
    if (/iphone|ipad|ipod/i.test(agent)) return 'ios';
    return 'desktop';
}

function explorerCoin(chainId) {
    const [network, kind] = String(chainId).split('-');
    if (!Object.hasOwn(NETWORK_COINS, network) || !Object.hasOwn(NETWORK_SUFFIX, kind)) return null;
    return `${NETWORK_SUFFIX[kind]}${NETWORK_COINS[network]}`;
}

function returnFragment(href) {
    const index = href.indexOf('#xchain=');
    return index === -1 ? null : href.slice(index);
}

function cleanHref(href) {
    const index = href.indexOf('#xchain=');
    return index === -1 ? href : href.slice(0, index);
}

function qrSvg(doc, link) {
    const { size, modules } = encodeQr(link);
    const ns = 'http://www.w3.org/2000/svg';
    const svg = doc.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
    svg.setAttribute('role', 'img');
    const path = doc.createElementNS(ns, 'path');
    let d = '';
    modules.forEach((row, y) => row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`;
    }));
    path.setAttribute('d', d);
    svg.append(path);
    return svg;
}

export function createClient(options = {}) {
    const win = options.window ?? globalThis.window;
    const storage = options.storage ?? win?.localStorage;
    const origin = options.origin ?? win?.location?.origin ?? '';
    const platform = options.platform ?? detectPlatform(win);
    const fetchImpl = options.fetch ?? globalThis.fetch;
    const pending = createPendingStore(storage, PENDING_KEY);
    const pickMemory = createPickMemory(storage, origin);
    const waiters = new Map();
    const listeners = new Set();
    let channel = null;

    function provider() {
        const candidate = win?.xchain;
        return providerReady(candidate) ? candidate : null;
    }

    function webLink(link) {
        return `${WEB_LINK_PREFIX}${encodeURIComponent(link)}`;
    }

    function notify(result) {
        for (const listener of listeners) listener(result);
    }

    function settle(envelope) {
        const waiter = waiters.get(envelope.id);
        if (waiter) {
            waiters.delete(envelope.id);
            waiter(envelope);
        }
    }

    function showContinueBar(envelope, address) {
        const doc = win?.document;
        if (!doc) return;
        const bar = doc.createElement('div');
        bar.setAttribute('role', 'alertdialog');
        bar.dataset.xchainContinue = 'true';
        const label = doc.createElement('span');
        label.textContent = `Continue as ${address}?`;
        const accept = doc.createElement('button');
        accept.type = 'button';
        accept.textContent = 'Continue';
        const dismiss = doc.createElement('button');
        dismiss.type = 'button';
        dismiss.textContent = 'Dismiss';
        accept.addEventListener('click', () => {
            bar.remove();
            notify({ ...envelope, solicited: false });
        });
        dismiss.addEventListener('click', () => bar.remove());
        bar.append(label, accept, dismiss);
        doc.body.append(bar);
    }

    function classify(envelope, record) {
        if (record !== null
            && record.id === envelope.id
            && (envelope.method === undefined || envelope.method === record.method)
            && (envelope.state === undefined || envelope.state === record.state)) {
            return { kind: 'solicited' };
        }
        const address = envelope.result?.address;
        if (envelope.method === 'login' && envelope.ok === true
            && typeof address === 'string' && address.length > 0) {
            return { kind: 'unsolicited-login', address };
        }
        return { kind: 'refused' };
    }

    function receive(envelope, { broadcast }) {
        const verdict = classify(envelope, pending.get());
        if (verdict.kind === 'refused') return failure('NO_PENDING_REQUEST');
        if (verdict.kind === 'unsolicited-login') {
            showContinueBar(envelope, verdict.address);
            return { ...envelope, solicited: false };
        }
        pending.clear();
        const result = { ...envelope, solicited: true };
        if (broadcast) channel?.postMessage(envelope);
        settle(result);
        notify(result);
        return result;
    }

    function handleReturn(href = win?.location?.href ?? '') {
        const fragment = returnFragment(href);
        if (fragment === null) return null;
        let envelope;
        try {
            envelope = parseReturn(fragment);
        } catch (error) {
            return failure(error.code ?? 'INVALID_PARAMS', error.message);
        }
        win?.history?.replaceState?.(win.history.state, '', cleanHref(href));
        return receive(envelope, { broadcast: true });
    }

    function openChooser(link) {
        const doc = win.document;
        const box = doc.createElement('div');
        box.dataset.xchainChooser = 'true';
        const choices = [
            ['app', 'Open in the XChain Wallet app'],
            ['web', 'Open the web wallet'],
            ['get', 'Get the wallet'],
        ];
        for (const [pick, text] of choices) {
            const button = doc.createElement('button');
            button.type = 'button';
            button.dataset.pick = pick;
            button.textContent = text;
            button.addEventListener('click', () => {
                pickMemory.set(pick);
                box.remove();
                launch(pick, link);
            });
            box.append(button);
        }
        if (qrOffered(link.length)) box.append(qrSvg(doc, link));
        doc.body.append(box);
        return box;
    }

    function launch(kind, link) {
        if (kind === 'intent') return win.location.assign(androidIntentUrl(webLink(link)));
        if (kind === 'universal-link') return win.location.assign(webLink(link));
        if (kind === 'app') return win.location.assign(link);
        if (kind === 'web') {
            const popup = win.open(`${WEB_WALLET_URL}?uri=${encodeURIComponent(link)}`, '_blank');
            if (!popup) win.location.assign(`${WEB_WALLET_URL}?uri=${encodeURIComponent(link)}`);
            return undefined;
        }
        if (kind === 'get') return win.open(GET_WALLET_URL, '_blank');
        return openChooser(link);
    }

    async function viaProvider(prov, method, params) {
        try {
            const result = await prov[PROVIDER_METHODS[method]](params);
            if (result && typeof result === 'object' && result.ok === false) return result;
            return { ok: true, method, result, solicited: true };
        } catch (error) {
            return failure(error?.code ?? 'INTERNAL_ERROR', error?.message);
        }
    }

    function request(method, params, requestOptions = {}) {
        const prov = provider();
        if (prov && Object.hasOwn(PROVIDER_METHODS, method)) {
            return viaProvider(prov, method, params);
        }
        let envelope;
        try {
            envelope = buildRequest(method, params, {
                ...(options.now === undefined ? {} : { now: options.now }),
                ...(requestOptions.callback === undefined && requestOptions.return === undefined && win?.location?.href
                    ? { return: cleanHref(win.location.href) }
                    : {}),
                ...requestOptions,
                state: requestOptions.state ?? token(options.randomBytes),
            });
        } catch (error) {
            return Promise.resolve(failure(error.code ?? 'INVALID_PARAMS', error.message));
        }
        let link;
        try {
            link = requestLink(envelope, options.now === undefined ? {} : { now: options.now });
        } catch (error) {
            return Promise.resolve(failure(error.code ?? "INVALID_PARAMS", error.message));
        }
        pending.set({
            id: envelope.id,
            method,
            nonce: token(options.randomBytes),
            state: envelope.state,
        });
        const outcome = new Promise((resolve) => waiters.set(envelope.id, resolve));
        const transport = pickTransport({ provider: prov, platform, rememberedPick: pickMemory.get() });
        launch(transport.kind, link);
        return outcome;
    }

    async function getBalances(chainId, address) {
        const prov = provider();
        if (prov) return prov.getBalances(chainId, address);
        const coin = explorerCoin(chainId);
        if (coin === null) return failure('CHAIN_NOT_SUPPORTED');
        if (typeof address !== 'string' || address.length === 0) {
            throw new TypeError('address must be a non-empty string');
        }
        if (typeof options.explorerUrl !== 'string') {
            throw new TypeError('explorerUrl is required to read balances without the extension');
        }
        const base = options.explorerUrl.replace(/\/$/, '');
        const response = await fetchImpl(`${base}/${coin}/api/balances/${encodeURIComponent(address)}`);
        const body = await response.json();
        if (body === null || typeof body !== 'object' || !Array.isArray(body.data)) {
            throw new TypeError('explorer response is malformed');
        }
        const data = body.data
            .filter((entry) => typeof entry?.tick === 'string' && typeof entry?.amount === 'string')
            .map(({ tick, amount }) => ({ tick, amount }));
        return { address, data, total: Number.isInteger(body.total) ? body.total : data.length };
    }

    function start() {
        if (typeof win?.BroadcastChannel === 'function' && channel === null) {
            channel = new win.BroadcastChannel(CHANNEL_NAME);
            channel.onmessage = (event) => {
                const data = event?.data;
                if (data && waiters.has(data.id)) {
                    pending.clear();
                    const result = { ...data, solicited: true };
                    settle(result);
                    notify(result);
                }
            };
        }
        win?.addEventListener?.('hashchange', () => handleReturn());
        return handleReturn();
    }

    return {
        request,
        handleReturn,
        getBalances,
        start,
        onReturn(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        close() {
            channel?.close();
            channel = null;
        },
    };
}
