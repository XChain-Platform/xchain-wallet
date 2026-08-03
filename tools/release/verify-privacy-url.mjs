// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// tools/release/verify-privacy-url.mjs - proves the public privacy-policy
// URL is live and serving the CURRENT in-repo policy ( §5 / D5).
//
// WHY THIS EXISTS, AND WHAT IT WOULD HAVE CAUGHT. Every store submission
// is hard-blocked on a privacy-policy URL, and the Chrome Web Store form
// validates that the URL resolves before it will accept the upload. The
// repo already protects the CONTENT of that page: stage S6 generates
// xchain.io/wallet/privacy/index.html from the canonical policy in the
// sibling xchain-documentation repo
// (components/wallet/privacy/privacy-policy.md), and a sync test in xchain-websites
// fails the moment the two disagree. Nothing protected the URL itself.
//
// It was written because that URL was a 404. Measured in a browser on
// 2026-08-01: the page was built, correct and deployed, but only at
// https://newsite.xchain.io/wallet/privacy/, because the apex still served
// an old placeholder docroot. Every in-repo check was green through it, so
// a submission would have failed at the store form with nothing in the
// repo to explain why. A generated page nobody can reach is not a
// published policy.
//
// RESOLVED THE SAME DAY: the operator flipped the apex  and the
// URL now serves the current policy, confirmed two ways, since one was not
// enough: through the edge in a real browser, and against the origin
// directly (`curl --resolve xchain.io:443:<origin-ip>`) fed back in with
// --html. Both agreed. The script stays because the failure it caught is
// recurring, not one-off: every deploy, every policy edit, and every
// future shell's submission asks the same question again.
//
// TWO KINDS OF "NOT OK", KEPT APART ON PURPOSE. This follows the same rule
// as tools/release/store-version-monitor.mjs: a check that cannot tell must
// say so loudly rather than fold into a pass OR into a failure.
//
//   - "The URL does not serve the policy" (404, or a 200 whose text is not
//     the current policy) is a FAILURE. It blocks submission and the fix is
//     a deploy.
//   - "I could not determine anything" (403/429/5xx, a timeout, a network
//     error) is INCONCLUSIVE. Note that this is not hypothetical on this
//     exact domain: Cloudflare fronts xchain.io and answers plain `curl`
//     with 403 for every path, live page or not, so a naive checker reading
//     403 as "missing" would report a false outage, and one reading any
//     non-200 as "cannot tell" would have missed the real 404 above.
//
// WHAT "SERVING THE CURRENT POLICY" MEANS HERE. The hosted page is rendered
// Markdown wrapped in site chrome, so this compares TEXT, not bytes: the
// policy's own text, stripped of Markdown, must appear verbatim inside the
// page's text, stripped of HTML. Both sides are normalized first for the
// things a Markdown renderer legitimately changes (curly quotes, dashes,
// ellipses, entities, whitespace, hard line breaks). It deliberately does
// not re-implement the renderer: that transform lives in the websites repo,
// and a second copy of it here would be one more thing to drift.
//
// CONFIGURATION
//
//   --url <url>       or PRIVACY_POLICY_URL   defaults to the D5 URL below
//   --source <path>   or PRIVACY_POLICY_PATH  defaults to the sibling
//                                             xchain-documentation checkout,
//                                             components/wallet/privacy/
//                                             privacy-policy.md
//   --timeout <ms>                            defaults to 15000
//   --html <path>                             check bytes you supply instead
//                                             of fetching (see below)
//
// THE --html ESCAPE HATCH, AND WHAT IT DOES NOT PROVE. This header used to
// say Cloudflare 403s this host on every path, so the fetch verdict was
// permanently exit 3 and the check could never go green on its own. That
// STOPPED BEING TRUE when turned Super Bot Fight Mode off, and it
// was measured on 2026-08-02 rather than assumed: a plain `curl` with no
// User-Agent, and this script's own fetch, both get 200 from the release
// operator's machine, and the live run exits 0. The correction matters more
// than a stale sentence usually does, because the instruction it carried was
// "expect exit 3 and do not read it as failure", which pre-arms an operator
// to shrug at the inconclusive verdict at the exact moment a real 404 would
// be producing one. Prefer the plain live run; reach for --html when a host
// you are on IS blocked (the edge block can come back, which is why 403
// still lands in inconclusive rather than in failure).
//
// Rather than weaken the fetch into something that guesses, this takes real
// output the same way verify-store.sh takes an operator's real store unpack:
//
//   curl -sS -o /tmp/policy.html --resolve xchain.io:443:<origin-ip> \
//        https://xchain.io/wallet/privacy/
//   node tools/release/verify-privacy-url.mjs --html /tmp/policy.html
//
// That proves the BYTES are the current policy. It proves nothing about
// whether the URL resolves, and going to the origin deliberately bypasses
// the edge, so a stale Cloudflare cache would not show up. Confirm the URL
// itself in a browser; the submission runbook's Phase 3 asks for both.
//
// EXIT CODES
//
//   0  LIVE     - 200, no redirect hop, and the page carries the current policy
//   1  FAILURE  - the URL does not resolve (404/410), or resolves to a page
//                 that is not the current policy, or redirects (see below)
//   2  CONFIG   - the source policy could not be read, or the URL is unusable;
//                 nothing was checked this run
//   3  INCONCLUSIVE - could not determine anything (403/429/5xx, timeout,
//                 network error). NOT an all-clear and never reported as one.
//   4  CONTACT_GATED - live and carrying the current policy, but at least one
//                 contact address the policy publishes is not readable
//                 without JavaScript. SUBMITTABLE: the store validates that
//                 the URL resolves and serves the policy, and it does.
//
// Why 4 is its own code rather than a warning printed inside 0. The edge can
// obfuscate the policy's mailto addresses (see decodeCloudflareEmails below),
// and this script DECODES that, silently, so it does not cry outage over a
// transformation the deployed bytes are innocent of. The cost of decoding
// silently is that the property then goes unmeasured: turn Email Address
// Obfuscation back on at the dashboard and the GDPR/DSA contact on a legal
// document is JavaScript-gated again, with every check in this repo still
// green. A line printed inside an exit 0 is a line that gets scrolled past;
// this spec has already found that prose warning people to stay consistent
// does not keep them consistent (S14). A disjoint code is the same shape S5
// and S10 already use here, and for the same reason: silence must never be
// indistinguishable from an all-clear.
//
// A redirect is a FAILURE rather than a pass, because the fix is free and
// the cost is not: the store form should be given the URL that answers
// directly. The message names the final URL so the operator can paste that
// instead. (The site's canonical form carries a trailing slash,
// /wallet/privacy/, which is what the D5 default below uses.)
//
// STDOUT carries the full report every run. STDERR carries content only on
// exit 1, 2, 3 and 4, so this can be run from cron the same way the
// store-version monitor is.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));  // tools/release

// D5, decided 2026-07-31. Trailing slash is the canonical form; see header.
export const DEFAULT_URL = 'https://xchain.io/wallet/privacy/';
//  moved the wallet's prose docs into the sibling
// xchain-documentation repo, which is checked out beside this one. Resolved
// from this script's own location rather than cwd, so it holds wherever the
// script is invoked from. Override with --source / PRIVACY_POLICY_PATH when
// the sibling lives elsewhere.
export const DEFAULT_SOURCE_PATH = join(
    here, '..', '..', '..', 'xchain-documentation',
    'components', 'wallet', 'privacy', 'privacy-policy.md',
);
export const DEFAULT_TIMEOUT_MS = 15000;

export const EXIT = { LIVE: 0, FAILURE: 1, CONFIG: 2, INCONCLUSIVE: 3, CONTACT_GATED: 4 };

// Status codes that mean "definitely not there" as opposed to "I was not
// allowed to look". Everything else non-200 lands in inconclusive.
const DEFINITELY_MISSING = new Set([404, 410]);

// Shortest prefix worth calling a partial match; below this the "match" is
// coincidence in the page chrome. Roughly one sentence opening.
const MEANINGFUL_PREFIX = 40;

const ENTITIES = {
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
    '&apos;': "'", '&nbsp;': ' ', '&mdash;': '-', '&ndash;': '-', '&hellip;': '...',
};

/**
 * Fold away everything a Markdown renderer is allowed to change without the
 * policy meaning anything different: smart quotes, dash forms, ellipsis,
 * HTML entities, and all whitespace runs (hard line breaks become <br>).
 * Written with escapes rather than literal punctuation so the characters
 * themselves stay out of this file.
 */
// Built from code points, so no smart-punctuation character appears
// literally anywhere in this file. `\s` already covers the non-breaking
// space, so the whitespace collapse below handles that case on its own.
const SMART_PUNCTUATION = [
    [[0x2018, 0x2019, 0x201a, 0x201b], "'"],
    [[0x201c, 0x201d, 0x201e, 0x201f], '"'],
    [[0x2013, 0x2014, 0x2015], '-'],
    [[0x2026], '...'],
].map(([codePoints, replacement]) => [
    new RegExp(`[${String.fromCharCode(...codePoints)}]`, 'g'),
    replacement,
]);

export function normalizeText(input) {
    let out = String(input).replace(/&[a-z#0-9]+;/gi, (e) => (e in ENTITIES ? ENTITIES[e] : e));
    for (const [pattern, replacement] of SMART_PUNCTUATION) out = out.replace(pattern, replacement);
    out = out.replace(/\s+/g, ' ');
    // Replacing an inline tag (<code>, <strong>, <a>) with a space leaves one
    // where the source has none: `chrome.storage.local`, renders as
    // 'chrome.storage.local ,' once tags become spaces. Fold that on BOTH
    // sides, so the comparison stays symmetric instead of papering over one
    // side of it.
    return out.replace(/\s+([,.;:!?)\]])/g, '$1').replace(/([(\[])\s+/g, '$1').trim();
}

/**
 * The policy's prose, with Markdown syntax removed: HTML comments (the SPDX
 * header and the D1-pending editorial note, neither of which is published),
 * the leading H1 (the page renders its own), heading markers, emphasis, code
 * ticks, list bullets, and link/autolink syntax reduced to their text.
 */
export function policyTextFromMarkdown(markdown) {
    const withoutComments = String(markdown).replace(/<!--[\s\S]*?-->/g, ' ');
    const lines = withoutComments.split('\n');
    const firstHeading = lines.findIndex((l) => /^#\s+/.test(l));
    if (firstHeading !== -1) lines.splice(firstHeading, 1);

    // Code spans are lifted out BEFORE emphasis markers are stripped. The
    // policy names the content-script match patterns inline (`https://*/*`),
    // and a blanket strip of `*` would quietly rewrite the one line a store
    // reviewer cross-checks against the manifest.
    const codeSpans = [];
    const body = lines.join('\n')
        .replace(/`([^`]+)`/g, (_, code) => {
            codeSpans.push(code);
            return `\u0000${codeSpans.length - 1}\u0000`;
        })
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')        // [text](url) -> text
        .replace(/<((?:https?|mailto):[^>]+|[^\s<>@]+@[^\s<>]+)>/g, '$1')  // <autolink>, incl. bare email
        .replace(/^#{1,6}\s+/gm, '')
        // Horizontal rules render as <hr>, which contributes no text at all.
        .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, '')
        .replace(/^\s*[-*+]\s+/gm, '')
        .replace(/[*_]/g, '')
        .replace(/\u0000(\d+)\u0000/g, (_, i) => codeSpans[Number(i)]);
    return normalizeText(body);
}

/**
 * Undo Cloudflare's Email Address Obfuscation.
 *
 * The edge rewrites every mailto in the served HTML into
 * `<a href="/cdn-cgi/l/email-protection#<hex>"><span class="__cf_email__"
 * data-cfemail="<hex>">[email&#160;protected]</span></a>`, and a bundled
 * script decodes it in the browser. The hex is the address XORed byte by
 * byte with its own first byte.
 *
 * Without this, the check reports the hosted policy as DIVERGING at the
 * contact line on every run, while the deployed bytes are correct. That is a
 * false alarm on the one check whose whole design goal is to never cry
 * outage:  S10 built four separate fixes for exactly this class of
 * bug in its Markdown-side comparison, and this is the same bug arriving
 * from the edge instead. A check that is red when nothing is wrong gets
 * waived, and a waived check is the one that misses the real 404.
 *
 * Found 2026-08-02 by running the tool against the live page after the
 * apex flip, which is the only way this was ever going to surface: the
 * generated page in the websites repo carries a plain `mailto:` and is
 * correct, so nothing in either repo could see it.
 */
export function decodeCloudflareEmails(html) {
    const decode = (hex) => {
        if (!/^[0-9a-f]{4,}$/i.test(hex) || hex.length % 2) return null;
        const key = parseInt(hex.slice(0, 2), 16);
        let out = '';
        for (let i = 2; i < hex.length; i += 2) {
            out += String.fromCharCode(parseInt(hex.substr(i, 2), 16) ^ key);
        }
        // Only accept something that actually looks like an address, so a
        // malformed payload degrades to the original text rather than to
        // plausible-looking garbage inside a legal document.
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out) ? out : null;
    };

    return String(html)
        // The visible span, which is what the text comparison actually reads.
        .replace(/<span[^>]*class="[^"]*__cf_email__[^"]*"[^>]*data-cfemail="([0-9a-f]+)"[^>]*>[\s\S]*?<\/span>/gi,
            (whole, hex) => decode(hex) ?? whole)
        // The href form, for pages where the address is the link target only.
        .replace(/\/cdn-cgi\/l\/email-protection#([0-9a-f]+)/gi,
            (whole, hex) => { const a = decode(hex); return a ? `mailto:${a}` : whole; });
}

/** Tags, scripts, styles and comments out; entities folded. No CF decoding. */
function visibleText(html) {
    return normalizeText(String(html)
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<[^>]+>/g, ' '));
}

/** The page's visible text: scripts, styles and tags out, entities folded. */
export function pageTextFromHtml(html) {
    return visibleText(decodeCloudflareEmails(html));
}

/**
 * What a reader WITHOUT JavaScript sees. Same strip as above, minus the
 * Cloudflare decode, because the decode is precisely the thing a browser's
 * bundled script does and a curl, a regulator's fetch, or a reviewer with
 * scripting off does not.
 */
export function pageTextWithoutScripts(html) {
    return visibleText(html);
}

/**
 * The contact addresses the policy itself publishes. Derived from the policy
 * text rather than hardcoded, so this cannot go stale the way a second copy
 * of `privacy@dankest.llc` would: whatever the policy publishes is what the
 * page has to show. Taking them from the already-normalized policy text (not
 * the raw Markdown) also keeps anything in an HTML comment or an SPDX header
 * out of the set, since the same text is what the page must carry anyway.
 */
export function contactAddressesFrom(policyText) {
    return [...new Set(String(policyText).match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [])];
}

/**
 * Which of those addresses a non-JS reader cannot see. Compared against the
 * page's visible TEXT rather than against the raw HTML on purpose: an address
 * split across an anchor's href and its label, or carrying an entity, is
 * still readable, and a check that fires on a correctly published address is
 * one people delete.
 */
export function gatedContacts(html, addresses) {
    const readable = pageTextWithoutScripts(html);
    return addresses.filter((address) => !readable.includes(address));
}

/**
 * Does the page carry the policy? Returns the divergence point when it does
 * not, because "the hosted policy is stale" is useless without "stale where".
 *
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function pageCarriesPolicy(pageText, policyText) {
    if (!policyText) return { ok: false, reason: 'the source policy has no text to compare' };
    if (pageText.includes(policyText)) return { ok: true };

    // Longest prefix of the policy that IS present, so the report can point
    // at the first sentence that differs rather than at the whole document.
    let lo = 0;
    let hi = policyText.length;
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (pageText.includes(policyText.slice(0, mid))) lo = mid; else hi = mid - 1;
    }
    // A one- or two-character "match" is a letter that happens to appear in
    // the page chrome, not a policy that starts correctly and then diverges.
    // Reporting a divergence point there would send someone hunting for a
    // typo in a page that does not carry the policy at all.
    if (lo < MEANINGFUL_PREFIX) {
        return {
            ok: false,
            reason: 'the page does not contain the policy text at all (wrong page, or the policy is not rendered here)',
        };
    }
    const at = policyText.slice(Math.max(0, lo - 60), lo);
    const expected = policyText.slice(lo, lo + 90);
    return {
        ok: false,
        reason: `the hosted copy diverges after ${lo} characters.\n`
                + `    ...ending: ${JSON.stringify(at)}\n`
                + `    expected next: ${JSON.stringify(expected)}`,
    };
}

/**
 * Fetch the URL without following redirects, so a hop is reported rather
 * than silently passed. Injectable `fetchImpl` so tests never hit the
 * network.
 *
 * @returns {Promise<{kind:'ok',html:string} | {kind:'redirect',location:string,status:number}
 *   | {kind:'missing',status:number} | {kind:'inconclusive',reason:string}>}
 */
export async function fetchPolicyPage(url, { fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetchImpl(url, {
            redirect: 'manual',
            signal: controller.signal,
            headers: {
                // A real browser UA: the origin sits behind Cloudflare, which
                // answers obvious tooling with a 403 that says nothing about
                // whether the page exists.
                'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
                    + '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'accept': 'text/html,application/xhtml+xml',
                'accept-language': 'en-US,en;q=0.9',
            },
        });
        const status = response.status;
        if (status >= 300 && status < 400) {
            const location = (response.headers && response.headers.get && response.headers.get('location')) || '(no Location header)';
            return { kind: 'redirect', location, status };
        }
        if (DEFINITELY_MISSING.has(status)) return { kind: 'missing', status };
        if (status !== 200) {
            return {
                kind: 'inconclusive',
                reason: `HTTP ${status}. This says nothing about whether the page exists: `
                    + 'the origin is fronted by Cloudflare, which answers non-browser clients with 403 '
                    + 'for every path. Load the URL in a real browser before concluding anything.',
            };
        }
        return { kind: 'ok', html: await response.text() };
    } catch (err) {
        const aborted = err && (err.name === 'AbortError' || err.name === 'TimeoutError');
        return {
            kind: 'inconclusive',
            reason: aborted
                ? `request timed out after ${timeoutMs}ms`
                : `network error: ${err && err.message ? err.message : String(err)}`,
        };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * The whole check, as data. Returns `{code, lines, errors}` so the smoke can
 * drive every outcome without capturing process state.
 */
export async function checkPrivacyUrl({
    url = DEFAULT_URL, sourcePath = DEFAULT_SOURCE_PATH, htmlPath, fetchImpl, timeoutMs,
} = {}) {
    const lines = [];
    const errors = [];
    const fail = (code, ...msgs) => {
        errors.push(...msgs);
        return { code, lines, errors };
    };

    let policyText;
    try {
        policyText = policyTextFromMarkdown(readFileSync(sourcePath, 'utf8'));
    } catch (err) {
        return fail(EXIT.CONFIG, `cannot read the source policy at ${sourcePath}: ${err.message}`,
            'The policy now lives in the sibling xchain-documentation checkout',
            '(components/wallet/privacy/privacy-policy.md). Clone it beside this repo,',
            'or point --source / PRIVACY_POLICY_PATH at your copy.',
            'nothing was checked this run.');
    }
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:') {
            return fail(EXIT.CONFIG, `the policy URL must be https, got ${JSON.stringify(url)}`);
        }
    } catch {
        return fail(EXIT.CONFIG, `unusable policy URL: ${JSON.stringify(url)}`);
    }

    lines.push(`url:    ${url}`);
    lines.push(`source: ${sourcePath}`);

    // Operator-supplied bytes. Same escape hatch, and the same reasoning, as
    // verify-store.sh's --unpacked-dir: when the check cannot fetch the real
    // thing itself, it takes real output rather than inventing a weaker test.
    // Here the blocker is Cloudflare, which 403s this host on every path, so
    // without this the verdict from any script host is permanently exit 3.
    // What it proves is narrower and the report says so: these bytes carry
    // the current policy. Whether the edge serves them is what a browser (or
    // a fetch through the edge) tells you, and Phase 3 of the submission
    // runbook asks for both.
    if (htmlPath) {
        let html;
        try {
            html = readFileSync(htmlPath, 'utf8');
        } catch (err) {
            return fail(EXIT.CONFIG, `cannot read the supplied page at ${htmlPath}: ${err.message}`,
                'nothing was checked this run.');
        }
        lines.push(`page:   ${htmlPath} (supplied; the fetch was skipped)`);
        const supplied = pageCarriesPolicy(pageTextFromHtml(html), policyText);
        if (!supplied.ok) {
            return fail(EXIT.FAILURE,
                `the supplied page is not the current policy: ${supplied.reason}`,
                'Rebuild and redeploy the hosted page from the canonical policy in',
                'xchain-documentation (components/wallet/privacy/privacy-policy.md).');
        }
        lines.push('CARRIES THE CURRENT POLICY. Not a liveness check: these bytes were handed to');
        lines.push('this script, not fetched from the URL. Confirm the URL itself resolves separately.');
        // Deliberately no contact-readability verdict here. These bytes come
        // either from the origin (--resolve, bypassing the edge, so no
        // obfuscation could have been applied) or from a browser save (after
        // the bundled script already decoded it). Both would report "readable"
        // no matter what the edge is doing, so answering at all would be a
        // confident wrong answer about a legal document's contact address.
        lines.push('contact: not judged on supplied bytes; edge obfuscation is only visible to a live fetch.');
        return { code: EXIT.LIVE, lines, errors };
    }

    const fetched = await fetchPolicyPage(url, { fetchImpl, timeoutMs });
    if (fetched.kind === 'redirect') {
        return fail(EXIT.FAILURE,
            `${url} redirects (HTTP ${fetched.status}) to ${fetched.location}.`,
            'Give the store form the URL that answers directly, or fix the deploy so this one does.');
    }
    if (fetched.kind === 'missing') {
        return fail(EXIT.FAILURE,
            `${url} returns HTTP ${fetched.status}: the policy is NOT published at this address.`,
            'Every store submission is hard-blocked on this URL resolving, and the Chrome Web Store',
            'form validates it before accepting an upload. This needs a deploy, not a doc change.');
    }
    if (fetched.kind === 'inconclusive') {
        return fail(EXIT.INCONCLUSIVE,
            `could not determine whether ${url} serves the policy: ${fetched.reason}`,
            'This is NOT an all-clear.');
    }

    const carries = pageCarriesPolicy(pageTextFromHtml(fetched.html), policyText);
    if (!carries.ok) {
        return fail(EXIT.FAILURE,
            `${url} resolves, but it is not serving the current policy: ${carries.reason}`,
            'Rebuild and redeploy the hosted page from the canonical policy in',
            'xchain-documentation (components/wallet/privacy/privacy-policy.md).');
    }

    lines.push('LIVE: the URL resolves directly and carries the current policy verbatim.');

    const contacts = contactAddressesFrom(policyText);
    const gated = gatedContacts(fetched.html, contacts);
    if (gated.length) {
        errors.push(
            `${url} is live and current, but ${gated.join(', ')} `
            + `${gated.length === 1 ? 'is' : 'are'} not readable without JavaScript.`,
            'The edge is rewriting the policy\'s mailto links (Cloudflare Email Address Obfuscation),',
            'so a reviewer, a regulator, or any non-JS fetch of this legal document sees',
            '"[email protected]" where the GDPR/DSA contact belongs. The deployed bytes are correct.',
            'NOT a submission blocker: the store validates that the URL resolves and serves the',
            'policy, and it does. Two ways out: turn Email Address Obfuscation off for',
            '/wallet/privacy/* in the Cloudflare dashboard, or additionally publish the address as',
            'plain text, which the obfuscator does not rewrite (it targets mailto links).');
        return { code: EXIT.CONTACT_GATED, lines, errors };
    }
    lines.push(contacts.length
        ? `contact: ${contacts.join(', ')} readable without JavaScript.`
        : 'contact: the policy publishes no email address to check.');
    return { code: EXIT.LIVE, lines, errors };
}

function parseArgs(argv) {
    const out = {
        url: process.env.PRIVACY_POLICY_URL || DEFAULT_URL,
        sourcePath: process.env.PRIVACY_POLICY_PATH || DEFAULT_SOURCE_PATH,
        timeoutMs: DEFAULT_TIMEOUT_MS,
    };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--url') out.url = argv[++i];
        else if (arg === '--source') out.sourcePath = argv[++i];
        else if (arg === '--html') out.htmlPath = argv[++i];
        else if (arg === '--timeout') out.timeoutMs = Number(argv[++i]);
        else if (arg === '--help' || arg === '-h') out.help = true;
        else out.unknown = arg;
    }
    return out;
}

const USAGE = `verify-privacy-url.mjs - is the public privacy-policy URL live and current?

  node tools/release/verify-privacy-url.mjs [--url <url>] [--source <path>] [--timeout <ms>]
  node tools/release/verify-privacy-url.mjs --html <saved-page.html>

The second form skips the fetch and checks bytes you supply, for when
Cloudflare blocks the host you are on. It no longer blocks by default: turned Super Bot Fight Mode off, measured 2026-08-02, so prefer
the plain live run. Get supplied bytes from the origin, bypassing the edge:

  curl -sS -o /tmp/policy.html --resolve xchain.io:443:<origin-ip> \
       https://xchain.io/wallet/privacy/

or save the page from a browser. It proves the bytes are the current
policy, not that the URL is reachable; check that separately.

Defaults to ${DEFAULT_URL} ( D5) and the sibling xchain-documentation
checkout's components/wallet/privacy/privacy-policy.md, the one policy
covering every wallet shell. Without that checkout the run exits 2 (config
error); --source / PRIVACY_POLICY_PATH points it elsewhere.

Exit codes: 0 live, 1 not live / not current / redirects, 2 config error,
3 inconclusive (403, timeout, network - NOT an all-clear), 4 live and
current but a contact address is JavaScript-gated at the edge (submittable;
fix the edge setting).

Run it before any store submission, and after any deploy that touches the
websites repo. See tools/release/README.md.`;

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        process.stdout.write(`${USAGE}\n`);
        return EXIT.LIVE;
    }
    if (args.unknown) {
        process.stderr.write(`unknown argument: ${args.unknown}\n${USAGE}\n`);
        return EXIT.CONFIG;
    }
    const { code, lines, errors } = await checkPrivacyUrl(args);
    if (lines.length) process.stdout.write(`${lines.join('\n')}\n`);
    if (errors.length) process.stderr.write(`${errors.join('\n')}\n`);
    return code;
}

if (process.argv[1] && process.argv[1].endsWith('verify-privacy-url.mjs')) {
    process.exitCode = await main();
}
