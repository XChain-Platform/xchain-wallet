// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: §16 dryRunRestore dispenser-branch (change=2) scan. Confirms the
// opt-in `scanDispenserBranch` adds a change=2 comparison without altering
// the default (change=0) behavior, and that a divergent dispenser address
// fails the overall match.

import { describe, it, expect } from 'vitest';
import { dryRunRestore } from '../../../packages/core/src/flows/dryRunRestore.js';

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

// Deterministic fake: the "address" is just the compressed pubkey hex, so
// comparisons are stable without real address encoding.
const sdkRegistry = {
    get: () => ({
        wallet: { deriveAddress: (pubkeyHex) => `addr:${pubkeyHex}` },
    }),
};

const DESCRIPTOR = { id: 'bitcoin', coin: 'bitcoin', networkKind: 'regtest', defaultAddressType: 'p2wpkh' };
const chainRegistry = {
    get: (id) => (id === 'bitcoin' ? DESCRIPTOR : null),
    supportedChains: () => [DESCRIPTOR],
    derivationPathFor: (chainId, addressType, account, change, index) =>
        `m/84'/0'/${account}'/${change}/${index}`,
};

function makeVault(addresses = []) {
    return { addresses: { list: async () => addresses.map((a) => ({ ...a })) } };
}

const baseOpts = {
    walletId: 'w1',
    mnemonic: MNEMONIC,
    activeChainIds: ['bitcoin'],
    chainRegistry,
    sdkRegistry,
    gapLimit: 3,
};

describe('dryRunRestore dispenser branch (§16)', () => {
    it('omits dispenser fields by default (unchanged behavior)', async () => {
        const res = await dryRunRestore({ ...baseOpts, vault: makeVault() });
        expect(res.perChain[0].dispenserComparisons).toBeUndefined();
        expect(res.perChain[0].dispenserDerived).toBeUndefined();
        expect(res.perChain[0].comparisons).toHaveLength(3);
    });

    it('adds a change=2 comparison set when scanDispenserBranch is set', async () => {
        const res = await dryRunRestore({
            ...baseOpts,
            vault: makeVault(),
            scanDispenserBranch: true,
            dispenserGapLimit: 4,
        });
        const chain = res.perChain[0];
        expect(chain.dispenserDerived).toHaveLength(4);
        expect(chain.dispenserComparisons).toHaveLength(4);
        // Dispenser derived paths live on the /2/ branch.
        expect(chain.dispenserDerived.every((d) => d.path.split('/')[4] === '2')).toBe(true);
        // Primary branch derived paths stay on /0/.
        expect(chain.derived.every((d) => d.path.split('/')[4] === '0')).toBe(true);
    });

    it('flags a divergent dispenser address and fails overallMatch', async () => {
        // Seed a dispenser-path record whose stored address cannot match
        // what the seed derives, forcing a divergence on the change=2 pass.
        const vault = makeVault([
            {
                derivationPath: "m/84'/0'/0'/2/0",
                chain: 'bitcoin',
                network: 'regtest',
                address: 'addr:WRONG_PUBKEY',
            },
        ]);
        const res = await dryRunRestore({
            ...baseOpts,
            vault,
            scanDispenserBranch: true,
            dispenserGapLimit: 2,
        });
        expect(res.overallMatch).toBe(false);
        const disp0 = res.perChain[0].dispenserComparisons.find((c) => c.index === 0);
        expect(disp0.match).toBe(false);
        expect(disp0.expected).toBe('addr:WRONG_PUBKEY');
    });
});
