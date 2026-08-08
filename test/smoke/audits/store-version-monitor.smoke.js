// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for  §2/§4: the Chrome Web Store publish-log monitor.
//
// The four failure modes that matter, per the spec, are the four cases
// driven here: item IDs unset (must refuse loudly, not report clean),
// a live version present in the log (clean), a live version absent
// from the log (the rogue-publish alert), and a fetch failure (must be
// distinguishable from clean - "inconclusive", never a silent pass).
// None of this touches the real network: every fetch is a stubbed
// `fetchImpl` injected into `run()`.

import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

// Resolved from this file, not from cwd: the real publish log is read
// below, and the runner's cwd is not something this check should depend on.
const here = dirname(fileURLToPath(import.meta.url));

import {
    checkItem,
    classifyPlayListingHtml,
    extractVersionFromListingHtml,
    judgePlay,
    parsePublishLog,
    readState,
    run,
    writeState,
} from '../../../tools/release/store-version-monitor.mjs';

const dir = mkdtempSync(join(tmpdir(), 'xchain-store-version-monitor-'));
const logPath = join(dir, 'publish-log.md');

// A page shaped like a real Chrome Web Store listing's "Details" panel,
// the same structural shape confirmed live 2026-08-01 against
// chromewebstore.google.com/detail/cjpalhdlnbpafiamejdnhcphjbkeiagm
// (uBlock Origin): a "Version" label div immediately followed by a
// sibling div holding the version string, buried in a much larger page.
function listingHtml(version) {
    return `<html><body><section class="MHH2Z"><div class="SmeJW"><h2>Details</h2></div>`
        + `<div class="im4wIf"><ul><li class="MqICNe"><div class="QDHp8e">Version</div>`
        + `<div class="nBZElf">${version}</div></li></ul></div></section></body></html>`;
}

function fakeFetch(map) {
    return async (url) => {
        for (const [needle, handler] of Object.entries(map)) {
            if (url.includes(needle)) return handler();
        }
        throw new Error(`fakeFetch: no stub for ${url}`);
    };
}

function ok(body, status = 200) {
    return { ok: status >= 200 && status < 300, status, text: async () => body };
}

const LOG = `# Chrome Web Store publish log

## Log

| version | zip sha256 | item | operator | date |
|---|---|---|---|---|
| 0.0.0-EXAMPLE | \`0000\` | main | EXAMPLE-operator (not a real entry) | 2026-01-01 |
| 0.333.1 | \`abc123\` | main | J-Dog | 2026-08-01 |
| 0.333.1 | \`def456\` | beta | J-Dog | 2026-07-30 |
`;
writeFileSync(logPath, LOG);

// -------------------------------------------------------- the extractor

{
    const result = extractVersionFromListingHtml(listingHtml('1.72.2'));
    assert.deepEqual(result, { ok: true, version: '1.72.2' }, 'reads the version out of the details panel');
}
{
    const result = extractVersionFromListingHtml('<html><body>nothing useful here</body></html>');
    assert.equal(result.ok, false, 'no Version label at all is not a pass');
    assert.match(result.reason, /no "Version"/);
}
{
    // The label is present but the structure feeding it garbage - the
    // shape guard must catch this rather than accept any string.
    const html = `<div>Version</div><div>not-a-version</div>`;
    const result = extractVersionFromListingHtml(html);
    assert.equal(result.ok, false, 'a non-version-shaped value is rejected, not passed through');
}
{
    const result = extractVersionFromListingHtml('');
    assert.equal(result.ok, false, 'an empty body is not a pass');
}

// -------------------------------------------------------- the log parser

{
    const entries = parsePublishLog(LOG);
    assert.equal(entries.length, 2, 'the EXAMPLE scaffold row is excluded');
    assert.ok(entries.some((e) => e.item === 'main' && e.version === '0.333.1'));
    assert.ok(entries.some((e) => e.item === 'beta' && e.version === '0.333.1'));
    assert.ok(!entries.some((e) => e.version.includes('EXAMPLE')), 'no EXAMPLE row leaks through');
}

// -------------------------------------------------------- checkItem cases

{
    // Case: live version IS in the log - clean.
    const entries = parsePublishLog(LOG);
    const fetchImpl = fakeFetch({ 'chromewebstore.google.com': () => ok(listingHtml('0.333.1')) });
    const result = await checkItem({ key: 'main', itemId: 'aaaa', entries, fetchImpl });
    assert.equal(result.state, 'ok', 'a logged live version is clean');
    assert.equal(result.version, '0.333.1');
}
{
    // Case: live version is NOT in the log - the rogue-publish signal.
    const entries = parsePublishLog(LOG);
    const fetchImpl = fakeFetch({ 'chromewebstore.google.com': () => ok(listingHtml('0.333.9')) });
    const result = await checkItem({ key: 'main', itemId: 'aaaa', entries, fetchImpl });
    assert.equal(result.state, 'alert', 'an unlogged live version is the alert case');
    assert.match(result.detail, /no row in the publish log/);
}
{
    // Case: fetch failure - must be inconclusive, never a pass.
    const entries = parsePublishLog(LOG);
    const fetchImpl = fakeFetch({ 'chromewebstore.google.com': () => { throw new Error('ECONNRESET'); } });
    const result = await checkItem({ key: 'main', itemId: 'aaaa', entries, fetchImpl });
    assert.equal(result.state, 'inconclusive', 'a network failure is inconclusive, not clean');
    assert.match(result.detail, /network error/);
}
{
    // Case: an HTTP error status - also inconclusive, not clean.
    const entries = parsePublishLog(LOG);
    const fetchImpl = fakeFetch({ 'chromewebstore.google.com': () => ok('rate limited', 429) });
    const result = await checkItem({ key: 'main', itemId: 'aaaa', entries, fetchImpl });
    assert.equal(result.state, 'inconclusive');
    assert.match(result.detail, /HTTP 429/);
}
{
    // Case: 200 but the page shape doesn't match (a redesign, a CAPTCHA
    // page) - inconclusive, never a silent pass dressed as clean.
    const entries = parsePublishLog(LOG);
    const fetchImpl = fakeFetch({ 'chromewebstore.google.com': () => ok('<html>please verify you are human</html>') });
    const result = await checkItem({ key: 'main', itemId: 'aaaa', entries, fetchImpl });
    assert.equal(result.state, 'inconclusive');
}

// ------------------------------------------------------------ run() cases

{
    // Deliverable case 1: item IDs unset. Must exit non-zero with a
    // clear message and must NOT attempt any network call.
    let fetchCalled = false;
    const fetchImpl = async () => { fetchCalled = true; return ok(listingHtml('0.333.1')); };
    const result = await run({ argv: [], env: {}, fetchImpl });
    assert.equal(result.exitCode, 2, 'unset CWS_MAIN_ITEM_ID is a config error, not a clean run');
    assert.match(result.stderr, /CWS_MAIN_ITEM_ID is not set/);
    assert.equal(result.stdout, '', 'nothing is reported as checked, because nothing was');
    assert.equal(fetchCalled, false, 'no fetch is attempted without a configured item id');
}
{
    // Deliverable case 2: live version present in the log - clean run,
    // silent on stderr (so cron mails nothing).
    const fetchImpl = fakeFetch({ 'chromewebstore.google.com': () => ok(listingHtml('0.333.1')) });
    const result = await run({
        argv: ['--no-play'],
        env: { CWS_MAIN_ITEM_ID: 'aaaa', CWS_BETA_ITEM_ID: 'bbbb', PUBLISH_LOG_PATH: logPath },
        fetchImpl,
    });
    assert.equal(result.exitCode, 0, 'both items logged is a clean run');
    assert.equal(result.stderr, '', 'a clean run is silent on stderr');
    assert.match(result.stdout, /OK\s+item=main/);
    assert.match(result.stdout, /OK\s+item=beta/);
}
{
    // Deliverable case 3: live version absent from the log - the alert,
    // loud on stderr so cron mails it.
    const fetchImpl = fakeFetch({ 'chromewebstore.google.com': () => ok(listingHtml('9.9.9')) });
    const result = await run({
        argv: ['--no-play'],
        env: { CWS_MAIN_ITEM_ID: 'aaaa', PUBLISH_LOG_PATH: logPath },
        fetchImpl,
    });
    assert.equal(result.exitCode, 1, 'an unlogged live version exits non-zero');
    assert.match(result.stderr, /ROGUE-PUBLISH INCIDENT SIGNAL/);
    assert.match(result.stderr, /live-version=9\.9\.9/);
    assert.match(result.stderr, /INCIDENT-RUNBOOK\.md §14/, 'points at the real runbook section, not an invented one');
}
{
    // Deliverable case 4: fetch failure - inconclusive, distinct exit
    // code from both clean (0) and alert (1), loud on stderr.
    const fetchImpl = fakeFetch({ 'chromewebstore.google.com': () => { throw new Error('ETIMEDOUT'); } });
    const result = await run({
        argv: ['--no-play'],
        env: { CWS_MAIN_ITEM_ID: 'aaaa', PUBLISH_LOG_PATH: logPath },
        fetchImpl,
    });
    assert.equal(result.exitCode, 3, 'a fetch failure is its own exit code, not 0 and not 1');
    assert.match(result.stderr, /CANNOT VERIFY/);
    assert.doesNotMatch(result.stderr, /ROGUE-PUBLISH/, 'inconclusive must never be reported as an alert');
}
{
    // Beta unconfigured is a normal pre-launch/pre-D3 state, not an
    // error: it must not alert or fail the run by itself.
    const fetchImpl = fakeFetch({ 'chromewebstore.google.com': () => ok(listingHtml('0.333.1')) });
    const result = await run({
        argv: ['--no-play'],
        env: { CWS_MAIN_ITEM_ID: 'aaaa', PUBLISH_LOG_PATH: logPath },
        fetchImpl,
    });
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /beta item not configured/);
}
{
    // An unreadable publish log is also a config error (no baseline to
    // compare against), not a clean run.
    const fetchImpl = fakeFetch({ 'chromewebstore.google.com': () => ok(listingHtml('0.333.1')) });
    const result = await run({
        argv: ['--no-play'],
        env: { CWS_MAIN_ITEM_ID: 'aaaa', PUBLISH_LOG_PATH: join(dir, 'no-such-file.md') },
        fetchImpl,
    });
    assert.equal(result.exitCode, 2, 'a missing publish log is a config error');
    assert.match(result.stderr, /could not read the publish log/);
}
{
    // --main-id / --beta-id flags override the environment.
    const fetchImpl = fakeFetch({ 'chromewebstore.google.com': () => ok(listingHtml('0.333.1')) });
    const result = await run({
        argv: ['--main-id', 'aaaa', '--log', logPath, '--no-play'],
        env: {},
        fetchImpl,
    });
    assert.equal(result.exitCode, 0, 'a CLI flag can supply the item id when the env var is unset');
}
{
    const result = await run({ argv: ['--help'], env: {} });
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /usage: store-version-monitor/);
}

// ------------------------------- the parser against the REAL publish log
//
// Everything above drives `LOG`, a fixture written in this file. A fixture
// and a parser written together always agree; the file the monitor actually
// reads is `packages/extension/docs/publish-log.md`, and the operator
// appends rows to it BY HAND, mid-ceremony, in the same step as an upload
// (the Chrome Web Store submission runbook, Phase 6:
// https://docs.xchain.io/components/wallet/release/extension/chrome-web-store).
//
// So the shape of that real table is load-bearing and was unverified. If it
// drifts from what the parser expects, the parser does not throw: it
// returns fewer rows, or none. The monitor then finds a live version with
// "no row in the publish log" and reports the ROGUE-PUBLISH ALERT against a
// perfectly legitimate release. That is the specific outcome spec §2 warns
// about, because an alert that cries wolf on every normal release trains
// everyone to ignore the one that matters.
//
// It cannot be checked by parsing real rows, because there are none yet and
// there will not be until the first upload. It CAN be checked by taking the
// scaffold's own worked EXAMPLE row, which is written in the format a real
// row must follow, and reading it as if it were real.

const REAL_LOG_PATH = join(here, '..', '..', '..', 'packages', 'extension', 'docs', 'publish-log.md');
const realLog = readFileSync(REAL_LOG_PATH, 'utf8');

const realRows = parsePublishLog(realLog);

{
    // De-EXAMPLE the scaffold row: same table, same columns, values the
    // parser is not told to skip. It must then parse as one row MORE than
    // the file already yields, with every field landing in the right
    // column.
    //
    // Relative, not absolute. An earlier cut asserted "exactly one row"
    // and a mutation caught what that really meant: the day the first real
    // publish appends its row, the count becomes two and this check fails
    // on the legitimate path. A gate that goes red the first time the
    // ceremony succeeds is a gate someone deletes, and they would be right.
    //
    // The sentinel values must not contain "example", which is the very
    // thing the parser is told to skip.
    const SENTINEL_VERSION = '9.9.9';
    const SENTINEL_OPERATOR = 'shape-check';

    if (/0\.0\.0-EXAMPLE/.test(realLog)) {
        const asReal = realLog
            .replace(/0\.0\.0-EXAMPLE/g, SENTINEL_VERSION)
            .replace(/EXAMPLE-operator \(not a real entry\)/g, SENTINEL_OPERATOR);

        const shapeRows = parsePublishLog(asReal);
        assert.equal(shapeRows.length, realRows.length + 1,
            `the worked EXAMPLE row in ${REAL_LOG_PATH} does not parse as a row when read as a real entry `
            + `(expected ${realRows.length + 1} rows, got ${shapeRows.length}). The monitor reads this exact `
            + 'table. If its shape has drifted from the parser, a legitimate release reads as a rogue '
            + 'publish, which is the false alarm spec §2 says must never happen.');

        const row = shapeRows.find((r) => r.version === SENTINEL_VERSION);
        assert.ok(row, 'the de-EXAMPLEd scaffold row is not among the parsed rows');
        assert.match(row.sha256, /^`?[0-9a-f]{64}`?$/,
            'column 2 of the real table is a 64-hex sha256 (backticks allowed, the file uses code formatting)');
        assert.ok(['main', 'beta'].includes(row.item),
            `column 3 of the real table is the item, expected main or beta, got "${row.item}"`);
        assert.equal(row.operator, SENTINEL_OPERATOR, 'column 4 of the real table is the operator');
        assert.match(row.date, /^\d{4}-\d{2}-\d{2}$/, 'column 5 of the real table is an ISO date');
    } else {
        // The scaffold row is how the table's shape stays checkable before
        // any real publish exists. Once it is gone, real rows have to be
        // carrying that job, or nothing is.
        assert.ok(realRows.length > 0,
            `${REAL_LOG_PATH} no longer contains the worked EXAMPLE row AND parses no real rows, so nothing `
            + 'verifies that its table is still a shape the monitor can read. Restore the example row or '
            + 'keep the real rows that replaced it.');
    }
}

{
    // The scaffold banner and the contents must agree, in both directions.
    // The day a real row is appended and the header still says no publish
    // has happened, the file lies to whoever is reading it during an
    // incident, which is the only time anyone reads it in a hurry.
    const saysScaffold = /\*\*Status:\*\*\s*SCAFFOLD/i.test(realLog)
        || /No real publish has happened yet/i.test(realLog);

    if (saysScaffold) {
        assert.equal(realRows.length, 0,
            `${REAL_LOG_PATH} still declares itself a SCAFFOLD ("no real publish has happened yet") but `
            + `parses ${realRows.length} real row(s). Update the status block in the same step as the `
            + 'first real row, or the incident runbook points at a file that contradicts itself.');
    } else {
        assert.ok(realRows.length > 0,
            `${REAL_LOG_PATH} has dropped its SCAFFOLD banner but parses no real rows. Either a row was `
            + 'removed (this log is append-only, per spec §2) or the table shape drifted and the parser '
            + 'can no longer see the rows that are there.');
    }

    // Real rows, once they exist, are hand-typed. The parser accepts any
    // five cells, so a typo does not fail here: it produces a row that can
    // never match a live version, which the monitor reports as a rogue
    // publish. Validate them at commit time instead of at 3am.
    for (const r of realRows) {
        assert.match(r.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/,
            `publish-log row has a malformed version "${r.version}". It must match the uploaded `
            + "manifest.json's version exactly, or the monitor can never match it against the live store.");
        assert.match(r.sha256, /^`?[0-9a-f]{64}`?$/,
            `publish-log row for ${r.version} has a malformed zip sha256. It is the only record of WHICH `
            + 'bytes went live, and the post-publish verification is checked against it.');
        assert.ok(['main', 'beta'].includes(r.item),
            `publish-log row for ${r.version} has item "${r.item}", expected main or beta. The monitor `
            + 'matches rows to items by this exact string, so anything else makes the row invisible.');
        assert.ok(r.operator && !/example/i.test(r.operator),
            `publish-log row for ${r.version} has no named operator (spec §6: one named operator per release)`);
        assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/,
            `publish-log row for ${r.version} has a malformed date "${r.date}", expected YYYY-MM-DD`);
    }
}

// ------------------------------------------------------------ Play lane
//
//  row 69. The Play lane's whole contract is the absence LATCH:
// a 404 is normal before the listing exists and an incident after it
// has been seen live even once. The cases below are that distinction
// plus the ways it can be defeated. No version is asserted anywhere,
// because a Play listing page does not carry one (measured; see the
// script header) - if a future change starts reporting a Play version,
// these tests are the thing that should look wrong.

// A page shaped like a real Play listing, matching what was measured
// 2026-08-08 against play.google.com/store/apps/details?id=
// org.thoughtcrime.securesms: og:title carries "<name> - Apps on
// Google Play" and the package name appears in the body.
function playHtml(pkg, name) {
    return `<html><head><meta property="og:title" content="${name} - Apps on Google Play">`
        + `</head><body><c-wiz data-item-id="${pkg}">...</c-wiz></body></html>`;
}

const statePath = join(dir, 'store-monitor-state.json');
const PKG = 'io.xchain.wallet.android';

{
    const live = classifyPlayListingHtml(playHtml(PKG, 'XChain Wallet'), PKG);
    assert.deepEqual(live, { ok: true, title: 'XChain Wallet' }, 'reads the app name off a live listing');
}
{
    // A 200 that never names our package is the shape of a soft-404, a
    // redirect or an interstitial. Arming the latch on it would mean a
    // later real 404 alerts for a listing that was never live.
    const other = classifyPlayListingHtml(playHtml('com.someone.else', 'Some Other App'), PKG);
    assert.equal(other.ok, false, 'a 200 for a different package is not our listing going live');
    assert.match(other.reason, /never names/);
}
{
    const noTitle = classifyPlayListingHtml(`<html><body>${PKG}</body></html>`, PKG);
    assert.equal(noTitle.ok, false, 'the package name alone, with no og:title, is not a confident match');
}

// --- the latch, which is the reason this lane can exist before the listing

{
    // Never seen + absent = the expected pre-publish state, and it must
    // NOT arm the latch: a latch armed here would alert forever.
    const judged = judgePlay({ fetched: { state: 'absent' }, packageName: PKG, firstSeen: null });
    assert.equal(judged.state, 'ok', 'a 404 before the listing has ever been seen is not an alert');
    assert.equal(judged.sawLive, false, 'nothing was seen, so nothing may be latched');
}
{
    // Seen before + absent = the takedown/suspension/unpublish signal.
    const judged = judgePlay({ fetched: { state: 'absent' }, packageName: PKG, firstSeen: '2026-08-08T00:00:00.000Z' });
    assert.equal(judged.state, 'alert', 'a 404 AFTER the listing has been seen live is the incident signal');
    assert.match(judged.detail, /unpublished, suspended or removed/);
}
{
    const judged = judgePlay({
        fetched: { state: 'live', html: playHtml(PKG, 'XChain Wallet') }, packageName: PKG, firstSeen: null,
    });
    assert.equal(judged.state, 'ok');
    assert.equal(judged.sawLive, true, 'a first sighting arms the latch');
    assert.match(judged.detail, /FIRST SIGHTING/);
}
{
    // An unrecognisable page must never be folded into "ok", and must
    // never arm the latch either - same honesty rule as the Chrome lane.
    const judged = judgePlay({
        fetched: { state: 'inconclusive', reason: 'HTTP 503 fetching the Play listing' },
        packageName: PKG, firstSeen: '2026-08-08T00:00:00.000Z',
    });
    assert.equal(judged.state, 'inconclusive', 'a 503 is not a takedown and is not clean either');
    assert.equal(judged.sawLive, false);
}

// --- persistence: the latch survives a run, and refuses to be guessed past

{
    const fresh = readState(join(dir, 'does-not-exist.json'));
    assert.deepEqual(fresh, { firstSeen: null, lastSeen: null }, 'a missing latch means "never seen"');
}
{
    writeFileSync(statePath, 'not json{');
    assert.throws(() => readState(statePath), /JSON/,
        'a corrupt latch throws rather than silently reading as "never seen", which would disarm it');
    rmSync(statePath, { force: true });
}
{
    writeState(statePath, { firstSeen: '2026-08-08T00:00:00.000Z', lastSeen: '2026-08-08T01:00:00.000Z' });
    assert.deepEqual(readState(statePath), {
        firstSeen: '2026-08-08T00:00:00.000Z', lastSeen: '2026-08-08T01:00:00.000Z',
    }, 'the latch round-trips');
    rmSync(statePath, { force: true });
}

// --- end to end through run(), the way cron sees it

{
    const first = await run({
        argv: ['--no-chrome', '--state', statePath],
        env: {},
        fetchImpl: fakeFetch({ 'play.google.com': () => ok(playHtml(PKG, 'XChain Wallet')) }),
    });
    assert.equal(first.exitCode, 0, 'a live listing is clean');
    assert.match(first.stdout, /FIRST SIGHTING/);
    assert.ok(!/version=/.test(first.stdout), 'the Play lane must not print a version column');

    // Same state file, listing now gone: this is the transition the lane exists for.
    const after = await run({
        argv: ['--no-chrome', '--state', statePath],
        env: {},
        fetchImpl: fakeFetch({ 'play.google.com': () => ok('gone', 404) }),
    });
    assert.equal(after.exitCode, 1, 'the listing disappearing after a sighting is an ALERT');
    assert.match(after.stderr, /PLAY LISTING INCIDENT SIGNAL/);
    rmSync(statePath, { force: true });
}
{
    // Disabling both lanes must not look like a clean run.
    const none = await run({ argv: ['--no-chrome', '--no-play'], env: {} });
    assert.equal(none.exitCode, 2, 'a run that checked nothing is a config error, not clean');
}
{
    // The Chrome contract is unchanged: no item id is still a hard config
    // error - but it must now also say the Play lane did not run, so an
    // operator cannot read it as "the Android listing is being watched".
    const unset = await run({ argv: [], env: {} });
    assert.equal(unset.exitCode, 2);
    assert.match(unset.stderr, /--no-chrome/,
        'the config error must name the way to run the Play lane on its own');
}

rmSync(dir, { recursive: true, force: true });
console.log('store-version-monitor.smoke.js: ok (including the parser against the real publish-log.md, '
    + 'and the Play absence latch)');
