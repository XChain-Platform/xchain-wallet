/** @vitest-environment node */

// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The vault's collections answer `get`, never `find`. resolveSigner (every
// send from a hardware wallet address) and the host's signer pick (Add
// account, Add network) looked a SignerRecord up with `find`, which threw a
// TypeError against the real vault; the stand-ins in the older tests had
// `find`, so nothing caught it. This runs the hardware branch on a real vault.

import { describe, expect, it } from 'vitest';
import { resolveSigner } from '../../../packages/core/src/flows/resolveSigner.js';
import { getSignerRecord } from '../../../packages/core/src/flows/registerSigner.js';
import { addHardwareWallet } from '../../../packages/core/src/flows/hardwareWallet.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { InMemoryBackend, Vault } from '../../../packages/core/src/storage/index.js';

async function trezorWallet() {
    const vault = new Vault({ backend: new InMemoryBackend(), masterKey: new Uint8Array(32).fill(7) });
    await vault.open();
    const hw = await addHardwareWallet({
        vault,
        chainRegistry: defaultRegistry(),
        name: 'Desk Trezor',
        device: { vendor: 'trezor', model: 'T3T1', deviceIdentifier: 'trezor-dev', firmwareVersion: null },
        accounts: [{
            chainId: 'bitcoin-mainnet', accountIndex: 0, address: 'bc1qtrezor0', publicKey: `02${'a'.repeat(64)}`, derivationPath: "m/84'/0'/0'/0/0", addressType: 'p2wpkh',
        }],
    });
    return { vault, hw };
}

describe('SignerRecord lookups on the real vault', () => {
    it('the vault has no find, and getSignerRecord reads the record with get', async () => {
        const { vault, hw } = await trezorWallet();
        expect(typeof vault.signers.find).toBe('undefined');
        await expect(getSignerRecord(vault, hw.signer.id)).resolves.toMatchObject({ id: hw.signer.id, vendor: 'trezor' });
        await expect(getSignerRecord(vault, 'nope')).resolves.toBeNull();
    });

    it('resolveSigner resolves a hardware address to its SignerRecord', async () => {
        const { vault, hw } = await trezorWallet();
        const [address] = (await vault.addresses.list()).filter((a) => a.signerId === hw.signer.id);
        const descriptor = await resolveSigner({ vault, address });
        expect(descriptor).toMatchObject({ kind: 'trezor', signerRecord: { id: hw.signer.id } });
    });
});
