// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// tools/release/store-version-monitor.mjs - Chrome Web Store publish
// monitor ( §2 "Publish monitoring (compromise detection)").
//
// THE ONE RULE THIS SCRIPT ENFORCES. For each configured item (main,
// and beta once it exists) it fetches the version the Chrome Web Store
// is currently SERVING to the public, and checks that version against
// `packages/extension/docs/publish-log.md` - the append-only record the
// release operator writes to at every upload. A live version with no
// matching row in that log is the rogue-publish incident signal: a
// build went out through the console without the logged, one-operator
// process, which is exactly what a compromised or phished publisher
// account produces.
//
// It deliberately does NOT compare against "the latest release tag".
// The store lawfully lags the tag during review and can sit behind it
// for a while after a rejection; a tag-based check would false-alarm on
// every normal release and train everyone to ignore the one alert that
// matters. The publish log is the only baseline this script trusts,
// same as the spec is emphatic about.
//
// HOW IT GETS THE LIVE VERSION, AND WHAT BREAKS IT. It fetches the
// item's public listing page (`https://chromewebstore.google.com/
// detail/<itemId>?hl=en`, which serves unlisted items too - "unlisted"
// means unindexed, not access-controlled, so the store-required install
// tests already exercise the same URL shape) and looks for the
// "Details" panel's Version row: a label `<div>` containing the text
// "Version" immediately followed by a sibling `<div>` holding the
// version string, e.g. `>Version</div><div class="nBZElf">1.72.2</div>`.
// The match is on STRUCTURE and the label TEXT, not on the `nBZElf`
// class name - that class is one of Google's build-hashed, opaque CSS
// identifiers and will rotate on any store frontend rebuild, but the
// label text and the label→value structural shape are what a human
// reads on the page and are far less likely to change without the page
// meaning something different. This was verified 2026-08-01 against a
// REAL live Chrome Web Store listing (uBlock Origin,
// cjpalhdlnbpafiamejdnhcphjbkeiagm), which is the only grounding
// available before this extension's own item exists.
//
// This is still fragile, on purpose acknowledged rather than hidden: a
// store redesign, an A/B test, a locale that renders something other
// than "Version" despite `?hl=en`, an interstitial/CAPTCHA/rate-limit
// page, or any non-200 response all make the pattern fail to match (or
// fail to look like a version once matched). Every one of those is
// reported as INCONCLUSIVE - "I cannot tell" - and is never, under any
// circumstance, folded into a clean/OK result. A monitor that reports
// "no problem" when it actually couldn't check is worse than no monitor
// (see the exit-code table below). This is a lighter-weight scrape than
// `tools/release/verify-store.sh` deliberately refuses to do: that
// script needs the exact BYTES of the published item and there is no
// safe way to get those without an undocumented download endpoint, so
// it makes the operator supply real store output instead. This script
// only needs the version STRING already rendered on the item's own
// public listing page for anyone with the link, which is a much
// narrower and more stable surface, and still gets treated with the
// same "loud can't-tell, never a silent pass" honesty.
//
// CONFIGURATION. Item IDs are not known yet - nothing has been
// uploaded - so they come from environment or CLI flags, never
// hard-coded:
//
//   CWS_MAIN_ITEM_ID   env, or --main-id <id>   REQUIRED
//   CWS_BETA_ITEM_ID   env, or --beta-id <id>   optional (checked only
//                                                once set; unset is a
//                                                normal pre-launch or
//                                                pre-D3 state, not an
//                                                error)
//   PUBLISH_LOG_PATH   env, or --log <path>     optional; defaults to
//                                                packages/extension/docs/publish-log.md
//                                                in this checkout
//
// If CWS_MAIN_ITEM_ID is unset, the script refuses to run rather than
// silently reporting clean: an inert monitor that says nothing is far
// more dangerous than one that is visibly broken, because the operator
// stops checking once "a monitor exists".
//
// EXIT CODES (what cron reads; install notes are in the CLI usage text
// below and in tools/release/README.md "Installing the store-version
// monitor on origin-host"):
//
//   0   clean - every configured item's live version has a matching
//       row in the publish log
//   1   ALERT - the rogue-publish incident signal: at least one live
//       version has no matching row in the log
//   2   CONFIG ERROR - CWS_MAIN_ITEM_ID unset, or the publish log could
//       not be read; the monitor did not check anything this run
//   3   INCONCLUSIVE - at least one item's live version could not be
//       determined (network error, timeout, non-200, or the page shape
//       did not match), and no item independently produced an ALERT
//
// STDOUT carries the full per-item report every run (useful when run
// by hand or redirected to a log file). STDERR carries content ONLY on
// exit codes 1, 2 and 3 - a clean run is silent on stderr - so the cron
// line below (which discards stdout but lets stderr reach cron's own
// mail delivery, the same pattern already live on origin-host for the
// / refresh-status checks) mails only when there is
// something to say.

import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));  // tools/release
export const DEFAULT_LOG_PATH = join(here, '..', '..', 'packages', 'extension', 'docs', 'publish-log.md');
export const DEFAULT_TIMEOUT_MS = 15000;

const LISTING_URL = (itemId) => `https://chromewebstore.google.com/detail/${encodeURIComponent(itemId)}?hl=en`;

// Structural match: a "Version" label div immediately followed by a
// sibling div holding the value. Not keyed on the (opaque, build-hashed)
// CSS class names - see the header comment above.
const VERSION_PANEL_RE = /<div[^>]*>\s*Version\s*<\/div>\s*<div[^>]*>([^<]+)<\/div>/i;
// Chrome extension versions are 1-4 dot-separated integers (Chromium's
// own limit). Guards against the label match landing on the right shape
// but the wrong text if the page is restructured around it.
const VERSION_SHAPE_RE = /^\d{1,5}(\.\d{1,5}){0,3}$/;

/**
 * Pull the live version out of a fetched Chrome Web Store listing page.
 * Returns `{ok:false, reason}` for anything short of a confident match -
 * never a guess dressed up as a version.
 *
 * @param {string} html
 * @returns {{ok: true, version: string} | {ok: false, reason: string}}
 */
export function extractVersionFromListingHtml(html) {
    if (typeof html !== 'string' || html.length === 0) {
        return { ok: false, reason: 'empty response body' };
    }
    const match = VERSION_PANEL_RE.exec(html);
    if (!match) {
        return {
            ok: false,
            reason: 'no "Version" details-panel label found in the listing page '
                + '(page shape may have changed, the item may not be live yet, or '
                + 'this may be an interstitial/CAPTCHA/error page rather than the listing)',
        };
    }
    const value = match[1].trim();
    if (!VERSION_SHAPE_RE.test(value)) {
        return {
            ok: false,
            reason: `"Version" label found but its value does not look like a version string: ${JSON.stringify(value)}`,
        };
    }
    return { ok: true, version: value };
}

/**
 * Fetch one item's public listing page. Injectable `fetchImpl` so tests
 * never touch the real network.
 *
 * @returns {Promise<{ok: true, html: string} | {ok: false, reason: string}>}
 */
export async function fetchListingHtml(itemId, { fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetchImpl(LISTING_URL(itemId), {
            signal: controller.signal,
            headers: {
                'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
                    + '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'accept-language': 'en-US,en;q=0.9',
            },
        });
        if (!response.ok) {
            return { ok: false, reason: `HTTP ${response.status} fetching the listing page` };
        }
        const html = await response.text();
        return { ok: true, html };
    } catch (err) {
        const aborted = err && (err.name === 'AbortError' || err.name === 'TimeoutError');
        return {
            ok: false,
            reason: aborted
                ? `listing fetch timed out after ${timeoutMs}ms`
                : `network error fetching the listing page: ${err && err.message ? err.message : String(err)}`,
        };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Fetch + extract in one step, for one item.
 * @returns {Promise<{ok: true, version: string} | {ok: false, reason: string}>}
 */
export async function fetchLiveVersion(itemId, options = {}) {
    const fetched = await fetchListingHtml(itemId, options);
    if (!fetched.ok) return fetched;
    return extractVersionFromListingHtml(fetched.html);
}

/**
 * Parse `publish-log.md`'s `## Log` markdown table into row objects.
 * The scaffold's worked EXAMPLE row is deliberately excluded: it is
 * marked "not a real entry" in the file itself, and comparing a live
 * version against it would never match anyway, but excluding it here
 * keeps the parser honest about what it thinks is a real publish.
 *
 * @param {string} text
 * @returns {Array<{version: string, sha256: string, item: string, operator: string, date: string}>}
 */
export function parsePublishLog(text) {
    const entries = [];
    let inLogSection = false;

    for (const rawLine of text.split('\n')) {
        const line = rawLine.trim();
        if (/^##\s+Log\s*$/i.test(line)) { inLogSection = true; continue; }
        if (!inLogSection) continue;
        if (!line.startsWith('|')) continue;

        const cells = line.split('|').slice(1, -1).map((c) => c.trim());
        if (cells.length < 5) continue;
        const [version, sha256, item, operator, date] = cells;

        if (/^-+$/.test(version)) continue;                 // markdown separator row
        if (version.toLowerCase() === 'version') continue;  // header row, defensive
        if (/example/i.test(version) || /example/i.test(operator)) continue;

        entries.push({ version, sha256, item, operator, date });
    }
    return entries;
}

/**
 * Check one item's live version against the parsed log.
 * @returns {Promise<{key: string, itemId: string, state: 'ok'|'alert'|'inconclusive', version: string|null, detail: string}>}
 */
export async function checkItem({ key, itemId, entries, fetchImpl, timeoutMs }) {
    const live = await fetchLiveVersion(itemId, { fetchImpl, timeoutMs });
    if (!live.ok) {
        return { key, itemId, state: 'inconclusive', version: null, detail: live.reason };
    }
    const logged = entries.some((e) => e.item === key && e.version === live.version);
    if (logged) {
        return { key, itemId, state: 'ok', version: live.version, detail: 'matches a logged publish-log row' };
    }
    return {
        key,
        itemId,
        state: 'alert',
        version: live.version,
        detail: `no row in the publish log has item=${key} and version=${live.version}`,
    };
}

// ------------------------------------------------------------------ CLI

const USAGE = `usage: store-version-monitor.mjs [--main-id <id>] [--beta-id <id>]
                                  [--log <path>] [--timeout <ms>] [--json]

Compares the live Chrome Web Store version of each configured item
against packages/extension/docs/publish-log.md ( §2). A live
version with no matching log row is the rogue-publish incident signal.

Item IDs come from --main-id/--beta-id or CWS_MAIN_ITEM_ID/CWS_BETA_ITEM_ID.
CWS_MAIN_ITEM_ID (or --main-id) is REQUIRED; the beta item is optional
and is skipped, without error, until it is configured.

Exit codes: 0 clean, 1 ALERT (rogue-publish signal), 2 config error
(item id unset or log unreadable - the monitor did NOT run any check),
3 inconclusive (could not determine a live version this run - NOT the
same as clean).

Intended install, origin-host cron (see the manual QA checklist at
https://docs.xchain.io/components/wallet/release/qa-checklist for the
one-time setup steps; not yet installed):

  0 */6 * * * CWS_MAIN_ITEM_ID=<id> CWS_BETA_ITEM_ID=<id> \\
    /usr/bin/node /opt/xchain/store-version-monitor.mjs >/dev/null
`;

function parseArgs(argv) {
    const flags = {};
    for (let i = 0; i < argv.length; i += 1) {
        const a = argv[i];
        if (a === '--main-id') flags.mainId = argv[i += 1];
        else if (a === '--beta-id') flags.betaId = argv[i += 1];
        else if (a === '--log') flags.log = argv[i += 1];
        else if (a === '--timeout') flags.timeoutMs = Number(argv[i += 1]);
        else if (a === '--json') flags.json = true;
        else if (a === '--help' || a === '-h') flags.help = true;
    }
    return flags;
}

/**
 * The whole run, side-effect free (no direct process.stdout/stderr/exit
 * writes) so it can be driven and asserted against in a smoke test
 * without touching the real network or the real process streams.
 *
 * @returns {Promise<{exitCode: number, stdout: string, stderr: string}>}
 */
export async function run({ argv = [], env = process.env, fetchImpl, timeoutMs, now = () => new Date() } = {}) {
    const flags = parseArgs(argv);
    if (flags.help) return { exitCode: 0, stdout: USAGE, stderr: '' };

    const stamp = now().toISOString();
    const out = [];
    const err = [];

    const mainId = flags.mainId || env.CWS_MAIN_ITEM_ID || '';
    if (!mainId) {
        err.push(
            'store-version-monitor: CWS_MAIN_ITEM_ID is not set (no --main-id either). '
            + 'Nothing has been uploaded to the Chrome Web Store yet, so this monitor has no '
            + 'item to check. This is a CONFIG error, not a clean bill of health - it means the '
            + 'monitor did not run any check this pass. Set CWS_MAIN_ITEM_ID (and, once it '
            + 'exists, CWS_BETA_ITEM_ID) after the first upload, when the extension ID is '
            + 'recorded per spec  §2.',
        );
        return { exitCode: 2, stdout: '', stderr: err.join('\n') };
    }

    const betaId = flags.betaId || env.CWS_BETA_ITEM_ID || '';
    const logPath = flags.log || env.PUBLISH_LOG_PATH || DEFAULT_LOG_PATH;

    let entries;
    try {
        entries = parsePublishLog(readFileSync(logPath, 'utf8'));
    } catch (e) {
        err.push(
            `store-version-monitor: could not read the publish log at ${logPath} (${e.message}). `
            + 'Without it this monitor has no baseline to compare a live version against, so it '
            + 'cannot tell clean from rogue. Exiting as a config error rather than reporting OK.',
        );
        return { exitCode: 2, stdout: '', stderr: err.join('\n') };
    }

    const items = [{ key: 'main', itemId: mainId }];
    if (betaId) {
        items.push({ key: 'beta', itemId: betaId });
    } else {
        out.push(`${stamp} beta item not configured (CWS_BETA_ITEM_ID unset) - skipping; `
            + 'expected before the beta item exists, spec §2.');
    }

    // Sequential on purpose: at most two items, run on a cron cadence, no
    // need to pay for concurrency here.
    const results = [];
    for (const item of items) {
        results.push(await checkItem({ ...item, entries, fetchImpl, timeoutMs }));
    }

    const alerts = results.filter((r) => r.state === 'alert');
    const inconclusive = results.filter((r) => r.state === 'inconclusive');
    const ok = results.filter((r) => r.state === 'ok');
    const exitCode = alerts.length > 0 ? 1 : inconclusive.length > 0 ? 3 : 0;

    if (flags.json) {
        return {
            exitCode,
            stdout: JSON.stringify({ stamp, results, exitCode }, null, 2),
            stderr: exitCode === 0 ? '' : JSON.stringify({ alerts, inconclusive }, null, 2),
        };
    }

    for (const r of ok) {
        out.push(`${stamp} OK     item=${r.key} id=${r.itemId} version=${r.version}: ${r.detail}`);
    }
    for (const r of inconclusive) {
        out.push(`${stamp} UNSURE item=${r.key} id=${r.itemId}: ${r.detail}`);
    }
    for (const r of alerts) {
        out.push(`${stamp} ALERT  item=${r.key} id=${r.itemId} version=${r.version}: ${r.detail}`);
    }
    out.push(`${stamp} summary: ${results.length} item(s) checked, ${ok.length} ok, `
        + `${alerts.length} alert(s), ${inconclusive.length} inconclusive`);

    // stderr carries only what needs a human, so a fully clean run is
    // silent on stderr and the cron line below mails nothing.
    if (alerts.length > 0) {
        err.push(`ROGUE-PUBLISH INCIDENT SIGNAL: a live Chrome Web Store version has no `
            + `matching row in ${logPath}.`);
        for (const r of alerts) err.push(`  item=${r.key} id=${r.itemId} live-version=${r.version}: ${r.detail}`);
        err.push('Do not assume this is benign. Verify in the CWS console who published it '
            + 'before doing anything else. K7 custody / group-publisher recovery is spec §2 '
            + '(claude/specs/wallet-publishing-chrome-extension.md); emergency levers once a '
            + 'bad build is confirmed live are claude/reports/launch/INCIDENT-RUNBOOK.md §14.');
    }
    if (inconclusive.length > 0) {
        err.push(`CANNOT VERIFY ${inconclusive.length} item(s) this run - NOT an all-clear, `
            + 'it means the live version could not be determined:');
        for (const r of inconclusive) err.push(`  item=${r.key} id=${r.itemId}: ${r.detail}`);
    }

    return { exitCode, stdout: out.join('\n'), stderr: err.join('\n') };
}

const invokedDirectly = (() => {
    if (!process.argv[1]) return false;
    try {
        return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
    } catch {
        return false;
    }
})();

if (invokedDirectly) {
    run({ argv: process.argv.slice(2) }).then(({ exitCode, stdout, stderr }) => {
        if (stdout) process.stdout.write(`${stdout}\n`);
        if (stderr) process.stderr.write(`${stderr}\n`);
        process.exit(exitCode);
    });
}
