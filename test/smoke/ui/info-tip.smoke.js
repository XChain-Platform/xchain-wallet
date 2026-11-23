// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
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
// Send's Advanced section (with the RBF help tip) is the shared Form Standard
// AdvancedSection, which FeeSection mounts from its `advanced` prop.
const advancedSrc = read('packages/core/src/shared/components/formStandard/AdvancedSection.jsx');
const feeSectionSrc = read('packages/core/src/shared/components/formStandard/FeeSection.jsx');
const feeSelSrc = read('packages/core/src/ui/FeeSelector.jsx');
const createSrc = read('packages/core/src/shared/routes/CreateWallet.jsx');
const dpSrc = read('packages/core/src/shared/components/DerivationPathCrossCheck.jsx');
const adsSrc = read('packages/core/src/shared/components/settings/AdsSection.jsx');
// Settings rows carry their help through the shared row frame, which mounts the InfoTip.
const settingsRowSrc = read('packages/core/src/shared/components/settings/SettingsInlineRow.jsx');

// 1. Primitive is exported and accepts the documented props.
assert.ok(/export function InfoTip\(/.test(tipSrc),
    'InfoTip exports the primitive');
for (const prop of ['label', 'aria', 'placement', 'className']) {
    assert.ok(new RegExp(`\\b${prop}\\b`).test(tipSrc), `InfoTip declares prop "${prop}"`);
}

// 2. Trigger is a real <button type="button"> with aria-label and a
//    persistent aria-describedby relationship to the bubble.
assert.ok(/<button[\s\S]*?type="button"/.test(tipSrc),
    'InfoTip uses a real <button>');
assert.ok(/aria-describedby=\{id\}/.test(tipSrc),
    'InfoTip wires aria-describedby to the bubble id before focus');
assert.ok(/aria-expanded=\{open\}/.test(tipSrc),
    'InfoTip surfaces aria-expanded on the trigger');
assert.ok(/hidden=\{!open\}/.test(tipSrc),
    'InfoTip keeps the described bubble mounted while hiding it visually');

// 3. Bubble is annotated as role="tooltip".
assert.ok(/role="tooltip"/.test(tipSrc),
    'InfoTip bubble has role="tooltip"');

// 4. Esc dismisses; outside click dismisses.
assert.ok(/event\.key === 'Escape'/.test(tipSrc),
    'InfoTip dismisses on Escape');
assert.ok(/useOutsidePress\(\[wrapRef\],[\s\S]*?events:\s*\['pointerdown'\],[\s\S]*?target:\s*'document'/.test(tipSrc),
    'InfoTip dismisses on outside pointer');

// 5. Public re-export from @xchain-wallet/core/ui.
assert.ok(/export \{ InfoTip \} from '\.\/InfoTip\.jsx'/.test(indexSrc),
    'InfoTip is re-exported from core/ui index');

// 6. Five integration sites import + invoke <InfoTip ...>.
const integrations = [
    { src: advancedSrc, file: 'AdvancedSection.jsx (Send RBF)', match: /<InfoTip\s+aria=\{t\('send\.rbf\.helpLabel'\)\}/ },
    { src: sendSrc, file: 'Send.jsx', match: /<InfoTip\s+label=\{help\}\s+aria=\{t\('ui\.field\.about'/ },
    // Match any aria string: the point is that FeeSelector MOUNTS an InfoTip, not
    // what that tip's aria label happens to be worded as this month.
    { src: feeSelSrc, file: 'FeeSelector.jsx', match: /<InfoTip\s+aria=(?:"[^"]+"|\{)/ },
];
for (const { src, file, match } of integrations) {
    assert.ok(/InfoTip/.test(src), `${file} imports InfoTip`);
    assert.ok(match.test(src), `${file} mounts <InfoTip aria="…">`);
}
// CreateWallet's extra-passphrase Switch mounts the kit InfoTip through its own
// `help` prop (2026-11-14, Extra Passphrase form section), named "About <label>".
assert.ok(
    /<Switch[\s\S]{0,200}?help=(?:\{t\('createWallet\.thisExtraSecretCombinesWith'\)\}|"This extra secret combines)/.test(createSrc),
    'CreateWallet.jsx gives its passphrase Switch the help tip',
);
// Automatic Donations uses the shared settings help pattern rather than its own
// InfoTip: the Send at row (the trigger threshold) names its help text, hands
// it to the shared row frame, and that frame mounts the InfoTip with it.
// The help interpolates the formatted release default into the shared copy.
assert.ok(/help:\s*t\('settings\.help\.ads\.sendAt',\s*\{\s*sendAt:\s*money\(ADS_DEFAULT_SEND_AT, currency\)\s*\}\)/.test(adsSrc),
    'AdsSection.jsx gives the Send at row its help text');
assert.ok(/<InlineRowFrame\b[\s\S]*?help=\{row\.help\}/.test(adsSrc),
    'AdsSection.jsx hands row help to the shared InlineRowFrame');
assert.ok(/import \{[^}]*\bInfoTip\b[^}]*\} from '@xchain-wallet\/core\/ui'/.test(settingsRowSrc),
    'SettingsInlineRow.jsx imports InfoTip');
assert.ok(/<InfoTip\s+label=\{help\}\s+aria=\{t\('ui\.field\.about'/.test(settingsRowSrc),
    'SettingsInlineRow.jsx mounts <InfoTip> from the row help');
// Send still reaches the RBF tip: its fee row passes `advanced`, and the fee
// section mounts the shared Advanced slot from it.
assert.ok(/<FeeSection\b[\s\S]*?advanced=\{\{/.test(sendSrc),
    'Send.jsx passes its Advanced options to FeeSection');
assert.ok(/<AdvancedSlot\b[^>]*advanced=\{advanced\}/.test(feeSectionSrc),
    'FeeSection mounts the shared AdvancedSlot');

console.log('OK: InfoTip primitive + 5 integration smoke');
