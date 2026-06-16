// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for Cluster B Step 5 — Seed-phrase reveal UI wiring.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const sectionSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'settings', 'BackupSection.jsx'),
    'utf8',
);
const hostSrc = readFileSync(
    join(wsRoot, 'packages', 'extension', 'src', 'background', 'createBackgroundHost.js'),
    'utf8',
);
const webMessagingSrc = readFileSync(
    join(wsRoot, 'packages', 'web', 'src', 'messaging.js'),
    'utf8',
);
const popupMessagingSrc = readFileSync(
    join(wsRoot, 'packages', 'extension', 'src', 'popup', 'messaging.js'),
    'utf8',
);

// --- BackupSection wiring ---------------------------------------------

assert.match(sectionSrc, /messaging\.revealMnemonicRequest/, 'calls revealMnemonicRequest');
assert.match(sectionSrc, /revealStage/, 'tracks reveal stage');
assert.match(sectionSrc, /'idle' \| 'password' \| 'shown'/, 'three reveal stages');
assert.match(sectionSrc, /<UnlockPrompt/, 'inline password prompt');
assert.match(sectionSrc, /<RevealedMnemonic/, 'mnemonic display component');
assert.match(sectionSrc, /mnemonicHidden/, 'tap-to-reveal toggle state');
assert.match(sectionSrc, /filter: hidden \? 'blur\(8px\)'/, 'CSS blur when hidden');
assert.match(sectionSrc, /Tap to reveal/, 'reveal hint copy');
assert.match(sectionSrc, /Tap to hide again/, 'hide hint copy');
assert.match(
    sectionSrc,
    /NoMnemonicForWifOnlyError/,
    'maps wif-only error to friendly copy',
);
assert.match(
    sectionSrc,
    /no seed phrase to reveal/,
    'wif-only friendly copy text',
);

// `Show…` button only enabled when a wallet is active.
assert.match(
    sectionSrc,
    /label="Back up seed phrase"[\s\S]*disabled=\{!activeWallet\}/,
    'reveal row disabled until activeWallet is supplied',
);

// --- host handler -----------------------------------------------------

assert.match(hostSrc, /revealMnemonic\b/, 'host imports revealMnemonic from flows');
assert.match(
    hostSrc,
    /host\.register\('wallet\.revealMnemonic'/,
    'host registers wallet.revealMnemonic',
);

// --- messaging wrappers -----------------------------------------------

for (const [src, name] of [
    [webMessagingSrc, 'web'],
    [popupMessagingSrc, 'popup'],
]) {
    assert.match(
        src,
        /export function revealMnemonicRequest/,
        `${name} messaging exports revealMnemonicRequest`,
    );
    assert.match(
        src,
        /sendMessage\('wallet\.revealMnemonic'/,
        `${name} messaging dispatches wallet.revealMnemonic`,
    );
}

console.log('reveal-mnemonic-ui smoke OK');
