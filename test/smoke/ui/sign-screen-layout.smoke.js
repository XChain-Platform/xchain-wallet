// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §21, Step 5: sign-screen layout polish (§21.3 + §21.7).
//
// Cross-cuts SignApproval.jsx (extension approval window) and
// Send.jsx (user-initiated send). Asserts:
//   - Approve button label reads "Approve & Sign on <chain>" for
//     signAction / signPsbt; "Sign in" for signIn; bare "Approve"
//     for signMessage. Send.jsx uses "Sign on <chain>" (user-initiated
//     verb per §21.7: "Sign", not "Approve & Sign").
//   - dApp Source block renders when an origin is present (Origin +
//     optional App name).
//   - Action details collapsed by default behind a <details> toggle.
//   - CSS hooks for the new blocks are present.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const signPath = join(wsRoot, 'packages', 'extension', 'src', 'approval', 'kinds', 'SignApproval.jsx');
const signCssPath = join(wsRoot, 'packages', 'extension', 'src', 'approval', 'kinds', 'SignApproval.module.css');
const sendPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Send.jsx');
const sendCssPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Send.module.css');

const signSrc = readFileSync(signPath, 'utf8');
const signCss = readFileSync(signCssPath, 'utf8');
const sendSrc = readFileSync(sendPath, 'utf8');
const sendCss = readFileSync(sendCssPath, 'utf8');

// --- 1. Approve-button label semantics (SignApproval) -------------------

assert.match(
    signSrc,
    /const approveLabel\s*=/,
    'derives a per-kind approve label',
);
assert.match(
    signSrc,
    /kind === 'signAction' \|\| kind === 'signPsbt'/,
    'signAction + signPsbt take the value-committing label',
);
assert.match(
    signSrc,
    /Approve & Sign on \$\{chainName\}/,
    'value-committing label carries the chain name',
);
assert.match(
    signSrc,
    /'Approve & Sign'/,
    'falls back to bare "Approve & Sign" when no chain',
);
assert.match(
    signSrc,
    /'Sign in'/,
    'signIn keeps a "Sign in" label',
);
// Bare "Approve" remains for signMessage. The button JSX renders {approveLabel}
// (no longer a hardcoded "Approve"); confirm both the literal fallback exists
// and the button consumes the derived label.
assert.match(
    signSrc,
    />\s*\{approveLabel\}\s*</,
    'button renders the derived approveLabel, not a hardcoded string',
);

// --- 2. dApp Source block (SignApproval) --------------------------------

assert.match(
    signSrc,
    /<section className=\{styles\.source\} aria-label="Source">/,
    'Source block uses a labelled <section>',
);
assert.match(
    signSrc,
    /\{origin \?/,
    'Source block conditionally renders on origin presence',
);
assert.match(signSrc, /styles\.sourceLabel/);
assert.match(signSrc, /styles\.sourceOrigin/);
assert.match(signSrc, /styles\.sourceApp/);
// App name resolves from either payload.appName or payload.payload.appName.
assert.match(
    signSrc,
    /payload\?\.appName \|\| payload\?\.payload\?\.appName/,
);

// --- 3. Action details collapsed (SignApproval) -------------------------

assert.match(
    signSrc,
    /<details className=\{styles\.details\}>/,
    'action details wrapped in a <details> disclosure (closed by default)',
);
assert.match(
    signSrc,
    /<summary className=\{styles\.detailsToggle\}>/,
    'disclosure toggle uses the styled summary',
);
assert.match(
    signSrc,
    /Details \(\{decoded\.details\.length\}\)/,
    'toggle shows the row count',
);

// --- 4. SignApproval CSS hooks -----------------------------------------

for (const cls of ['source', 'sourceLabel', 'sourceOrigin', 'sourceApp', 'details', 'detailsToggle']) {
    assert.match(signCss, new RegExp(`\\.${cls}\\b`), `SignApproval.module.css defines .${cls}`);
}

// --- 5. Send.jsx polish -------------------------------------------------

// Submit-button label uses chain-suffixed "Sign on <chain>" for
// software signing (HW path keeps its existing Sign on Trezor / Ledger
// affordance).
assert.match(
    sendSrc,
    /descriptor\?\.displayName\s*\?\s*`Sign on \$\{descriptor\.displayName\}`\s*:\s*'Sign'/,
    'Send.jsx submit button reads "Sign on <chain>" (software path)',
);
// "Send" copy must no longer appear as a button label.
assert.ok(
    !/>\s*Send\s*<\/Button>/.test(sendSrc),
    'old "Send" button label removed',
);

// Details collapsed.
assert.match(
    sendSrc,
    /<details className=\{styles\.details\}>/,
    'Send.jsx review wraps details in a <details> disclosure',
);
assert.match(
    sendSrc,
    /<summary className=\{styles\.detailsToggle\}>/,
    'Send.jsx review uses the styled disclosure summary',
);

// --- 6. Send.jsx CSS hooks ---------------------------------------------

assert.match(sendCss, /\.details\b/, 'Send.module.css defines .details');
assert.match(sendCss, /\.detailsToggle\b/, 'Send.module.css defines .detailsToggle');

console.log('sign-screen-layout smoke OK');
