// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// : error-recovery sweep remainder. Cluster P FOLLOWUP 4 shipped
// StatusMessage + one-click recovery on IssueTokenForm / DispenserForm /
// AddAccountForm; this closes the two lanes it explicitly deferred:
//
//   1. MultisigSigningSession's 5+ inline `<div role="alert">` error rows
//      migrate to `<StatusMessage variant="error">` carrying a "Try again"
//      recovery that re-runs whatever action last failed (recorded in a
//      retryRef). Non-retryable errors (malformed scan / wrong envelope
//      kind / memo-derived encode failure) render the alert without a
//      button.
//   2. The three Settings rows (BiometricRow / DuressPassphraseRow /
//      AboutSection) swap their inline role="alert" spans/divs for
//      StatusMessage, offering "Try again" where a re-run is meaningful.
//
// Static source-analysis smoke, matching error-recovery-sweep.smoke.js.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const multisigSrc = read('packages/core/src/shared/routes/MultisigSigningSession.jsx');
const biometricSrc = read('packages/core/src/shared/components/settings/BiometricRow.jsx');
const duressSrc = read('packages/core/src/shared/components/settings/DuressPassphraseRow.jsx');
const aboutSrc = read('packages/core/src/shared/components/settings/AboutSection.jsx');

// --- 1. MultisigSigningSession ---------------------------------------

assert.ok(//.test(multisigSrc), 'MultisigSigningSession tags ');

// The inline `<div role="alert" className={styles.error}>` error rows are
// gone: every error surface now goes through StatusMessage.
assert.equal(
    (multisigSrc.match(/<div role="alert" className=\{styles\.error\}>/g) || []).length,
    0,
    'MultisigSigningSession replaced every inline role=alert error div with StatusMessage',
);
assert.ok(
    /import \{[^}]*StatusMessage[^}]*\} from '@xchain-wallet\/core\/ui'/.test(multisigSrc),
    'MultisigSigningSession imports StatusMessage',
);

// A shared retryRef + fail() helper record the re-runnable action, and the
// render-time errorRecovery surfaces it as a "Try again" affordance.
assert.ok(
    /const retryRef = useRef\(/.test(multisigSrc),
    'MultisigSigningSession keeps a retryRef for the last failed action',
);
assert.ok(
    /const fail = useCallback\(\(message, retryFn\) => \{/.test(multisigSrc),
    'MultisigSigningSession funnels errors through a fail(message, retryFn) helper',
);
assert.ok(
    /const errorRecovery = retryRef\.current[\s\S]{0,120}label: 'Try again', onAction: retryRef\.current/.test(multisigSrc),
    'MultisigSigningSession builds a Try again recovery from retryRef',
);

// The retryable handlers register themselves; the non-retryable sites pass null.
for (const fn of ['refreshList', 'handleAggregate', 'handleCancel', 'handleSignLocally', 'handlePasteSubmit']) {
    assert.ok(
        new RegExp(`fail\\([^;]*, ${fn}\\)`).test(multisigSrc),
        `MultisigSigningSession records ${fn} as its own retry action`,
    );
}
// Scan / parse / wrong-kind failures are not re-runnable: they pass null.
assert.ok(/fail\([^;]*, null\)/.test(multisigSrc), 'non-retryable multisig errors pass null (no button)');

// Every StatusMessage recovery slot that carries errorRecovery is the shared
// error surface (list / sign-locally / paste-inbox / tracker); the memo-error
// export site renders StatusMessage without recovery.
assert.ok(
    (multisigSrc.match(/<StatusMessage variant="error" recovery=\{errorRecovery\}>/g) || []).length >= 4,
    'MultisigSigningSession wires errorRecovery into the four shared-error surfaces',
);
assert.ok(
    /<StatusMessage variant="error">\{exportFrames\.error\}<\/StatusMessage>/.test(multisigSrc),
    'export-envelope memo error renders StatusMessage without a recovery button',
);

// --- 2. BiometricRow --------------------------------------------------

assert.ok(//.test(biometricSrc), 'BiometricRow tags ');
assert.ok(
    /import \{ StatusMessage \} from '@xchain-wallet\/core\/ui'/.test(biometricSrc),
    'BiometricRow imports StatusMessage',
);
assert.equal(
    (biometricSrc.match(/role="alert"/g) || []).length,
    0,
    'BiometricRow no longer hand-rolls role=alert (StatusMessage provides it)',
);
assert.ok(
    /retryRef\.current = doEnable/.test(biometricSrc),
    'BiometricRow records the pairing attempt as the retry action on failure',
);
assert.ok(
    /recovery=\{retryRef\.current \? \{ label: 'Try again', onAction: retryRef\.current \} : undefined\}/.test(biometricSrc),
    'BiometricRow surfaces a Try again recovery affordance',
);

// --- 3. DuressPassphraseRow ------------------------------------------

assert.ok(//.test(duressSrc), 'DuressPassphraseRow tags ');
assert.ok(
    /import \{ StatusMessage \} from '@xchain-wallet\/core\/ui'/.test(duressSrc),
    'DuressPassphraseRow imports StatusMessage',
);
// The docstring still mentions role="alert" as documentation; assert there is
// no hand-rolled JSX `role="alert"` attribute left.
assert.equal(
    (duressSrc.match(/ role="alert">/g) || []).length,
    0,
    'DuressPassphraseRow no longer hand-rolls a role=alert span',
);
assert.ok(
    /retryRef\.current = attemptSet/.test(duressSrc),
    'DuressPassphraseRow records the set attempt as the retry action on storage failure',
);
assert.ok(
    /recovery=\{retryRef\.current \? \{ label: 'Try again', onAction: retryRef\.current \} : undefined\}/.test(duressSrc),
    'DuressPassphraseRow surfaces a Try again recovery affordance (storage-failure only)',
);
// Validation messages leave retryRef null: they precede the try block and
// reset the ref, so no button renders for "does not match".
assert.ok(
    /retryRef\.current = null;[\s\S]{0,200}Pick a passphrase/.test(duressSrc),
    'DuressPassphraseRow clears retryRef before validation so validation errors have no button',
);

// --- 4. AboutSection --------------------------------------------------

assert.ok(//.test(aboutSrc), 'AboutSection tags ');
assert.ok(
    /import \{ Button, StatusMessage \} from '@xchain-wallet\/core\/ui'/.test(aboutSrc),
    'AboutSection imports StatusMessage',
);
assert.equal(
    (aboutSrc.match(/<div role="alert"/g) || []).length,
    0,
    'AboutSection replaced its inline role=alert error div with StatusMessage',
);
assert.ok(
    /retryRef\.current = handleCopyDiagnostics/.test(aboutSrc),
    'AboutSection records the copy action as retry on copy failure',
);
assert.ok(
    /retryRef\.current = handleTogglePreview/.test(aboutSrc),
    'AboutSection records the preview action as retry on preview failure',
);
assert.ok(
    /recovery=\{retryRef\.current \? \{ label: 'Try again', onAction: retryRef\.current \} : undefined\}/.test(aboutSrc),
    'AboutSection surfaces a Try again recovery affordance',
);

console.log('OK: error-recovery sweep remainder (MultisigSigningSession + Biometric/Duress/About settings rows)');
