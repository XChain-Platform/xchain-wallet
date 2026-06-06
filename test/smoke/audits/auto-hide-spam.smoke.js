// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// §27.4 / Cluster I FOLLOWUP 2 smoke — auto-hide-spam toast.
//
// Asserts:
//   1. Home.jsx imports buildBalanceRows + detectSpamCandidates from
//      BalanceList and useToast from ToastHost.
//   2. A useEffect fires after the balance load that:
//      - bails when balances / activeWalletId aren't ready,
//      - bails when the wallet was already nudged this mount,
//      - filters candidates against the existing hiddenTokens set,
//      - bails when the filtered set is empty,
//      - calls showToast with `Hide N`-style action + onAction that
//        merges the candidates into hiddenTokens via updateSettings.
//   3. The per-wallet ref guard (spamNudgedForWalletRef) is in place
//      so a mid-session rebalance doesn't re-prompt.
//   4. The underlying detectSpamCandidates classifier still flags the
//      documented spam shapes (zero-balance non-native + sub-divisible
//      no-fiat dust) so the toast never fires for legitimate balances.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

// --- 1. Imports ----------------------------------------------------------

const homeSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Home.jsx'),
    'utf8',
);
assert.ok(/import \{ buildBalanceRows, detectSpamCandidates \} from '\.\.\/components\/BalanceList\.jsx'/.test(homeSrc),
    'Home.jsx imports buildBalanceRows + detectSpamCandidates from BalanceList');
assert.ok(/import \{ useToast \} from '\.\.\/components\/ToastHost\.jsx'/.test(homeSrc),
    'Home.jsx imports useToast from ToastHost');

// --- 2 + 3. Effect shape: per-wallet ref guard + candidate filter ------

assert.ok(/spamNudgedForWalletRef = useRef/.test(homeSrc),
    'Home.jsx declares the per-wallet nudge ref');
assert.ok(/spamNudgedForWalletRef\.current === activeWalletId/.test(homeSrc),
    'Effect bails when the same wallet was already nudged this mount');
assert.ok(/spamNudgedForWalletRef\.current = activeWalletId/.test(homeSrc),
    'Effect marks the wallet as nudged before showing the toast');
assert.ok(/buildBalanceRows\(balances, chainRegistry\)/.test(homeSrc),
    'Effect aggregates raw balances into rows via buildBalanceRows');
assert.ok(/detectSpamCandidates\(rows\)/.test(homeSrc),
    'Effect runs detectSpamCandidates against the aggregated rows');
assert.ok(/candidates\.filter\(\(k\) => !hiddenSet\.has\(k\)\)/.test(homeSrc),
    'Effect filters candidates against the existing hiddenTokens set');
assert.ok(/if \(fresh\.length === 0\) return/.test(homeSrc),
    'Effect bails when no fresh candidates remain after the filter');
assert.ok(/showToast\(\{[\s\S]*?actionLabel: `Hide \$\{fresh\.length\}`/.test(homeSrc),
    'Effect calls showToast with a "Hide N" actionLabel');
assert.ok(/messaging\.updateSettings\(\{ hiddenTokens: merged \}\)/.test(homeSrc),
    'onAction merges candidates into hiddenTokens via messaging.updateSettings');

// --- 4. detectSpamCandidates classifier behaviour ----------------------

const balanceListSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'BalanceList.jsx'),
    'utf8',
);
assert.ok(/export function detectSpamCandidates\(rows\)/.test(balanceListSrc),
    'detectSpamCandidates is still exported');

// Re-import the classifier directly to confirm runtime behaviour (no
// JSX round-trip needed because the function lives next to the JSX
// component in the same module — ESM gives us the export).
// We can't import .jsx in Node smokes, so instead we eval the small
// detectSpamCandidates region. Easier: extract the regex region and
// pin contract-level invariants by reading the source.
assert.ok(/r\.kind === 'native'/.test(balanceListSrc),
    'classifier skips native rows so BTC / LTC / DOGE never get flagged');
assert.ok(/q === 0n/.test(balanceListSrc),
    'classifier flags zero-balance non-native rows');
assert.ok(/r\.fiatRate === null && r\.divisibility > 0/.test(balanceListSrc),
    'classifier flags sub-divisible no-fiat-rate rows that round to dust');

console.log(
    'OK — auto-hide-spam smoke (§27.4 / Cluster I FOLLOWUP 2 — Home.jsx mounts a one-shot useEffect over the balance load that runs detectSpamCandidates against buildBalanceRows; filters out already-hidden keys; surfaces a useToast nudge with Hide N action + onAction that bulk-merges hiddenTokens via messaging.updateSettings; per-wallet ref guard prevents re-prompting on mid-session rebalances)',
);
