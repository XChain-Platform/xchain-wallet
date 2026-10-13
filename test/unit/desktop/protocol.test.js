/**
 * @vitest-environment node
 */

// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    ALL_SCHEMES,
    TIER_1_SCHEME,
    TIER_2_SCHEMES,
    attachDeepLinkHandlers,
    classifyDeepLink,
    createDeepLinkSlot,
    pickDeepLinkTarget,
    registerProtocolClients,
    updateCoinSchemeOptIn,
} from '../../../packages/desktop/main/protocol.js';

function electronApp({ gotLock = true } = {}) {
    const listeners = new Map();
    return {
        listeners,
        requestSingleInstanceLock: vi.fn(() => gotLock),
        setAsDefaultProtocolClient: vi.fn(),
        removeAsDefaultProtocolClient: vi.fn(),
        on: vi.fn((name, listener) => { listeners.set(name, listener); }),
    };
}

const originalArgv = process.argv;
afterEach(() => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
});

describe('desktop protocol registration', () => {
    it('claims xchain and only the opted-in coin schemes', () => {
        const app = electronApp();

        registerProtocolClients(app, { optedInSchemes: ['bitcoin', 'dogecoin', 'unknown'] });

        expect(TIER_1_SCHEME).toBe('xchain');
        expect(TIER_2_SCHEMES).toEqual(['bitcoin', 'litecoin', 'dogecoin']);
        expect(ALL_SCHEMES).toEqual(['xchain', 'bitcoin', 'litecoin', 'dogecoin']);
        expect(app.setAsDefaultProtocolClient.mock.calls).toEqual([
            ['xchain'],
            ['bitcoin'],
            ['dogecoin'],
        ]);
        expect(app.removeAsDefaultProtocolClient).toHaveBeenCalledExactlyOnceWith('litecoin');
    });

    it('re-applies registration for a settings opt-in update', () => {
        const app = electronApp();

        updateCoinSchemeOptIn(app, ['litecoin']);

        expect(app.setAsDefaultProtocolClient.mock.calls).toEqual([
            ['xchain'],
            ['litecoin'],
        ]);
        expect(app.removeAsDefaultProtocolClient.mock.calls).toEqual([
            ['bitcoin'],
            ['dogecoin'],
        ]);
    });

    it('tolerates unsupported or failing best-effort removal', () => {
        const withoutRemoval = electronApp();
        delete withoutRemoval.removeAsDefaultProtocolClient;
        expect(() => registerProtocolClients(withoutRemoval)).not.toThrow();

        const failingRemoval = electronApp();
        failingRemoval.removeAsDefaultProtocolClient.mockImplementation(() => { throw new Error('OS refusal'); });
        expect(() => registerProtocolClients(failingRemoval)).not.toThrow();
    });

    it('rejects a missing Electron app handle', () => {
        expect(() => registerProtocolClients(null)).toThrow(/invalid Electron app handle/);
        expect(() => registerProtocolClients({})).toThrow(/invalid Electron app handle/);
    });
});

describe('desktop deep-link classification', () => {
    it('classifies coin payments and rejects unsupported required parameters', () => {
        expect(classifyDeepLink('BITCOIN:bc1qexample?amount=1.25&label=Lunch')).toMatchObject({
            scheme: 'bitcoin',
            raw: 'BITCOIN:bc1qexample?amount=1.25&label=Lunch',
            parsed: {
                scheme: 'bitcoin',
                address: 'bc1qexample',
                amount: '1.25',
                label: 'Lunch',
            },
        });
        expect(classifyDeepLink('bitcoin:bc1qexample?req-payjoin=1')).toEqual({
            scheme: 'bitcoin',
            raw: 'bitcoin:bc1qexample?req-payjoin=1',
            parsed: null,
        });
    });

    it('classifies and hardens xchain intents', () => {
        const rlo = String.fromCharCode(0x202e);
        const raw = `xchain:TBTC/send?to=addr&amount=1&memo=${encodeURIComponent(`Pay${rlo}rent`)}`;
        const link = classifyDeepLink(raw);

        expect(link.scheme).toBe('xchain');
        expect(link.raw).toBe(raw);
        expect(link.parsed.kind).toBe('send');
        expect(link.parsed.memo).not.toContain(rlo);
    });

    it.each([
        [null, null],
        ['', null],
        ['not-a-uri', null],
        ['https://example.com', null],
        ['bitcoin:bc1qexample?amount=not-a-number', { scheme: 'bitcoin', parsed: null }],
    ])('handles invalid or irrelevant input %j', (raw, expected) => {
        const result = classifyDeepLink(raw);
        if (expected === null) expect(result).toBe(null);
        else expect(result).toMatchObject(expected);
    });
});

describe('desktop deep-link delivery', () => {
    it('wires macOS and subsequent-instance Electron events', () => {
        process.argv = ['electron', 'app.js'];
        const app = electronApp();
        const onDeepLink = vi.fn();
        const onSecondInstance = vi.fn();

        expect(attachDeepLinkHandlers(app, { onDeepLink, onSecondInstance })).toEqual({ gotLock: true });

        const preventDefault = vi.fn();
        app.listeners.get('open-url')({ preventDefault }, 'dogecoin:DAddress?amount=2');
        app.listeners.get('second-instance')({}, ['electron', '--flag', 'litecoin:LAddress'], '/tmp');
        app.listeners.get('second-instance')({}, ['electron', 'https://example.com'], '/tmp');

        expect(preventDefault).toHaveBeenCalledOnce();
        expect(onSecondInstance).toHaveBeenCalledTimes(2);
        expect(onDeepLink).toHaveBeenCalledTimes(2);
        expect(onDeepLink.mock.calls[0][0]).toMatchObject({ scheme: 'dogecoin' });
        expect(onDeepLink.mock.calls[1][0]).toMatchObject({ scheme: 'litecoin' });
    });

    it('queues an Electron launch-argument link for the next turn', async () => {
        process.argv = ['electron', 'app.js', 'bitcoin:bc1qlaunch?amount=3'];
        const app = electronApp();
        const onDeepLink = vi.fn();

        attachDeepLinkHandlers(app, { onDeepLink });
        expect(onDeepLink).not.toHaveBeenCalled();
        await new Promise((resolve) => setImmediate(resolve));

        expect(onDeepLink).toHaveBeenCalledOnce();
        expect(onDeepLink.mock.calls[0][0]).toMatchObject({
            scheme: 'bitcoin',
            parsed: { address: 'bc1qlaunch', amount: '3' },
        });
    });

    it('does not install listeners when another Electron instance owns the lock', () => {
        const app = electronApp({ gotLock: false });

        expect(attachDeepLinkHandlers(app, { onDeepLink: vi.fn() })).toEqual({ gotLock: false });
        expect(app.on).not.toHaveBeenCalled();
    });

    it('requires a callback', () => {
        expect(() => attachDeepLinkHandlers(electronApp(), {})).toThrow(/onDeepLink/);
    });

    it('stores one pending link and hands it out once', () => {
        const slot = createDeepLinkSlot();
        const first = { raw: 'xchain:first' };
        const second = { raw: 'xchain:second' };

        slot.offer(first);
        slot.offer(second);

        expect(slot.take()).toBe(second);
        expect(slot.take()).toBe(null);
    });

    it('prefers a focused primary window, then the newest primary window', () => {
        const first = { id: 1 };
        const detached = { id: 2 };
        const newest = { id: 3 };
        const live = [first, detached, newest];
        const isDetached = (win) => win === detached;

        expect(pickDeepLinkTarget(live, first, isDetached)).toBe(first);
        expect(pickDeepLinkTarget(live, detached, isDetached)).toBe(newest);
        expect(pickDeepLinkTarget([detached], detached, isDetached)).toBe(null);
    });
});
