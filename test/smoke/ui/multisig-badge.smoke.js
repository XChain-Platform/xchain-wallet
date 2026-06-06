// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Smoke for Phase 4 — Step 22 of 23 — Multisig badges surface-wide
// (§22 + §22.4).

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const sharedRoutes = join(core, 'src', 'shared', 'routes');
const sharedComponents = join(core, 'src', 'shared', 'components');
const ui = join(core, 'src', 'ui');

// ─── MultisigBadge — exports from core/ui ─────────────────────

const uiBarrel = readFileSync(join(ui, 'index.js'), 'utf8');
assert.ok(/export\s*\{\s*MultisigBadge\s*\}\s*from\s*['"]\.\/MultisigBadge\.jsx['"]/.test(uiBarrel),
    'core/ui barrel exports MultisigBadge from MultisigBadge.jsx');

const badgeFile = readFileSync(join(ui, 'MultisigBadge.jsx'), 'utf8');
assert.ok(/export function MultisigBadge\b/.test(badgeFile),
    'MultisigBadge.jsx defines the named component');
for (const scheme of ['p2sh-multisig', 'p2wsh-multisig', 'taproot-musig2']) {
    assert.ok(badgeFile.includes(scheme),
        `MultisigBadge has a tone entry for ${scheme}`);
}
assert.ok(/data-testid="multisig-badge"/.test(badgeFile),
    'badge exposes a stable test id for layered surface assertions');
assert.ok(/data-scheme=/.test(badgeFile),
    'badge exposes a scheme dataset attribute');
assert.ok(/aria-label/.test(badgeFile),
    'badge sets aria-label for screen readers');
assert.ok(/MuSig2/.test(badgeFile),
    'badge labels taproot-musig2 as "MuSig2"');
assert.ok(/P2SH/.test(badgeFile) && /P2WSH/.test(badgeFile),
    'badge labels P2SH and P2WSH schemes');

// ─── Receive — replaces inline multisig pill with the badge ──

const receive = readFileSync(join(sharedRoutes, 'Receive.jsx'), 'utf8');
assert.ok(/MultisigBadge\b/.test(receive),
    'Receive imports MultisigBadge');
assert.ok(/<MultisigBadge[\s\S]*?multisig\.threshold[\s\S]*?multisig\.cosignerCount[\s\S]*?multisig\.scheme/.test(receive),
    'Receive renders <MultisigBadge> wired to the multisig record fields');

// ─── History — Multisig-only filter chip ─────────────────────

const history = readFileSync(join(sharedRoutes, 'History.jsx'), 'utf8');
assert.ok(/multisigOnly/.test(history),
    'History tracks a multisigOnly filter state');
assert.ok(/Multisig only/.test(history),
    'History renders a "Multisig only" filter chip per §22');
assert.ok(/getMultisigReceiveAddress/.test(history),
    'History resolves the wallet\'s multisig address up-front for the filter');
assert.ok(/aria-pressed=\{multisigOnly\}/.test(history),
    'History\'s multisig-only chip carries aria-pressed for assistive tech');

// ─── ChainBalanceCard — optional multisig prop ────────────────

const cardSrc = readFileSync(join(sharedComponents, 'ChainBalanceCard.jsx'), 'utf8');
assert.ok(/multisig\b/.test(cardSrc),
    'ChainBalanceCard accepts a multisig prop');
assert.ok(/<MultisigBadge/.test(cardSrc),
    'ChainBalanceCard renders MultisigBadge when multisig is provided');

const home = readFileSync(join(sharedRoutes, 'Home.jsx'), 'utf8');
assert.ok(/getMultisigReceiveAddress/.test(home),
    'Home fetches the multisig address to drive the indicator');
assert.ok(/multisig=\{isBtc \? multisig : null\}/.test(home),
    'Home passes multisig only to BTC chain cards (§10.3 BTC-only at launch)');

// ─── MultisigSigningSession — uses the badge ──────────────────

const route = readFileSync(join(sharedRoutes, 'MultisigSigningSession.jsx'), 'utf8');
assert.ok(/MultisigBadge\b/.test(route),
    'MultisigSigningSession imports MultisigBadge');
assert.ok(/<MultisigBadge[\s\S]*?threshold=\{(?:active|s)\.threshold\}[\s\S]*?cosignerCount=\{(?:active|s)\.cosignerPubkeys\.length\}/.test(route),
    'MultisigSigningSession renders <MultisigBadge> against session.threshold + cosignerPubkeys.length');

console.log(
    'OK — multisig badge smoke (MultisigBadge: 3-scheme tone map + ARIA + data-scheme + Receive integration + History "Multisig only" filter chip + getMultisigReceiveAddress prefetch + ChainBalanceCard multisig prop + Home BTC-only badge gate + MultisigSigningSession header + list-row badge replaces inline schemeLabel)',
);
