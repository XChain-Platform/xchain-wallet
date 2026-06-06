// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Smoke for §37 / G122 Contextual tooltips. Pins the InfoTip primitive
// + the five integrations shipped at v0.210.0.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const tipSrc = read('packages/core/src/ui/InfoTip.jsx');
const indexSrc = read('packages/core/src/ui/index.js');
const sendSrc = read('packages/core/src/shared/routes/Send.jsx');
const feeSelSrc = read('packages/core/src/ui/FeeSelector.jsx');
const createSrc = read('packages/core/src/shared/routes/CreateWallet.jsx');
const dpSrc = read('packages/core/src/shared/components/DerivationPathCrossCheck.jsx');
const adsSrc = read('packages/core/src/shared/components/settings/AdsSection.jsx');

// 1. Primitive is exported and accepts the documented props.
assert.ok(/export function InfoTip\(/.test(tipSrc),
    'InfoTip exports the primitive');
for (const prop of ['label', 'aria', 'placement', 'className']) {
    assert.ok(new RegExp(`\\b${prop}\\b`).test(tipSrc), `InfoTip declares prop "${prop}"`);
}

// 2. Trigger is a real <button type="button"> with aria-label and
//    aria-describedby that points at the bubble id when open.
assert.ok(/<button[\s\S]*?type="button"/.test(tipSrc),
    'InfoTip uses a real <button>');
assert.ok(/aria-describedby=\{open \? id : undefined\}/.test(tipSrc),
    'InfoTip wires aria-describedby to the bubble id when open');
assert.ok(/aria-expanded=\{open\}/.test(tipSrc),
    'InfoTip surfaces aria-expanded on the trigger');

// 3. Bubble is annotated as role="tooltip".
assert.ok(/role="tooltip"/.test(tipSrc),
    'InfoTip bubble has role="tooltip"');

// 4. Esc dismisses; outside click dismisses.
assert.ok(/event\.key === 'Escape'/.test(tipSrc),
    'InfoTip dismisses on Escape');
assert.ok(/!wrapRef\.current\.contains\(event\.target\)/.test(tipSrc),
    'InfoTip dismisses on outside pointer');

// 5. Public re-export from @xchain-wallet/core/ui.
assert.ok(/export \{ InfoTip \} from '\.\/InfoTip\.jsx'/.test(indexSrc),
    'InfoTip is re-exported from core/ui index');

// 6. Five integration sites import + invoke <InfoTip ...>.
const integrations = [
    { src: sendSrc, file: 'Send.jsx', match: /aria="Replace-by-fee help"/ },
    { src: feeSelSrc, file: 'FeeSelector.jsx', match: /aria="Network fee help"/ },
    { src: createSrc, file: 'CreateWallet.jsx', match: /aria="BIP39 passphrase help"/ },
    { src: dpSrc, file: 'DerivationPathCrossCheck.jsx', match: /aria="Derivation path help"/ },
    { src: adsSrc, file: 'AdsSection.jsx', match: /aria="Trigger threshold help"/ },
];
for (const { src, file, match } of integrations) {
    assert.ok(/InfoTip/.test(src), `${file} imports InfoTip`);
    assert.ok(match.test(src), `${file} mounts <InfoTip aria="…">`);
}

console.log('OK — InfoTip primitive + 5 integration smoke');
