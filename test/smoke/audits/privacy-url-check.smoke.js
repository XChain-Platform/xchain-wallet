// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for tools/release/verify-privacy-url.mjs ( §5 / D5).
//
// The script answers one pre-submission question: is the privacy-policy
// URL the store form validates actually live, and is it serving THIS
// repo's policy? Two things have to hold for that answer to be worth
// anything, and this smoke pins both.
//
// 1. The four outcomes stay disjoint, and "I could not tell" never
//    becomes a pass. Same rule as the store-version monitor: an
//    inconclusive run reported as clean is worse than no check, because
//    people stop looking once a check exists. The 403 case is not
//    hypothetical here - Cloudflare fronts xchain.io and answers plain
//    tooling with 403 on every path, live page or not.
//
// 2. The text comparison survives the Markdown -> HTML transform. The
//    hosted page is rendered by the websites repo, so this compares
//    prose, not bytes, and every folding rule it applies (smart quotes,
//    dashes, entities, inline-tag spacing, code spans, autolinks) is a
//    place a false ALARM could hide. Building this found four of them,
//    each caught by running against the real deployed page rather than
//    a fixture: `chrome.storage.local`, followed by a comma, arrived as
//    "local ," once tags became spaces; a blanket emphasis strip turned
//    the `https://*/*` match pattern into "https:///" (the one line a
//    reviewer cross-checks against the manifest); and a bare email
//    autolink, <privacy@dankest.llc>, was left with its angle brackets.
//    So the last check below renders the CHECKED-IN hosted page through
//    the same comparison, offline, and would fail on any of them again.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    checkPrivacyUrl, normalizeText, policyTextFromMarkdown, pageTextFromHtml,
    pageCarriesPolicy, EXIT, DEFAULT_URL, DEFAULT_SOURCE_PATH,
} from '../../../tools/release/verify-privacy-url.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');                       // xchain-wallet
const HOSTED_PAGE = join(root, '..', 'xchain-websites', 'xchain.io', 'wallet', 'privacy', 'index.html');

const POLICY = readFileSync(DEFAULT_SOURCE_PATH, 'utf8');
const POLICY_TEXT = policyTextFromMarkdown(POLICY);

// A stand-in for the rendered page: the policy's own text is what a
// correct deploy puts inside the site chrome.
const pageWith = (text) => `<!doctype html><html><head><title>t</title>`
    + `<style>body{}</style><script>var x=1</script></head>`
    + `<body><h1>Wallet Privacy Policy</h1><div class="prose">${text}</div>`
    + `<footer>Copyright</footer></body></html>`;

const respond = ({ status = 200, body = '', location } = {}) => ({
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (h) => (h.toLowerCase() === 'location' ? location : undefined) },
    text: async () => body,
});

const stub = (reply) => async () => (typeof reply === 'function' ? reply() : reply);

// --- 1. The happy path, and it is the only thing that exits 0. --------------

let result = await checkPrivacyUrl({ fetchImpl: stub(respond({ body: pageWith(POLICY_TEXT) })) });
assert.equal(result.code, EXIT.LIVE, 'a 200 carrying the policy is LIVE');
assert.equal(result.errors.length, 0, 'a live run writes nothing to stderr');

// --- 2. Not published: the case measured live on 2026-08-01. ---------------

result = await checkPrivacyUrl({ fetchImpl: stub(respond({ status: 404 })) });
assert.equal(result.code, EXIT.FAILURE, '404 is a FAILURE, not an inconclusive');
assert.match(result.errors.join(' '), /NOT published/, '404 says plainly that the policy is not there');
assert.match(result.errors.join(' '), /deploy, not a doc change/, 'and names the actual fix');

result = await checkPrivacyUrl({ fetchImpl: stub(respond({ status: 410 })) });
assert.equal(result.code, EXIT.FAILURE, '410 is equally definite');

// --- 3. Published, but stale. ----------------------------------------------

const stale = POLICY_TEXT.replace('There is no backup on our servers', 'There is a backup on our servers');
assert.notEqual(stale, POLICY_TEXT, 'fixture assumption stale: the policy no longer says what this edit targets');
result = await checkPrivacyUrl({ fetchImpl: stub(respond({ body: pageWith(stale) })) });
assert.equal(result.code, EXIT.FAILURE, 'a page serving an older policy is a FAILURE');
assert.match(result.errors.join(' '), /diverges after \d+ characters/, 'and says WHERE it diverges');

result = await checkPrivacyUrl({ fetchImpl: stub(respond({ body: pageWith('an unrelated page') })) });
assert.equal(result.code, EXIT.FAILURE, 'a wrong page is a FAILURE');
assert.match(result.errors.join(' '), /does not contain the policy text at all/, 'reported as wholly absent');

// --- 4. Could not tell. Never folded into either verdict. ------------------

for (const status of [403, 429, 500, 503]) {
    result = await checkPrivacyUrl({ fetchImpl: stub(respond({ status })) });
    assert.equal(result.code, EXIT.INCONCLUSIVE, `HTTP ${status} is INCONCLUSIVE`);
    assert.match(result.errors.join(' '), /NOT an all-clear/, `HTTP ${status} says so out loud`);
}

result = await checkPrivacyUrl({
    fetchImpl: async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; },
});
assert.equal(result.code, EXIT.INCONCLUSIVE, 'a timeout is INCONCLUSIVE');

result = await checkPrivacyUrl({ fetchImpl: async () => { throw new Error('getaddrinfo ENOTFOUND'); } });
assert.equal(result.code, EXIT.INCONCLUSIVE, 'a network error is INCONCLUSIVE');
assert.match(result.errors.join(' '), /network error/, 'and names it as one');

// --- 5. A redirect is reported, not followed. -----------------------------

result = await checkPrivacyUrl({
    fetchImpl: stub(respond({ status: 301, location: 'https://xchain.io/wallet/privacy/' })),
});
assert.equal(result.code, EXIT.FAILURE, 'a redirect hop fails rather than passing quietly');
assert.match(result.errors.join(' '), /https:\/\/xchain\.io\/wallet\/privacy\//, 'and names the destination to paste instead');

// --- 6. Config errors check nothing, and say nothing else. ----------------

result = await checkPrivacyUrl({ sourcePath: join(root, 'no', 'such', 'policy.md'), fetchImpl: stub(respond({})) });
assert.equal(result.code, EXIT.CONFIG, 'an unreadable source policy is a CONFIG error');
assert.match(result.errors.join(' '), /nothing was checked/, 'and admits that nothing was checked');

result = await checkPrivacyUrl({ url: 'http://xchain.io/wallet/privacy/', fetchImpl: stub(respond({})) });
assert.equal(result.code, EXIT.CONFIG, 'a non-https policy URL is a CONFIG error');

result = await checkPrivacyUrl({ url: 'not a url', fetchImpl: stub(respond({})) });
assert.equal(result.code, EXIT.CONFIG, 'an unusable URL is a CONFIG error');

// The default is the decided D5 URL, not whatever was convenient.
assert.equal(DEFAULT_URL, 'https://xchain.io/wallet/privacy/',
    'the default URL is D5 (trailing slash: the canonical form, so no redirect hop under review)');

// --- 6b. Operator-supplied bytes (--html) ---------------------------------
//
// Cloudflare 403s any script host on this domain, so without this path the
// fetch verdict is permanently exit 3 and the check can never go green on
// its own. It answers a NARROWER question than the fetch does, and the
// report has to say so rather than let a content pass read as liveness.

const suppliedPage = join(root, 'test', 'smoke', 'audits', '.privacy-supplied.tmp.html');
writeFileSync(suppliedPage, pageWith(POLICY_TEXT));
try {
    result = await checkPrivacyUrl({
        htmlPath: suppliedPage,
        fetchImpl: () => { throw new Error('--html must not fetch'); },
    });
    assert.equal(result.code, EXIT.LIVE, 'supplied bytes carrying the policy pass');
    assert.match(result.lines.join(' '), /Not a liveness check/,
        'and the report refuses to be read as proof the URL resolves');

    writeFileSync(suppliedPage, pageWith(POLICY_TEXT.replace('There is no backup on our servers', 'There is a backup')));
    result = await checkPrivacyUrl({ htmlPath: suppliedPage, fetchImpl: stub(respond({})) });
    assert.equal(result.code, EXIT.FAILURE, 'supplied bytes that are a stale policy still fail');
} finally {
    rmSync(suppliedPage, { force: true });
}

result = await checkPrivacyUrl({ htmlPath: join(root, 'no', 'such', 'page.html'), fetchImpl: stub(respond({})) });
assert.equal(result.code, EXIT.CONFIG, 'an unreadable supplied page is a CONFIG error, not a failure');

// --- 7. The folding rules, individually. ----------------------------------

// Built from code points so the smart punctuation itself stays out of the file.
const SMART_SAMPLE = `a${String.fromCharCode(0x2019)}b ${String.fromCharCode(0x201c)}c${String.fromCharCode(0x201d)}` + ` ${String.fromCharCode(0x2014)} d${String.fromCharCode(0x2026)}`;
assert.equal(normalizeText(SMART_SAMPLE), `a'b "c" - d...`,
    'smart quotes, dashes and ellipsis fold to their ASCII forms');
assert.equal(normalizeText('&amp;&nbsp;&quot;x&quot;'), '& "x"', 'entities are decoded');
assert.equal(pageTextFromHtml('<p>to <code>chrome.storage.local</code>, which</p>'), 'to chrome.storage.local, which',
    'an inline tag does not leave a space before the punctuation that follows it');
assert.equal(policyTextFromMarkdown('# T\n\nMatches `https://*/*` and `http://localhost/*`.\n'),
    'Matches https://*/* and http://localhost/*.',
    'a match pattern inside a code span keeps its asterisks');
assert.equal(policyTextFromMarkdown('# T\n\nEmail <privacy@dankest.llc> or **see** [docs](https://x.test).\n'),
    'Email privacy@dankest.llc or see docs.',
    'autolinks (including bare email), emphasis and links reduce to their text');
assert.equal(policyTextFromMarkdown('<!-- D1 PENDING: internal -->\n# T\n\nBody.\n'), 'Body.',
    'internal comments and the leading title never reach the comparison');
assert.equal(pageCarriesPolicy('x', '').ok, false, 'an empty policy is never silently "carried"');

// --- 8. Offline end to end: the checked-in hosted page. -------------------

if (existsSync(HOSTED_PAGE)) {
    const verdict = pageCarriesPolicy(pageTextFromHtml(readFileSync(HOSTED_PAGE, 'utf8')), POLICY_TEXT);
    assert.equal(verdict.ok, true,
        'the checked-in xchain-websites privacy page does not carry the current policy '
        + `(rebuild it there): ${verdict.ok ? '' : verdict.reason}`);
} else {
    console.log('  (xchain-websites not checked out beside this repo; skipped the hosted-page comparison)');
}

console.log('privacy-url-check.smoke.js OK');
