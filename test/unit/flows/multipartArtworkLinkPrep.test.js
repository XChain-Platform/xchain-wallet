// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { prepareArtworkLink } from '../../../packages/core/src/flows/multipartArtworkLinkPrep.js';

const TXID = 'ab'.repeat(32);

function multipart(status = 'complete') {
    return {
        file_hash: 'cd'.repeat(32),
        total_parts: 2,
        parts_received: status === 'complete' ? 2 : 1,
        total_bytes: 600000,
        status,
    };
}

function transaction(actionIndex = 71) {
    return { actions: [{ action: 'FILE', action_index: actionIndex }] };
}

function detail(status = 'complete') {
    return { action: 'FILE', action_format: 1, status: 'valid', multipart: multipart(status) };
}

function explorerOf({ transactions = [transaction()], details = [detail()] } = {}) {
    const transactionQueue = [...transactions];
    const detailQueue = [...details];
    return {
        getTransaction: vi.fn(async () => transactionQueue.shift()),
        getAction: vi.fn(async () => detailQueue.shift()),
    };
}

function input(overrides = {}) {
    return {
        explorer: explorerOf(),
        txid: TXID,
        linkTarget: { tick: 'art', issueActionIndex: '29' },
        tick: 'ART',
        coinTicker: 'btc',
        maxAttempts: 1,
        waitMs: 0,
        sleep: vi.fn(async () => {}),
        ...overrides,
    };
}

describe('complete artwork link preparation', () => {
    it('builds fields from the explorer index and target index', async () => {
        const explorer = explorerOf({ transactions: [transaction(71)] });
        await expect(prepareArtworkLink(input({ explorer }))).resolves.toEqual({
            ok: true,
            fields: {
                coin1: 'BTC',
                coin1ActionIndex: '71',
                coin2: 'BTC',
                coin2ActionIndex: '29',
            },
        });
        expect(explorer.getTransaction).toHaveBeenCalledOnce();
        expect(explorer.getAction).toHaveBeenCalledWith('71');
    });

    it('accepts a numeric issue index from a resumed upload', async () => {
        const linkTarget = { tick: 'ART', issueActionIndex: 43 };
        const result = await prepareArtworkLink(input({ linkTarget }));
        expect(result.fields.coin2ActionIndex).toBe('43');
    });
});

describe('polling artwork link preparation', () => {
    it('sleeps with waitMs between pending and complete attempts', async () => {
        const sleep = vi.fn(async () => {});
        const explorer = explorerOf({
            transactions: [transaction(), transaction()],
            details: [detail('pending'), detail('complete')],
        });
        await expect(prepareArtworkLink(input({
            explorer, sleep, maxAttempts: 3, waitMs: 17,
        }))).resolves.toMatchObject({ ok: true });
        expect(explorer.getTransaction).toHaveBeenCalledTimes(2);
        expect(sleep).toHaveBeenCalledOnce();
        expect(sleep).toHaveBeenCalledWith(17);
    });

    it('returns pending when all attempts remain pending', async () => {
        const sleep = vi.fn(async () => {});
        const explorer = explorerOf({
            transactions: [transaction(), transaction(), transaction()],
            details: [detail('pending'), detail('pending'), detail('pending')],
        });
        await expect(prepareArtworkLink(input({
            explorer, sleep, maxAttempts: 3,
        }))).resolves.toEqual({ ok: false, reason: 'pending' });
        expect(explorer.getTransaction).toHaveBeenCalledTimes(3);
        expect(sleep).toHaveBeenCalledTimes(2);
    });
});

describe('terminal artwork link preparation refusals', () => {
    it('returns mismatch without sleeping', async () => {
        const sleep = vi.fn(async () => {});
        const explorer = explorerOf({ details: [detail('mismatch')] });
        await expect(prepareArtworkLink(input({
            explorer, sleep, maxAttempts: 3,
        }))).resolves.toEqual({ ok: false, reason: 'mismatch' });
        expect(sleep).not.toHaveBeenCalled();
    });

    it('returns not_indexed for an unindexed transaction', async () => {
        const explorer = explorerOf({ transactions: [{ actions: [] }] });
        await expect(prepareArtworkLink(input({ explorer })))
            .resolves.toEqual({ ok: false, reason: 'not_indexed' });
        expect(explorer.getAction).not.toHaveBeenCalled();
    });

    it('returns unreadable for a thrown explorer error', async () => {
        const explorer = explorerOf();
        explorer.getTransaction.mockRejectedValueOnce(new Error('offline'));
        await expect(prepareArtworkLink(input({ explorer })))
            .resolves.toEqual({ ok: false, reason: 'unreadable' });
    });
});

describe('artwork link preparation target checks', () => {
    it.each([
        [null, 'no_link_target'],
        [{ tick: 'other', issueActionIndex: 29 }, 'token_mismatch'],
    ])('returns %s without explorer or sleep calls', async (linkTarget, reason) => {
        const explorer = explorerOf();
        const sleep = vi.fn(async () => {});
        await expect(prepareArtworkLink(input({ explorer, sleep, linkTarget })))
            .resolves.toEqual({ ok: false, reason });
        expect(explorer.getTransaction).not.toHaveBeenCalled();
        expect(explorer.getAction).not.toHaveBeenCalled();
        expect(sleep).not.toHaveBeenCalled();
    });
});

describe('artwork link preparation validation', () => {
    it.each([
        ['txid', { txid: 'AB'.repeat(32) }, null],
        ['explorer', { explorer: { getTransaction: vi.fn() } }, { tick: 'other' }],
        ['tick', { tick: '  ' }, null],
        ['coinTicker', { coinTicker: '' }, { tick: 'other' }],
    ])('rejects invalid %s before explorer calls', async (field, override, linkTarget) => {
        const base = input();
        const explorer = override.explorer ?? base.explorer;
        let error;
        try {
            await prepareArtworkLink({ ...base, linkTarget, ...override });
        } catch (caught) {
            error = caught;
        }
        expect(error).toBeInstanceOf(TypeError);
        expect(error).toMatchObject({ code: 'ARTWORK_LINK_PREP_INVALID' });
        expect(error.message).toContain(field);
        expect(explorer.getTransaction).not.toHaveBeenCalled();
        if (explorer.getAction) expect(explorer.getAction).not.toHaveBeenCalled();
        expect(base.sleep).not.toHaveBeenCalled();
    });
});

describe('artwork link preparation input ownership', () => {
    it('does not mutate any input', async () => {
        const values = input();
        const before = structuredClone(values.linkTarget);
        Object.freeze(values.linkTarget);
        Object.freeze(values);
        await prepareArtworkLink(values);
        expect(values.linkTarget).toEqual(before);
    });
});
