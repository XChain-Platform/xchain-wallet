// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { writeFile } from 'node:fs/promises';

import { encryptWalletSeed } from '../../../packages/core/src/crypto/walletBlob.js';
import { makeFreshKdfParams } from '../../../packages/core/src/crypto/kdf.js';
import { createPendingTx } from '../../../packages/core/src/schemas/pendingTx.js';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { createWallet } from '../../../packages/core/src/schemas/wallet.js';
import { Vault } from '../../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';

const MASTER_KEY_FILL = 11;
const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const UNLOCK_WORD = 'fixture-password';
const RECEIVE_PUBLIC_KEY_HEX = '0330d54fd0dd420a6e5f8d3624f5f3482cae350f79d5f0753bf5beef9c2d91af3c';
const masterKey = new Uint8Array(32).fill(MASTER_KEY_FILL);
const backend = new InMemoryBackend();
const vault = new Vault({ backend, masterKey });

await vault.open();

const { encryptedSeed, kdfParams } = await encryptWalletSeed({
    password: UNLOCK_WORD,
    seed: new TextEncoder().encode(MNEMONIC),
    kdfParams: makeFreshKdfParams(),
});
const wallet = createWallet({
    name: 'Imported fixture wallet',
    origin: 'imported-mnemonic',
    format: 'bip39',
    passphraseEnabled: false,
    encryptedSeed,
    kdfParams,
});
const pendingTx = createPendingTx({
    chain: 'bitcoin',
    network: 'mainnet',
    fromAddress: 'bc1qfixturefromaddress',
    toAddress: 'bc1qfixturetoaddress',
    action: 'SEND',
    actionSummary: 'Send fixture transaction',
    psbtHex: '70736274ff',
});
const settings = {
    ...createDefaultSettings(),
    theme: 'dark',
    fiatCurrency: 'EUR',
    autolockMinutes: 30,
};

await vault.wallets.put(wallet);
await vault.pendingTxs.put(pendingTx);
await vault.settings.put(settings);

const blob = await backend.load();
const fixture = {
    documentVersion: vault.documentVersion,
    masterKeyFill: MASTER_KEY_FILL,
    walletId: wallet.id,
    password: UNLOCK_WORD,
    receivePublicKeyHex: RECEIVE_PUBLIC_KEY_HEX,
    pendingTxId: pendingTx.id,
    theme: settings.theme,
    fiatCurrency: settings.fiatCurrency,
    autolockMinutes: settings.autolockMinutes,
    blob: Buffer.from(blob).toString('base64'),
};

vault.close();
await writeFile(
    new URL('./populated-vault.json', import.meta.url),
    `${JSON.stringify(fixture, null, 4)}\n`,
);
