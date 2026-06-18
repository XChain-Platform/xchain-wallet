// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §18.5 / Cluster N FOLLOWUP 3: sign-flow risk classifier
// drives the HW cross-check explicit-confirm checkbox.
//
// Pins:
//   - flows/signRiskClassifier.js exports classifySignRisk with the
//     four-input contract (signerKind / amountSats / recipientNovel /
//     multisig / settings).
//   - Behavioral: software signers always returnf
//     `requireExplicitConfirm: false`. HW signers honor the four
//     dimensions in priority order: settings.alwaysRequireHwExplicit-
//     Confirm → multisig → recipientNovel → testSendThresholdSats.
//   - schemas/settings.js declares privacy.alwaysRequireHwExplicit-
//     Confirm as v2-tolerant.
//   - HwSignBlock accepts requireExplicitConfirm + reason +
//     onConfirmedChange, threads them into DerivationPathCrossCheck.
//   - Send.jsx imports classifySignRisk, computes signRisk in a
//     useMemo, threads requireExplicitConfirm into HwSignBlock, and
//     gates Submit on hwExplicitConfirmed.
//   - PrivacySection has the always-on toggle.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifySignRisk } from '../../../packages/core/src/flows/signRiskClassifier.js';
import { validateSettings, createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const sendSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Send.jsx'),
    'utf8',
);
const hwBlockSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'HwSignBlock.jsx'),
    'utf8',
);
const privacySrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'settings', 'PrivacySection.jsx'),
    'utf8',
);

// ─── 1. classifier behavior ────────────────────────────────────────────

// Software signer never needs explicit confirm.
assert.deepEqual(
    classifySignRisk({ signerKind: null }),
    { requireExplicitConfirm: false, reason: null },
);
assert.deepEqual(
    classifySignRisk({ signerKind: 'software' }),
    { requireExplicitConfirm: false, reason: null },
);
assert.deepEqual(
    classifySignRisk({
        signerKind: null,
        recipientNovel: true,
        multisig: true,
        settings: { alwaysRequireHwExplicitConfirm: true, testSendThresholdSats: 1 },
    }),
    { requireExplicitConfirm: false, reason: null },
    'software path always-false even with every risk dimension flipped on',
);

// Always-on toggle wins over everything else.
{
    const r = classifySignRisk({
        signerKind: 'trezor',
        settings: { alwaysRequireHwExplicitConfirm: true },
    });
    assert.equal(r.requireExplicitConfirm, true);
    assert.match(r.reason, /always require/i);
}

// Multisig wins over recipient novelty / amount.
{
    const r = classifySignRisk({
        signerKind: 'ledger',
        multisig: true,
    });
    assert.equal(r.requireExplicitConfirm, true);
    assert.match(r.reason, /multisig/i);
}

// Recipient novelty.
{
    const r = classifySignRisk({
        signerKind: 'trezor',
        recipientNovel: true,
    });
    assert.equal(r.requireExplicitConfirm, true);
    assert.match(r.reason, /first-time recipient/i);
}

// Amount over threshold.
{
    const r = classifySignRisk({
        signerKind: 'trezor',
        amountSats: 5_000_000,
        settings: { testSendThresholdSats: 1_000_000 },
    });
    assert.equal(r.requireExplicitConfirm, true);
    assert.match(r.reason, /large amount/i);
}

// Amount under threshold: no confirm.
{
    const r = classifySignRisk({
        signerKind: 'trezor',
        amountSats: 500_000,
        settings: { testSendThresholdSats: 1_000_000 },
    });
    assert.equal(r.requireExplicitConfirm, false);
    assert.equal(r.reason, null);
}

// Threshold = 0 disables the amount branch entirely.
{
    const r = classifySignRisk({
        signerKind: 'trezor',
        amountSats: 1_000_000_000,
        settings: { testSendThresholdSats: 0 },
    });
    assert.equal(r.requireExplicitConfirm, false);
}

// HW signer with no risk inputs → no confirm.
{
    const r = classifySignRisk({ signerKind: 'trezor' });
    assert.deepEqual(r, { requireExplicitConfirm: false, reason: null });
}

// ─── 2. schema accepts the new field ──────────────────────────────────

{
    const settings = {
        ...createDefaultSettings(),
        privacy: {
            ...createDefaultSettings().privacy,
            alwaysRequireHwExplicitConfirm: true,
        },
    };
    const ok = validateSettings(settings);
    assert.equal(ok.ok, true,
        'schema validates alwaysRequireHwExplicitConfirm: ' + JSON.stringify(ok.errors));
}
{
    const settings = {
        ...createDefaultSettings(),
        privacy: {
            ...createDefaultSettings().privacy,
            alwaysRequireHwExplicitConfirm: 'maybe',
        },
    };
    const bad = validateSettings(settings);
    assert.equal(bad.ok, false, 'schema rejects non-boolean');
}

// ─── 3. HwSignBlock prop wiring ────────────────────────────────────────

assert.match(
    hwBlockSrc,
    /requireExplicitConfirm,\s*\n\s*requireExplicitConfirmReason,\s*\n\s*onConfirmedChange,?\s*\n\s*\}\)/,
    'HwSignBlock destructures the three new props',
);
assert.match(
    hwBlockSrc,
    /<DerivationPathCrossCheck[\s\S]+?requireExplicitConfirm=\{requireExplicitConfirm\}[\s\S]+?onConfirmedChange=\{onConfirmedChange\}/,
    'HwSignBlock threads the props into DerivationPathCrossCheck',
);
assert.match(
    hwBlockSrc,
    /requireExplicitConfirm && requireExplicitConfirmReason/,
    'HwSignBlock surfaces the reason copy above the cross-check block when required',
);

// ─── 4. Send.jsx wiring ────────────────────────────────────────────────

assert.match(
    sendSrc,
    /import \{ classifySignRisk \}/,
    'Send.jsx imports classifySignRisk',
);
assert.match(
    sendSrc,
    /const signRisk = useMemo\(/,
    'Send.jsx wraps classifier output in useMemo',
);
assert.match(
    sendSrc,
    /const \[hwExplicitConfirmed, setHwExplicitConfirmed\] = useState\(false\)/,
    'Send.jsx tracks hwExplicitConfirmed state',
);
assert.match(
    sendSrc,
    /<HwSignBlock[\s\S]+?requireExplicitConfirm=\{signRisk\.requireExplicitConfirm\}[\s\S]+?onConfirmedChange=\{setHwExplicitConfirmed\}/,
    'Send.jsx passes risk + setter to HwSignBlock',
);
assert.match(
    sendSrc,
    /signRisk\.requireExplicitConfirm && !hwExplicitConfirmed/,
    'Send.jsx submit gate honors the risk classifier',
);

// ─── 5. Settings toggle wiring ─────────────────────────────────────────

assert.match(
    privacySrc,
    /Always require hardware cross-check confirm/,
    'PrivacySection has the toggle',
);
assert.match(
    privacySrc,
    /alwaysRequireHwExplicitConfirm/,
    'PrivacySection writes the new field',
);

console.log('sign-risk-classifier smoke OK');
