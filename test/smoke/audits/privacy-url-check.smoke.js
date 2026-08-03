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
//    people stop looking once a check exists. The 403 case was not
//    hypothetical: Cloudflare fronted xchain.io and answered plain tooling
//    with 403 on every path, live page or not. turned that off
//    and a plain live run now exits 0 (measured 2026-08-02), but the
//    inconclusive-on-403 treatment stays, because the block can come back
//    and this check must not report a false outage when it does.
//
// 3. A contact address the policy publishes is readable WITHOUT
//    JavaScript, reported as its own exit code rather than a printed
//    line. The edge can obfuscate mailto links and this script decodes
//    that silently, so without a distinct verdict the gated and ungated
//    pages are indistinguishable and the setting can flip back unnoticed
//    on a legal document's GDPR/DSA contact.
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
    pageCarriesPolicy, contactAddressesFrom, gatedContacts,
    EXIT, DEFAULT_URL, DEFAULT_SOURCE_PATH,
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
assert.match(result.lines.join(' '), /contact: privacy@dankest\.llc readable without JavaScript/,
    'a clean run SAYS the contact is readable without JS rather than staying silent about it: '
    + 'silence is what let this go unmeasured in the first place');

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

// --- 3b. The edge rewrites the contact address (found live 2026-08-02). -----
//
// Cloudflare's Email Address Obfuscation replaces every mailto in the served
// HTML with a `__cf_email__` span carrying the address XORed against its own
// first byte, decoded browser-side by a bundled script. The deployed bytes
// are correct and the generated page in xchain-websites carries a plain
// mailto, so neither repo could see this: it only exists at the edge, and it
// only showed up by running the tool against the live URL.
//
// Left undecoded it reported the hosted policy as DIVERGING at the contact
// line on every single run. That is a false alarm on the one check whose
// design goal is to never cry outage, and a check that is red when nothing is
// wrong gets waived. The waived check is the one that misses the real 404,
// which this tool exists because of.
const cfHex = (address) => {
    const key = 0x7a;
    return [key, ...[...address].map((c) => c.charCodeAt(0) ^ key)]
        .map((b) => b.toString(16).padStart(2, '0')).join('');
};

const cfObfuscate = (text, address) => {
    const hex = cfHex(address);
    return text.replace(address,
        `<a href="/cdn-cgi/l/email-protection#${hex}">`
        + `<span class="__cf_email__" data-cfemail="${hex}">[email&#160;protected]</span></a>`);
};

// The same transformation applied to REAL markup, where the address already
// sits inside a mailto anchor. The edge rewrites the whole anchor; replacing
// just the address string inside it (as the fixture helper above does, on
// plain text) nests one anchor inside another's href and tests a shape
// Cloudflare never emits.
const cfObfuscateAnchors = (html, address) => {
    const hex = cfHex(address);
    const span = `<span class="__cf_email__" data-cfemail="${hex}">[email&#160;protected]</span>`;
    const quoted = address.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return html
        .replace(new RegExp(`<a[^>]*href="mailto:${quoted}"[^>]*>[\\s\\S]*?</a>`, 'gi'),
            `<a href="/cdn-cgi/l/email-protection#${hex}">${span}</a>`)
        .split(address).join(span);
};

const CONTACT = 'privacy@dankest.llc';
assert.ok(POLICY_TEXT.includes(CONTACT),
    `fixture assumption stale: the policy no longer publishes ${CONTACT}, which is what the edge rewrites`);

const obfuscated = cfObfuscate(POLICY_TEXT, CONTACT);
assert.notEqual(obfuscated, POLICY_TEXT, 'the fixture actually obfuscated something');
assert.ok(!obfuscated.includes(CONTACT), 'and the plain address is genuinely gone from the served bytes');

result = await checkPrivacyUrl({ fetchImpl: stub(respond({ body: pageWith(obfuscated) })) });
assert.equal(result.code, EXIT.CONTACT_GATED,
    'an obfuscated contact is CONTACT_GATED: not stale (the deployed bytes are correct and the '
    + 'transformation is the edge\'s), but not a clean pass either');
assert.match(result.lines.join(' '), /LIVE: the URL resolves directly/,
    'and it still says the URL is live and current, because it is');
assert.match(result.errors.join(' '), /not readable without JavaScript/, 'the finding is stated plainly');
assert.match(result.errors.join(' '), new RegExp(CONTACT.replace('.', '\\.')),
    'and names WHICH address, since a policy may publish more than one');
assert.match(result.errors.join(' '), /NOT a submission blocker/,
    'and says so, because an operator hitting a non-zero code mid-ceremony must not read it as '
    + '"cannot submit": the store validates that the URL resolves and serves the policy, and it does');

// The whole reason this is a code and not a printed line: decoding is silent
// by design, so with only the text comparison the gated and ungated pages are
// indistinguishable. Prove they diverge here rather than trusting that they do.
const ungated = await checkPrivacyUrl({ fetchImpl: stub(respond({ body: pageWith(POLICY_TEXT) })) });
assert.notEqual(ungated.code, result.code,
    'the gated and ungated pages MUST reach different verdicts; if they ever agree, the check is '
    + 'decorative and the edge setting can flip back unnoticed');

// Derivation, not a second copy of the address. Whatever the policy publishes
// is what the page has to show, so a new contact address is covered the day it
// is added rather than the day someone remembers to update this file.
assert.deepEqual(contactAddressesFrom(POLICY_TEXT), [CONTACT],
    'the checked addresses come out of the policy itself');
assert.deepEqual(contactAddressesFrom('write to a@b.test or a@b.test, and c@d.test'), ['a@b.test', 'c@d.test'],
    'deduplicated, in the order the policy publishes them');
assert.deepEqual(gatedContacts(pageWith(POLICY_TEXT), [CONTACT]), [],
    'a plainly published address is not gated');
assert.deepEqual(gatedContacts(pageWith(obfuscated), [CONTACT]), [CONTACT], 'an obfuscated one is');

// A false positive here would be worse than the gap it closes: a check that
// fires on a correctly published address is one people delete. An address
// split across an anchor's href and its label, which is exactly how the
// generated page publishes it, must read as readable.
assert.deepEqual(gatedContacts(`<p>email <a href="mailto:${CONTACT}">${CONTACT}</a> today</p>`, [CONTACT]), [],
    'a normal mailto anchor is readable, not gated');
assert.deepEqual(gatedContacts(`<p>email <a href="mailto:${CONTACT}"><strong>${CONTACT}</strong></a></p>`, [CONTACT]), [],
    'nor does an inline tag inside the label gate it');

// Degrade safely: a malformed payload must leave the text alone rather than
// substitute plausible-looking garbage into a legal document.
const garbled = pageWith(POLICY_TEXT).replace('</body>',
    '<span class="__cf_email__" data-cfemail="zzzz">[email&#160;protected]</span></body>');
result = await checkPrivacyUrl({ fetchImpl: stub(respond({ body: garbled })) });
assert.equal(result.code, EXIT.LIVE, 'an undecodable obfuscation payload does not break an otherwise good page');

// And the decoding must not paper over a genuinely stale contact address: an
// obfuscated OLD address still has to read as divergence.
const staleContact = cfObfuscate(POLICY_TEXT.replace(CONTACT, 'legal@dankest.llc'), 'legal@dankest.llc');
result = await checkPrivacyUrl({ fetchImpl: stub(respond({ body: pageWith(staleContact) })) });
assert.equal(result.code, EXIT.FAILURE,
    'an obfuscated but WRONG contact address is still a failure; decoding must not become a blanket excuse');

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
// This path exists for a host the edge blocks. It is no longer the normal
// case: turned Super Bot Fight Mode off and a plain live run exits
// 0 from the operator's machine, measured 2026-08-02. It answers a NARROWER
// question than the fetch does, and the report has to say so rather than let
// a content pass read as liveness.

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
    assert.match(result.lines.join(' '), /contact: not judged on supplied bytes/,
        'and it declines to judge contact readability, rather than answering confidently');

    // The declining is load-bearing: supplied bytes come either from the
    // origin (--resolve bypasses the edge, so nothing could have obfuscated
    // them) or from a browser save (after the bundled script already decoded
    // them). Both would read "readable" whatever the edge is actually doing.
    writeFileSync(suppliedPage, pageWith(obfuscated));
    result = await checkPrivacyUrl({ htmlPath: suppliedPage, fetchImpl: stub(respond({})) });
    assert.equal(result.code, EXIT.LIVE,
        'obfuscated supplied bytes are NOT reported as gated: this path cannot see the edge, and a '
        + 'confident answer about a legal document\'s contact address is worse than no answer');

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
    const hosted = readFileSync(HOSTED_PAGE, 'utf8');
    const verdict = pageCarriesPolicy(pageTextFromHtml(hosted), POLICY_TEXT);
    assert.equal(verdict.ok, true,
        'the checked-in xchain-websites privacy page does not carry the current policy '
        + `(rebuild it there): ${verdict.ok ? '' : verdict.reason}`);

    // Both contact verdicts against the REAL generated page rather than only
    // against a fixture written beside the parser, which is the S13 lesson:
    // a fixture and the code that reads it always agree. The page publishes a
    // plain mailto, so served as-is it must pass; run it through the edge
    // transformation and it must not.
    result = await checkPrivacyUrl({ fetchImpl: stub(respond({ body: hosted })) });
    assert.equal(result.code, EXIT.LIVE,
        'the real generated page, served unmodified, is a clean pass: it carries a plain mailto');
    const hostedGated = cfObfuscateAnchors(hosted, CONTACT);
    assert.ok(!hostedGated.includes(CONTACT),
        'the fixture actually removed every plain occurrence from the real page');
    result = await checkPrivacyUrl({ fetchImpl: stub(respond({ body: hostedGated })) });
    assert.equal(result.code, EXIT.CONTACT_GATED,
        'and the same real page with the edge obfuscation applied is CONTACT_GATED, which is the '
        + 'state measured live on 2026-08-02 before the zone setting was turned off');
} else {
    console.log('  (xchain-websites not checked out beside this repo; skipped the hosted-page comparison)');
}

// ---------------------------------------------------------------------
// Every store listing doc names the SAME url, and it is this one.
//
// The docs below are what a human transcribes into a store form, one
// field at a time, with the console open. Verifying that the URL is live
// (everything above) says nothing about whether the URL anyone will
// actually type is that URL.
//
// This is not hypothetical. On 2026-08-02 `PLAY_LISTING.md` still named
// `https://dankest.llc/privacy.html` and explained that its DNS had not
// moved yet. The DNS had since moved: that page answered 200 and served
// the SUPERSEDED 1 August policy, the one claiming the first-party hosts
// keep "your IP address … for 14 days", against a repo whose data-safety
// answers come from the corrected measurement that says the opposite.
// Filling the Play form from that row would have put a reviewer in front
// of exactly the policy/form mismatch  §5 calls a rejection class,
// and it would have looked fine from inside the console. The App Store
// doc had been corrected the same day with this reasoning; the Play one
// was simply missed, which is what a cross-doc check is for.
//
// A dead wrong URL is the safe failure here. A LIVE wrong URL serving
// superseded text is the one nobody catches.
const LISTING_DOCS = [
    'packages/mobile/docs/PLAY_LISTING.md',
    'packages/mobile/docs/APP_STORE_LISTING.md',
    'packages/extension/docs/DATA_DISCLOSURE.md',
];
for (const rel of LISTING_DOCS) {
    const path = join(root, rel);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf8');
    // The row a human copies: the line that both names a privacy policy
    // and carries a URL. Prose elsewhere in the file may legitimately
    // discuss a rejected candidate, so this looks at the field, not the
    // document.
    const rows = text.split('\n').filter((l) => /privacy/i.test(l) && /https?:\/\//.test(l));
    const field = rows.find((l) => /^\|\s*Privacy policy/i.test(l.trim()));
    assert.ok(field, `${rel} has a "Privacy policy" field row naming a URL`);
    assert.ok(field.includes(DEFAULT_URL),
        `${rel}'s privacy-policy field must name ${DEFAULT_URL}, the URL this tool verifies `
        + `and the one every other store form publishes. Got: ${field.trim().slice(0, 160)}`);
    // Naming the right one is not enough while a wrong one is live and
    // plausible. A field may still DISCUSS the rejected dankest.llc
    // candidate, which these rows do and should, but the canonical URL
    // has to come first, because the first URL in the row is the one that
    // gets copied.
    const wrong = field.indexOf('dankest.llc/privacy');
    assert.ok(wrong === -1 || field.indexOf(DEFAULT_URL) < wrong,
        `${rel}'s privacy-policy field names a dankest.llc URL before the canonical one. `
        + 'That host answers 200 while serving the superseded 1 August policy (measured '
        + '2026-08-02), so getting this order wrong fails silently, in front of a reviewer');
}

console.log('privacy-url-check.smoke.js OK');
