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
// monitor (§2 "Publish monitoring (compromise detection)").
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
// monitor on the release host"):
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
// mail delivery, the same pattern already live on the release host for
// the existing refresh-status checks) mails only when there is
// something to say.
//
// ---------------------------------------------------------------- PLAY
//
// THE PLAY LANE CHECKS PRESENCE, NOT VERSION, AND THAT IS A MEASURED
// DECISION RATHER THAN A SHORTCUT (frontier row 69). The obvious
// design was to mirror the Chrome lane: scrape the listing, read the
// version, compare it against a log. It does not transfer, because a
// Play listing page does not carry a version. Measured 2026-08-08
// against a real live listing (Signal, org.thoughtcrime.securesms): the
// server-rendered HTML contains the string "Version" ZERO times, and
// the "About this app" panel that shows it is populated by a later
// `batchexecute` XHR. What the HTML does contain is seventeen distinct
// semver-shaped strings from unrelated page furniture, so a regex would
// be choosing one of seventeen guesses. The Chrome lane's own header
// forbids exactly that ("never a guess dressed up as a version"), so
// the Play lane does not attempt it.
//
// WHAT THE PLAY LANE DOES DETECT. Row 69 names three risks: a store can
// SUSPEND a listing, UNPUBLISH it, or silently ROLL IT BACK. The first
// two are presence changes and are detected here precisely. The third
// is a version change and is NOT detected - stated here so that nobody
// later reads "a Play monitor exists" as covering it. The only faithful
// route to Play version state is the authenticated Play Developer API
// (`androidpublisher`, edits/tracks), which needs a service-account
// credential this lane deliberately does not hold; that remains a
// separate decision, not an oversight.
//
// THE LATCH, WHICH IS WHY THIS CAN BE BUILT BEFORE THE LISTING EXISTS.
// Row 69 deferred this work because a monitor pointed at a listing that
// does not exist yet must either false-alarm on every run or "tolerate
// absence, which is the state it can least afford to tolerate later".
// That is a real objection and this is the answer to it: absence is
// tolerated ONLY until the listing has been seen live even once, and
// never again afterwards. The first sighting is recorded in a small
// state file and from that moment a 404 is an ALERT, permanently. The
// monitor therefore arms ITSELF at the production promote, with no
// human step and no code change riding an operator's console click -
// which matters because the event that makes the listing public (the
// staged rollout, frontier rows 36/37) lands no commit for a code
// change to ride.
//
// The state file is the latch's memory, so deleting it disarms the
// latch back to "never seen". It lives beside the script on the monitor
// host (root-owned, alongside the cron entry), which is the same trust
// boundary as the script itself; an attacker who can delete it can
// equally replace the monitor. Stated rather than defended.
//
//   PLAY_PACKAGE_NAME  env, or --play-package <id>   defaults to the
//                                                     shipped applicationId
//   PLAY_STATE_PATH    env, or --state <path>        latch state file
//   --no-play                                        disable the lane
//
// A state file that exists but cannot be read or parsed is a CONFIG
// error (exit 2), never a clean run: an unreadable latch means the
// monitor cannot tell "never published" from "was published and is now
// gone", which is the one distinction it exists to make.

import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
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

// ----------------------------------------------------------------- PLAY

/** The shipped Android applicationId (D1). Immutable once published,
 *  so it is a constant here rather than something an operator must supply. */
export const PLAY_PACKAGE_NAME = 'io.xchain.wallet.android';
export const DEFAULT_STATE_PATH = join(here, 'store-monitor-state.json');

const PLAY_LISTING_URL = (pkg) => `https://play.google.com/store/apps/details?id=${encodeURIComponent(pkg)}&hl=en`;

// Google renders the listing's app name into og:title as
// "<App name> - Apps on Google Play". Measured against a real live
// listing 2026-08-08; see the header note.
const PLAY_TITLE_RE = /<meta\s+property="og:title"\s+content="(.*?) - Apps on Google Play"/i;

/**
 * Decide what a fetched Play listing page proves. A 200 that does not
 * name our package is NOT treated as our listing being live: it is the
 * shape a redirect, an interstitial or a soft-404 takes, and calling it
 * live would arm the latch against a page that is not ours.
 *
 * @param {string} html
 * @param {string} packageName
 * @returns {{ok: true, title: string} | {ok: false, reason: string}}
 */
export function classifyPlayListingHtml(html, packageName) {
    if (typeof html !== 'string' || html.length === 0) {
        return { ok: false, reason: 'empty response body' };
    }
    if (!html.includes(packageName)) {
        return {
            ok: false,
            reason: `listing page returned 200 but never names ${packageName} `
                + '(soft-404, redirect, interstitial or the wrong app)',
        };
    }
    const match = PLAY_TITLE_RE.exec(html);
    if (!match) {
        return {
            ok: false,
            reason: 'no og:title "… - Apps on Google Play" found (page shape may have '
                + 'changed, or this is an interstitial/CAPTCHA rather than the listing)',
        };
    }
    return { ok: true, title: match[1].trim() };
}

/**
 * Fetch the Play listing. A 404 is a first-class ANSWER ("absent"), not
 * a failure: before the production promote it is the expected state.
 * Every other non-200 is inconclusive.
 *
 * @returns {Promise<{state: 'live', html: string} | {state: 'absent'} | {state: 'inconclusive', reason: string}>}
 */
export async function fetchPlayListing(packageName, { fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetchImpl(PLAY_LISTING_URL(packageName), {
            signal: controller.signal,
            headers: {
                'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
                    + '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'accept-language': 'en-US,en;q=0.9',
            },
        });
        if (response.status === 404) return { state: 'absent' };
        if (!response.ok) {
            return { state: 'inconclusive', reason: `HTTP ${response.status} fetching the Play listing` };
        }
        return { state: 'live', html: await response.text() };
    } catch (err) {
        const aborted = err && (err.name === 'AbortError' || err.name === 'TimeoutError');
        return {
            state: 'inconclusive',
            reason: aborted
                ? `Play listing fetch timed out after ${timeoutMs}ms`
                : `network error fetching the Play listing: ${err && err.message ? err.message : String(err)}`,
        };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Read the latch. A missing file means "never seen", which is the
 * correct starting state. A file that exists but will not parse throws,
 * because guessing there would silently disarm the latch.
 *
 * @returns {{firstSeen: string|null, lastSeen: string|null}}
 */
export function readState(statePath, { readFileImpl = readFileSync } = {}) {
    let raw;
    try {
        raw = readFileImpl(statePath, 'utf8');
    } catch (e) {
        if (e && e.code === 'ENOENT') return { firstSeen: null, lastSeen: null };
        throw e;
    }
    const parsed = JSON.parse(raw);
    const play = (parsed && parsed.play) || {};
    return { firstSeen: play.firstSeen || null, lastSeen: play.lastSeen || null };
}

/** Write-temp + rename, so a crash mid-write cannot leave a truncated latch. */
export function writeState(statePath, state, { writeFileImpl = writeFileSync, renameImpl = renameSync } = {}) {
    const tmp = `${statePath}.tmp`;
    writeFileImpl(tmp, `${JSON.stringify({ play: state }, null, 2)}\n`, 'utf8');
    renameImpl(tmp, statePath);
}

/**
 * The latch decision. Pure, so the interesting half is testable without
 * a filesystem or a network.
 *
 * @returns {{state: 'ok'|'alert'|'inconclusive', detail: string, sawLive: boolean, title: string|null}}
 */
export function judgePlay({ fetched, packageName, firstSeen }) {
    if (fetched.state === 'inconclusive') {
        return { state: 'inconclusive', detail: fetched.reason, sawLive: false, title: null };
    }
    if (fetched.state === 'absent') {
        if (firstSeen) {
            return {
                state: 'alert',
                detail: `the Play listing for ${packageName} was live (first seen ${firstSeen}) and now `
                    + 'returns 404: it has been unpublished, suspended or removed',
                sawLive: false,
                title: null,
            };
        }
        return {
            state: 'ok',
            detail: 'no public Play listing yet, and none has ever been seen - the expected state '
                + 'until the production promote (frontier rows 36/37)',
            sawLive: false,
            title: null,
        };
    }
    const identified = classifyPlayListingHtml(fetched.html, packageName);
    if (!identified.ok) {
        return { state: 'inconclusive', detail: identified.reason, sawLive: false, title: null };
    }
    return {
        state: 'ok',
        detail: firstSeen
            ? `listing is live as "${identified.title}"`
            : `listing is live as "${identified.title}" - FIRST SIGHTING, the absence latch is now armed`,
        sawLive: true,
        title: identified.title,
    };
}

/**
 * Full Play check including latch persistence.
 * @returns {Promise<{key: string, itemId: string, state: string, version: null, detail: string}>}
 */
export async function checkPlay({
    packageName, statePath, fetchImpl, timeoutMs, now = () => new Date(),
    readStateImpl = readState, writeStateImpl = writeState,
}) {
    const prior = readStateImpl(statePath);
    const fetched = await fetchPlayListing(packageName, { fetchImpl, timeoutMs });
    const judged = judgePlay({ fetched, packageName, firstSeen: prior.firstSeen });

    if (judged.sawLive) {
        const stamp = now().toISOString();
        writeStateImpl(statePath, { firstSeen: prior.firstSeen || stamp, lastSeen: stamp });
    }
    return {
        key: 'play', itemId: packageName, state: judged.state, version: null, detail: judged.detail,
    };
}

// --------------------------------------------------------- DIRECT lane
//
//  row 130. Chrome and Play are both watched above; the lane that
// has ACTUALLY SHIPPED TO THE PUBLIC was not watched at all. The direct
// APK, its signed manifest and its update feed have been live on
// downloads.xchain.io since 2026-08-06 and were re-measured only when a
// person happened to run a sweep by hand.
//
// WHY THIS LANE NEEDS NO LATCH, which is the whole difference from Play.
// Play's absence is the normal starting state, so a 404 there is only an
// alarm once the listing has been seen live (hence the latch). The direct
// lane is the opposite: it is published NOW, so absence is ALWAYS an
// alert and there is no state to keep. A lane that needs no state file
// cannot have a corrupt one, which removes the entire failure mode the
// Play lane's exit-2 branch exists for.
//
// WHAT THIS CHECKS: presence and IDENTITY.
//   - the feed answers and parses under the same strict rule the app applies
//   - the manifest for the version the feed names answers
//   - the APK the CDN actually serves hashes to the digest that manifest
//     claims for it
// That last one is the point. Rows 93/94/97/102/103 of  are all the
// same failure - a published surface saying something false, found only
// by looking - and the digest is the only one of these that a silent
// re-upload would break.
//
// WHAT THIS DELIBERATELY DOES NOT CHECK, stated so nobody reads "a direct
// monitor exists" as covering it: the GPG signature on the manifest. That
// needs a keyring and a trust decision about which key is canonical, and
// a monitor that imports a key from the same host it is auditing proves
// nothing. Verifying K1 against the published fingerprint stays the
// documented human step (release/verify-release.md).

/**
 * The feed's ONLY field, validated exactly as the app validates it.
 *
 * Deliberately a COPY of `directUpdateCheck.js`'s rule rather than an
 * import of it. This tool is deployed standalone - it runs from cron on
 * origin-host, and `rollback-rerelease.sh` copies it alone into a scratch
 * repo - so an import reaching into `packages/web` makes it unloadable
 * in both places (measured: it broke the rollback smoke immediately).
 * The two must not drift, so the smoke asserts this function and the
 * app's agree across a table of inputs, where both files exist.
 *
 * @param {unknown} body
 * @returns {string} the validated version
 */
export function parseDirectFeedVersion(body) {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        throw new Error('body must be a JSON object');
    }
    const version = body.version;
    if (typeof version !== 'string') throw new Error('missing a string "version"');
    if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
        throw new Error(`"${String(version).slice(0, 32)}" is not a plain MAJOR.MINOR.PATCH`);
    }
    return version;
}

export const DEFAULT_DIRECT_BASE = 'https://downloads.xchain.io/wallet';

/**
 * Parse a release manifest into its tag and its digest table.
 *
 * The format is `sha256␠␠./name` lines under `# key: value` comments, and
 * the ONLY fields read are the tag and the digests - anything else is a
 * comment as far as this is concerned.
 *
 * @param {string} text
 * @returns {{tag: string|null, digests: Record<string, string>}}
 */
export function parseReleaseManifest(text) {
    if (typeof text !== 'string') throw new TypeError('manifest must be text');
    const digests = {};
    let tag = null;
    for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (!line) continue;
        if (line.startsWith('#')) {
            const m = /^#\s*tag:\s*(\S+)/.exec(line);
            if (m) tag = m[1];
            continue;
        }
        const m = /^([0-9a-f]{64})\s+\.?\/?(.+)$/i.exec(line);
        if (m) digests[m[2].trim()] = m[1].toLowerCase();
    }
    return { tag, digests };
}

/**
 * Score the direct lane from already-fetched material. Pure, so every
 * branch is testable without touching the network - including the ones
 * that only appear when something is wrong, which is exactly when a
 * monitor must not be improvising.
 *
 * @param {{feedText?: string|null, manifestText?: string|null,
 *          apkBytes?: Uint8Array|null, apkName?: string,
 *          transport?: string|null}} m
 * @returns {{state: 'ok'|'alert'|'inconclusive', detail: string, version: string|null}}
 */
export function judgeDirect(m) {
    if (m.transport) {
        return { state: 'inconclusive', detail: `could not reach the feed: ${m.transport}`, version: null };
    }
    if (m.feedText === null || m.feedText === undefined) {
        return {
            state: 'alert',
            detail: 'the direct update feed is GONE. It is published and in use by every '
                + 'sideloaded install, so its absence is an outage, never a "not yet"',
            version: null,
        };
    }
    let version;
    try {
        version = parseDirectFeedVersion(JSON.parse(m.feedText));
    } catch (e) {
        return {
            state: 'alert',
            detail: `the feed is served but the app's own validator rejects it (${e.message}), `
                + 'so every direct install is reading a feed it will discard',
            version: null,
        };
    }
    if (m.manifestText === null || m.manifestText === undefined) {
        return {
            state: 'alert',
            detail: `the feed names ${version} but no signed manifest is published for it, so a `
                + 'user told to verify their download has nothing to verify against',
            version,
        };
    }
    const { tag, digests } = parseReleaseManifest(m.manifestText);
    if (tag && tag !== `v${version}`) {
        return {
            state: 'alert',
            detail: `the feed says ${version} and the manifest it points at is tagged ${tag}: `
                + 'these are two different releases and one of them is being mis-served',
            version,
        };
    }
    const expected = digests[m.apkName];
    if (!expected) {
        return {
            state: 'inconclusive',
            detail: `the manifest for ${tag || version} lists no digest for ${m.apkName}, so the `
                + 'served APK cannot be checked against it',
            version,
        };
    }
    if (!m.apkBytes) {
        return {
            state: 'alert',
            detail: `the manifest publishes a digest for ${m.apkName} but the CDN does not serve `
                + 'the file: the download page links a binary that is not there',
            version,
        };
    }
    const actual = createHash('sha256').update(m.apkBytes).digest('hex');
    if (actual !== expected) {
        return {
            state: 'alert',
            detail: `the APK served for ${version} hashes to ${actual} but its signed manifest `
                + `claims ${expected}. The published binary is NOT the one that was signed`,
            version,
        };
    }
    return {
        state: 'ok',
        detail: `${m.apkName} is published and its SHA-256 matches the signed manifest `
            + `(${actual.slice(0, 8)}…${actual.slice(-4)})`,
        version,
    };
}

/**
 * Fetch and score the direct lane.
 * @returns {Promise<{key: string, itemId: string, state: string, version: string|null, detail: string}>}
 */
export async function checkDirect({
    base = DEFAULT_DIRECT_BASE, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
    const root = String(base).replace(/\/+$/, '');
    const get = async (url, asBytes = false) => {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), timeoutMs);
        try {
            const res = await fetchImpl(url, { signal: ctl.signal, redirect: 'error' });
            if (res.status === 404) return null;
            if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
            return asBytes ? new Uint8Array(await res.arrayBuffer()) : await res.text();
        } finally { clearTimeout(timer); }
    };

    let feedText = null; let manifestText = null; let apkBytes = null;
    let apkName = ''; let transport = null;
    try {
        feedText = await get(`${root}/android/latest.json`);
        if (feedText !== null) {
            // Read the version the same way the app does before using it to
            // build any further URL: a malformed feed must not send this
            // monitor fetching an attacker-shaped path.
            let version = null;
            try { version = parseDirectFeedVersion(JSON.parse(feedText)); } catch { /* judged below */ }
            if (version) {
                apkName = `xchain-wallet-v${version}.apk`;
                manifestText = await get(`${root}/RELEASE_HASHES/v${version}.txt`);
                if (manifestText !== null) apkBytes = await get(`${root}/android/${apkName}`, true);
            }
        }
    } catch (e) {
        transport = e.message;
    }

    const judged = judgeDirect({ feedText, manifestText, apkBytes, apkName, transport });
    return {
        key: 'direct', itemId: `${root}/android`, state: judged.state,
        version: judged.version, detail: judged.detail,
    };
}

// ------------------------------------------------------------------ CLI

const USAGE = `usage: store-version-monitor.mjs [--main-id <id>] [--beta-id <id>]
                                  [--log <path>] [--timeout <ms>] [--json]
                                  [--play-package <id>] [--state <path>]
                                  [--direct-base <url>]
                                  [--no-play] [--no-chrome] [--no-direct]
                                  [--help]

CHROME lane: compares the live Chrome Web Store version of each
configured item against packages/extension/docs/publish-log.md
(§2). A live version with no matching log row is the
rogue-publish incident signal.

Item IDs come from --main-id/--beta-id or CWS_MAIN_ITEM_ID/CWS_BETA_ITEM_ID.
CWS_MAIN_ITEM_ID (or --main-id) is REQUIRED unless --no-chrome; the beta
item is optional and is skipped, without error, until it is configured.

PLAY lane (row 69): checks that the Android listing is PRESENT
and is ours. It does not check a version, because a Play listing page
does not publish one - see the header comment for the measurement. The
first time the listing is seen live, an absence latch is armed in the
state file; from then on a 404 is an ALERT rather than "not published
yet". This arms itself, so no code change has to ride the operator's
production promote.

  PLAY_PACKAGE_NAME  defaults to ${PLAY_PACKAGE_NAME}
  PLAY_STATE_PATH    defaults to the file beside this script

DIRECT lane ( row 130): the direct-APK download feed, which is the
only artifact this project has actually shipped to the public. Fetches
the update pointer, the signed manifest for the version it names, and
the APK itself, then hashes the served bytes and ALERTS if they do not
match the digest that manifest claims. It keeps NO state and needs no
latch: this lane is published now, so an absent feed is always an
outage rather than a "not published yet". It does NOT verify the
manifest's GPG signature - that needs a keyring and a trust decision,
and a monitor importing a key from the host it audits proves nothing -
so verifying K1 stays the documented human step.

  DIRECT_FEED_BASE   defaults to ${DEFAULT_DIRECT_BASE}

Exit codes: 0 clean, 1 ALERT (rogue publish, or a listing that was live
and is now gone), 2 config error (item id unset, log unreadable, latch
unreadable, or both lanes disabled - the monitor did NOT run a full
check), 3 inconclusive (could not determine state this run - NOT the
same as clean).

Install, release-host cron (see the manual QA checklist at
https://docs.xchain.io/components/wallet/release/qa-checklist for the
one-time setup steps). The Chrome lane stays disarmed until an item id
exists, because a missing id is a whole-run config error; the other two
lanes need no id and are LIVE on origin-host as of 2026-08-10:

  0 */6 * * * PLAY_STATE_PATH=/opt/xchain/state/store-monitor-state.json \\
    /usr/bin/node /opt/xchain/store-version-monitor.mjs --no-chrome >/dev/null

PLAY_STATE_PATH is set there rather than left at its default because
/opt/xchain is root-owned and the cron user cannot write into it. That
misconfiguration is invisible on the day you make it: with no listing
published the run exits 0, and only the FIRST SIGHTING of a live one
tries to write the latch and dies EACCES exit 2 - the exact promote day
the latch exists to arm itself on. Give the latch a writable home.

Once the extension is uploaded, move to the combined line:

  0 */6 * * * CWS_MAIN_ITEM_ID=<id> CWS_BETA_ITEM_ID=<id> \\
    PLAY_STATE_PATH=/opt/xchain/state/store-monitor-state.json \\
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
        else if (a === '--play-package') flags.playPackage = argv[i += 1];
        else if (a === '--state') flags.statePath = argv[i += 1];
        else if (a === '--no-play') flags.noPlay = true;
        else if (a === '--no-direct') flags.noDirect = true;
        else if (a === '--direct-base') flags.directBase = argv[i += 1];
        else if (a === '--no-chrome') flags.noChrome = true;
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

    const chromeEnabled = !flags.noChrome;
    const playEnabled = !flags.noPlay;
    const directEnabled = !flags.noDirect;
    const mainId = flags.mainId || env.CWS_MAIN_ITEM_ID || '';

    if (chromeEnabled && !mainId) {
        err.push(
            'store-version-monitor: CWS_MAIN_ITEM_ID is not set (no --main-id either). '
            + 'Nothing has been uploaded to the Chrome Web Store yet, so this monitor has no '
            + 'item to check. This is a CONFIG error, not a clean bill of health - it means the '
            + 'monitor did not run any check this pass. Set CWS_MAIN_ITEM_ID (and, once it '
            + 'exists, CWS_BETA_ITEM_ID) after the first upload, when the extension ID is '
            + 'recorded per spec §2.',
        );
        // The Play lane needs no id and could have run, so say so rather than
        // leaving an operator to conclude the Android listing is being watched.
        // Android is AHEAD of Chrome in this programme, so "no Chrome item yet"
        // must not silently mean "no Android listing check either".
        if (playEnabled || directEnabled) {
            err.push(
                'The Play and direct lanes did NOT run either, because this is a whole-run config '
                + 'error. Both need no Chrome item, and the DIRECT lane watches the only artifact '
                + 'this project has actually shipped to the public, so a missing Chrome id must '
                + 'never silently mean the published APK went unchecked. '
                + 'To watch the Play listing before a Chrome item exists, run with --no-chrome.',
            );
        }
        return { exitCode: 2, stdout: '', stderr: err.join('\n') };
    }
    if (!chromeEnabled && !playEnabled && !directEnabled) {
        err.push('store-version-monitor: every lane is disabled (--no-chrome, --no-play and --no-direct), '
            + 'so nothing was checked. Refusing to exit 0 on a run that verified nothing.');
        return { exitCode: 2, stdout: '', stderr: err.join('\n') };
    }

    const betaId = flags.betaId || env.CWS_BETA_ITEM_ID || '';
    const logPath = flags.log || env.PUBLISH_LOG_PATH || DEFAULT_LOG_PATH;

    const items = [];
    let entries = [];
    if (chromeEnabled) {
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
        items.push({ key: 'main', itemId: mainId });
        if (betaId) {
            items.push({ key: 'beta', itemId: betaId });
        } else {
            out.push(`${stamp} beta item not configured (CWS_BETA_ITEM_ID unset) - skipping; `
                + 'expected before the beta item exists, spec §2.');
        }
    }

    // Sequential on purpose: at most two items, run on a cron cadence, no
    // need to pay for concurrency here.
    const results = [];
    for (const item of items) {
        results.push(await checkItem({ ...item, entries, fetchImpl, timeoutMs }));
    }

    if (playEnabled) {
        const packageName = flags.playPackage || env.PLAY_PACKAGE_NAME || PLAY_PACKAGE_NAME;
        const statePath = flags.statePath || env.PLAY_STATE_PATH || DEFAULT_STATE_PATH;
        try {
            results.push(await checkPlay({ packageName, statePath, fetchImpl, timeoutMs, now }));
        } catch (e) {
            // An unreadable or corrupt latch cannot be guessed past: without it
            // "never published" and "was published and is now gone" are the same
            // observation, and those are the two states this lane distinguishes.
            err.push(
                `store-version-monitor: the Play absence latch at ${statePath} could not be read `
                + `(${e.message}). Without it a 404 cannot be told from a takedown, so this is a `
                + 'config error rather than a clean run.',
            );
            return { exitCode: 2, stdout: '', stderr: err.join('\n') };
        }
    }

    if (directEnabled) {
        const directBase = flags.directBase || env.DIRECT_FEED_BASE || DEFAULT_DIRECT_BASE;
        results.push(await checkDirect({ base: directBase, fetchImpl, timeoutMs }));
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

    // The Play lane carries no version (see the header: Play does not publish
    // one on the listing page), so the column is omitted rather than printed
    // as "null", which would read as a failed scrape.
    const versionCol = (r) => (r.version === null || r.version === undefined ? '' : ` version=${r.version}`);
    for (const r of ok) {
        out.push(`${stamp} OK     item=${r.key} id=${r.itemId}${versionCol(r)}: ${r.detail}`);
    }
    for (const r of inconclusive) {
        out.push(`${stamp} UNSURE item=${r.key} id=${r.itemId}: ${r.detail}`);
    }
    for (const r of alerts) {
        out.push(`${stamp} ALERT  item=${r.key} id=${r.itemId}${versionCol(r)}: ${r.detail}`);
    }
    out.push(`${stamp} summary: ${results.length} item(s) checked, ${ok.length} ok, `
        + `${alerts.length} alert(s), ${inconclusive.length} inconclusive`);

    // stderr carries only what needs a human, so a fully clean run is
    // silent on stderr and the cron line below mails nothing.
    const chromeAlerts = alerts.filter((r) => r.key !== 'play');
    const playAlerts = alerts.filter((r) => r.key === 'play');
    if (chromeAlerts.length > 0) {
        err.push(`ROGUE-PUBLISH INCIDENT SIGNAL: a live Chrome Web Store version has no `
            + `matching row in ${logPath}.`);
        for (const r of chromeAlerts) err.push(`  item=${r.key} id=${r.itemId} live-version=${r.version}: ${r.detail}`);
        err.push('Do not assume this is benign. Verify in the CWS console who published it '
            + 'before doing anything else. K7 custody / group-publisher recovery is spec §2 '
            + '(claude/specs/wallet-publishing-chrome-extension.md); emergency levers once a '
            + 'bad build is confirmed live are claude/reports/launch/INCIDENT-RUNBOOK.md §14.');
    }
    if (playAlerts.length > 0) {
        err.push('PLAY LISTING INCIDENT SIGNAL: the Android listing is not answering as ours.');
        for (const r of playAlerts) err.push(`  item=${r.key} id=${r.itemId}: ${r.detail}`);
        err.push('A listing that was live and now 404s is a takedown, a suspension or a '
            + 'self-inflicted unpublish; check Play Console -> Publishing overview and the '
            + 'developer-account email before assuming anything. Android emergency levers '
            + '(the staged-rollout halt, and the direct APK lane that has none) are '
            + 'claude/reports/launch/INCIDENT-RUNBOOK.md §15.');
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
