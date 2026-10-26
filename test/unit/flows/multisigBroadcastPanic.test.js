// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Broadcasting a finalized multisig transaction pushes signed bytes to the
// network, the same irreversible step the queued and signed-tx broadcast
// routes refuse while panic mode is on.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { finalizeMultisigSigningSession } from '../../../packages/core/src/flows/multisigSigning.js';
import {
    __resetPanicModePersistenceForTests,
    activatePanicMode,
    deactivatePanicMode,
} from '../../../packages/core/src/flows/panicMode.js';

function finalizedSession() {
    const session = {
        id: 'session-1',
        walletId: 'wallet-1',
        chainId: 'bitcoin-regtest',
        status: 'finalized',
        finalizedTxHex: '0200000001',
        cosignerPubkeys: [],
    };
    const records = new Map([[session.id, session]]);
    const put = vi.fn(async (record) => records.set(record.id, record));
    const broadcastTx = vi.fn(async () => ({ txid: 'ff'.repeat(32) }));
    return {
        records,
        put,
        broadcastTx,
        vault: { multisigSigningSessions: { get: vi.fn(async (id) => records.get(id) || null), put } },
        sdkRegistry: { get: () => ({ encoder: { broadcastTx } }) },
    };
}

beforeEach(() => {
    localStorage.clear();
    __resetPanicModePersistenceForTests();
});

afterEach(() => {
    __resetPanicModePersistenceForTests();
    localStorage.clear();
});

describe('multisig broadcast under panic mode', () => {
    it('refuses to broadcast and leaves the session finalized', async () => {
        const h = finalizedSession();
        activatePanicMode();

        await expect(finalizeMultisigSigningSession({
            vault: h.vault, sdkRegistry: h.sdkRegistry, sessionId: 'session-1', broadcast: true,
        })).rejects.toMatchObject({ name: 'PanicModeActiveError' });

        expect(h.broadcastTx).not.toHaveBeenCalled();
        expect(h.put).not.toHaveBeenCalled();
        expect(h.records.get('session-1').status).toBe('finalized');
    });

    it('broadcasts once the freeze is turned off', async () => {
        const h = finalizedSession();
        activatePanicMode();
        deactivatePanicMode();

        const next = await finalizeMultisigSigningSession({
            vault: h.vault, sdkRegistry: h.sdkRegistry, sessionId: 'session-1', broadcast: true,
        });
        expect(h.broadcastTx).toHaveBeenCalledOnce();
        expect(next.status).toBe('broadcast');
    });
});
