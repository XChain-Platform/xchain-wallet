// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Two web tabs share one stored queue but never hold the vault lease together.
// A tab that re-unlocks after the other tab queued or discarded entries must
// replace its cache from storage on lease acquisition; otherwise its next
// persist writes the stale cache over the other tab's work.

import { describe, it, expect } from 'vitest';
import { __createWebVaultMultiTabHarnessForTests } from '../../../packages/web/src/hostBridge.js';

const W = 'w1';
const entry = (hex) => ({ chainId: 'bitcoin-regtest', signedTxHex: hex });

describe('web broadcast queue across tabs', () => {
    it('keeps another tab\'s queued entry when a re-unlocked tab persists', async () => {
        const harness = __createWebVaultMultiTabHarnessForTests();
        const a = harness.createTab();
        const b = harness.createTab();

        await a.acquire();
        await a.enqueue(W, entry('aa'));
        await a.release();

        await b.acquire();
        await b.enqueue(W, entry('bb'));
        await b.release();

        await a.acquire();
        await a.enqueue(W, entry('cc'));
        const hexes = (await a.list(W)).map((e) => e.signedTxHex).sort();
        expect(hexes).toEqual(['aa', 'bb', 'cc']);
        expect(harness.stored().queues[W].map((e) => e.signedTxHex).sort()).toEqual(['aa', 'bb', 'cc']);
    });

    it('does not resurrect an entry another tab discarded', async () => {
        const harness = __createWebVaultMultiTabHarnessForTests();
        const a = harness.createTab();
        const b = harness.createTab();

        await a.acquire();
        const queued = await a.enqueue(W, entry('aa'));
        await a.enqueue(W, entry('keep'));
        await a.release();

        await b.acquire();
        await b.discard(W, queued.id);
        await b.release();

        await a.acquire();
        await a.enqueue(W, entry('new'));
        const hexes = harness.stored().queues[W].map((e) => e.signedTxHex).sort();
        expect(hexes).toEqual(['keep', 'new']);
    });

    it('defers lease release while a broadcast is in flight', async () => {
        const harness = __createWebVaultMultiTabHarnessForTests();
        const a = harness.createTab();
        await a.acquire();
        a.beginBroadcast('claim');
        await a.release();
        expect(a.state()).toEqual({ hasLease: true, releaseDeferred: true });
        await a.finishBroadcast('claim');
        expect(a.state()).toEqual({ hasLease: false, releaseDeferred: false });
    });
});
