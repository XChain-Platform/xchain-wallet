// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const routes = join(root, 'packages', 'core', 'src', 'shared', 'routes');
const settings = join(root, 'packages', 'core', 'src', 'shared', 'components', 'settings');
const ui = join(root, 'packages', 'core', 'src', 'ui');

function source(directory, file) {
    return readFileSync(join(directory, file), 'utf8');
}

const createWallet = source(routes, 'CreateWallet.jsx');
const importWallet = source(routes, 'ImportWallet.jsx');
const migrateWallet = source(routes, 'MigrateToBip39.jsx');
const pairWallet = source(routes, 'PairPartnerWallet.jsx');
const locked = source(routes, 'Locked.jsx');
const addressList = source(routes, 'AddressList.jsx');
const backupSection = source(settings, 'BackupSection.jsx');
const addressField = source(ui, 'AddressField.jsx');
const addressCombobox = source(ui, 'AddressCombobox.jsx');

for (const [name, text] of [
    ['create password', createWallet],
    ['import password', importWallet],
    ['migration password', migrateWallet],
    ['paired-wallet password', pairWallet],
]) {
    assert.match(
        text,
        /value=\{password\}[\s\S]{0,300}?autoComplete="new-password"/,
        `${name} uses new-password`,
    );
    assert.match(
        text,
        /value=\{confirm\}[\s\S]{0,300}?autoComplete="new-password"/,
        `${name} confirmation uses new-password`,
    );
}

assert.match(
    locked,
    /name="username"[\s\S]{0,120}?value="xchain-wallet"[\s\S]{0,120}?autoComplete="username"[\s\S]{0,120}?hidden/,
    'unlock supplies a hidden username token',
);
assert.match(
    locked,
    /name="password"[\s\S]{0,300}?autoComplete="current-password"/,
    'unlock uses current-password',
);

const recoveryPhrase = importWallet.match(/<textarea[\s\S]{0,1200}?id="xc-mnemonic"[\s\S]{0,1200}?\/>/)?.[0] || '';
assert.match(recoveryPhrase, /autoComplete="off"/, 'recovery phrase disables autocomplete');
assert.match(recoveryPhrase, /spellCheck=\{false\}/, 'recovery phrase disables spellcheck');

const backupPhrase = backupSection.match(
    /<textarea[\s\S]{0,500}?placeholder="Recovery phrase, words separated by spaces"[\s\S]{0,500}?\/>/,
)?.[0] || '';
assert.match(backupPhrase, /autoComplete="off"/, 'backup test phrase disables autocomplete');
assert.match(backupPhrase, /spellCheck=\{false\}/, 'backup test phrase disables spellcheck');

const privateKey = addressList.match(/<Input[\s\S]{0,1200}?label="WIF private key"[\s\S]{0,1200}?\/>/)?.[0] || '';
assert.match(privateKey, /autoComplete="off"/, 'private key disables autocomplete');
assert.match(privateKey, /spellCheck=\{false\}/, 'private key disables spellcheck');

assert.match(addressField, /autoComplete="off"/, 'address fields disable autocomplete');
assert.match(addressCombobox, /autoComplete="off"/, 'address comboboxes disable autocomplete');

console.log('autocomplete-policy smoke OK');
