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
import { withEnglishCopy } from '../_localized-source.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const statusSrc = read('packages/core/src/ui/StatusMessage.jsx');
const sendSrc = read('packages/core/src/shared/routes/Send.jsx');
const psbtSrc = read('packages/core/src/shared/routes/PsbtSignForm.jsx');
const importSrc = withEnglishCopy(read('packages/core/src/shared/routes/ImportWallet.jsx'));
const pairSrc = read('packages/core/src/shared/routes/PairSignerForm.jsx');

// 1. StatusMessage exposes the `recovery` prop and renders an
//    accessible button when it's provided.
assert.ok(/\brecovery\b/.test(statusSrc),
    'StatusMessage references the recovery prop');
assert.ok(/recovery\.label/.test(statusSrc),
    'StatusMessage reads recovery.label');
assert.ok(/recovery\.onAction/.test(statusSrc),
    'StatusMessage reads recovery.onAction');
assert.ok(/<Button[\s\S]*?type="button"[\s\S]*?aria-label/.test(statusSrc),
    'StatusMessage recovery renders the shared Button with aria-label');
assert.ok(/Promise\.resolve\(recovery\.onAction\(\)\)\.catch/.test(statusSrc),
    'StatusMessage swallows recovery.onAction rejections so the message stays visible');

// 2. Send.jsx surfaces a "Use max" recovery on amount-related form
//    errors AND on insufficient-funds submit errors.
assert.ok(/StatusMessage/.test(sendSrc),
    'Send.jsx imports StatusMessage');
assert.ok(/label: t\('send\.useMax'\)/.test(sendSrc),
    'Send.jsx wires "Use max" recovery');
// migrated this from a regex over the displayed message to the
// structured cause returned by humanizeError, so the Use-Max recovery keys
// off the classified cause instead of re-parsing display copy.
assert.ok(/submitErrorCause\s*===\s*'insufficient_funds'/.test(sendSrc),
    'Send.jsx detects insufficient-funds submit errors (via humanizeError cause) for the Use-Max recovery');

// 3. PsbtSignForm offers a "Clear" recovery for unrecognized paste.
assert.ok(/StatusMessage/.test(psbtSrc),
    'PsbtSignForm imports StatusMessage');
// The paste error is a note under the field, with Clear as an ordinary button beside it.
assert.ok(/setPasted\(''\); setError\(null\);[\s\S]{0,80}Clear/.test(psbtSrc),
    'PsbtSignForm wires a Clear recovery');
assert.ok(/setPasted\(''\)/.test(psbtSrc),
    'PsbtSignForm Clear recovery wipes the textarea');

// 4. ImportWallet backup lane: a submit without a file names it under the
//    drop area, whose own Choose File button is the way on, and takes focus.
assert.ok(/StatusMessage/.test(importSrc),
    'ImportWallet imports StatusMessage');
assert.ok(/refuseBackupField\('file', 'Choose a backup file\.'\)/.test(importSrc),
    'ImportWallet names a missing backup file on the drop area');
assert.ok(/error=\{backupErrorFor\('file'\)\}/.test(importSrc),
    'ImportWallet shows the file refusal under the drop area, beside its Choose File button');

// 5. PairSignerForm (Hardware Wallet connect): a connection failure is an
//    error notice with no button of its own, because the Try again row
//    under the statuses retries; an account read failure offers Try again
//    as the notice's recovery.
assert.ok(/StatusMessage/.test(pairSrc),
    'PairSignerForm imports StatusMessage');
assert.ok(/<StatusMessage key="connection-error" variant="error">\{failedMessage\}<\/StatusMessage>/.test(pairSrc),
    'PairSignerForm shows the connection failure as a plain error notice');
assert.ok(/title=\{t\('hardwareConnect\.connect\.tryAgain'\)\}[\s\S]{0,200}onClick=\{\(\) => runPairing\(vendor\)\}/.test(pairSrc),
    'PairSignerForm Try again row runs the pairing again');
// Try again reads every network again at every account number asked for.
// The smoke runner's English-source loader (_english-source.mjs) shows the
// label as its English text; a bare node run shows the t() call.
assert.ok(/recovery=\{\{\s*label: (?:t\('common\.tryAgain'\)|'Try Again'),\s*onAction: handleRetryAll,/.test(pairSrc),
    'PairSignerForm account read failure offers Try again');

console.log('OK: StatusMessage.recovery + Send / PsbtSignForm / ImportWallet / PairSignerForm wiring smoke');
