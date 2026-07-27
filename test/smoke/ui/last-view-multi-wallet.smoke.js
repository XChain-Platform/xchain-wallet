// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §24 / Cluster U FOLLOWUPs 5 + 6: last-view memory edge cases.
//
// Pins:
//   FU 5: clear on remove-wallet:
//     - ThisWalletSection imports `clearLastView` and calls it after a
//       successful messaging.removeWallet.
//     - DemoBanner does the same when the user (or auto-expire) exits
//       demo mode, now via the shared `exitDemoWallet` teardown .
//   FU 6: multi-wallet threading:
//     - useLastView guards the persist effect with a per-walletId
//       lastResumedFor + lastPersistedFor pair so a wallet switch
//       can't stomp the new wallet's key with the previous wallet's
//       current view.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const thisWalletSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'settings', 'ThisWalletSection.jsx'),
    'utf8',
);
const demoBannerSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'DemoBanner.jsx'),
    'utf8',
);
const demoGraduationSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'utils', 'demoGraduation.js'),
    'utf8',
);
const useLastViewSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'hooks', 'useLastView.js'),
    'utf8',
);

// ─── FU 5: clear on remove-wallet ─────────────────────────────────────

assert.match(
    thisWalletSrc,
    /import \{ clearLastView \} from '\.\.\/\.\.\/utils\/lastViewMemory\.js'/,
    'ThisWalletSection imports clearLastView',
);
assert.match(
    thisWalletSrc,
    /messaging\.removeWallet[\s\S]+?clearLastView\(activeWallet\.id\)/,
    'ThisWalletSection clears last-view AFTER removeWallet',
);

// : the demo teardown moved into one shared helper so the three
// escapes (Wallet details, the 24h auto-expire, and the add-wallet
// graduation) cannot drift. DemoBanner now reaches clearLastView +
// clearDemoWalletId through it, so pin the call site and the helper.
assert.match(
    demoBannerSrc,
    /import \{ exitDemoWallet \} from '\.\.\/utils\/demoGraduation\.js'/,
    'DemoBanner routes its exit through the shared demo teardown',
);
assert.match(
    demoBannerSrc,
    /exitDemoWallet\(\{[\s\S]+?walletId: activeWalletId,/,
    'DemoBanner tears down the active demo wallet on exit',
);
assert.match(
    demoGraduationSrc,
    /clearDemoWalletId\(\);\s*\n\s*clearLastView\(walletId\);/,
    'the shared teardown clears last-view alongside the demo flag',
);

// ─── FU 6: multi-wallet last-view threading ──────────────────────────

assert.match(
    useLastViewSrc,
    /lastResumedFor = useRef/,
    'useLastView tracks lastResumedFor',
);
assert.match(
    useLastViewSrc,
    /lastPersistedFor = useRef/,
    'useLastView tracks lastPersistedFor (the FU 6 grace gate)',
);
// Persist effect should bail when resume hasn't fired yet for this walletId.
assert.match(
    useLastViewSrc,
    /lastResumedFor\.current !== walletId\)\s*\{[\s\S]+?return/,
    'persist effect bails when resume effect has not yet fired for this walletId',
);
// One-tick persist grace gate.
assert.match(
    useLastViewSrc,
    /lastPersistedFor\.current !== walletId\)\s*\{[\s\S]+?lastPersistedFor\.current = walletId;[\s\S]+?return/,
    'persist effect skips the first run after a wallet switch (one-tick grace)',
);
// Resume effect resets both refs on null walletId.
assert.match(
    useLastViewSrc,
    /lastResumedFor\.current = null;\s*\n\s*lastPersistedFor\.current = null/,
    'resume effect resets both refs on null walletId',
);
// On a fresh resume, lastPersistedFor is cleared so the grace gate fires.
assert.match(
    useLastViewSrc,
    /lastResumedFor\.current = walletId;[\s\S]+?lastPersistedFor\.current = null/,
    'resume effect clears lastPersistedFor so the next persist tick re-runs the grace gate',
);

console.log('last-view-multi-wallet smoke OK');
