// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';
import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';
import {
    DOCUMENT_VERSION,
    decodeDocument,
    emptyDocument,
    encodeDocument,
} from '../../../packages/core/src/storage/codec.js';

const KEY = new Uint8Array(32).fill(17);
const AAD = new TextEncoder().encode('xchain-vault');

async function persistAndDecode(document, { key = KEY, aad } = {}) {
    const backend = new InMemoryBackend();
    await backend.save(await encodeDocument(key, document, aad));
    return decodeDocument(key, await backend.load(), aad);
}

describe('storage/codec', () => {
    it('creates independent documents with every collection initialized', () => {
        const first = emptyDocument();
        const second = emptyDocument();

        expect(first).toEqual({
            documentVersion: DOCUMENT_VERSION,
            wallets: [],
            accounts: [],
            addresses: [],
            contacts: [],
            connectedSites: [],
            pendingTxs: [],
            signers: [],
            pendingAirdrops: [],
            pendingDeploys: [],
            watchlistEntries: [],
            priceAlerts: [],
            multisigSigningSessions: [],
            coSignerAccounts: [],
            gatedKeys: [],
            autopayOrders: [],
            autopayLeases: [],
            settings: null,
        });

        first.wallets.push({ id: 'wallet-1' });
        expect(second.wallets).toEqual([]);
    });

    it('round-trips a document through an in-memory backend with AAD', async () => {
        const document = emptyDocument();
        document.wallets.push({ id: 'wallet-1', name: 'Primary' });
        document.settings = { theme: 'dark' };

        await expect(persistAndDecode(document, { aad: AAD })).resolves.toEqual(document);
    });

    it('fills collections omitted by an older version-one document', async () => {
        const decoded = await persistAndDecode({
            documentVersion: DOCUMENT_VERSION,
            wallets: [{ id: 'wallet-1' }],
            settings: { theme: 'light' },
        });

        expect(decoded).toEqual({
            ...emptyDocument(),
            wallets: [{ id: 'wallet-1' }],
            settings: { theme: 'light' },
        });
    });

    it('rejects a document encrypted with different AAD', async () => {
        const backend = new InMemoryBackend();
        await backend.save(await encodeDocument(KEY, emptyDocument(), AAD));

        await expect(
            decodeDocument(KEY, await backend.load(), new TextEncoder().encode('other-vault')),
        ).rejects.toThrow();
    });

    it('rejects non-object payloads and unsupported document versions', async () => {
        await expect(persistAndDecode(null)).rejects.toThrow(
            'codec: decoded payload is not an object',
        );
        await expect(persistAndDecode({ documentVersion: 2 })).rejects.toThrow(
            `codec: unsupported documentVersion 2 (expected ${DOCUMENT_VERSION})`,
        );
    });
});
