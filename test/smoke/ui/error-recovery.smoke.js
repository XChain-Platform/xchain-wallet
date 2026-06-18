// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §37 / G121 Error recovery one-click fixes. Pins the
// StatusMessage `recovery` prop + the five integration sites shipped
// at v0.211.0.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const statusSrc = read('packages/core/src/ui/StatusMessage.jsx');
const sendSrc = read('packages/core/src/shared/routes/Send.jsx');
const psbtSrc = read('packages/core/src/shared/routes/PsbtSignForm.jsx');
const importSrc = read('packages/core/src/shared/routes/ImportWallet.jsx');
const pairSrc = read('packages/core/src/shared/routes/PairSignerForm.jsx');

// 1. StatusMessage exposes the `recovery` prop and renders an
//    accessible button when it's provided.
assert.ok(/\brecovery\b/.test(statusSrc),
    'StatusMessage references the recovery prop');
assert.ok(/recovery\.label/.test(statusSrc),
    'StatusMessage reads recovery.label');
assert.ok(/recovery\.onAction/.test(statusSrc),
    'StatusMessage reads recovery.onAction');
assert.ok(/<button[\s\S]*?type="button"[\s\S]*?aria-label/.test(statusSrc),
    'StatusMessage recovery renders a real <button> with aria-label');
assert.ok(/Promise\.resolve\(recovery\.onAction\(\)\)\.catch/.test(statusSrc),
    'StatusMessage swallows recovery.onAction rejections so the message stays visible');

// 2. Send.jsx surfaces a "Use Max" recovery on amount-related form
//    errors AND on insufficient-funds submit errors.
assert.ok(/StatusMessage/.test(sendSrc),
    'Send.jsx imports StatusMessage');
assert.ok(/label: 'Use Max'/.test(sendSrc),
    'Send.jsx wires "Use Max" recovery');
assert.ok(/\/insufficient\|not enough\/i\.test\(submitError\)/.test(sendSrc),
    'Send.jsx detects insufficient-funds submit errors for the Use-Max recovery');

// 3. PsbtSignForm offers a "Clear" recovery for unrecognized paste.
assert.ok(/StatusMessage/.test(psbtSrc),
    'PsbtSignForm imports StatusMessage');
assert.ok(/label: 'Clear'/.test(psbtSrc),
    'PsbtSignForm wires a Clear recovery');
assert.ok(/setPasted\(''\)/.test(psbtSrc),
    'PsbtSignForm Clear recovery wipes the textarea');

// 4. ImportWallet backup lane offers a "Browse" recovery when the
//    user submits without picking a file.
assert.ok(/StatusMessage/.test(importSrc),
    'ImportWallet imports StatusMessage');
assert.ok(/label: 'Browse'[\s\S]*backupDrop\.openFilePicker/.test(importSrc),
    'ImportWallet wires Browse recovery via the dropzone openFilePicker');

// 5. PairSignerForm offers a "Try again" recovery on transient
//    pairing errors (gated to skip the WebHID-not-supported case
//    where retry is pointless).
assert.ok(/StatusMessage/.test(pairSrc),
    'PairSignerForm imports StatusMessage');
assert.ok(/label: 'Try again'[\s\S]*handlePickVendor\(vendor\)/.test(pairSrc),
    'PairSignerForm Try-again recovery re-runs handlePickVendor');
assert.ok(/!\/WebHID\|not supported\|not available\/i\.test\(error\)/.test(pairSrc),
    'PairSignerForm Try-again recovery is suppressed for WebHID-unsupported errors');

console.log('OK: StatusMessage.recovery + Send / PsbtSignForm / ImportWallet / PairSignerForm wiring smoke');
