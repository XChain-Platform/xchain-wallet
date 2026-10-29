// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Native provider edges on the dApp connect path: the injected provider, the
// content-script relay, the bridge.connect handler with the real approval
// broker, and the connect prompt itself. Every case ends in one grant or one
// clear refusal, and no grant reaches an origin the operator did not approve.

import React from 'react';
import PROVIDER_SRC from '../../../packages/extension/src/inject/xchainProvider.js?raw';
import CONTENT_SRC from '../../../packages/extension/src/content/contentScript.js?raw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BUNDLED_DESCRIPTORS } from '../../../packages/core/src/registry/index.js';
import { MessageHost } from '../../../packages/extension/src/background/MessageHost.js';
import { ApprovalBroker } from '../../../packages/extension/src/background/approvalBroker.js';
import { registerBridgeHandlers } from '../../../packages/extension/src/bridge/handlers.js';

const mocks = vi.hoisted(() => ({
    getSettings: vi.fn(),
    resolveApproval: vi.fn(),
}));

vi.mock('../../../packages/extension/src/approval/messaging.js', () => ({
    getSettings: mocks.getSettings,
    resolveApproval: mocks.resolveApproval,
}));

const { ConnectApproval } = await import(
    '../../../packages/extension/src/approval/kinds/ConnectApproval.jsx'
);


const ORIGIN = 'https://dapp.example';
const chain = BUNDLED_DESCRIPTORS[0];

// A page realm the classic scripts run against, with its own message bus.
function fakePage({ origin = ORIGIN, top, protocol } = {}) {
    const listeners = [];
    const posted = [];
    const url = origin === 'null' ? null : new URL(origin);
    const win = {
        location: {
            origin,
            protocol: protocol ?? (url ? url.protocol : 'https:'),
            hostname: url ? url.hostname : '',
            pathname: '/',
        },
        document: {
            contentType: 'text/html',
            head: { appendChild: vi.fn() },
            documentElement: { appendChild: vi.fn() },
            createElement: () => ({ addEventListener: vi.fn(), remove: vi.fn() }),
        },
        addEventListener: (type, fn) => { if (type === 'message') listeners.push(fn); },
        dispatchEvent: vi.fn(),
        postMessage: (data, targetOrigin) => { posted.push({ data, targetOrigin }); },
    };
    win.top = top ?? win;
    const deliver = (data, { source = win, from = origin } = {}) => {
        for (const fn of [...listeners]) fn({ source, origin: from, data });
    };
    return { win, posted, deliver };
}

function runProvider(page) {
    // eslint-disable-next-line no-new-func
    new Function('window', PROVIDER_SRC)(page.win);
}

function runContentScript(page, chromeApi) {
    // eslint-disable-next-line no-new-func
    new Function('window', 'document', 'chrome', CONTENT_SRC)(page.win, page.win.document, chromeApi);
}

function fakeChrome() {
    const sent = [];
    return {
        sent,
        runtime: {
            getURL: (p) => `chrome-extension://wallet/${p}`,
            lastError: undefined,
            sendMessage: vi.fn((message, cb) => { sent.push({ message, cb }); }),
            onMessage: { addListener: vi.fn() },
        },
    };
}

function fakeVault(accounts = [
    { id: 'acct-1', name: 'Account 1' },
    { id: 'acct-2', name: 'Account 2' },
]) {
    const sites = new Map();
    const state = { accounts };
    return {
        _sites: sites,
        _state: state,
        settings: { get: async () => ({ developerMode: false, fees: {} }) },
        accounts: { list: async () => state.accounts.slice() },
        connectedSites: {
            findBy: async (field, value) => [...sites.values()].filter((s) => s[field] === value),
            put: async (s) => { sites.set(s.id, s); return s; },
            delete: async (id) => { sites.delete(id); },
        },
        blockedSites: { findBy: async () => [] },
    };
}

const chainRegistry = { get: () => null, supportedChains: () => [] };

function makeBackground({ vault = fakeVault(), approvals } = {}) {
    const windows = {
        create: vi.fn(async () => ({ id: windows.create.mock.calls.length })),
        remove: vi.fn(async () => {}),
        onRemoved: { addListener: vi.fn() },
    };
    let n = 0;
    const broker = approvals ?? new ApprovalBroker({
        windows,
        action: { setBadgeText: async () => {} },
        getUrl: (p) => `chrome-extension://wallet/${p}`,
        newId: () => `req-${++n}`,
        setTimer: () => 0,
        clearTimer: () => {},
    });
    const host = new MessageHost({ vault, chainRegistry, sdkRegistry: {} });
    registerBridgeHandlers(host, { approvals: broker });
    const call = (type, request) => host.handle({ type, request });
    return { vault, broker, windows, call };
}

const flush = () => new Promise((r) => { setTimeout(r, 0); });

const APPROVE = {
    approved: true,
    chains: [chain.id],
    accounts: ['acct-1'],
    canSignMessage: false,
    canSignAction: {},
};

beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({});
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('provider edges: iframe and opaque origins', () => {
    it('installs no provider and no relay inside an iframe', () => {
        const parent = fakePage();
        const frame = fakePage({ origin: 'https://ads.example', top: parent.win });
        const chromeApi = fakeChrome();
        runProvider(frame);
        runContentScript(frame, chromeApi);

        expect(frame.win.xchain).toBeUndefined();
        frame.deliver({ source: 'xchain-inject', id: 'f1', type: 'bridge.connect', request: {} });
        expect(chromeApi.sent).toHaveLength(0);
        expect(frame.posted).toHaveLength(0);
    });

    it('installs no provider and no relay in a sandboxed (opaque) document', () => {
        const page = fakePage({ origin: 'null', protocol: 'https:' });
        const chromeApi = fakeChrome();
        runProvider(page);
        runContentScript(page, chromeApi);

        expect(page.win.xchain).toBeUndefined();
        page.deliver({ source: 'xchain-inject', id: 'o1', type: 'bridge.connect', request: {} }, { from: 'null' });
        expect(chromeApi.sent).toHaveLength(0);
    });

    it('relays nothing a child frame posts to the top page', () => {
        const page = fakePage();
        const chromeApi = fakeChrome();
        runContentScript(page, chromeApi);

        page.deliver(
            { source: 'xchain-inject', id: 'c1', type: 'bridge.connect', request: {} },
            { source: { other: true }, from: 'https://ads.example' },
        );
        expect(chromeApi.sent).toHaveLength(0);
    });

    it('stamps the document origin on a connect whatever origin the page names', () => {
        const page = fakePage();
        const chromeApi = fakeChrome();
        runContentScript(page, chromeApi);

        page.deliver({
            source: 'xchain-inject',
            id: 'c2',
            type: 'bridge.connect',
            request: { origin: 'https://bank.example', requestedChains: [chain.id] },
        });
        expect(chromeApi.sent).toHaveLength(1);
        expect(chromeApi.sent[0].message.request.origin).toBe(ORIGIN);
    });
});

describe('provider edges: a page that replaces or freezes the provider', () => {
    it('keeps the wallet provider when the page tries to replace it', () => {
        const page = fakePage();
        runProvider(page);
        const real = page.win.xchain;

        expect(Reflect.set(page.win, 'xchain', { isXChainWallet: true, connect: () => 'forged' })).toBe(false);
        expect(() => Object.defineProperty(page.win, 'xchain', { value: {} })).toThrow(TypeError);
        expect(page.win.xchain).toBe(real);
    });

    it('settles a connect on a frozen provider exactly once', async () => {
        const page = fakePage();
        runProvider(page);
        Object.freeze(page.win.xchain);

        const pending = page.win.xchain.connect({ requestedChains: [chain.id] });
        expect(page.posted).toHaveLength(1);
        const { id, type } = page.posted[0].data;
        expect(type).toBe('bridge.connect');
        expect(page.posted[0].targetOrigin).toBe(ORIGIN);

        const result = { ok: true, accounts: [{ id: 'acct-1' }] };
        page.deliver({ source: 'xchain-inject-response', id, ok: true, result });
        page.deliver({
            source: 'xchain-inject-response',
            id,
            ok: false,
            error: { name: 'BridgeError', message: 'late', code: 'USER_REJECTED' },
        });
        await expect(pending).resolves.toBe(result);
    });

    it('ignores a forged response from another origin', async () => {
        const page = fakePage();
        runProvider(page);

        const pending = page.win.xchain.connect({});
        const { id } = page.posted[0].data;
        page.deliver(
            { source: 'xchain-inject-response', id, ok: true, result: { forged: true } },
            { from: 'https://evil.example' },
        );
        page.deliver({
            source: 'xchain-inject-response',
            id,
            ok: false,
            error: { name: 'BridgeError', message: 'User rejected', code: 'USER_REJECTED' },
        });
        await expect(pending).resolves.toEqual({
            ok: false,
            error: 'USER_REJECTED',
            message: 'User rejected',
        });
    });
});

describe('bridge.connect edges with the real approval broker', () => {
    it('refuses a connect whose origin is not a non-empty string', async () => {
        const bg = makeBackground();
        for (const origin of [undefined, 42, { href: ORIGIN }, '']) {
            const res = await bg.call('bridge.connect', { origin });
            expect(res.ok).toBe(false);
        }
        expect(bg.windows.create).not.toHaveBeenCalled();
        expect(bg.vault._sites.size).toBe(0);
    });

    it('grants only the origin the approval named', async () => {
        const bg = makeBackground();
        const pending = bg.call('bridge.connect', { origin: ORIGIN, requestedChains: [chain.id] });
        await flush();
        const [id] = [...bg.broker._pending.keys()];
        expect(bg.broker.fetch(id).payload.origin).toBe(ORIGIN);
        await bg.broker.resolve(id, APPROVE);
        expect((await pending).ok).toBe(true);

        const sites = [...bg.vault._sites.values()];
        expect(sites.map((s) => s.origin)).toEqual([ORIGIN]);
        const other = await bg.call('bridge.getAccounts', { origin: 'https://other.example' });
        expect(other.ok).toBe(false);
        expect(other.error.code).toBe('NOT_CONNECTED');
    });

    it('ends a disconnect sent while the approval is open in one grant', async () => {
        const bg = makeBackground();
        const pending = bg.call('bridge.connect', { origin: ORIGIN, requestedChains: [chain.id] });
        await flush();
        const disconnect = await bg.call('bridge.disconnect', { origin: ORIGIN });
        expect(disconnect).toEqual({ ok: true, result: { disconnected: false } });

        const [id] = [...bg.broker._pending.keys()];
        await bg.broker.resolve(id, APPROVE);
        expect((await pending).ok).toBe(true);
        expect(bg.vault._sites.size).toBe(1);
        expect(await bg.broker.resolve(id, APPROVE)).toBe(false);
        expect(bg.vault._sites.size).toBe(1);
    });

    it('drops an account removed between the approval and the grant', async () => {
        const bg = makeBackground();
        const pending = bg.call('bridge.connect', { origin: ORIGIN, requestedChains: [chain.id] });
        await flush();
        const [id] = [...bg.broker._pending.keys()];
        expect(bg.broker.fetch(id).payload.accountOptions.map((a) => a.id)).toEqual(['acct-1', 'acct-2']);

        bg.vault._state.accounts = [{ id: 'acct-2', name: 'Account 2' }];
        await bg.broker.resolve(id, { ...APPROVE, accounts: ['acct-1'] });
        const res = await pending;
        expect(res.ok).toBe(true);
        const [site] = [...bg.vault._sites.values()];
        expect(site.permissions.accounts).toEqual(['acct-2']);
        expect(site.permissions.accounts).not.toContain('acct-1');
    });

    it('turns a closed approval window into one USER_REJECTED and no grant', async () => {
        const bg = makeBackground();
        const pending = bg.call('bridge.connect', { origin: ORIGIN, requestedChains: ['not-a-chain'] });
        await flush();
        const [id] = [...bg.broker._pending.keys()];
        await bg.broker.resolve(id, { approved: false });
        const res = await pending;
        expect(res.ok).toBe(false);
        expect(res.error.code).toBe('USER_REJECTED');
        expect(bg.vault._sites.size).toBe(0);
    });

    it('opens one window for the same origin connecting from two tabs', async () => {
        const bg = makeBackground();
        const tabA = bg.call('bridge.connect', { origin: ORIGIN, requestedChains: [chain.id], requesterTabId: 11 });
        const tabB = bg.call('bridge.connect', { origin: ORIGIN, requestedChains: [chain.id], requesterTabId: 12 });
        await flush();
        expect(bg.windows.create).toHaveBeenCalledOnce();
        const [id] = [...bg.broker._pending.keys()];
        await bg.broker.resolve(id, APPROVE);
        const [a, b] = await Promise.all([tabA, tabB]);
        expect(a.ok).toBe(true);
        expect(b.ok).toBe(true);
    });

    // Both tabs share one approval prompt, and the second tab waits on the
    // first connect, so the origin ends with exactly one stored grant.
    it('stores one grant for the same origin connecting from two tabs', async () => {
        const bg = makeBackground();
        const tabA = bg.call('bridge.connect', { origin: ORIGIN, requestedChains: [chain.id], requesterTabId: 11 });
        const tabB = bg.call('bridge.connect', { origin: ORIGIN, requestedChains: [chain.id], requesterTabId: 12 });
        await flush();
        const [id] = [...bg.broker._pending.keys()];
        await bg.broker.resolve(id, APPROVE);
        await Promise.all([tabA, tabB]);

        expect([...bg.vault._sites.values()].filter((s) => s.origin === ORIGIN)).toHaveLength(1);
    });

    // One grant per origin means one disconnect leaves nothing that answers
    // reads for that origin.
    it('leaves no grant after one disconnect that follows a two-tab connect', async () => {
        const bg = makeBackground();
        const tabA = bg.call('bridge.connect', { origin: ORIGIN, requestedChains: [chain.id], requesterTabId: 11 });
        const tabB = bg.call('bridge.connect', { origin: ORIGIN, requestedChains: [chain.id], requesterTabId: 12 });
        await flush();
        const [id] = [...bg.broker._pending.keys()];
        await bg.broker.resolve(id, APPROVE);
        await Promise.all([tabA, tabB]);

        const disconnect = await bg.call('bridge.disconnect', { origin: ORIGIN });
        expect(disconnect.result.disconnected).toBe(true);
        const after = await bg.call('bridge.getAccounts', { origin: ORIGIN });
        expect(after.ok).toBe(false);
        expect(after.error.code).toBe('NOT_CONNECTED');
    });
});

describe('ConnectApproval prompt edges', () => {
    function mount(payload, id = 'edge') {
        return render(<ConnectApproval id={id} payload={payload} onReject={() => {}} />);
    }

    it.each([
        ['sandboxed opaque', 'null'],
        ['about:blank frame', 'about:blank'],
        ['data URL frame', 'data:text/html,hi'],
        ['number', 42],
        ['object', { origin: ORIGIN }],
    ])('blocks a %s origin with plain copy', (_label, origin) => {
        mount({ origin, requestedChains: [chain.id], accountOptions: [{ id: 'acct-1' }] });

        expect(screen.getByRole('alert')).toHaveTextContent('This connection request is missing or invalid.');
        expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
        expect(mocks.resolveApproval).not.toHaveBeenCalled();
    });

    it('renders an oversized origin in full and grants once', async () => {
        const origin = `https://${'a'.repeat(60)}.${'b'.repeat(60)}.${'c'.repeat(60)}.example`;
        mocks.resolveApproval.mockResolvedValue(undefined);
        vi.spyOn(window, 'close').mockImplementation(() => {});
        mount({ origin, requestedChains: [chain.id], accountOptions: [{ id: 'acct-1' }] });

        expect(screen.getByTestId('request-origin-full').textContent).toBe(origin);
        const approve = screen.getByRole('button', { name: 'Approve' });
        fireEvent.click(approve);
        fireEvent.click(approve);
        await vi.waitFor(() => expect(mocks.resolveApproval).toHaveBeenCalledOnce());
    });

    it('offers no grant for an unknown chain id and keeps reject live', () => {
        const onReject = vi.fn();
        render(
            <ConnectApproval
                id="unknown-chain"
                payload={{ origin: ORIGIN, requestedChains: ['not-a-chain'], accountOptions: [{ id: 'acct-1' }] }}
                onReject={onReject}
            />,
        );

        expect(screen.queryAllByRole('checkbox', { name: /^Allow / })).toHaveLength(0);
        const approve = screen.getByRole('button', { name: 'Approve' });
        expect(approve).toBeDisabled();
        fireEvent.click(approve);
        fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
        expect(onReject).toHaveBeenCalledOnce();
        expect(mocks.resolveApproval).not.toHaveBeenCalled();
    });

    it('grants only the known chain when the request mixes known and unknown ids', async () => {
        mocks.resolveApproval.mockResolvedValue(undefined);
        vi.spyOn(window, 'close').mockImplementation(() => {});
        mount({ origin: ORIGIN, requestedChains: ['not-a-chain', chain.id], accountOptions: [{ id: 'acct-1' }] });

        fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
        await vi.waitFor(() => expect(mocks.resolveApproval).toHaveBeenCalledOnce());
        expect(mocks.resolveApproval.mock.calls[0][1].chains).toEqual([chain.id]);
    });

    it.each([
        ['a string', 'bitcoin-mainnet'],
        ['an empty id', ['']],
        ['a non-string id', [7]],
    ])('blocks requestedChains given as %s', (_label, requestedChains) => {
        mount({ origin: ORIGIN, requestedChains, accountOptions: [{ id: 'acct-1' }] });
        expect(screen.getByRole('alert')).toHaveTextContent('This connection request is missing or invalid.');
        expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    });
});
