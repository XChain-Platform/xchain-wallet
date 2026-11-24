// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useFoldDivision } from '../../../packages/core/src/shared/hooks/useFoldDivision.js';
import { installNativeFold } from '../../../packages/web/src/platform/nativeFold.js';
import {
    assignNativeFold,
    foldPayloadFor,
    publishNativeFold,
    seedNativeFold,
    setNativeFold,
} from '../../e2e/fixtures/foldPublish.js';

const bookDivision = {
    orientation: 'vertical',
    x: 475.5,
    y: 0,
    width: 0,
    height: 669,
};
const bookPayload = {
    posture: 'open',
    division: bookDivision,
    display: 'inner',
};
const closedPayload = {
    posture: 'closed',
    division: { orientation: 'none', x: 0, y: 0, width: 0, height: 0 },
    display: 'outer',
};

afterEach(() => {
    cleanup();
    delete globalThis.__xchainNativeFold;
    document.documentElement.removeAttribute('data-fold');
    document.documentElement.style.removeProperty('--xc-fold-x');
    document.documentElement.style.removeProperty('--xc-fold-y');
    document.documentElement.style.removeProperty('--xc-fold-width');
    document.documentElement.style.removeProperty('--xc-fold-height');
    vi.restoreAllMocks();
});

describe('foldPayloadFor', () => {
    it('builds the open inner payload with its measured vertical division', () => {
        const viewport = {
            name: 'Duo open-portrait',
            state: 'open-portrait',
            width: 951,
            height: 669,
            division: bookDivision,
        };

        expect(foldPayloadFor(viewport)).toEqual(bookPayload);
        expect(foldPayloadFor(viewport).division).toBe(bookDivision);
    });

    it('builds closed outer payloads with a no-fold division', () => {
        expect(foldPayloadFor({
            state: 'closed-portrait',
            division: closedPayload.division,
        })).toEqual(closedPayload);
        expect(foldPayloadFor({ state: 'closed-landscape' })).toEqual(closedPayload);
    });

    it.each([
        ['an unsupported orientation', { ...bookDivision, orientation: 'diagonal' }],
        ['a negative coordinate', { ...bookDivision, x: -1 }],
        ['a non-finite dimension', { ...bookDivision, height: Number.NaN }],
    ])('replaces %s with a no-fold division', (_label, division) => {
        expect(foldPayloadFor({ state: 'open-landscape', division })).toEqual({
            posture: 'open',
            division: closedPayload.division,
            display: 'inner',
        });
    });

    it.each([
        { state: 'partial-vertical', division: bookDivision },
        null,
        'open-portrait',
    ])('returns null for an unsupported viewport: %j', (viewport) => {
        expect(foldPayloadFor(viewport)).toBeNull();
    });
});

describe('native fold publishing', () => {
    it('updates useFoldDivision from an open Book payload and then a closed payload', () => {
        const { result } = renderHook(() => useFoldDivision());

        act(() => publishNativeFold(bookPayload));
        expect(result.current).toEqual({
            vertical: true,
            dividerX: 475.5,
            horizontal: false,
            divisionY: null,
        });

        act(() => publishNativeFold(closedPayload));
        expect(result.current.vertical).toBe(false);
    });

    it('dispatches a CustomEvent carrying the payload', () => {
        const listener = vi.fn();
        globalThis.addEventListener('xchain:native-fold', listener, { once: true });

        publishNativeFold(bookPayload);

        expect(listener).toHaveBeenCalledOnce();
        const [event] = listener.mock.calls[0];
        expect(event).toBeInstanceOf(CustomEvent);
        expect(event.detail).toBe(bookPayload);
    });

    it('drives installed web fold state from vertical to none', () => {
        const uninstall = installNativeFold();

        publishNativeFold(bookPayload);
        expect(document.documentElement).toHaveAttribute('data-fold', 'vertical');

        publishNativeFold(closedPayload);
        expect(document.documentElement).toHaveAttribute('data-fold', 'none');

        uninstall();
    });

    it('deletes the global while still publishing null', () => {
        globalThis.__xchainNativeFold = bookPayload;
        const listener = vi.fn();
        globalThis.addEventListener('xchain:native-fold', listener, { once: true });

        publishNativeFold(null);

        expect(globalThis).not.toHaveProperty('__xchainNativeFold');
        expect(listener.mock.calls[0][0].detail).toBeNull();
    });

    it('serializes both browser functions without outer bindings', () => {
        const rebuiltPublish = new Function(`return (${publishNativeFold.toString()})`)();
        const rebuiltAssign = new Function(`return (${assignNativeFold.toString()})`)();
        const listener = vi.fn();
        globalThis.addEventListener('xchain:native-fold', listener, { once: true });

        rebuiltAssign(closedPayload);
        expect(globalThis.__xchainNativeFold).toBe(closedPayload);

        rebuiltPublish(bookPayload);
        expect(globalThis.__xchainNativeFold).toBe(bookPayload);
        expect(listener.mock.calls[0][0]).toBeInstanceOf(CustomEvent);
        expect(listener.mock.calls[0][0].detail).toBe(bookPayload);
    });
});

describe('Playwright adapters', () => {
    it('passes publishNativeFold and one payload argument to page.evaluate', async () => {
        const page = { evaluate: vi.fn(async (publisher, payload) => publisher(payload)) };

        await expect(setNativeFold(page, bookPayload)).resolves.toBeUndefined();
        expect(page.evaluate).toHaveBeenCalledWith(publishNativeFold, bookPayload);
        expect(globalThis.__xchainNativeFold).toBe(bookPayload);
    });

    it('passes assignNativeFold and one payload argument to page.addInitScript', async () => {
        const page = { addInitScript: vi.fn(async (assigner, payload) => assigner(payload)) };

        await expect(seedNativeFold(page, closedPayload)).resolves.toBeUndefined();
        expect(page.addInitScript).toHaveBeenCalledWith(assignNativeFold, closedPayload);
        expect(globalThis.__xchainNativeFold).toBe(closedPayload);
    });
});
