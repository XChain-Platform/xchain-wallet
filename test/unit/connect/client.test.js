// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';

import { createClient, PENDING_KEY } from '../../../packages/connect/src/client.js';
import { parseRequest } from '../../../packages/connect/src/request.js';

const NOW = 1_800_000_000_000;
const ID = 'AAAAAAAAAAAAAAAAAAAAAA';
const CLAIM = 'BBBBBBBBBBBBBBBBBBBBBB';

function memoryStorage() {
    const map = new Map();
    return {
        getItem: (key) => (map.has(key) ? map.get(key) : null),
        setItem: (key, value) => map.set(key, String(value)),
        removeItem: (key) => map.delete(key),
    };
}

function fakeElement(tag) {
    const el = {
        tag, children: [], dataset: {}, attrs: {}, handlers: {}, removed: false, textContent: '',
        append(...nodes) { el.children.push(...nodes); },
        setAttribute(name, value) { el.attrs[name] = value; },
        addEventListener(type, fn) { el.handlers[type] = fn; },
        remove() { el.removed = true; },
    };
    return el;
}

function fakeWindow(extra = {}) {
    const channels = [];
    class FakeChannel {
        constructor(name) { this.name = name; this.posted = []; channels.push(this); }
        postMessage(data) { this.posted.push(data); }
        close() { this.closed = true; }
    }
    const body = fakeElement('body');
    const win = {
        location: { origin: 'https://site.example', href: 'https://site.example/page', assign: vi.fn() },
        history: { state: null, replaceState: vi.fn() },
        navigator: { userAgent: 'Mozilla desktop' },
        document: {
            body,
            createElement: fakeElement,
            createElementNS: (ns, tag) => fakeElement(tag),
        },
        open: vi.fn(() => ({})),
        addEventListener: vi.fn(),
        BroadcastChannel: FakeChannel,
        ...extra,
    };
    return { win, channels, body };
}

function setup(winExtra = {}, options = {}) {
    const { win, channels, body } = fakeWindow(winExtra);
    const storage = memoryStorage();
    const client = createClient({ window: win, storage, now: NOW, ...options });
    return { client, win, storage, channels, body };
}

function returnHref(payload) {
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `https://site.example/page#xchain=${encoded}`;
}

function pendingId(storage) {
    return JSON.parse(storage.getItem(PENDING_KEY)).id;
}

describe('transport choice', () => {
    it('uses a provider at 0.2.0 or later', async () => {
        const signIn = vi.fn(async () => ({ address: 'bc1qa' }));
        const { client, win } = setup({ xchain: { version: '0.2.0', signIn } });
        const result = await client.request('login', {});
        expect(signIn).toHaveBeenCalled();
        expect(result).toMatchObject({ ok: true, result: { address: 'bc1qa' } });
        expect(win.location.assign).not.toHaveBeenCalled();
    });

    it('ignores a provider below 0.2.0', () => {
        const signIn = vi.fn();
        const { client, win } = setup({ xchain: { version: '0.1.9', signIn } });
        client.request('login', {}, { return: 'https://site.example/page' });
        expect(signIn).not.toHaveBeenCalled();
        expect(win.document.body.children[0].dataset.xchainChooser).toBe('true');
    });

    it('launches an Android intent', () => {
        const { client, win } = setup({ navigator: { userAgent: 'Android' } });
        client.request('login', {});
        expect(win.location.assign.mock.calls[0][0]).toMatch(/^intent:\/\/wallet\.xchain\.io\/link\//);
    });

    it('launches a universal link on iOS', () => {
        const { client, win } = setup({ navigator: { userAgent: 'iPhone' } });
        client.request('login', {});
        expect(win.location.assign.mock.calls[0][0]).toMatch(/^https:\/\/wallet\.xchain\.io\/link\/\?uri=/);
    });
});

describe('chooser and remembered pick', () => {
    it('offers the three picks and a QR for a short link', () => {
        const { client, body } = setup();
        client.request('login', {});
        const box = body.children[0];
        const picks = box.children.filter((c) => c.tag === 'button').map((c) => c.dataset.pick);
        expect(picks).toEqual(['app', 'web', 'get']);
        expect(box.children.some((c) => c.tag === 'svg')).toBe(true);
    });

    it('omits the QR when the link is over 2,900 chars', () => {
        const { client, body } = setup();
        client.request('signMessage', { message: 'x'.repeat(3000) });
        const box = body.children[0];
        expect(box.children.some((c) => c.tag === 'svg')).toBe(false);
    });

    it('remembers a pick and skips the chooser next time', () => {
        const first = setup();
        first.client.request('login', {});
        const web = first.body.children[0].children.find((c) => c.dataset.pick === 'web');
        web.handlers.click();
        expect(first.win.open.mock.calls[0][0]).toMatch(/^https:\/\/wallet\.xchain\.io\/\?uri=/);

        const { win, storage } = first;
        const again = createClient({ window: win, storage, now: NOW });
        again.request('login', {});
        expect(win.open).toHaveBeenCalledTimes(2);
    });

    it('opens the app link for the app pick', () => {
        const { client, win, body } = setup();
        client.request('login', {});
        body.children[0].children.find((c) => c.dataset.pick === 'app').handlers.click();
        expect(win.location.assign.mock.calls[0][0]).toMatch(/^xchain:request\?v=1&req=/);
    });
});

describe('pending store and requests', () => {
    it('stores one pending record per request', () => {
        const { client, storage } = setup();
        client.request('login', {});
        const record = JSON.parse(storage.getItem(PENDING_KEY));
        expect(Object.keys(record).sort()).toEqual(['id', 'method', 'nonce', 'state']);
        expect(record.method).toBe('login');
    });

    it('resolves a refusal for an invalid request', async () => {
        const { client } = setup();
        const result = await client.request('nope', {});
        expect(result.ok).toBe(false);
    });

    it('puts the request in the launched link', () => {
        const { client, win } = setup();
        client.request('login', {}, { state: 'abc' });
        win.document.body.children[0].children.find((c) => c.dataset.pick === 'app').handlers.click();
        const envelope = parseRequest(win.location.assign.mock.calls[0][0], { now: NOW });
        expect(envelope).toMatchObject({ method: 'login', state: 'abc' });
    });
});

describe('handleReturn', () => {
    it('settles the waiting request and clears the record and the fragment', async () => {
        const { client, win, storage, channels } = setup();
        const outcome = client.request('login', {});
        const id = pendingId(storage);
        const state = JSON.parse(storage.getItem(PENDING_KEY)).state;
        client.start();
        const result = client.handleReturn(returnHref({
            v: 1, id, method: 'login', ok: true, result: { address: 'bc1qa' }, state, claim: CLAIM,
        }));
        expect(result).toMatchObject({ ok: true, solicited: true });
        await expect(outcome).resolves.toMatchObject({ solicited: true });
        expect(storage.getItem(PENDING_KEY)).toBeNull();
        expect(win.history.replaceState).toHaveBeenCalledWith(null, '', 'https://site.example/page');
        expect(channels[0].posted[0].id).toBe(id);
    });

    it('answers NO_PENDING_REQUEST for an unsolicited signMessage', () => {
        const { client } = setup();
        const result = client.handleReturn(returnHref({
            v: 1, id: ID, method: 'signMessage', ok: true, result: { signature: 's' }, claim: CLAIM,
        }));
        expect(result).toEqual({ ok: false, error: 'NO_PENDING_REQUEST' });
    });

    it('answers NO_PENDING_REQUEST for a short unsolicited payload', () => {
        const { client } = setup();
        expect(client.handleReturn(returnHref({ id: ID, ok: true, claim: CLAIM })))
            .toEqual({ ok: false, error: 'NO_PENDING_REQUEST' });
    });

    it('answers NO_PENDING_REQUEST when the record is for another request', () => {
        const { client } = setup();
        client.request('login', {});
        expect(client.handleReturn(returnHref({
            v: 1, id: ID, method: 'signMessage', ok: true, result: {}, claim: CLAIM,
        }))).toEqual({ ok: false, error: 'NO_PENDING_REQUEST' });
    });

    it('shows the Continue bar for an unsolicited login and delivers on accept', () => {
        const { client, body } = setup();
        const listener = vi.fn();
        client.onReturn(listener);
        const result = client.handleReturn(returnHref({
            v: 1, id: ID, method: 'login', ok: true, result: { address: 'bc1qz' }, claim: CLAIM,
        }));
        expect(result.solicited).toBe(false);
        const bar = body.children[0];
        expect(bar.children[0].textContent).toBe('Continue as bc1qz?');
        expect(listener).not.toHaveBeenCalled();
        bar.children[1].handlers.click();
        expect(listener).toHaveBeenCalledWith(expect.objectContaining({ solicited: false }));
        expect(bar.removed).toBe(true);
    });

    it('returns null when there is no return fragment', () => {
        const { client } = setup();
        expect(client.handleReturn('https://site.example/page')).toBeNull();
    });
});

describe('BroadcastChannel', () => {
    it('settles the opener tab from a broadcast', async () => {
        const { client, storage, channels } = setup();
        client.start();
        const outcome = client.request('login', {});
        const id = pendingId(storage);
        channels[0].onmessage({ data: { v: 1, id, method: 'login', ok: true, result: { address: 'a' }, claim: CLAIM } });
        await expect(outcome).resolves.toMatchObject({ solicited: true, id });
    });

    it('ignores a broadcast nobody is waiting for', () => {
        const { client, channels } = setup();
        client.start();
        const listener = vi.fn();
        client.onReturn(listener);
        channels[0].onmessage({ data: { id: ID, ok: true, claim: CLAIM } });
        expect(listener).not.toHaveBeenCalled();
    });
});

describe('getBalances', () => {
    const body = { data: [{ tick: 'BTC', amount: '1', decimals: 8 }], total: 1 };
    const okFetch = () => vi.fn(async () => ({ json: async () => body }));

    it('reads the explorer map for each chain without a provider', async () => {
        const fetch = okFetch();
        const { client } = setup({}, { fetch, explorerUrl: 'https://explorer.test/' });
        const result = await client.getBalances('bitcoin-regtest', 'a b');
        expect(fetch).toHaveBeenCalledWith('https://explorer.test/RBTC/api/balances/a%20b');
        expect(result).toEqual({ address: 'a b', data: [{ tick: 'BTC', amount: '1' }], total: 1 });
    });

    it.each([
        ['bitcoin-mainnet', 'BTC'], ['bitcoin-testnet', 'TBTC'], ['litecoin-mainnet', 'LTC'],
        ['litecoin-testnet', 'TLTC'], ['litecoin-regtest', 'RLTC'], ['dogecoin-mainnet', 'DOGE'],
        ['dogecoin-testnet', 'TDOGE'], ['dogecoin-regtest', 'RDOGE'],
    ])('maps %s to %s', async (chain, coin) => {
        const fetch = okFetch();
        const { client } = setup({}, { fetch, explorerUrl: 'https://e.test' });
        await client.getBalances(chain, 'x');
        expect(fetch.mock.calls[0][0]).toBe(`https://e.test/${coin}/api/balances/x`);
    });

    it('refuses an unknown chain', async () => {
        const { client } = setup({}, { fetch: okFetch(), explorerUrl: 'https://e.test' });
        await expect(client.getBalances('solana-mainnet', 'x')).resolves
            .toEqual({ ok: false, error: 'CHAIN_NOT_SUPPORTED' });
    });

    it('rejects a malformed response', async () => {
        const fetch = vi.fn(async () => ({ json: async () => ({}) }));
        const { client } = setup({}, { fetch, explorerUrl: 'https://e.test' });
        await expect(client.getBalances('bitcoin-mainnet', 'x')).rejects.toThrow(TypeError);
    });

    it('goes through the provider when present', async () => {
        const getBalances = vi.fn(async () => [{ tick: 'BTC' }]);
        const { client } = setup({ xchain: { version: '0.2.0', getBalances } });
        await client.getBalances('bitcoin-mainnet', 'x');
        expect(getBalances).toHaveBeenCalledWith('bitcoin-mainnet', 'x');
    });
});
