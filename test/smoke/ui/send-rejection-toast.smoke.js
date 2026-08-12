// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §30.5 / G089: user-initiated cancel during Send surfaces
// the spec's "Transaction cancelled." toast and routes the user back to
// the composing form instead of leaving an alarming red error on the
// review screen. Cluster E Step 1 of 5.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const routes = join(core, 'src', 'shared', 'routes');

const sendPath = join(routes, 'Send.jsx');
assert.ok(existsSync(sendPath), 'Send.jsx exists');
const send = readFileSync(sendPath, 'utf8');

// --- 1. useToast import wired in -----------------------------------------

assert.ok(
    /import\s*\{\s*useToast\s*\}\s*from\s*['"]\.\.\/components\/ToastHost\.jsx['"]/.test(send),
    'Send.jsx imports useToast from ToastHost',
);
assert.ok(/useToast\(\)/.test(send), 'Send.jsx instantiates the useToast hook');

// --- 2. Cancel-pattern detection regex exists ----------------------------

// Pattern matches HW-device cancel/reject/denied messages so deliberate
// user actions don't get rendered as Send failures.
assert.ok(
    /\/cancel\|reject\|denied\/i/.test(send),
    'Send.jsx defines a /cancel|reject|denied/i pattern for user-cancel detection',
);

// --- 3. Toast call uses spec wording -------------------------------------

assert.ok(
    /showToast\(\s*\{\s*message:\s*['"]Transaction cancelled\.['"]/.test(send),
    'Send.jsx shows "Transaction cancelled." toast on user-cancel (§30.5 wording)',
);

// --- 4. Cancel branch routes back to the composing form ------------------

// Shape we want: detect user cancel, clear submitError, clear password,
// setStage('form'), call showToast. Verify each lever is present in the
// catch branch (without pinning exact line ordering).
// Anchor on `const isBadPassword` (unique to the handleSubmit catch) so we
// don't accidentally grab the earlier saveContact catch block, which grew
// when Send.jsx was refactored and moved above the submit handler.
// Window widened from 1500 to 2200: the handleSubmit catch block grew when
// a later change added plain-language error humanizing (humanizeError) alongside
// the existing user-cancel / bad-password branches.
const catchBlockMatch = send.match(/\}\s*catch\s*\(\s*err\s*\)\s*\{\s*\n\s+const isBadPassword[\s\S]{0,2200}?\n\s{4,8}\}/);
assert.ok(catchBlockMatch, 'Send.jsx still has a catch (err) block in handleSubmit');
const catchSrc = catchBlockMatch[0];
assert.ok(
    /isUserCancel/.test(catchSrc),
    'catch block classifies the error via an isUserCancel check',
);
assert.ok(
    /setStage\(\s*['"]form['"]\s*\)/.test(catchSrc),
    'catch block routes back to stage="form" on user-cancel',
);
assert.ok(
    /setSubmitError\(\s*null\s*\)/.test(catchSrc),
    'catch block clears submitError on user-cancel (no red error left over)',
);
assert.ok(
    /setPassword\(\s*['"]['"]\s*\)/.test(catchSrc),
    'catch block clears the password buffer on user-cancel',
);

// Bad-password handling must still take precedence so a wrong
// password doesn't get swallowed by the cancel path just because the
// hypothetical message contained "denied".
assert.ok(
    /isBadPassword[\s\S]{0,80}USER_CANCEL_RE\.test|!isBadPassword\s*&&\s*USER_CANCEL_RE/.test(catchSrc),
    'catch block treats InvalidPasswordError as bad-password before user-cancel',
);

console.log('send-rejection-toast smoke OK');
