// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it, vi } from 'vitest';
import { handleListPendingFileUploads } from '../../../packages/core/src/flows/fileMultipartRoutes.js';

const KEY_HEX = '9f'.repeat(32);

function upload(index = 0, overrides = {}) {
    return {
        id: `upload-${index}`,
        walletId: 'wallet-1',
        chainId: index % 2 ? 'ltc:regtest' : 'btc:regtest',
        sourceAddress: index % 2 ? 'rltc1source' : 'bcrt1source',
        originalSha256: 'a'.repeat(64),
        meta: { name: `file-${index}.png`, type: 'image/png', memo: 'private' },
        gate: null,
        partDigests: ['b'.repeat(64), 'c'.repeat(64)],
        fundingTxid: 'funding',
        fundingOutputs: [{ value: 1000 }],
        pieces: [{ index: 0, txid: 'part-0' }, { index: -1, txid: 'manifest' }],
        totalParts: 2,
        stage: 'sending',
        linkTarget: null,
        createdAt: `2026-11-15T08:00:0${index}.000Z`,
        ...overrides,
    };
}

function vaultFor(records) {
    const findBy = vi.fn(async () => records);
    const get = vi.fn();
    return { vault: { pendingFileUploads: { findBy, get } }, findBy, get };
}

describe('pending file upload summary projection', () => {
    it('copies resume fields while excluding gated secrets and persisted internals', async () => {
        const linkTarget = { tick: 'ART', issueActionIndex: '42' };
        const record = upload(0, { gate: { packKey: KEY_HEX }, linkTarget });
        const { vault, findBy, get } = vaultFor([record]);
        const result = await handleListPendingFileUploads({ walletId: 'wallet-1' }, { vault });
        expect(result.uploads).toEqual([{
            id: 'upload-0', name: 'file-0.png', chainId: 'btc:regtest',
            sourceAddress: 'bcrt1source', originalSha256: 'a'.repeat(64),
            createdAt: '2026-11-15T08:00:00.000Z',
            linkTarget: { tick: 'ART', issueActionIndex: '42' }, gated: true,
            partsSent: 1, paidTransactions: 5, totalParts: 2, stage: 'sending',
        }]);
        expect(result.uploads[0]).not.toBe(record);
        expect(result.uploads[0].linkTarget).not.toBe(linkTarget);
        expect(JSON.stringify(result)).not.toContain('"gate"');
        expect(JSON.stringify(result)).not.toContain(KEY_HEX);
        expect(findBy).toHaveBeenCalledTimes(1);
        expect(get).not.toHaveBeenCalled();
    });

    it('lists six records on two chains in one read and preserves null link targets', async () => {
        const records = Array.from({ length: 6 }, (_, index) => upload(index));
        const { vault, findBy, get } = vaultFor(records);
        const result = await handleListPendingFileUploads({ walletId: 'wallet-1' }, { vault });
        expect(result.uploads).toHaveLength(6);
        expect(result.uploads.map(({ chainId }) => chainId)).toEqual([
            'btc:regtest', 'ltc:regtest', 'btc:regtest',
            'ltc:regtest', 'btc:regtest', 'ltc:regtest',
        ]);
        expect(result.uploads.every(({ linkTarget, gated }) => linkTarget === null && !gated)).toBe(true);
        expect(findBy).toHaveBeenCalledTimes(1);
        expect(findBy).toHaveBeenCalledWith('walletId', 'wallet-1');
        expect(get).not.toHaveBeenCalled();
    });
});
