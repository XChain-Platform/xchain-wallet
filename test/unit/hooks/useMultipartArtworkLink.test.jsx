// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useMultipartArtworkLink } from '../../../packages/core/src/shared/hooks/useMultipartArtworkLink.js';

const TXID = 'ab'.repeat(32);
const LINK_TARGET = Object.freeze({ tick: 'art', issueActionIndex: '29' });

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, reject, resolve };
}

function transaction(actionIndex = 71) {
    return { actions: [{ action: 'FILE', action_index: actionIndex }] };
}

function detail(status = 'complete') {
    return {
        action: 'FILE',
        action_format: 1,
        status: 'valid',
        multipart: {
            file_hash: 'cd'.repeat(32),
            total_parts: 2,
            parts_received: status === 'complete' ? 2 : 1,
            total_bytes: 600000,
            status,
        },
    };
}

function explorerOf({ transactions = [transaction()], details = [detail()] } = {}) {
    const transactionQueue = [...transactions];
    const detailQueue = [...details];
    return {
        getTransaction: vi.fn(async () => transactionQueue.shift()),
        getAction: vi.fn(async () => detailQueue.shift()),
    };
}

function options(overrides = {}) {
    return {
        explorer: explorerOf(),
        tick: 'ART',
        coinTicker: 'btc',
        maxAttempts: 1,
        waitMs: 0,
        sleep: vi.fn(async () => {}),
        ...overrides,
    };
}

function setup(overrides = {}) {
    return renderHook((props) => useMultipartArtworkLink(props), {
        initialProps: options(overrides),
    });
}

async function runCheck(result, input = { txid: TXID, linkTarget: LINK_TARGET }) {
    let reply;
    await act(async () => { reply = await result.current.check(input); });
    return reply;
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('real preparation success', () => {
    it('uses the re-resolved explorer index in complete link fields', async () => {
        const explorer = explorerOf({ transactions: [transaction(83)] });
        const { result } = setup({ explorer });
        await expect(runCheck(result)).resolves.toEqual({
            ok: true,
            fields: {
                coin1: 'BTC',
                coin1ActionIndex: '83',
                coin2: 'BTC',
                coin2ActionIndex: '29',
            },
        });
        expect(result.current.fields.coin1ActionIndex).toBe('83');
        expect(result.current.notice).toBeNull();
        expect(explorer.getAction).toHaveBeenCalledWith('83');
    });
});

describe('real preparation retry notice', () => {
    it('maps a pending-forever manifest to a retryable notice', async () => {
        const sleep = vi.fn(async () => {});
        const explorer = explorerOf({
            transactions: [transaction(), transaction()],
            details: [detail('pending'), detail('pending')],
        });
        const { result } = setup({ explorer, maxAttempts: 2, sleep, waitMs: 7 });
        await expect(runCheck(result)).resolves.toEqual({ ok: false, reason: 'pending' });
        expect(result.current.fields).toBeNull();
        expect(result.current.notice).toMatchObject({ reason: 'pending', retryable: true });
        expect(explorer.getTransaction).toHaveBeenCalledTimes(2);
        expect(sleep).toHaveBeenCalledOnce();
    });
});

describe('real preparation terminal notice', () => {
    it('maps a token mismatch without calling the explorer', async () => {
        const explorer = explorerOf();
        const { result } = setup({ explorer });
        const linkTarget = { tick: 'other', issueActionIndex: 29 };
        await expect(runCheck(result, { txid: TXID, linkTarget }))
            .resolves.toEqual({ ok: false, reason: 'token_mismatch' });
        expect(result.current.notice).toMatchObject({
            reason: 'token_mismatch', retryable: false,
        });
        expect(explorer.getTransaction).not.toHaveBeenCalled();
        expect(explorer.getAction).not.toHaveBeenCalled();
    });
});

describe('prepare call ownership', () => {
    it('calls prepare exactly once with the hook and check inputs', async () => {
        const prepare = vi.fn().mockResolvedValue({ ok: true, fields: { ready: true } });
        const values = options({ prepare });
        const { result } = renderHook(() => useMultipartArtworkLink(values));
        const input = { txid: TXID, linkTarget: LINK_TARGET };
        await expect(runCheck(result, input)).resolves.toEqual({
            ok: true, fields: { ready: true },
        });
        expect(prepare).toHaveBeenCalledOnce();
        expect(prepare).toHaveBeenCalledWith({
            explorer: values.explorer,
            txid: TXID,
            linkTarget: LINK_TARGET,
            tick: 'ART',
            coinTicker: 'btc',
            maxAttempts: 1,
            waitMs: 0,
            sleep: values.sleep,
        });
    });

    it('does not mutate hook options or check input', async () => {
        const prepare = vi.fn().mockResolvedValue({ ok: true, fields: {} });
        const explorer = explorerOf();
        const sleep = vi.fn(async () => {});
        const values = Object.freeze(options({ explorer, prepare, sleep }));
        const input = Object.freeze({ txid: TXID, linkTarget: LINK_TARGET });
        const before = { ...values };
        const { result } = renderHook(() => useMultipartArtworkLink(values));
        await runCheck(result, input);
        expect(values).toEqual(before);
        expect(input).toEqual({ txid: TXID, linkTarget: LINK_TARGET });
    });
});

describe('single-flight checks', () => {
    it('returns null for a second check while the first is running', async () => {
        const pending = deferred();
        const prepare = vi.fn(() => pending.promise);
        const { result } = setup({ prepare });
        let first;
        act(() => { first = result.current.check({ txid: TXID, linkTarget: LINK_TARGET }); });
        expect(result.current.checking).toBe(true);
        await expect(result.current.check({ txid: TXID, linkTarget: LINK_TARGET }))
            .resolves.toBeNull();
        expect(prepare).toHaveBeenCalledOnce();
        await act(async () => {
            pending.resolve({ ok: true, fields: { ready: true } });
            await first;
        });
        expect(result.current.checking).toBe(false);
    });
});

describe('prepare rejection', () => {
    it('stores the original coded error and resolves null', async () => {
        const failure = Object.assign(new TypeError('Invalid txid'), {
            code: 'ARTWORK_LINK_PREP_INVALID',
        });
        const prepare = vi.fn().mockRejectedValue(failure);
        const { result } = setup({ prepare });
        await expect(runCheck(result)).resolves.toBeNull();
        expect(result.current).toMatchObject({
            checking: false, fields: null, notice: null, error: failure,
        });
        expect(result.current.error.code).toBe('ARTWORK_LINK_PREP_INVALID');
    });
});

describe('unmapped preparation refusal', () => {
    it('creates a non-retryable notice without a message', async () => {
        const prepare = vi.fn().mockResolvedValue({ ok: false, reason: 'future_reason' });
        const { result } = setup({ prepare });
        await runCheck(result);
        expect(result.current.fields).toBeNull();
        expect(result.current.notice).toEqual({
            reason: 'future_reason', message: null, retryable: false,
        });
    });
});

describe('unmount settlement guard', () => {
    it('drops a result that settles after unmount', async () => {
        const pending = deferred();
        const prepare = vi.fn(() => pending.promise);
        const { result, unmount } = setup({ prepare });
        const fieldsRead = vi.fn();
        const reply = {
            ok: true,
            get fields() {
                fieldsRead();
                return { stale: true };
            },
        };
        let promise;
        act(() => { promise = result.current.check({ txid: TXID, linkTarget: LINK_TARGET }); });
        unmount();
        pending.resolve(reply);
        await expect(promise).resolves.toBe(reply);
        expect(prepare).toHaveBeenCalledOnce();
        expect(fieldsRead).not.toHaveBeenCalled();
    });
});

describe('reset settlement guard', () => {
    it('clears state and drops a result that settles after reset', async () => {
        const pending = deferred();
        const prepare = vi.fn()
            .mockResolvedValueOnce({ ok: false, reason: 'pending' })
            .mockReturnValueOnce(pending.promise);
        const { result } = setup({ prepare });
        await runCheck(result);
        expect(result.current.notice).not.toBeNull();
        let promise;
        act(() => { promise = result.current.check({ txid: TXID, linkTarget: LINK_TARGET }); });
        act(() => { result.current.reset(); });
        expect(result.current).toMatchObject({ fields: null, notice: null, error: null });
        await act(async () => {
            pending.resolve({ ok: true, fields: { stale: true } });
            await promise;
        });
        expect(result.current).toMatchObject({
            checking: false, fields: null, notice: null, error: null,
        });
    });
});
