// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A multisig stored with more cosigners than its address type supports shows a
// page notice and no receive address on Receive and on its detail screen. The
// config is seeded through the create route with the ceiling raised for that
// one call; the page then reloads on the real ceiling. The dev-mock SDK has no
// multisig address derivation, so the in-ceiling case is covered by the
// regression suite.

import { secp256k1 } from '@noble/curves/secp256k1';
import {
    DEFAULT_PASSWORD,
    createWallet,
    expect,
    gotoSection,
    openPaletteCommand,
    test,
    unlockWallet,
} from '../../fixtures/wallet.js';

const NOTICE = /more cosigners than its address type supports, so funds sent to it can.t be spent/i;

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

async function seed(page, scheme, count) {
    await page.route('**/schemas/multisigConfig.js*', async (route) => {
        const response = await route.fetch();
        const body = (await response.text())
            .replace("'p2sh-multisig': 15,", "'p2sh-multisig': 20,")
            .replace("'p2wsh-multisig': 16,", "'p2wsh-multisig': 20,");
        await route.fulfill({ response, body });
    });
    await page.reload();
    await unlockWallet(page, DEFAULT_PASSWORD);
    await page.evaluate(async ({ scheme: s, list }) => {
        const messaging = await import('/src/messaging.js');
        const wallets = await messaging.listWallets();
        await messaging.createMultisigConfig({
            walletId: wallets[0].id,
            chainId: 'bitcoin-regtest',
            scheme: s,
            threshold: 2,
            cosigners: list,
        });
    }, { scheme, list: cosigners(count) });
    await page.unroute('**/schemas/multisigConfig.js*');
    await page.reload();
    await unlockWallet(page, DEFAULT_PASSWORD);
}

const CASES = [
    { scheme: 'p2wsh-multisig', count: 17 },
    { scheme: 'p2sh-multisig', count: 16 },
];

for (const { scheme, count } of CASES) {
    test(`${count}-key ${scheme} shows the notice and no address`, async ({ page }) => {
        await createWallet(page);
        await seed(page, scheme, count);

        await gotoSection(page, 'Receive');
        const form = page.getByRole('form', { name: 'Receive payment', exact: true });
        await expect(form).toBeVisible();
        await expect(page.getByText(NOTICE)).toBeVisible();
        await expect(page.getByRole('group', { name: 'Multisig receive address' })).toHaveCount(0);
        await expect(page.getByRole('img', { name: /Multisig QR code/ })).toHaveCount(0);
        await page.screenshot({ path: test.info().outputPath(`receive-${scheme}-${count}.png`) });

        await openPaletteCommand(page, 'Addresses');
        await page.getByText('Multisig receive').first().click();
        await expect(page.getByText(NOTICE)).toBeVisible();
        await expect(page.getByRole('button', { name: /Copy wallet address/i })).toHaveCount(0);
        await page.screenshot({ path: test.info().outputPath(`detail-${scheme}-${count}.png`) });
    });
}
