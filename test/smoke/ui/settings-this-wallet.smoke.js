// Smoke for §35 Settings — Step 16 — This Wallet panel + removeWallet flow.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import { flows, storage as storageLib } from '../../../packages/core/src/index.js';
import { createWallet as createWalletRecord } from '../../../packages/core/src/schemas/wallet.js';
import { createAccount as createAccountRecord } from '../../../packages/core/src/schemas/account.js';
import { createAddress } from '../../../packages/core/src/schemas/address.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const sectionPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'settings', 'ThisWalletSection.jsx');
const settingsPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Settings.jsx');
const hostPath = join(wsRoot, 'packages', 'extension', 'src', 'background', 'createBackgroundHost.js');
const popupMsgPath = join(wsRoot, 'packages', 'extension', 'src', 'popup', 'messaging.js');
const webMsgPath = join(wsRoot, 'packages', 'web', 'src', 'messaging.js');
const poolPath = join(wsRoot, 'packages', 'core', 'src', 'signers', 'SignerPool.js');

// ─── 1. removeWallet flow purges descendants ─────────────────────────

function makeVault() {
    const masterKey = new Uint8Array(32);
    crypto.getRandomValues(masterKey);
    return new storageLib.Vault({
        backend: new storageLib.InMemoryBackend(),
        masterKey,
    });
}

const vault = makeVault();
await vault.open();

// Seed two wallets so we can confirm one is removed without touching the other.
const walletA = createWalletRecord({
    name: 'Alice',
    encryptedSeed: 'AAAA',
    kdfParams: { algorithm: 'argon2id', salt: 'aGVsbG8=', iterations: 1, memory: 1, parallelism: 1 },
    format: 'bip39',
    origin: 'created',
    passphraseEnabled: false,
});
const walletB = createWalletRecord({
    name: 'Bob',
    encryptedSeed: 'BBBB',
    kdfParams: { algorithm: 'argon2id', salt: 'aGVsbG8x', iterations: 1, memory: 1, parallelism: 1 },
    format: 'bip39',
    origin: 'created',
    passphraseEnabled: false,
});
await vault.wallets.put(walletA);
await vault.wallets.put(walletB);

const accA = createAccountRecord({ walletId: walletA.id, name: 'Acct A', index: 0 });
const accB = createAccountRecord({ walletId: walletB.id, name: 'Acct B', index: 0 });
await vault.accounts.put(accA);
await vault.accounts.put(accB);

const addrA = createAddress({
    accountId: accA.id,
    chain: 'bitcoin',
    network: 'mainnet',
    address: 'bc1qaaa',
    publicKey: '02aaaa',
    addressType: 'p2wpkh',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    label: 'A0',
});
const addrB = createAddress({
    accountId: accB.id,
    chain: 'bitcoin',
    network: 'mainnet',
    address: 'bc1qbbb',
    publicKey: '02bbbb',
    addressType: 'p2wpkh',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    label: 'B0',
});
await vault.addresses.put(addrA);
await vault.addresses.put(addrB);

const result = await flows.removeWallet({ vault, walletId: walletA.id });
assert.equal(result.removed.wallet, 1, 'one wallet removed');
assert.equal(result.removed.accounts, 1, 'one account removed');
assert.equal(result.removed.addresses, 1, 'one address removed');

const remainingWallets = await vault.wallets.list();
assert.equal(remainingWallets.length, 1, 'one wallet remains');
assert.equal(remainingWallets[0].id, walletB.id, 'walletB remains');

const remainingAccounts = await vault.accounts.list();
assert.equal(remainingAccounts.length, 1, 'one account remains');
assert.equal(remainingAccounts[0].id, accB.id, 'accountB remains');

const remainingAddresses = await vault.addresses.list();
assert.equal(remainingAddresses.length, 1, 'one address remains');
assert.equal(remainingAddresses[0].id, addrB.id, 'addressB remains');

// ─── 2. SignerPool.evict added ───────────────────────────────────────

const poolSrc = readFileSync(poolPath, 'utf8');
assert.match(poolSrc, /evict\(walletId\)/, 'SignerPool.evict added');

// ─── 3. Section surface ──────────────────────────────────────────────

const src = readFileSync(sectionPath, 'utf8');
assert.match(src, /export function ThisWalletSection\(/, 'named export');
assert.match(src, /messaging\.removeWallet\(\{\s*walletId:\s*activeWallet\.id\s*\}\)/, 'wires removeWallet messaging');
assert.match(src, /Type the wallet name/, 'typed-name confirmation copy');
assert.match(src, /matches = typed === walletName/, 'typed-name match check');
assert.match(src, /onConfirmRemove/, 'confirm handler defined');

// ─── 4. Host + messaging wiring ──────────────────────────────────────

const hostSrc = readFileSync(hostPath, 'utf8');
assert.match(hostSrc, /host\.register\('wallet\.remove'/, 'host registers wallet.remove');
assert.match(hostSrc, /signerPool\.evict\(walletId\)/, 'host evicts SignerPool entry');

const popupMsg = readFileSync(popupMsgPath, 'utf8');
const webMsg = readFileSync(webMsgPath, 'utf8');
assert.match(popupMsg, /export function removeWallet/, 'popup exports removeWallet');
assert.match(webMsg, /export function removeWallet/, 'web exports removeWallet');
assert.match(popupMsg, /sendMessage\('wallet\.remove'/, 'popup wires wallet.remove');
assert.match(webMsg, /sendMessage\('wallet\.remove'/, 'web wires wallet.remove');

// ─── 5. Settings.jsx wires the panel ─────────────────────────────────

const settingsSrc = readFileSync(settingsPath, 'utf8');
assert.match(settingsSrc, /import \{ ThisWalletSection \}/, 'Settings.jsx imports section');
const idx = settingsSrc.indexOf("id: 'this-wallet'");
const block = settingsSrc.slice(idx, idx + 600);
assert.match(block, /kind:\s*'panel'/, 'this-wallet flipped to panel');
assert.match(block, /Component:\s*ThisWalletSection/, 'wires ThisWalletSection');
assert.match(block, /activeWallet.*onOpenWalletPicker/, 'props pass activeWallet + onOpenWalletPicker');

console.log('settings-this-wallet smoke OK');
