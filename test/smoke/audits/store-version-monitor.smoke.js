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
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
    checkItem,
    extractVersionFromListingHtml,
    parsePublishLog,
    run,
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
        argv: [],
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
        argv: [],
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
        argv: [],
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
        argv: [],
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
        argv: [],
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
        argv: ['--main-id', 'aaaa', '--log', logPath],
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

rmSync(dir, { recursive: true, force: true });
console.log('store-version-monitor.smoke.js: ok');
