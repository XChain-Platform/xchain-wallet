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
//   - dApp approvals keep their approval wording, while wallet action
//     confirmations name the action and amount shown in the review.
//   - dApp Source block renders when an origin is present (Origin +
//     optional App name).
//   - Action details collapsed by default behind a <details> toggle.
//   - CSS hooks for the new blocks are present.

import { strict as assert } from 'node:assert';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const signPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'approval', 'SignApproval.jsx');
const sendPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Send.jsx');

const signSrc = readFileSync(signPath, 'utf8');
const sendSrc = readFileSync(sendPath, 'utf8');
const confirmStandardSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'ConfirmStandard.jsx'),
    'utf8',
);
const confirmStandardCss = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'ConfirmStandard.module.css'),
    'utf8',
);
const confirmStandardModelSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'utils', 'confirmStandardModel.js'),
    'utf8',
);
const { en } = await import(join(wsRoot, 'packages', 'core', 'src', 'i18n', 'locales', 'en', 'index.js'));

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
    /approveLabel = t\('extension\.connect\.approve'\)/,
    'every kind approves with the translated bare "Approve"',
);
assert.doesNotMatch(
    signSrc,
    /\? 'Sign In' : 'Approve'/,
    'the retired per-kind approve-label ternary has not come back',
);
assert.match(
    confirmStandardSrc,
    /Icon\.ThumbsUpIcon/,
    'the shared Approve button carries the thumbs-up icon',
);
assert.match(
    confirmStandardSrc,
    /Icon\.ThumbsDownIcon/,
    'the shared Reject button carries the thumbs-down icon',
);
assert.match(
    signSrc,
    /<ConfirmButtons[\s\S]{0,300}approveLabel=\{approveLabel\}/,
    'SignApproval passes the derived verb to the shared button pair',
);

// --- 1b. action labels on the in-wallet confirm surface ------------------
//
// The wallet surface derives its label from the reviewed, composed action so
// every action adapter follows the same wording and amount formatting.
{
    const confirmSrc = readFileSync(
        join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'ConfirmActionModal.jsx'),
        'utf8',
    );
    assert.doesNotMatch(
        confirmSrc,
        /const defaultApproveLabel[\s\S]{0,120}Approve & Sign/,
        'confirm surface: action label is not chain-based signing text',
    );
    // Confirm Standard (G127): the reviewed action and amount are the page's
    // one sentence, read from the composed action, and the footer is the one
    // shared Reject and Approve pair.
    assert.match(
        confirmSrc,
        /confirmHeadline\(\{[\s\S]*?decoded: formattedDecoded/,
        'confirm surface: the sentence names the reviewed action and amount',
    );
    assert.match(confirmSrc, /<ConfirmDecisionFooter\b/,
        'confirm surface: the warning and shared button pair use one decision footer');
    const footerIdx = confirmStandardSrc.indexOf('data-testid="confirm-approve"');
    assert.ok(footerIdx !== -1, 'confirm surface: the Approve button is testid-tagged');
    const footer = confirmStandardSrc.slice(footerIdx, footerIdx + 400);
    assert.ok(
        !/>\s*Approve\s*</.test(footer),
        'confirm surface: the footer verb comes from the one approve label, not a literal',
    );
}

// --- 1c. the signIn summary names its fields in plain language ----------
//
// The voice guide (packages/web/src/style-guide/sections/VoiceSection.jsx)
// lists "nonce" among the jargon to name only when the user asks about it,
// and this dialog opens on every dApp sign-in. The value uses the shared
// signing-display hardening so invisible and directional controls cannot
// misrepresent the original bytes that remain in the signing payload.
assert.match(
    signSrc,
    /t\('extension\.sign\.oneTimeCode'\)/,
    'signIn summary translates the challenge label',
);
assert.equal(en['extension.sign.oneTimeCode'], 'One-time code', 'English challenge label stays exact');
assert.doesNotMatch(
    signSrc,
    /summaryLabel[^>]*>Nonce</,
    'the bare "Nonce" label has not come back',
);
assert.match(
    signSrc,
    /label: t\('extension\.sign\.oneTimeCode'\),\s*value: neutralizeControlText\(resolvedPayload\.payload\.nonce\)/,
    'the challenge value enters the facts card through signed-text hardening',
);
assert.match(signSrc, /displayedSignInNonce !== signInNonce[\s\S]{0,120}extension\.sign\.warningNoun\.signIn/,
    'a changed sign-in challenge produces a safety warning');
assert.equal(en['extension.sign.warningNoun.signIn'], 'sign-in', 'English warning noun stays exact');

// --- 2. dApp source in Confirm Standard ---------------------------------

assert.match(signSrc, /const requestingSite = siteNameFromOrigin\(origin\)/,
    'the requesting origin is reduced to a safe site name');
assert.match(signSrc, /sentence: kind === 'signPsbt'[\s\S]{0,120}sentenceForSite\(baseHead\.sentence, requestingSite\)/,
    'the one confirmation sentence names the requesting site');
assert.match(
    signSrc,
    /payload\?\.appName \|\| payload\?\.payload\?\.appName/,
    'the declared app name resolves from either payload location',
);
assert.match(signSrc, /key: 'app-name',[\s\S]{0,180}value: appName/,
    'the declared app name is retained in the facts card');

// --- 3. Confirm Standard content (SignApproval) -------------------------

assert.match(signSrc, /<ConfirmStandard\b/, 'SignApproval renders the shared confirmation body');
assert.match(signSrc, /sentence=\{confirmationHead\.sentence\}/,
    'SignApproval renders the one action sentence');
// No Total block (G127 revised 2026-11-16): fees are facts card rows.
assert.doesNotMatch(signSrc, /total=\{confirmationTotal\}|confirmTotal\(/,
    'SignApproval renders no Total block');
assert.match(signSrc, /facts=\{confirmationFacts\}/,
    'SignApproval renders the facts card');
assert.match(signSrc, /<ConfirmStandard\b[\s\S]{0,2400}?status=\{confirmationStatus\}[\s\S]{0,2400}?warning=\{confirmationWarning\}/,
    'SignApproval renders the check verdict in the status notice and safety findings in the short warning');
assert.doesNotMatch(signSrc, /<PsbtIntentPanel\b/,
    'PSBT approvals use the shared decoded confirmation model');
assert.doesNotMatch(signSrc, /<ActionIntentSummary\b|<PreflightPanel\b/,
    'retired review panels are absent from SignApproval');

// --- 4. Send Confirm Standard ------------------------------------------

assert.match(sendSrc, /<ConfirmStandard\b/, 'Send review renders Confirm Standard');
assert.match(sendSrc, /<ConfirmDecisionFooter\b/,
    'Send review renders the shared warning slot and button pair');
assert.doesNotMatch(sendSrc, /^\s*<(?:ActionIntentSummary|PreflightPanel|BalanceChanges)\b/m,
    'Send review has none of the retired review panels');
assert.match(confirmStandardSrc, /const addressFacts = withAddressFact\(\{ facts: actionFacts, address, addressIsSource, addressLabel \}\)/,
    'the primary address enters the facts card before every other detail');
assert.match(confirmStandardSrc, /const orderedFacts = facts/,
    'the facts renderer preserves the order selected by Confirm Standard');
assert.match(confirmStandardModelSrc, /return \[\s*\{\s*key: 'address',[\s\S]{0,300}?\.\.\.rows\.filter/,
    'the address model makes the canonical address the first fact row');
assert.doesNotMatch(confirmStandardSrc, /className=\{styles\.address\}/,
    'the address no longer renders as a separate line under the sentence');
assert.doesNotMatch(confirmStandardCss, /\.stack\s*\{[^}]*padding-(?:block-)?top/s,
    'the confirm stack adds no inset beyond Screen body 8px top padding');

// No review or confirm surface labels a button "Sign on <device or chain>".
{
    const shared = join(wsRoot, 'packages', 'core', 'src', 'shared');
    for (const rel of ['routes/Send.jsx', 'routes/ComposeMessage.jsx', 'routes/ExecuteContractForm.jsx', 'routes/IssueTokenForm.jsx', 'components/PlaceOrderPanel.jsx']) {
        assert.doesNotMatch(readFileSync(join(shared, rel), 'utf8'), /\.signOn'/, `${rel}: no "Sign on X" label key`);
    }
    // The hardware sign page's own page title ("Sign on Your Trezor") names
    // the page, not a button, so it is the one value allowed to read so.
    const PAGE_TITLES = new Set(['hardwareSign.title']);
    const enKeys = Object.keys(en).filter((k) => !PAGE_TITLES.has(k));
    assert.deepEqual(
        enKeys.filter((k) => /signOn$/i.test(k) || /^Sign on\b/.test(String(en[k]))),
        [],
        'en locale holds no "Sign on X" label',
    );
    // Product JSX never writes a "Sign on <device>" button literal either: the
    // hardware path shows the software path's label with the sign icon.
    const offenders = [];
    const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (/\.jsx$/.test(entry.name)) {
                readFileSync(full, 'utf8').split('\n').forEach((line, i) => {
                    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
                    if (/(['"`]|>)Sign on\b/.test(line) && !/title="Sign on another phone"/.test(line)) {
                        offenders.push(`${full.slice(wsRoot.length + 1)}:${i + 1}`);
                    }
                });
            }
        }
    };
    for (const pkg of ['core', 'web', 'desktop', 'extension']) {
        const src = join(wsRoot, 'packages', pkg, 'src');
        if (existsSync(src)) walk(src);
    }
    assert.deepEqual(offenders, [], 'no product JSX literal reads "Sign on <device>"');
}

// --- 5. one Reject / Approve pair on every confirm screen ----------------
//
// Every confirm surface ends in exactly two footer buttons: Reject with the
// thumbs-down icon and Approve with the thumbs-up icon. The in-wallet screens
// delegate to ConfirmActionModal and render no footer buttons of their own.
{
    const read = (...parts) => readFileSync(join(wsRoot, ...parts), 'utf8');
    const footerOf = (src, startMarker) => {
        const start = src.indexOf(startMarker);
        assert.ok(start !== -1, `footer marker ${startMarker} exists`);
        const end = src.indexOf('</div>', src.lastIndexOf('</Button>', src.indexOf('</div>', start + 200)) );
        return src.slice(start, end === -1 ? start + 1500 : end);
    };
    const THUMBS = {
        reject: /icon=\{<Icon\.ThumbsDownIcon \/>\}/,
        approve: /icon=\{<Icon\.ThumbsUpIcon \/>\}/,
    };
    const assertPair = (name, footer, icons = THUMBS, dangerReject = false) => {
        const buttons = footer.match(/<Button\b/g) || [];
        assert.equal(buttons.length, 2, `${name}: footer has exactly two buttons`);
        const [rejectBtn, approveBtn] = footer.split(/<Button\b/).slice(1);
        assert.match(rejectBtn, icons.reject, `${name}: Reject carries its icon`);
        assert.match(rejectBtn, /extension\.approval\.reject|\bReject\b/, `${name}: first button is Reject`);
        assert.match(approveBtn, icons.approve, `${name}: Approve carries its icon`);
        if (dangerReject) {
            assert.match(rejectBtn, /variant="danger"/, `${name}: Reject is danger`);
        } else {
            assert.doesNotMatch(rejectBtn, /variant="(danger|primary)"/, `${name}: Reject is not danger or primary`);
        }
        assert.doesNotMatch(approveBtn, /variant="danger"/, `${name}: Approve is not danger`);
    };
    const connectSrc = read('packages', 'core', 'src', 'shared', 'approval', 'ConnectApproval.jsx');
    assertPair('ConnectApproval', footerOf(connectSrc, 'data-connect-actions'), THUMBS, true);
    assert.match(signSrc, /signingUnavailable \? \([\s\S]{0,500}<Button[\s\S]{0,300}variant="danger"/,
        'SignApproval fail-closed state offers only the red Reject button');
    assert.match(signSrc, /:\s*\(\s*<ConfirmButtons[\s\S]{0,300}approveLabel=\{approveLabel\}/,
        'SignApproval ready state delegates to the shared Reject and Approve pair');
    assert.equal(en['extension.connect.approve'], 'Approve', 'ConnectApproval approve label is Approve');
    {
        // The in-wallet confirm (G127): Reject red with a thumbs down and
        // Approve green with a thumbs up, half the width each.
        const footer = footerOf(confirmStandardSrc, '<div className={styles.buttons}');
        const buttons = footer.match(/<Button\b/g) || [];
        assert.equal(buttons.length, 2, 'ConfirmStandard: footer has exactly two buttons');
        const [rejectBtn, approveBtn] = footer.split(/<Button\b/).slice(1);
        assert.match(rejectBtn, THUMBS.reject, 'ConfirmStandard: Reject carries the thumbs down');
        assert.match(rejectBtn, /variant="danger"/, 'ConfirmStandard: Reject is red');
        assert.match(approveBtn, THUMBS.approve, 'ConfirmStandard: Approve carries the thumbs up');
        assert.match(approveBtn, /variant="success"/, 'ConfirmStandard: Approve is green');
        assert.match(rejectBtn, /className=\{styles\.button\}/, 'ConfirmStandard: Reject takes the half width');
        assert.match(approveBtn, /className=\{styles\.button\}/, 'ConfirmStandard: Approve takes the half width');
    }
    for (const name of ['ActionConfirmScreen', 'MessageConfirmScreen', 'PsbtConfirmScreen']) {
        const src = read('packages', 'core', 'src', 'shared', 'components', `${name}.jsx`);
        assert.match(src, /<ConfirmActionModal\b/, `${name}: renders the shared confirm footer`);
        assert.doesNotMatch(src, /<Button\b/, `${name}: adds no footer buttons of its own`);
    }
    {
        // Gated publish signs a single-part file on the shared confirm screen
        // alone: Review hands the composed publish to <ActionConfirmScreen>. Only a
        // multi-part file opens the form's own review first, the one approval that
        // quotes the whole file (multipart-no-size-cap Decision Q6).
        const gatedSrc = read('packages', 'core', 'src', 'shared', 'routes', 'GatedPublishForm.jsx');
        assert.doesNotMatch(gatedSrc, /gatedPublish\.signAndPublish/, 'GatedPublishForm: no Sign and Publish button');
        assert.doesNotMatch(gatedSrc, /send\.review\.signOn/, 'GatedPublishForm: no Sign on device button');
        assert.match(
            gatedSrc,
            /if \(actionConfirm\.open\) \{\s*return \(\s*<ActionConfirmScreen\b/,
            'GatedPublishForm: the open confirm flow renders <ActionConfirmScreen>',
        );
        const reviewStart = gatedSrc.search(/stage === 'review'/);
        const reviewBranch = reviewStart === -1
            ? ''
            : gatedSrc.slice(reviewStart, gatedSrc.indexOf('// Form stage.', reviewStart));
        assert.match(reviewBranch, /publishFile\.review\.signAndPublish/,
            'GatedPublishForm: multipart review has the shared Sign and Publish label');
        assert.match(reviewBranch, /<SignCredentials\b/,
            'GatedPublishForm: multipart review uses shared sign credentials');
        assert.match(reviewBranch, /setStage\('form'\)/,
            'GatedPublishForm: multipart approval returns to the progress form');
        // handleReview through the publish step it calls, up to the header.
        const reviewHandler = gatedSrc.slice(
            gatedSrc.indexOf('async function handleReview('),
            gatedSrc.indexOf('const header = ('),
        );
        assert.match(reviewHandler, /actionConfirm\.run\(/, 'GatedPublishForm: Review hands off to the confirm flow');
        assert.match(reviewHandler, /start\.path === 'single'[\s\S]{0,160}await publish\(\)/,
            'GatedPublishForm: the single-part path still enters the shared confirm flow');
        assert.match(reviewHandler, /setPendingMultipart\(true\);\s*setStage\('review'\)/,
            'GatedPublishForm: only a multipart path opens the whole-file review');
    }
}

console.log('sign-screen-layout smoke OK');
