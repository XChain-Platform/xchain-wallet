// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// tools/release/verify-demo-endpoints.mjs - the pre-submission gate from
//  §2.1: can a store REVIEWER, on a network we have never seen, reach
// the endpoints the scripted demo walks them through?
//
// WHY THIS EXISTS. App Review cannot reach regtest, so the review notes send
// the reviewer to the public testnet endpoints named in
// packages/core/src/registry/descriptors/. The first time anyone health-checked
// those, on 2026-08-01, EVERY host in the xchain.io zone answered 403 to a
// plain HTTP client: Cloudflare's Super Bot Fight Mode was blocking anything
// that did not fingerprint as a browser. A reviewer following the demo would
// have opened a wallet that could not load a balance, which is a functionality
// rejection and arguably the 4.2 "just a website in a wrapper" rejection §2.1
// exists to prevent. It had also been silently breaking the published SDK and
// the MCP server for who knows how long., fixed the same day.
//
// No test could have caught it and none can: every suite in this repo either
// stubs the network or runs against regtest, and the wallet's own CI runs from
// hosts that are on an allowlist. The only way to ask the question is to ask
// it, from outside, with a plain client. Hence a script rather than a suite,
// and hence NO custom User-Agent: looking like a browser would defeat the
// entire point.
//
// WHAT IT PROBES, and why each is more than a status code. A 200 that carries
// a broken service is the failure a reviewer actually hits.
//
//   - hub      /api/v1/chain-registry, and the Ed25519 signature is VERIFIED
//              against the pinned federation key. The wallet refuses an
//              unsigned or mis-signed snapshot, so a hub serving one is down
//              as far as the demo is concerned even at HTTP 200.
//   - explorer /{COIN}/api/status, and the demo's own coin must appear in the
//              `available` map. An explorer that is up but no longer serves
//              TBTC leaves the reviewer on an empty balance screen.
//   - encoder  /{COIN}/status, and `status` must be healthy with its UTXO
//              tracker reachable AND synced. A desynced tracker composes
//              transactions against a stale chain view, which is exactly the
//              airplane-mode signing step the demo asks the reviewer to
//              perform.
//
// The endpoint list is DERIVED from the descriptors, never restated here: the
// reviewer reaches whatever the shipped build resolves, so a moved host or a
// new chain has to change this gate without anyone remembering to.
//
// FOUR OUTCOMES, KEPT APART, same rule as verify-privacy-url.mjs and
// store-version-monitor.mjs: a check that cannot tell must say so rather than
// fold into a pass. The difference here is which side 403 lands on. That
// script treats 403 as inconclusive because Cloudflare used to answer plain
// tooling that way on every path. Since it does not, so a 403 on
// these hosts now means the block is BACK, and back is the regression this
// gate exists for. It is a failure, and it says so by name.
//
// Usage:
//   node tools/release/verify-demo-endpoints.mjs
//   node tools/release/verify-demo-endpoints.mjs --network mainnet
//   node tools/release/verify-demo-endpoints.mjs --burst 8
//   node tools/release/verify-demo-endpoints.mjs --json

import { BUNDLED_DESCRIPTORS } from '../../packages/core/src/registry/descriptors/index.js';
import { explorerCoinCode } from '../../packages/core/src/registry/coinTicker.js';
import { verifyChainRegistry } from '../../packages/core/src/registry/remote.js';

export const EXIT = { LIVE: 0, FAILURE: 1, CONFIG: 2, INCONCLUSIVE: 3 };

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Probe list for one network kind, derived from the shipped descriptors.
 *
 * Deduplicated by URL: all three chains point their explorer at one host, and
 * probing it three times would report one outage as three.
 *
 * @param {string} networkKind
 * @param {readonly object[]} [descriptors]
 * @returns {{ service: string, coin: string, url: string }[]}
 */
export function demoProbesFor(networkKind = 'testnet', descriptors = BUNDLED_DESCRIPTORS) {
    const probes = [];
    const seen = new Set();
    const add = (service, coin, url) => {
        if (seen.has(url)) return;
        seen.add(url);
        probes.push({ service, coin, url });
    };

    for (const d of descriptors) {
        if (d.networkKind !== networkKind) continue;
        const coin = explorerCoinCode(d);
        // The hub's registry route is origin-level and carries no coin, unlike
        // the per-coin URL the descriptor names for everything else.
        add('hub', coin, new URL('/api/v1/chain-registry', d.hub.defaultUrl).href);
        add('explorer', coin, `${trimSlash(d.explorer.defaultUrl)}/${coin}/api/status`);
        add('encoder', coin, `${trimSlash(d.encoder.defaultUrl)}/status`);
    }
    return probes;
}

function trimSlash(url) {
    return String(url).replace(/\/+$/, '');
}

/**
 * Turn one probe's raw outcome into a verdict.
 *
 * Split out from the fetching so every branch is reachable from a test without
 * a network: the branches that matter most are the ones that only happen when
 * production is broken.
 *
 * @param {{ service: string, coin: string }} probe
 * @param {{ status?: number, body?: string, error?: string }} raw
 * @returns {{ state: 'live' | 'failure' | 'inconclusive', detail: string }}
 */
export function classifyProbe(probe, raw) {
    if (raw.error) {
        return { state: 'inconclusive', detail: `could not reach it: ${raw.error}` };
    }
    if (raw.status === 403) {
        return {
            state: 'failure',
            detail: '403 to a plain client: the edge is blocking non-browser traffic again'
                + ' . A reviewer would see a wallet that cannot load a balance.',
        };
    }
    if (raw.status === 429) {
        return {
            state: 'failure',
            detail: '429 rate limited: this host is no longer covered by the zone rate-limit skip'
                + ' , and the configured limits are far below one wallet cold-open.',
        };
    }
    if (typeof raw.status !== 'number' || raw.status < 200 || raw.status >= 300) {
        return { state: 'failure', detail: `HTTP ${raw.status}` };
    }

    let json;
    try {
        json = JSON.parse(raw.body ?? '');
    } catch {
        // An HTML body on a 200 is the signature of a proxy or error page
        // standing in for the service, which is a failure that reads as health.
        return { state: 'failure', detail: '200 but the body is not JSON (a proxy or error page is answering)' };
    }

    if (probe.service === 'hub') {
        const verdict = verifyChainRegistry(json);
        if (!verdict.ok) {
            return { state: 'failure', detail: `chain-registry does not verify: ${verdict.reason}` };
        }
        return { state: 'live', detail: `signed registry, ${json.descriptors.length} descriptors, generated ${json.generatedAt}` };
    }

    if (probe.service === 'explorer') {
        const available = json?.available;
        if (!available || typeof available !== 'object') {
            return { state: 'failure', detail: '200 but the status body names no available networks' };
        }
        if (!Object.prototype.hasOwnProperty.call(available, probe.coin)) {
            return {
                state: 'failure',
                detail: `up, but ${probe.coin} is not among the networks it serves`
                    + ` (${Object.keys(available).join(', ') || 'none'}): the demo's balance screen would be empty`,
            };
        }
        return { state: 'live', detail: `serving ${probe.coin} (${Object.keys(available).length} networks)` };
    }

    if (probe.service === 'encoder') {
        if (json?.status !== 'healthy') {
            return { state: 'failure', detail: `status is ${JSON.stringify(json?.status)}, not healthy` };
        }
        if (json.tracker_reachable === false) {
            return { state: 'failure', detail: 'healthy, but its UTXO tracker is unreachable: nothing can be composed' };
        }
        if (json.tracker_synced === false) {
            return {
                state: 'failure',
                detail: `healthy, but its UTXO tracker is not synced (lag ${json.tracker_lag ?? '?'}):`
                    + ' the demo would compose against a stale chain view',
            };
        }
        return { state: 'live', detail: `healthy, tracker synced (lag ${json.tracker_lag ?? 0})` };
    }

    return { state: 'inconclusive', detail: `no check defined for service "${probe.service}"` };
}

/**
 * Fetch one probe. Never throws; a transport failure comes back as `error` so
 * the caller can keep it out of the pass/fail axis entirely.
 */
export async function probeOnce(url, { fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        // No User-Agent override on purpose: this must look like the plain
        // client a reviewer's device is not, and an allowlist is not.
        const res = await fetchImpl(url, {
            method: 'GET',
            headers: { accept: 'application/json' },
            redirect: 'follow',
            signal: controller.signal,
        });
        return { status: res.status, body: await res.text() };
    } catch (e) {
        return { error: e?.name === 'AbortError' ? `timed out after ${timeoutMs}ms` : (e?.message ?? String(e)) };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Run the whole gate.
 *
 * @returns {Promise<{ exit: number, results: object[], burst?: object }>}
 */
export async function checkDemoEndpoints({
    networkKind = 'testnet',
    descriptors = BUNDLED_DESCRIPTORS,
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    burst = 0,
} = {}) {
    const probes = demoProbesFor(networkKind, descriptors);
    if (probes.length === 0) {
        return { exit: EXIT.CONFIG, results: [], reason: `no descriptors for network kind "${networkKind}"` };
    }

    const results = [];
    for (const probe of probes) {
        const raw = await probeOnce(probe.url, { fetchImpl, timeoutMs });
        results.push({ ...probe, ...classifyProbe(probe, raw) });
    }

    let burstResult;
    if (burst > 0) {
        burstResult = await burstProbe(probes, { fetchImpl, timeoutMs, count: burst });
        if (burstResult.blocked > 0) {
            results.push({
                service: 'rate-limit',
                coin: '-',
                url: burstResult.url,
                state: 'failure',
                detail: `${burstResult.blocked}/${burst} rapid requests came back ${burstResult.statuses.join('/')}:`
                    + ' a wallet cold-open fans out more than this per address ',
            });
        }
    }

    const exit = results.some((r) => r.state === 'failure') ? EXIT.FAILURE
        : results.some((r) => r.state === 'inconclusive') ? EXIT.INCONCLUSIVE
            : EXIT.LIVE;
    return { exit, results, burst: burstResult };
}

/**
 * Fire a small burst at one endpoint, because one request per host cannot see
 * a rate limit and a wallet opening on three chains is not one request.
 * Deliberately bounded and opt-in: this points at production.
 */
export async function burstProbe(probes, { fetchImpl, timeoutMs, count }) {
    const target = probes.find((p) => p.service === 'explorer') ?? probes[0];
    const replies = await Promise.all(
        Array.from({ length: count }, () => probeOnce(target.url, { fetchImpl, timeoutMs })),
    );
    const statuses = [...new Set(replies.map((r) => r.error ? 'error' : String(r.status)))];
    const blocked = replies.filter((r) => r.status === 429 || r.status === 403).length;
    return { url: target.url, count, blocked, statuses };
}

const USAGE = `verify-demo-endpoints.mjs - can a reviewer following the scripted demo
actually reach everything it needs? ( §2.1 pre-submission gate.)

Usage:
  node tools/release/verify-demo-endpoints.mjs [--network <kind>] [--burst [n]] [--json]

Options:
  --network <kind>  network to probe, default testnet
  --burst [n]       also fire a small burst at one endpoint, default 8.
                    Opt-in because it points at PRODUCTION: one request per
                    host cannot see a rate limit, and a wallet opening on
                    three chains is not one request.
  --json            machine-readable result instead of the table
  -h, --help        print this and exit 0

PROBES LIVE HOSTS. That is why --help is answered before the probes rather
than after them .

Exit codes:
  0  live          every demo endpoint reachable from a plain client
  1  failure       DO NOT SUBMIT; a reviewer would hit this
  2  config        a configuration problem, not a reachability one
  3  inconclusive  something could not be reached. NOT a pass.
`;

function parseArgs(argv) {
    const args = { networkKind: 'testnet', burst: 0, json: false, help: false };
    for (let i = 0; i < argv.length; i += 1) {
        if (argv[i] === '--network') args.networkKind = argv[i + 1];
        else if (argv[i] === '--burst') args.burst = Number(argv[i + 1] ?? 8) || 8;
        else if (argv[i] === '--json') args.json = true;
        else if (argv[i] === '--help' || argv[i] === '-h') args.help = true;
    }
    return args;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        process.stdout.write(USAGE);
        return EXIT.LIVE;
    }
    const outcome = await checkDemoEndpoints(args);

    if (args.json) {
        console.log(JSON.stringify(outcome, null, 2));
        return outcome.exit;
    }

    console.log(`Demo-path endpoints, ${args.networkKind} ( §2.1 pre-submission gate)\n`);
    for (const r of outcome.results) {
        const mark = r.state === 'live' ? 'OK  ' : r.state === 'failure' ? 'FAIL' : '??  ';
        console.log(`${mark} ${r.service.padEnd(10)} ${r.url}`);
        console.log(`       ${r.detail}`);
    }
    console.log();
    if (outcome.exit === EXIT.LIVE) {
        console.log('All demo endpoints reachable from a plain client. Announce the submission window'
            + ' in the ledger so a concurrent session knows a review may be in flight.');
    } else if (outcome.exit === EXIT.FAILURE) {
        console.log('DO NOT SUBMIT. A reviewer following the scripted demo would hit this.');
    } else if (outcome.exit === EXIT.CONFIG) {
        console.log(`Configuration problem: ${outcome.reason}`);
    } else {
        console.log('INCONCLUSIVE: something could not be reached. This is not a pass; re-run from'
            + ' a network you trust before deciding.');
    }
    return outcome.exit;
}

if (process.argv[1] && process.argv[1].endsWith('verify-demo-endpoints.mjs')) {
    process.exitCode = await main();
}
