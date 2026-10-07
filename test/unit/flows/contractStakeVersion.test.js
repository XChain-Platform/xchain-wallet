// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The contract-staking composer signs STAKE v3, UNSTAKE v1 and DELEGATE v1,
// which every chain accepts. A caller's VERSION must never replace them, since
// the other versions of these actions are accepted on Bitcoin only.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../packages/core/src/flows/submitAction.js', () => ({
    submitAction: vi.fn(async () => ({ txid: 'tx' })),
}));

import { submitAction } from '../../../packages/core/src/flows/submitAction.js';
import { contractStakeAction } from '../../../packages/core/src/flows/contractStakeAction.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';

const PK = 'e'.repeat(64);
const FIELDS = { SIGNING_PUBKEY: PK, TARGET_CONTRACT_INDEX: '7', TICK: 'XCHAIN' };

/** @param {string} chainId */
function base(chainId) {
    return {
        chainRegistry: defaultRegistry(),
        chainId,
        walletId: 'w',
        from: { address: 'source', publicKey: '02' + 'a'.repeat(64), derivationPath: "m/84'/1'/0'/0/0" },
    };
}

/** @returns {{ action: string, params: Record<string, string> }} */
function lastActionData() {
    const calls = vi.mocked(submitAction).mock.calls;
    return calls[calls.length - 1][0].actionData;
}

const CASES = [
    { mode: 'stake', action: 'STAKE', forced: '3', stray: '1', extra: { AMOUNT: '1' } },
    { mode: 'unstake', action: 'UNSTAKE', forced: '1', stray: '0', extra: {} },
    { mode: 'delegate', action: 'DELEGATE', forced: '1', stray: '2', extra: {} },
];

describe.each(['litecoin-regtest', 'bitcoin-regtest'])('contractStakeAction wire version on %s', (chainId) => {
    beforeEach(() => { vi.mocked(submitAction).mockClear(); });

    for (const c of CASES) {
        it(`sends ${c.action} v${c.forced} when the caller passed a stray VERSION ${c.stray}`, async () => {
            await contractStakeAction({ ...base(chainId), mode: c.mode, params: { VERSION: c.stray, ...FIELDS, ...c.extra } });
            expect(lastActionData()).toEqual({ action: c.action, params: { ...FIELDS, ...c.extra, VERSION: c.forced } });
        });

        it(`sends ${c.action} v${c.forced} when the caller passed no VERSION`, async () => {
            await contractStakeAction({ ...base(chainId), mode: c.mode, params: { ...FIELDS, ...c.extra } });
            expect(lastActionData()).toEqual({ action: c.action, params: { ...FIELDS, ...c.extra, VERSION: c.forced } });
        });
    }
});
