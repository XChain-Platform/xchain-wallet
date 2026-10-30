// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The popup under hostile launch input, two windows unlocking together,
// replies that arrive late or malformed, and a large wallet set. Each case
// ends on a usable screen: no thrown render error, no console error, no
// endless spinner, and no prefilled amount that is not a finite number.

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registry as registryLib } from '@xchain-wallet/core';
import { App } from '../../../packages/extension/src/popup/App.jsx';
import { deepLinkRoute } from '../../../packages/desktop/renderer/deepLinkRoute.js';
import { SURFACE_STATE_STORAGE_KEY } from '../../../packages/extension/src/shared/surfaceStateSync.js';
import { getSessionStatus } from '../../../packages/extension/src/popup/messaging.js';

// A test can replace the session reply with any resolved value; every other
// test reaches the mocked background through the real messaging module.
const sessionReply = { override: null };
vi.mock('../../../packages/extension/src/popup/messaging.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        getSessionStatus: vi.fn((...args) => (sessionReply.override
            ? sessionReply.override()
            : actual.getSessionStatus(...args))),
    };
});

const POPUP_WIDTH = 360;
const POPUP_HEIGHT = 600;

beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
    sessionReply.override = null;
    vi.mocked(getSessionStatus).mockClear();
    cleanup();
    localStorage.clear();
    window.history.replaceState(null, '', '/');
    vi.unstubAllGlobals();
});

function seedOnboardingDone(walletId = 'w1') {
    localStorage.setItem('xc:onboardingExplainerSeenAt', '2026-10-13T00:00:00.000Z');
    localStorage.setItem('xc:licenseAcceptedAt', '2026-10-13T00:00:00.000Z');
    localStorage.setItem('xc:licenseAcceptedVersion', '2');
    localStorage.setItem('xchain.activeWallet', walletId);
    localStorage.setItem(`xc:activeAccount:${walletId}`, `${walletId}-a1`);
}

/**
 * One mocked background shared by every App instance rendered while it is
 * installed. `handlers` override replies per message type; a handler returns
 * the raw reply envelope, or `undefined` to leave the request unanswered.
 */
function installBackground({ session = 'unlocked', wallets, balances, handlers = {} } = {}) {
    const listeners = new Set();
    const state = { session, unlockAccepted: 0, unlockRequests: 0 };
    const sent = [];
    const walletRows = wallets || [{ id: 'w1', name: 'Alpha', format: 'bip39' }];
    const deliver = (kind, payload) => {
        for (const listener of [...listeners]) {
            listener({
                [SURFACE_STATE_STORAGE_KEY]: { newValue: { kind, payload, revision: String(Math.random()) } },
            }, 'session');
        }
    };
    const reply = (message) => {
        if (handlers[message.type]) return handlers[message.type](message, state);
        switch (message.type) {
        case 'session.status':
            return { ok: true, result: { state: state.session } };
        case 'wallet.unlock':
            state.unlockRequests += 1;
            if (state.session === 'unlocked') {
                // The background treats a second unlock as a no-op on the
                // live session and opens no new one.
                return { ok: true, result: { unlocked: true, passphraseCaptureNeeded: [] } };
            }
            state.unlockAccepted += 1;
            state.session = 'unlocked';
            deliver('session', { state: 'unlocked' });
            return { ok: true, result: { unlocked: true, passphraseCaptureNeeded: [] } };
        case 'wallet.list':
            return { ok: true, result: walletRows };
        case 'account.list': {
            const walletId = message.request?.walletId || 'w1';
            return { ok: true, result: [{ id: `${walletId}-a1`, walletId, index: 0, name: 'Account 1' }] };
        }
        case 'balances.wallet':
            return balances ? { ok: true, result: balances } : { ok: false, error: { name: 'Error', message: 'not available' } };
        default:
            return { ok: false, error: { name: 'Error', message: 'not available' } };
        }
    };
    vi.stubGlobal('chrome', {
        runtime: {
            lastError: undefined,
            getURL: (path) => `chrome-extension://wallet/${path}`,
            sendMessage: vi.fn((message, callback) => {
                sent.push(message);
                const envelope = reply(message);
                if (envelope === undefined) return;
                setTimeout(() => callback(envelope), 0);
            }),
        },
        storage: {
            onChanged: {
                addListener: (listener) => listeners.add(listener),
                removeListener: (listener) => listeners.delete(listener),
            },
            local: { get: (_key, callback) => callback({}) },
            session: { get: (_key, callback) => callback({}) },
        },
    });
    return { state, sent, deliver, listeners };
}

const settle = (ms = 0) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

function expectNoSpinner() {
    expect(screen.queryByRole('status', { name: /^loading/i })).not.toBeInTheDocument();
}

describe('popup launch input (IN)', () => {
    const big = `#/send?memo=${'A'.repeat(64 * 1024)}`;
    const hashes = [
        '#/send?amount=1e309',
        '#/send?amount=-0',
        '#/send?to=%00%E2%80%AE',
        big,
        '#/no-such-route/../../settings?x=1',
    ];

    it.each(hashes.map((hash) => [hash.length > 80 ? '64 KB hash' : hash, hash]))(
        'lands on Home with the junk hash %s',
        { timeout: 30_000 },
        async (_label, hash) => {
            seedOnboardingDone();
            window.history.replaceState(null, '', `/popup.html${hash}`);
            installBackground();
            render(<App />);
            await waitFor(() => expect(screen.getByRole('heading', { name: 'Home', level: 1 }))
                .toBeInTheDocument(), { timeout: 15_000 });
            expect(screen.queryByRole('textbox', { name: /amount/i })).not.toBeInTheDocument();
        },
    );

    const junkLinks = [
        'web+xchain:xchain:send?amount=1e309',
        'web+xchain:xchain:send?amount=-0',
        'web+xchain:xchain:send?amount=Infinity',
        'web+xchain:xchain:send?amount=NaN',
        'web+xchain:bitcoin:bcrt1qjunk?amount=1e309',
        'web+xchain:xchain:send?to=%00%E2%80%AE&amount=1',
        `web+xchain:xchain:send?memo=${'B'.repeat(64 * 1024)}`,
        'web+xchain:xchain:nope',
    ];

    it.each(junkLinks.map((link) => [link.length > 80 ? '64 KB link' : link, link]))(
        'routes the link %s to no non-finite amount',
        (_label, link) => {
            const route = deepLinkRoute(link, registryLib.defaultRegistry());
            if (route?.view === 'send' && route.sendPrefill?.amount !== undefined) {
                expect(Number.isFinite(Number(route.sendPrefill.amount))).toBe(true);
                expect(route.sendPrefill.amount).not.toMatch(/^-/);
            }
        },
    );

    it('opens on a safe screen and strips a non-finite amount link', { timeout: 30_000 }, async () => {
        seedOnboardingDone();
        window.history.replaceState(
            null,
            '',
            `/popup.html?uri=${encodeURIComponent('web+xchain:xchain:send?amount=1e309')}#/send?amount=1e309`,
        );
        installBackground();
        render(<App />);
        await screen.findByRole('heading', { name: 'Home', level: 1 }, { timeout: 15_000 });
        expect(window.location.search).toBe('');
        expect(screen.queryByDisplayValue(/e309|Infinity/i)).not.toBeInTheDocument();
    });
});

describe('two popups unlocking together (RA)', () => {
    it('accepts one unlock and leaves both windows unlocked', { timeout: 40_000 }, async () => {
        seedOnboardingDone();
        const bg = installBackground({ session: 'locked' });
        const first = render(<App />);
        const second = render(<App />);
        const forms = await waitFor(() => {
            const found = screen.getAllByRole('form', { name: 'Unlock wallet' });
            expect(found).toHaveLength(2);
            return found;
        }, { timeout: 15_000 });

        for (const form of forms) {
            const field = within(form).getByLabelText(/password/i, { selector: 'input' });
            fireEvent.change(field, { target: { value: 'correct horse' } });
        }
        await act(async () => {
            for (const form of forms) fireEvent.submit(form);
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        await waitFor(() => {
            expect(within(first.container).getByRole('heading', { name: 'Home', level: 1 })).toBeInTheDocument();
            expect(within(second.container).getByRole('heading', { name: 'Home', level: 1 })).toBeInTheDocument();
        }, { timeout: 20_000 });
        expect(bg.state.unlockAccepted).toBe(1);
        expect(bg.state.session).toBe('unlocked');
        expect(bg.state.unlockRequests).toBeLessThanOrEqual(2);
    });
});

describe('late and malformed background replies (NW/LC)', () => {
    it('drops a session reply that lands after the popup closes', { timeout: 20_000 }, async () => {
        seedOnboardingDone();
        const pending = [];
        installBackground({
            handlers: {
                'session.status': (message) => {
                    pending.push(message);
                    return undefined;
                },
            },
        });
        const callbacks = [];
        const runtime = globalThis.chrome.runtime;
        const original = runtime.sendMessage;
        runtime.sendMessage = vi.fn((message, callback) => {
            if (message.type === 'session.status') {
                callbacks.push(callback);
                return;
            }
            original(message, callback);
        });
        const view = render(<App />);
        await waitFor(() => expect(callbacks.length).toBeGreaterThan(0));
        view.unmount();
        await act(async () => {
            for (const callback of callbacks) callback({ ok: true, result: { state: 'unlocked' } });
            await new Promise((resolve) => setTimeout(resolve, 20));
        });
        // The console guard fails the test on a state update after unmount.
        expect(document.body.textContent).toBe('');
    });

    const malformed = [
        ['an empty object', {}],
        ['null', null],
        ['a string', 'ok'],
        ['ok with no payload', { ok: true }],
        ['ok with an empty payload', { ok: true, result: {} }],
    ];

    it.each(malformed)(
        'leaves no endless spinner when session.status answers %s',
        { timeout: 30_000 },
        async (_label, envelope) => {
            seedOnboardingDone();
            installBackground({ handlers: { 'session.status': () => envelope } });
            render(<App />);
            // Retries for a dropped reply run 150, 400 and 900 ms apart, then
            // the popup must settle on a screen the user can act on.
            await waitFor(() => {
                const actionable = screen.queryAllByRole('button').length > 0
                    || screen.queryByRole('alert')
                    || screen.queryByText(/unknown|try again|reconnect|could not|problem/i);
                expect(actionable).toBeTruthy();
            }, { timeout: 20_000 });
            expect(screen.queryByText(/^Loading/)).not.toBeInTheDocument();
        },
    );
});

describe('session status replies without a string state (NW)', () => {
    const shapes = [
        ['undefined', undefined],
        ['null', null],
        ['an empty object', {}],
        ['a numeric state', { state: 7 }],
        ['a string', 'unlocked'],
    ];

    it.each(shapes)(
        'shows the retryable error screen when getSessionStatus resolves %s',
        { timeout: 30_000 },
        async (_label, value) => {
            seedOnboardingDone();
            installBackground();
            sessionReply.override = () => Promise.resolve(value);
            render(<App />);
            const retry = await screen.findByRole('button', { name: 'Try again' }, { timeout: 15_000 });
            expect(screen.getByRole('heading', { name: "The wallet couldn't start.", level: 1 })).toBeInTheDocument();
            expect(screen.queryByRole('heading', { name: 'Home', level: 1 })).not.toBeInTheDocument();

            const before = vi.mocked(getSessionStatus).mock.calls.length;
            sessionReply.override = null;
            await act(async () => {
                fireEvent.click(retry);
                await new Promise((resolve) => setTimeout(resolve, 0));
            });
            expect(vi.mocked(getSessionStatus).mock.calls.length).toBeGreaterThan(before);
            await screen.findByRole('heading', { name: 'Home', level: 1 }, { timeout: 15_000 });
        },
    );

    it('renders Home when getSessionStatus resolves a valid reply', { timeout: 30_000 }, async () => {
        seedOnboardingDone();
        installBackground();
        sessionReply.override = () => Promise.resolve({ state: 'unlocked' });
        render(<App />);
        await screen.findByRole('heading', { name: 'Home', level: 1 }, { timeout: 15_000 });
        expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    });
});

describe('200 wallets and 500 tokens (SC)', () => {
    it('keeps the switcher and Home within the popup and opens the last wallet', { timeout: 60_000 }, async () => {
        const wallets = Array.from({ length: 200 }, (_, index) => ({
            id: `w${index + 1}`,
            name: `${String(index + 1).padStart(3, '0')} ${'N'.repeat(116)}`,
            format: 'bip39',
        }));
        const tokens = Array.from({ length: 500 }, (_, index) => ({
            tick: `TK${String(index).padStart(4, '0')}`,
            quantity: String(1000 + index),
            divisibility: 0,
        }));
        const balances = {
            'bitcoin-regtest': [{
                address: 'mScaleAddress',
                addressType: 'p2pkh',
                label: 'Main',
                balances: { native: { tick: 'BTC', quantity: '100000000', divisibility: 8 }, tokens },
                error: null,
            }],
        };
        seedOnboardingDone('w1');
        const bg = installBackground({ wallets, balances });
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: POPUP_WIDTH });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: POPUP_HEIGHT });
        render(<App />);
        await screen.findByRole('heading', { name: 'Home', level: 1 }, { timeout: 15_000 });
        await waitFor(() => expectNoSpinner(), { timeout: 20_000 });

        // jsdom has no layout, so the bound is the popup shell contract: the
        // document root carries the compact popup shell and no rendered node
        // sets an inline width wider than the popup.
        const tooWide = [...document.querySelectorAll('[style]')]
            .filter((node) => Number.parseFloat(node.style.width) > POPUP_WIDTH
                || Number.parseFloat(node.style.minWidth) > POPUP_WIDTH);
        expect(tooWide).toEqual([]);

        await act(async () => {
            const more = screen.queryByRole('button', { name: /^more$/i })
                || screen.queryByRole('button', { name: /more/i, hidden: false });
            if (more) fireEvent.click(more);
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        const switchButton = await waitFor(() => {
            const found = screen.queryByRole('button', { name: /switch wallet|choose wallet/i });
            if (!found) throw new Error('no wallet switcher entry');
            return found;
        }, { timeout: 10_000 });
        fireEvent.click(switchButton);
        await screen.findByRole('heading', { name: 'Wallets' }, { timeout: 15_000 });
        const last = await screen.findByText(new RegExp(`^200 N{116}$`), {}, { timeout: 15_000 });
        const rowsTooWide = [...document.querySelectorAll('[style]')]
            .filter((node) => Number.parseFloat(node.style.width) > POPUP_WIDTH);
        expect(rowsTooWide).toEqual([]);

        const row = last.closest('button') || last;
        await act(async () => {
            fireEvent.click(row);
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        await waitFor(() => expect(localStorage.getItem('xc:activeWallet') || '').toContain('"id":"w200"'), { timeout: 15_000 });
        await waitFor(() => expect(screen.getAllByTestId('wallet-identity')[0].getAttribute('title')).toMatch(/^200 N{116}$/), { timeout: 15_000 });
        await waitFor(() => expect(bg.sent.some((m) => m.type === 'account.list' && m.request?.walletId === 'w200'))
            .toBe(true), { timeout: 15_000 });
    });
});
