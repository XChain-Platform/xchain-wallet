// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: multisig cosigner ceiling per scheme.
//
//   [P0] 2026-10-24: The create form allows 20 SegWit cosigners and the host
//        accepts any count. The script builder encodes a key count past 16
//        as a non-number opcode (17 keys give OP_NOP), so the 17 to 20 key
//        SegWit address is shown for funding but can never be spent. The
//        host also stores a 16+ key Classic config whose address cannot be
//        derived at all.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { secp256k1 } from '@noble/curves/secp256k1';
import { createMultisigConfig } from '../../packages/core/src/flows/createMultisigConfig.js';
import { MAX_MULTISIG_COSIGNERS } from '../../packages/core/src/schemas/multisigConfig.js';
import { MessagingProvider } from '../../packages/core/src/shared/MessagingProvider.jsx';
import { MultisigCreate } from '../../packages/core/src/shared/routes/MultisigCreate.jsx';

const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

function cosigners(count) {
    return Array.from({ length: count }, (_, i) => {
        const secret = new Uint8Array(32);
        secret[0] = 1;
        secret[31] = i + 1;
        return {
            name: `Key ${i + 1}`,
            pubkey: toHex(secp256k1.getPublicKey(secret, true)),
            fingerprint: 'a1b2c3d4',
            origin: 'external-hardware',
            derivationPath: "m/48'/1'/0'/2'/0/0",
        };
    });
}

function fakeVault() {
    const wallet = { id: 'w-1', name: 'Main', multisigs: [] };
    return {
        wallets: {
            get: vi.fn(async () => wallet),
            put: vi.fn(async () => {}),
        },
    };
}

function create(scheme, count, vault = fakeVault()) {
    return createMultisigConfig({
        vault,
        sdkRegistry: { get: () => null },
        chainId: 'bitcoin-regtest',
        walletId: 'w-1',
        scheme,
        threshold: 2,
        cosigners: cosigners(count),
    });
}

afterEach(() => cleanup());

describe('regression/multisig-cosigner-ceiling', () => {
    it('[REGRESSION P0] caps SegWit at 16 keys, the last count the script encodes as a number', () => {
        expect(MAX_MULTISIG_COSIGNERS['p2wsh-multisig']).toBe(16);
        expect(MAX_MULTISIG_COSIGNERS['p2sh-multisig']).toBe(15);
    });

    it('[REGRESSION P0] the host refuses a 17-key SegWit config and stores nothing', async () => {
        const vault = fakeVault();
        await expect(create('p2wsh-multisig', 17, vault))
            .rejects.toThrow(/p2wsh-multisig supports at most 16 cosigners \(got 17\)/);
        expect(vault.wallets.put).not.toHaveBeenCalled();
        await expect(create('p2wsh-multisig', 16)).resolves.toMatchObject({
            config: { scheme: 'p2wsh-multisig' },
        });
    });

    it('[REGRESSION P0] the host refuses a 16-key Classic config', async () => {
        const vault = fakeVault();
        await expect(create('p2sh-multisig', 16, vault))
            .rejects.toThrow(/p2sh-multisig supports at most 15 cosigners \(got 16\)/);
        expect(vault.wallets.put).not.toHaveBeenCalled();
        await expect(create('p2sh-multisig', 15)).resolves.toMatchObject({
            config: { scheme: 'p2sh-multisig' },
        });
    });

    it('[REGRESSION P0] the form stops adding SegWit cosigners at 16', async () => {
        const messaging = {
            getAddressesByChain: vi.fn(async () => ({ 'bitcoin-regtest': [{ id: 'a-1', address: 'bcrt1qlocal', publicKey: '' }] })),
            getMultisigCosignerInfo: vi.fn(async () => ({})),
            createMultisigConfig: vi.fn(async () => ({})),
        };
        await act(async () => {
            render(
                <MessagingProvider shell="web" messaging={messaging}>
                    <MultisigCreate walletId="w-1" onBack={() => {}} />
                </MessagingProvider>,
            );
        });
        const add = await screen.findByRole('button', { name: /Add cosigner/i });
        for (let i = 0; i < 20; i += 1) {
            await act(async () => { fireEvent.click(add); });
        }
        // The form opens on SegWit with 2 rows.
        expect(screen.getAllByRole('group', { name: /^Cosigner \d+$/ })).toHaveLength(16);
        expect(add.disabled).toBe(true);

        // Taproot allows more rows; switching back to SegWit names the limit.
        await act(async () => {
            fireEvent.click(screen.getByRole('radio', { name: /^Taproot multi-signature/i }));
        });
        await act(async () => { fireEvent.click(add); });
        await act(async () => {
            fireEvent.click(screen.getByRole('radio', { name: /^SegWit multi-signature/i }));
        });
        expect(screen.getByText(/supports at most 16 cosigners/i)).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Review' }).disabled).toBe(true);
    });
});
