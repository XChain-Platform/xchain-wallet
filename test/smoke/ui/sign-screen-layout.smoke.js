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
//   - Approve/Reject footer reads a bare "Approve" (thumbs up) and
//     "Reject" (thumbs down) on every kind but signIn, which keeps its
//     own "Sign in" verb. The chain suffix that used to ride on the
//     approve button is retired by operator decision; the chain is shown
//     by the ChainBadge and the request details instead.
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
// Operator decision: the footer is Approve / Reject, thumbs up and thumbs down,
// with NO chain suffix. The retired form appended the chain to a
// balance-committing signature ("Approve & Sign on Litecoin"); the chain is
// carried by the ChainBadge and the request details instead.
assert.doesNotMatch(
    signSrc,
    /Approve & Sign/,
    'the retired "Approve & Sign" label has not come back',
);
assert.match(
    signSrc,
    /kind === 'signIn' \? 'Sign in' : 'Approve'/,
    'every kind but signIn approves with a bare "Approve"',
);
assert.match(
    signSrc,
    /Icon\.ThumbsUpIcon/,
    'approve carries the thumbs-up icon',
);
assert.match(
    signSrc,
    /Icon\.ThumbsDownIcon/,
    'reject carries the thumbs-down icon',
);
// Bare "Approve" remains for signMessage. The button JSX renders {approveLabel}
// (no longer a hardcoded "Approve"); confirm both the literal fallback exists
// and the button consumes the derived label.
assert.match(
    signSrc,
    />\s*\{approveLabel\}\s*</,
    'button renders the derived approveLabel, not a hardcoded string',
);

// --- 1b. the SAME rule on the in-wallet confirm surface -----------------
//
// a later change gave the wallet a second signing surface, and every action form now
// routes through it. It shipped with a bare "Approve": the button that commits
// the signature never said which chain it was committing on, while the dApp
// window a few files away got it right. Found by finally driving the page in a
// browser (Playwright), not by any unit test - the copy was internally
// consistent, just wrong.
//
// Derived from `variant` inside the component rather than passed by each of the
// three adapters, because three adapters each remembering the rule is three
// chances to forget it.
{
    const confirmSrc = readFileSync(
        join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'ConfirmActionModal.jsx'),
        'utf8',
    );
    assert.doesNotMatch(
        confirmSrc,
        /const defaultApproveLabel[\s\S]{0,120}Approve & Sign/,
        'confirm surface: the retired "Approve & Sign on <chain>" label has not come back',
    );
    assert.match(
        confirmSrc,
        /const defaultApproveLabel = 'Approve';/,
        'confirm surface: every variant approves with a bare "Approve"',
    );
    assert.match(
        confirmSrc,
        /\{approveLabel \|\| defaultApproveLabel\}/,
        'confirm surface: the footer button renders the derived label',
    );
    // The regression this guards: a hardcoded verb in the footer.
    const footerIdx = confirmSrc.indexOf('data-testid="confirm-approve"');
    assert.ok(footerIdx !== -1, 'confirm surface: the Approve button is testid-tagged');
    const footer = confirmSrc.slice(footerIdx, footerIdx + 400);
    assert.ok(
        !/>\s*Approve\s*</.test(footer),
        'confirm surface: the footer verb is not hardcoded back to a bare "Approve"',
    );
}

// --- 1c. the signIn summary names its fields in plain language ----------
//
// The voice guide (packages/web/src/style-guide/sections/VoiceSection.jsx)
// lists "nonce" among the jargon to name only when the user asks about it,
// and this dialog opens on every dApp sign-in. The VALUE stays raw in its
// <pre> so the user can compare it byte-for-byte with the site; only the
// label is translated.
assert.match(
    signSrc,
    /summaryLabel[^>]*>One-time code</,
    'signIn summary labels the challenge "One-time code"',
);
assert.doesNotMatch(
    signSrc,
    /summaryLabel[^>]*>Nonce</,
    'the bare "Nonce" label has not come back',
);
assert.match(
    signSrc,
    /<pre className=\{shared\.summaryValue\}>\{String\(inner\.nonce \|\| ''\)\}<\/pre>/,
    'the challenge value is still rendered raw for byte-for-byte comparison',
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
    'Send.jsx review/sign button reads "Sign on <chain>" (software path)',
);
// Send is a deliberate two-stage flow: the compose-stage submit button
// reads "Send" (it advances to Review via handleReview), and only the
// review-stage button commits with "Sign on <chain>" (asserted above).
// A blanket "no Send button anywhere" check is therefore over-broad and
// was retired; the "Sign on <chain>" assertion already pins the intent.

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
