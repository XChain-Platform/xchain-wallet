// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Builds `pre-spec-passphrase-backup.json`: an encrypted §19.4 backup envelope
// as a build from BEFORE the stored-passphrase change would have written it.
//
// WHY A GENERATOR AND NOT A BLOB. The envelope is ciphertext, so a checked-in
// file nobody can rebuild is a mystery that rots silently: the day the record
// shape or the envelope layout moves, the fixture is wrong and unfixable. This
// script is the fixture's source. Re-run it and the JSON is replaced.
//
//   node test/e2e/fixtures/make-pre-spec-passphrase-backup.mjs
//
// WHAT MAKES IT "PRE-SPEC". Only the wallet record differs from what today's
// build exports, and it differs in exactly the two ways that matter:
//
//   - `schemaVersion: 2`, so the restore has to migrate it on the way in. `put`
//     validates against CURRENT_VERSION and never migrates, so an envelope that
//     is NOT migrated first dies inside the vault (backupFile row 12, leg a).
//   - no `encryptedPassphrase` KEY AT ALL - not null, absent - on a wallet whose
//     `passphraseEnabled` is true. That is the legacy state: a wallet that has a
//     passphrase and has never stored it, which is what routes it into the
//     one-time capture step at its next unlock.
//
// Everything else is built by production code (`persistHdWallet` against a real
// Vault with the bundled chain registry), so the accounts and the HD address
// records carry REAL derivation paths and REAL public keys. That is load-bearing
// and not decoration: the capture step verifies a typed passphrase by re-deriving
// a key and comparing it against a stored address (`seedOwnsStoredAddresses`),
// and a wallet with no such address can never be captured at all.
//
// The downgrade happens between persist and export, through a stub vault whose
// `get` does not migrate - the same technique `test/integration/shells/
// prehost-restore-backup.test.js` uses for its "restores a pre-spec envelope"
// case. A real Vault would migrate the record back to v3 on read and the
// envelope would carry today's shape.
//
// THE SECRETS BELOW ARE THROWAWAY TEST VALUES AND ARE MEANT TO BE READ. They are
// the only way anyone can drive the fixture; a reader who cannot see them cannot
// unlock it. Nothing here has ever held value on any network.
//
//   recovery phrase : legal winner thank year wave sausage worth useful legal winner thank yellow
//                     (the canonical BIP39 test vector, so its checksum is valid)
//   BIP39 passphrase: pre-spec-25th-word
//   wallet password on the device it was exported FROM: old-device-password-3311
//   password that opens the envelope itself:            pre-spec-envelope-password-7714
//
// NOT byte-reproducible, and cannot be: every seal mints a fresh IV and salt. Two
// runs produce two different files that decrypt to the same records.

import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';
import { Vault } from '../../../packages/core/src/storage/Vault.js';
import { deriveMasterKey, makeFreshKdfParams } from '../../../packages/core/src/crypto/kdf.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { SDKRegistry } from '../../../packages/core/src/sdk/SDKRegistry.js';
import { adaptXChainSDK } from '../../../packages/core/src/sdk/defaultFactory.js';
import { persistHdWallet } from '../../../packages/core/src/flows/_persistHdWallet.js';
import { exportBackupFile } from '../../../packages/core/src/flows/backupFile.js';

// The REAL `xchain-sdk`, resolved from the web shell's own dependency, because
// address encoding is the one thing this script cannot fake: the whole value of
// the fixture is that its stored public keys and addresses are the ones the
// wallet itself derives. The dev-mock SDK fabricates addresses (see
// `packages/web/src/sdkFactory.js`), which would make the capture step's
// ownership check unverifiable rather than merely wrong.
//
// `createRequire` rather than a bare import: the package is CJS and is a
// dependency of `packages/web`, not of the repo root or of `test/e2e`.
const requireFromWeb = createRequire(
    new URL('../../../packages/web/package.json', import.meta.url),
);

export const PRE_SPEC_MNEMONIC =
    'legal winner thank year wave sausage worth useful legal winner thank yellow';
export const PRE_SPEC_PASSPHRASE = 'pre-spec-25th-word';
export const PRE_SPEC_WALLET_PASSWORD = 'old-device-password-3311';
export const PRE_SPEC_BACKUP_PASSWORD = 'pre-spec-envelope-password-7714';
export const PRE_SPEC_WALLET_NAME = 'Pre-Spec Passphrase Wallet';

export const ENVELOPE_PATH = join(
    dirname(fileURLToPath(import.meta.url)),
    'pre-spec-passphrase-backup.json',
);

/** load/save/clear over one in-memory slot, plus a peek for the export stub. */
function memCollection(records) {
    const m = new Map(records.map((r) => [r.id, structuredClone(r)]));
    return {
        get: async (id) => (m.has(id) ? structuredClone(m.get(id)) : null),
        list: async () => Array.from(m.values()).map((r) => structuredClone(r)),
        put: async (r) => { m.set(r.id, structuredClone(r)); },
        delete: async (id) => { m.delete(id); },
    };
}

/**
 * Builds the envelope and returns it as a JSON string.
 *
 * Exported so a test can rebuild it in memory rather than reading the file,
 * though nothing does today: the checked-in file is the point, because it is
 * what proves an envelope written by an OLD build still restores.
 */
export async function buildPreSpecEnvelope() {
    const kdfParams = makeFreshKdfParams();
    const chainRegistry = defaultRegistry();
    const { XChainSDK } = requireFromWeb('xchain-sdk');
    const sdkRegistry = new SDKRegistry({
        chainRegistry,
        sdkFactory: adaptXChainSDK(XChainSDK),
    });
    const masterKey = deriveMasterKey(PRE_SPEC_WALLET_PASSWORD, kdfParams);
    let vault;
    try {
        vault = new Vault({ backend: new InMemoryBackend(), masterKey });
        await vault.open();

        // Production's own create/import pipeline. Bitcoin mainnet because that
        // is where a real pre-spec wallet would have been: the restoring device
        // takes the envelope's settings, lands there, and the spec switches it
        // to the regtest venue the same way it would any freshly created wallet.
        const persisted = await persistHdWallet({
            mnemonic: PRE_SPEC_MNEMONIC,
            format: 'bip39',
            origin: 'created',
            passphraseEnabled: true,
            bip39Passphrase: PRE_SPEC_PASSPHRASE,
            password: PRE_SPEC_WALLET_PASSWORD,
            name: PRE_SPEC_WALLET_NAME,
            accountName: 'Account 0',
            kdfParams,
            vault,
            chainRegistry,
            sdkRegistry,
            activeChainIds: ['bitcoin-mainnet'],
            activeNetwork: 'mainnet',
        });

        const walletId = persisted.wallet.id;
        const wallet = await vault.wallets.get(walletId);
        // The downgrade, and the whole reason this script exists. Delete rather
        // than null: a pre-spec record has no such key, and the distinction is
        // what the migration step has to survive.
        const legacyWallet = { ...wallet, schemaVersion: 2 };
        delete legacyWallet.encryptedPassphrase;

        const settings = await vault.settings.get();
        const stub = {
            wallets: memCollection([legacyWallet]),
            accounts: memCollection(await vault.accounts.list()),
            addresses: memCollection(await vault.addresses.list()),
            contacts: memCollection([]),
            connectedSites: memCollection([]),
            pendingTxs: memCollection([]),
            settings: { get: async () => structuredClone(settings), put: async () => {} },
        };

        const { fileContent } = await exportBackupFile({
            vault: stub,
            walletId,
            password: PRE_SPEC_BACKUP_PASSWORD,
            kdfParams,
        });
        return fileContent;
    } finally {
        masterKey.fill(0);
    }
}

const invokedDirectly = process.argv[1]
    && fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
    const fileContent = await buildPreSpecEnvelope();
    // Pretty-printed on the way out. The envelope's own payload is a single
    // base64 string either way, so this costs nothing and makes the checked-in
    // file reviewable as a diff instead of as one 8KB line.
    await writeFile(ENVELOPE_PATH, `${JSON.stringify(JSON.parse(fileContent), null, 2)}\n`, 'utf8');
    const parsed = JSON.parse(fileContent);
    console.log(`wrote ${ENVELOPE_PATH}`);
    console.log(`  walletName: ${parsed.walletName}`);
    console.log(`  payload bytes: ${parsed.payload.length}`);
}
