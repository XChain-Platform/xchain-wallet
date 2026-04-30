// Smoke for §19.4 / Cluster H FOLLOWUP 3 — `add` mode for encrypted
// backup restore. Pins:
//   - importBackupFile accepts a `mode` parameter
//   - the helper re-mints wallet / account / address ids and rewires
//     every cross-reference (account.walletId, address.accountId,
//     wallet.importedKeys[].addressId, pendingTx.id)
//   - contacts / connectedSites / settings ids stay untouched
//   - the host route forwards req.mode
//   - ImportWallet's backup lane forwards mode through

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const flowPath = join(wsRoot, 'packages', 'core', 'src', 'flows', 'backupFile.js');
const bgPath = join(wsRoot, 'packages', 'extension', 'src', 'background', 'createBackgroundHost.js');
const importWalletPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'ImportWallet.jsx');

// --- 1. Flow file shape -------------------------------------------------

const flow = readFileSync(flowPath, 'utf8');
assert.ok(/mode\s*=\s*'fresh'/.test(flow),
    "importBackupFile defaults mode to 'fresh'");
assert.ok(/mode\s*!==\s*'fresh'\s*&&\s*mode\s*!==\s*'add'/.test(flow),
    'mode is validated to fresh|add');
assert.ok(/export function remintIdentifiers/.test(flow),
    'remintIdentifiers exported for test access');
assert.ok(/skipWalletScoped:\s*mode\s*===\s*'add'/.test(flow),
    "add-mode skips wallet-scoped collisions in collectConflicts");

// --- 2. remintIdentifiers behavior --------------------------------------

const { remintIdentifiers } = await import(flowPath);

const payload = {
    payloadVersion: 1,
    wallet: {
        id: 'w-old',
        name: 'Sample',
        importedKeys: [
            { addressId: 'a-imported-1' },
            { addressId: 'a-imported-2' },
        ],
    },
    accounts: [
        { id: 'acc-old-1', walletId: 'w-old' },
        { id: 'acc-old-2', walletId: 'w-old' },
    ],
    addresses: [
        { id: 'a-imported-1', accountId: null, address: 'bc1qa' },
        { id: 'a-derived-1', accountId: 'acc-old-1', address: 'bc1qb' },
        { id: 'a-derived-2', accountId: 'acc-old-2', address: 'bc1qc' },
        { id: 'a-imported-2', accountId: null, address: 'bc1qd' },
    ],
    contacts: [{ id: 'c-1', address: 'bc1qx', name: 'alice' }],
    connectedSites: [{ id: 'cs-1', origin: 'https://example.com' }],
    settings: { schemaVersion: 1 },
    signers: [],
    pendingTxs: [{ id: 'p-1', fromAddress: 'bc1qb', txid: 'abc' }],
};

remintIdentifiers(payload);

// Wallet id is fresh + UUID-shaped.
assert.notEqual(payload.wallet.id, 'w-old', 'wallet.id was re-minted');
assert.match(payload.wallet.id, /^[0-9a-f-]{36}$/, 'wallet.id is UUID-shaped');

// Account ids changed and walletId rewired to the new wallet.
for (const acc of payload.accounts) {
    assert.notEqual(acc.id, 'acc-old-1', 'account ids were re-minted');
    assert.notEqual(acc.id, 'acc-old-2', 'account ids were re-minted');
    assert.equal(acc.walletId, payload.wallet.id,
        'account.walletId rewired to the new wallet.id');
}

// Address ids changed; accountId rewired only when it referenced a
// re-minted account (imported addresses with accountId=null pass through).
const accountIdSet = new Set(payload.accounts.map((a) => a.id));
for (const addr of payload.addresses) {
    assert.equal(/^a-(imported|derived)-/.test(addr.id), false,
        'address ids were re-minted');
    if (addr.accountId !== null) {
        assert.ok(accountIdSet.has(addr.accountId),
            'address.accountId rewired to a fresh account id');
    }
}

// Imported-key addressIds rewired to the new address ids.
const addressIdSet = new Set(payload.addresses.map((a) => a.id));
for (const ik of payload.wallet.importedKeys) {
    assert.ok(addressIdSet.has(ik.addressId),
        'importedKeys[].addressId rewired to a fresh address id');
}

// Contacts / connectedSites ids untouched (they're global).
assert.equal(payload.contacts[0].id, 'c-1', 'contact.id untouched');
assert.equal(payload.connectedSites[0].id, 'cs-1', 'connectedSite.id untouched');

// PendingTxs got fresh ids; fromAddress (a string, not an id) survives
// the reset so the row still associates with its address.
assert.notEqual(payload.pendingTxs[0].id, 'p-1', 'pendingTx.id re-minted');
assert.equal(payload.pendingTxs[0].fromAddress, 'bc1qb',
    'pendingTx.fromAddress preserved (address-scoped not id-scoped)');

// --- 3. Host registration forwards req.mode -----------------------------

const bg = readFileSync(bgPath, 'utf8');
assert.ok(
    /wallet\.importBackup'[\s\S]{0,400}mode:\s*req\?\.\s*mode/m.test(bg),
    'createBackgroundHost forwards req.mode into importBackupFile',
);

// --- 4. ImportWallet wires mode into backup lane -----------------------

const iw = readFileSync(importWalletPath, 'utf8');
assert.ok(
    /messaging\.importBackupRequest\(\{[\s\S]*mode,[\s\S]*\}\)/.test(iw),
    'ImportWallet forwards mode prop into importBackupRequest',
);
assert.ok(/Restore as a new wallet/.test(iw),
    'add-mode subtitle copy is present');
assert.ok(/Restore an encrypted backup as a new wallet/.test(iw),
    'add-mode full-shell subtitle copy is present');

console.log('backup-add-mode smoke OK');
