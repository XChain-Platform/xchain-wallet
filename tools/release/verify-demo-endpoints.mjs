// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// tools/release/verify-demo-endpoints.mjs - the pre-submission gate asking:
// can a store REVIEWER, on a network we have never seen, reach
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
// the MCP server for who knows how long. It was fixed the same day.
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
//   - hub-rpc  the JSON-RPC root, probed with a POST, because that is the only
//              verb it answers. Its GET is a different resource entirely - the
//              static landing page the vhost serves from DocumentRoot - and
//              reading a POST-only surface's CORS posture off that page is how
//              this gate spent 2026-08-08 reporting the hub unreachable while
//              every request the wallet issues to it worked. The call is
//              `ping`, the same method `sdk.pingHub()` sends from the wallet's
//              own reachability check (§49.1), so a pass means the reviewer's
//              app can talk to the hub rather than that some other method can.
//   - explorer /{COIN}/api/status, and the demo's own coin must appear in the
//              `available` map. An explorer that is up but no longer serves
//              TBTC leaves the reviewer on an empty balance screen. Serving it
//              is not enough either: the coin's INDEXER must be current, or the
//              balance screen is served from a stale view and a funding
//              transaction sent for the rehearsal never appears. Measured
//              2026-08-06, this gate reported all three testnet chains live
//              while TDOGE's indexer trailed its decoder by 756,703 blocks and
//              its newest indexed block was 32 days old, and TLTC's newest was
//              1.6 days old. Only the DEMO coin is fatal (below); the others
//              are reported, because the demo runs on one chain and a stale
//              chain nobody funds is information, not a blocker.
//   - encoder  /{COIN}/status, and `status` must be healthy with its UTXO
//              tracker reachable AND synced. A desynced tracker composes
//              transactions against a stale chain view, which is exactly the
//              airplane-mode signing step the demo asks the reviewer to
//              perform.
//
// AND, on every probe, whether the response is READABLE from the origin the
// store build sends. This half was missing until 2026-08-07 and it is the one
// that mattered most. Everything above asks "is the service up", answered from
// a terminal; the shipped app is a WebView whose only HTTP path is `fetch`,
// because the §4 SSC-1 hardening blocks Capacitor's native-HTTP interceptor. So
// a service can be perfectly healthy, answer this gate 200, and be unusable by
// the app. Measured that day: this gate exited 0 while the encoder and the hub
// served no Access-Control-Allow-Origin on any path, so a reviewer following
// the scripted demo could read a balance and could not send - the failure the
// gate exists to prevent, sitting inside a green run. A blocked origin is now a
// FAILURE, named as UNREACHABLE FROM THE APP so it cannot be read as a warning.
//
// AND, for the two endpoints whose load-bearing call is a POST (the encoder's
// create_tx and the hub's JSON-RPC surface), whether a browser would even be
// ALLOWED to issue that POST. Every other probe is a GET, and a GET is
// CORS-simple: it never triggers a preflight, so none of it can see an edge
// that blocks the one request a browser actually sends before a POST - the
// OPTIONS with Access-Control-Request-Method. Measured 2026-08-07: the hub's
// JSON-RPC route answers a plain GET with a real Access-Control-Allow-Origin
// AND answers `POST` itself with one too, while its preflight OPTIONS comes
// back HTTP 200 with no access-control-* header at all (the Apache vhost
// proxies `%{REQUEST_METHOD} =POST` only, so the preflight never reaches the
// app behind it). A browser that receives that OPTIONS reply never sends the
// POST - create_tx and the hub's writes are unreachable from the app even
// though the GET probe above, and a plain POST from curl, both come back
// healthy. The preflight is issued at the exact path the SDK's POST hits
// (trailing slash included; the un-slashed path is a different, unproxied
// route on these hosts), and a blocked preflight is FATAL for the same reason
// a blocked GET is: UNREACHABLE FROM THE APP, because the browser never sends
// the POST at all.
//
// The endpoint list is DERIVED from the descriptors, never restated here: the
// reviewer reaches whatever the shipped build resolves, so a moved host or a
// new chain has to change this gate without anyone remembering to.
//
// FOUR OUTCOMES, KEPT APART, same rule as verify-privacy-url.mjs and
// store-version-monitor.mjs: a check that cannot tell must say so rather than
// fold into a pass. The difference here is which side 403 lands on. That
// script treats 403 as inconclusive because Cloudflare used to answer plain
// tooling that way on every path. Since the fix it does not, so a 403 on
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

// registry/remote.js is the only import here that reaches node_modules
// (@noble/curves, for the registry signature), and it is loaded dynamically
// for a reason about WHERE this tool gets typed rather than about cost.
//
// An ES module's static imports are evaluated before any
// top-level statement in the file, so the --help handling below cannot run
// at all in a tree without dependencies installed. The process dies on the
// import with a module-not-found stack trace, which is exactly the "a tool
// answering how-do-I-use-you with its own failure vocabulary" the ceremony
// gate's §13 forbids - and §13 could not see it, because CI and every
// developer machine have node_modules. The tree that does not is the
// pristine clone the release ceremony mandates.
//
// The failure is not swallowed, only moved to the one probe that needs it:
// the hub's registry verdict. The probe table, the HTTP classification and
// --help all work with no dependencies at all, and the hub probe says what
// is missing rather than pretending the registry verified.
let verifyChainRegistry;
try {
    ({ verifyChainRegistry } = await import('../../packages/core/src/registry/remote.js'));
} catch (err) {
    verifyChainRegistry = () => {
        throw new Error('the chain-registry verifier could not be loaded in this tree '
            + `(${err.message}). Run "pnpm install" and re-run; --help and the probe table `
            + 'work without it, but the hub probe cannot be classified honestly.');
    };
}

export const EXIT = { LIVE: 0, FAILURE: 1, CONFIG: 2, INCONCLUSIVE: 3 };

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * The Origin a store build actually sends, and it is not the obvious one.
 *
 * packages/mobile/capacitor.config.json sets `androidScheme: "https"` and
 * declares NO `iosScheme`, so the two mobile shells do not share an origin:
 * iOS falls to Capacitor's default `capacitor://localhost` while Android sends
 * `https://localhost`. iOS is the default here because this is the iOS
 * submission gate; `--origin` re-points it at another shell.
 *
 * This matters because the store build has no way around CORS. The §4 SSC-1
 * hardening compiles a WKContentRuleList into the app that blocks Capacitor's
 * native-HTTP interceptor, so every call the wallet makes is a WebView fetch.
 * A service that answers 200 to curl and serves no Access-Control-Allow-Origin
 * is, to the shipped app, down.
 */
const SHELL_ORIGIN = 'capacitor://localhost';

/**
 * The Access-Control-Allow-Origin classification, shared by the GET-reply
 * check (corsVerdict) and the preflight check (preflightVerdict) below: same
 * header, same rule, matched against a value that may be genuinely absent
 * (`null`, a real response) or unreadable at all (`undefined`, an offline
 * fixture) - see probeOnce()'s comment for why those two must not collapse.
 */
function acaoVerdict(acao, origin) {
    if (acao === undefined) {
        return { state: 'unknown', detail: 'the response carried no readable headers, so its CORS posture could not be checked' };
    }
    if (acao === '*' || (acao && acao === origin)) {
        return { state: 'ok', detail: `Access-Control-Allow-Origin: ${acao}` };
    }
    if (acao === null) {
        return {
            state: 'blocked',
            detail: 'it serves no Access-Control-Allow-Origin, so a browser-based shell cannot read the'
                + ' response at all - the request is made and the answer is thrown away',
        };
    }
    // A comma-joined value looks configured and is accepted by nothing. Named
    // separately because the remedy is different: the service needs an
    // allowlist matched per-origin, not a wider string.
    if (acao.includes(',')) {
        return {
            state: 'blocked',
            detail: `Access-Control-Allow-Origin names several origins ("${acao}"), which every browser`
                + ' rejects: the service must match one origin per request, not echo a comma-joined list',
        };
    }
    return {
        state: 'blocked',
        detail: `Access-Control-Allow-Origin is "${acao}", which does not permit ${origin}`,
    };
}

/**
 * Would a browser at the probed origin be allowed to READ this response?
 *
 * Kept apart from the service checks on purpose: reachability and health are
 * different questions, and conflating them is what let the encoder and hub sit
 * "healthy" in this gate's own output while the app could not call them.
 */
export function corsVerdict(raw) {
    if (raw?.error || typeof raw?.status !== 'number') {
        return { state: 'unknown', detail: 'no response to read CORS from' };
    }
    return acaoVerdict(raw.acao, raw.origin);
}

/**
 * Would a browser at the probed origin be allowed to SEND the POST at all?
 *
 * A GET is CORS-simple and never provokes a preflight, so corsVerdict() above
 * is structurally blind to an edge that answers the OPTIONS wrong: it only ever
 * sees the GET's own reply. Measured 2026-08-07, this is not hypothetical - the
 * hub's JSON-RPC route passes corsVerdict() on its GET (and answers a plain
 * POST with a real ACAO too) while its OPTIONS preflight comes back HTTP 200
 * with no access-control-* header at all, because the Apache vhost proxies
 * `%{REQUEST_METHOD} =POST` only and the preflight never reaches the app. A
 * browser that receives that OPTIONS reply never issues the POST, full stop -
 * the ACAO on the POST's own reply is never seen because the POST is never
 * sent. A pass requires BOTH the same origin-matching ACAO as a GET, and an
 * Access-Control-Allow-Methods naming POST; either missing means the browser
 * stops at the preflight.
 */
export function preflightVerdict(raw) {
    if (raw?.error || typeof raw?.status !== 'number') {
        return { state: 'unknown', detail: 'no response to read the preflight from' };
    }
    const { origin, allowMethods } = raw;
    const acao = acaoVerdict(raw.acao, origin);
    if (acao.state !== 'ok') return acao;
    if (allowMethods === undefined) {
        return { state: 'unknown', detail: 'the preflight reply carried no readable headers, so its allowed methods could not be checked' };
    }
    const methods = allowMethods === null ? [] : allowMethods.split(',').map((m) => m.trim().toUpperCase());
    if (!methods.includes('POST')) {
        return {
            state: 'blocked',
            detail: `the preflight's Access-Control-Allow-Methods is ${JSON.stringify(allowMethods)}, which does not name POST`,
        };
    }
    return { state: 'ok', detail: `preflight permits POST from ${origin} (${acao.detail}, Allow-Methods: ${allowMethods})` };
}

/**
 * Fold the CORS verdict into the service verdict. A service that is healthy but
 * unreachable from the app is a FAILURE for this gate's purpose, because the
 * gate's question is whether the reviewer's demo can be performed.
 */
function withCors(verdict, cors) {
    if (cors.state !== 'blocked') return verdict;
    return {
        state: 'failure',
        detail: `${verdict.detail} - but UNREACHABLE FROM THE APP: ${cors.detail}`,
    };
}

/**
 * Fold the preflight verdict into the service verdict, same shape as
 * withCors() above and for the same reason: a blocked preflight means the
 * browser never sends the POST at all, which is a FAILURE, not a warning.
 */
function withPreflight(verdict, preflight) {
    if (preflight.state !== 'blocked') return verdict;
    // The GET-CORS fold above may already have failed this same probe (an
    // encoder can serve no ACAO on both its GET and its OPTIONS at once).
    // Named differently in that case so the detail reads as one host with two
    // problems rather than repeating the same headline twice.
    if (verdict.state === 'failure') {
        // Only carry the preflight's own reason when it differs from the GET's.
        // When one Apache rule blocks both, the two reasons are the same
        // sentence and appending it verbatim prints the explanation twice.
        const alsoWhy = verdict.detail.includes(preflight.detail) ? '' : `: ${preflight.detail}`;
        return {
            state: 'failure',
            detail: `${verdict.detail} - and the preflight is ALSO blocked, so the browser never sends the POST`
                + ` at all either${alsoWhy}`,
        };
    }
    return {
        state: 'failure',
        detail: `${verdict.detail} - but UNREACHABLE FROM THE APP: the preflight is blocked, so the browser never`
            + ` sends the POST at all - ${preflight.detail}`,
    };
}

/**
 * The one chain the scripted demo is funded on.
 *
 * STATED rather than derived, unlike the endpoint list, because which chain the
 * reviewer's demo wallet holds coin on is a listing decision and not a fact any
 * descriptor carries. It is TBTC because §2.1 already names the TBTC encoder
 * and hub as the demo endpoints, and because it is the only testnet chain whose
 * indexer was current when this was measured. The runbook cites this constant
 * rather than restating it.
 */
export const DEMO_COIN = 'TBTC';

/**
 * Freshness thresholds for the demo coin's indexer.
 *
 * Both are deliberately loose, because a gate that flaps is a gate an operator
 * routes around on submission day. Six hours clears BTC testnet4's documented
 * min-difficulty stalls (~2h) with headroom, and 1,000 blocks clears ordinary
 * churn even on DOGE testnet, which mints blocks many times a minute. What they
 * do not clear is the state actually found in production: 32 days and 756,703
 * blocks.
 */
export const STALE_AFTER_MS = 6 * 60 * 60 * 1000;
export const MAX_INDEXER_LAG_BLOCKS = 1000;

/**
 * The DEMO coin's own lag ceiling, which is tight where the two above are loose.
 *
 * Both thresholds above measure a RATE, and the failure they missed is not a
 * rate: on 2026-08-10 an indexer migration moved every source's consensus hash
 * and each replica fail-closed on the divergence, so TBTC's replica froze at
 * block 147814 while its source ran on to 147854. That reads as `lag 40, newest
 * block 4h old` - inside a 1,000-block allowance and inside a six-hour window -
 * so the gate called the demo chain current for the whole time it was already
 * never going to apply another block.
 *
 * A halt is terminal, not slow, and on a chain minting every ten minutes it
 * hides behind loose rate thresholds for most of a day. What the demo actually
 * needs is stricter and simpler to state: the reviewer's funding transaction
 * lands at the SOURCE's tip, so the demo chain's replica has to BE at that tip,
 * not merely near it. Every healthy chain measured at the same moment sat at
 * lag 0 (BTC, LTC and DOGE mainnet, and TLTC); only the two halted replicas
 * carried a gap. Two blocks is therefore slack for a sample taken mid-apply,
 * not tolerance for a chain that is behind.
 *
 * This catches a frozen replica once its gap opens; it cannot catch a halt
 * whose gap is still inside the slack. That residue is now closed by
 * replicaHaltVerdict() below, which reads the explorer's own replica_halted
 * signal instead of inferring one from a rate.
 */
export const MAX_DEMO_LAG_BLOCKS = 2;

/**
 * How current is one coin's indexed view, per the explorer's own status body.
 *
 * Two independent signals, because they fail apart: `last_block_time` catches a
 * pipeline that has stopped, and `decoder_lag_blocks` (the indexer's distance
 * BEHIND the decoder, per the explorer's own definition) catches one that is
 * running but hopelessly behind. TDOGE showed both at once; a chain whose node
 * has stalled would show only the first.
 *
 * @param {any} json      the explorer's /{COIN}/api/status body
 * @param {string} coin
 * @param {number} nowMs
 * @param {number} maxLagBlocks  ceiling on the indexer's distance behind the
 *                               decoder; the demo coin passes the tighter
 *                               MAX_DEMO_LAG_BLOCKS, everything else the loose one
 * @returns {{ state: 'fresh'|'stale'|'unknown', detail: string }}
 */
export function indexerFreshness(json, coin, nowMs = Date.now(), maxLagBlocks = MAX_INDEXER_LAG_BLOCKS) {
    const blockTimeSec = json?.last_block_time?.[coin];
    const lagBlocks = json?.decoder_lag_blocks?.[coin];
    const haveTime = typeof blockTimeSec === 'number' && Number.isFinite(blockTimeSec);
    const haveLag = typeof lagBlocks === 'number' && Number.isFinite(lagBlocks);

    if (!haveTime && !haveLag) {
        return {
            state: 'unknown',
            detail: `the status body carries no indexer clock for ${coin}`
                + ' (no last_block_time, no decoder_lag_blocks)',
        };
    }

    const reasons = [];
    if (haveTime) {
        const ageMs = nowMs - blockTimeSec * 1000;
        if (ageMs > STALE_AFTER_MS) {
            reasons.push(`its newest indexed block is ${describeAge(ageMs)} old`);
        }
    }
    if (haveLag && lagBlocks > maxLagBlocks) {
        reasons.push(`its indexer trails the decoder by ${lagBlocks.toLocaleString('en-US')} blocks`
            + ` (ceiling ${maxLagBlocks.toLocaleString('en-US')})`);
    }

    if (reasons.length > 0) {
        return { state: 'stale', detail: reasons.join(' and ') };
    }
    const age = haveTime ? describeAge(nowMs - blockTimeSec * 1000) : 'unknown age';
    return { state: 'fresh', detail: `newest indexed block ${age} old, indexer lag ${haveLag ? lagBlocks : '?'}` };
}

/**
 * WHY a coin is missing from `available`, in the explorer's own terms.
 *
 * This exists because the sentence it replaces was a DIAGNOSIS nobody had
 * asked this gate to make. It read "up, but TDOGE is not among the networks it
 * serves", which a reader can only understand as deconfiguration - and on
 * 2026-08-10 a run acted on exactly that reading and went looking for explorer
 * configuration that was never touched. The explorer had all nine networks in
 * `supported` the whole time; it builds `available` by DELETING every coin it
 * has marked stale, so "withdrawn for staleness" and "not served" are the same
 * observation from outside, and only `supported` tells them apart.
 *
 * The rule this encodes is the one this gate keeps re-learning: report what was
 * measured, and name a cause only when the payload carries the evidence for it.
 * An absence with no `supported` map to consult stays an absence.
 *
 * @param {any} json    the explorer's /{COIN}/api/status body
 * @param {string} coin
 * @returns {string}
 */
export function absenceCause(json, coin) {
    const available = json?.available ?? {};
    const served = Object.keys(available).join(', ') || 'none';
    const supported = json?.supported;
    const isSupported = supported && typeof supported === 'object'
        && Object.prototype.hasOwnProperty.call(supported, coin);

    if (!supported || typeof supported !== 'object') {
        // No evidence either way, so no cause is claimed.
        return `up, but ${coin} is absent from the networks it currently serves (${served})`;
    }
    if (isSupported) {
        // The explorer's OWN stale flag decides, not our freshness arithmetic:
        // that flag is what actually drives the deletion from `available`.
        // Freshness only supplies detail, and when it has none this says so
        // rather than inventing one. The first draft of this branch hardcoded
        // "the explorer marked it stale" as its fallback, which reproduced
        // this row's entire defect one level down - and only driving the LIVE
        // payload exposed it, because the sentence appeared for a coin whose
        // `stale` flag was false.
        const flagged = json?.stale?.[coin] === true;
        const why = indexerFreshness(json, coin);
        let because;
        if (why.state === 'stale') because = why.detail;
        else if (flagged) because = 'the explorer marks it stale, without saying why in this body';
        else because = 'its status body gives no reason';
        return `up and CONFIGURED for ${coin}, but currently withdrawn from service: ${because}`
            + ` (serving ${served})`;
    }
    return `up, and ${coin} is not in its configured set at all (serving ${served})`;
}

/**
 * Read the explorer's fail-closed-halt signal for one coin, the fact a lag
 * ceiling can only ever proxy: a replica halted AT its source's tip has no
 * gap to measure until the source mints its next block, and this asks the
 * source of truth instead of inferring one from a rate.
 *
 * @param {any} json    the explorer's /{COIN}/api/status body
 * @param {string} coin
 * @returns {{ state: 'halted'|'ok'|'unknown', detail: string }}
 */
export function replicaHaltVerdict(json, coin) {
    const halted = json?.replica_halted?.[coin];
    if (halted === true) {
        return {
            state: 'halted',
            detail: 'its replica has an active consensus-divergence HALT: it applies no further'
                + ' blocks until an operator intervenes',
        };
    }
    if (halted === false) {
        return { state: 'ok', detail: 'no active replica halt' };
    }
    return {
        state: 'unknown',
        detail: `the status body carries no readable replica_halted signal for ${coin}`
            + ' (absent field, null, or an explorer deployment that predates it)',
    };
}

function describeAge(ms) {
    const minutes = Math.max(0, Math.round(ms / 60_000));
    if (minutes < 90) return `${minutes}m`;
    const hours = Math.round(minutes / 60);
    if (hours < 48) return `${hours}h`;
    return `${Math.round(hours / 24)}d`;
}

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
    const add = (service, coin, url, preflightUrl, postBody) => {
        if (seen.has(url)) return;
        seen.add(url);
        // Only the demo coin's freshness is fatal, so the flag travels with the
        // probe rather than being re-derived inside the classifier, which has
        // no idea which network kind it was built for. `preflightUrl` is set
        // only for the two services whose load-bearing call is a POST; its
        // presence is what tells checkDemoEndpoints() to also issue an OPTIONS.
        // `postBody` goes further: it marks a probe whose MAIN request is a
        // POST, so the run issues that instead of a GET (see checkDemoEndpoints).
        probes.push({
            service, coin, url, isDemoCoin: coin === DEMO_COIN,
            ...(preflightUrl ? { preflightUrl } : {}),
            ...(postBody ? { postBody } : {}),
        });
    };

    for (const d of descriptors) {
        if (d.networkKind !== networkKind) continue;
        const coin = explorerCoinCode(d);
        // The hub's registry route is origin-level and carries no coin, unlike
        // the per-coin URL the descriptor names for everything else.
        add('hub', coin, new URL('/api/v1/chain-registry', d.hub.defaultUrl).href);
        // The registry route above is the hub's ONE annotated cross-origin
        // exception (it sets ACAO: * explicitly), so probing only that route
        // reports the hub reachable while the JSON-RPC surface the wallet also
        // needs - getAllConfig, service-endpoint discovery, capability
        // thresholds - is closed. That is the same trap this file just fixed,
        // one level in: a green signal for the relationship it measures and no
        // other. Mounted at the origin root (`app.use(jsonRouter(...))`), and
        // it is POST-only for the calls that matter, so the preflight is
        // issued at this same root - there is no separate JSON-RPC path.
        //
        // Probed with a POST rather than a GET, and that is the whole of row
        // 72. A GET of this root is answered by the vhost's DocumentRoot with
        // a static HTML landing page - a different resource, which naturally
        // carries no Access-Control-Allow-Origin - so a CORS verdict taken
        // from it says nothing about the JSON-RPC surface. It said something
        // false: on 2026-08-08, with the preflight repaired and every call the
        // wallet makes working, this gate still reported the hub unreachable
        // from the app because it was reading the landing page's headers.
        // `ping` is the method the wallet's own reachability check sends
        // (sdk.pingHub() -> POST {method:'ping'}), so the probe stands in for
        // a call the app actually makes. NOT `getallconfigs`: that one is the
        // hub's one sensitive read (it returns every service's DB credentials)
        // and answers 401 to any client without HUB_API_KEY, which the shipped
        // wallet correctly does not carry - a red gate for working-as-designed.
        const hubRpcUrl = new URL('/', d.hub.defaultUrl).href;
        add('hub-rpc', coin, hubRpcUrl, hubRpcUrl, { jsonrpc: '2.0', id: 1, method: 'ping', params: [] });
        add('explorer', coin, `${trimSlash(d.explorer.defaultUrl)}/${coin}/api/status`);
        // The encoder's create_tx call is POST '/' against an axios client
        // whose baseURL is the descriptor's URL, and axios's combineURLs joins
        // that into a TRAILING-SLASHED path. The Apache vhost proxies
        // `/<COIN>/` and does not proxy the un-slashed `/<COIN>` (that one is
        // served from DocumentRoot, a different route entirely) - so the
        // preflight has to target the exact slashed path the SDK calls, not
        // the `/status` health path this probe already uses for its GET.
        const encoderBase = trimSlash(d.encoder.defaultUrl);
        add('encoder', coin, `${encoderBase}/status`, `${encoderBase}/`);
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
export function classifyProbe(probe, raw, { nowMs = Date.now() } = {}) {
    if (raw.error) {
        return { state: 'inconclusive', detail: `could not reach it: ${raw.error}` };
    }
    // Handled before the status ladder below because this reply came from a
    // POST, not a GET, and its failure vocabulary has to say so: an operator
    // reading "HTTP 404" here would otherwise go looking at the landing page
    // this probe deliberately no longer touches.
    if (probe.service === 'hub-rpc') {
        if (typeof raw.status !== 'number' || raw.status < 200 || raw.status >= 300) {
            return {
                state: 'failure',
                detail: `the JSON-RPC surface answered HTTP ${raw.status} to the same ping POST the wallet's`
                    + ' reachability check sends, so the app cannot see the hub as up',
            };
        }
        let rpc;
        try {
            rpc = JSON.parse(raw.body ?? '');
        } catch {
            // An HTML body on a 200 here means the POST was answered by the
            // vhost's static root rather than proxied to the app - the shape
            // row 70 fixed for OPTIONS, one verb over.
            return { state: 'failure', detail: '200 to the ping POST but the body is not JSON (the vhost answered it, not the hub)' };
        }
        if (rpc?.error) {
            return { state: 'failure', detail: `the hub refused the ping: ${JSON.stringify(rpc.error)}` };
        }
        if (!rpc?.result) {
            return { state: 'failure', detail: 'the ping POST came back without a JSON-RPC result member' };
        }
        return {
            state: 'live',
            detail: `JSON-RPC ping answered ${JSON.stringify(rpc.result)} (POST, the only verb this surface answers)`,
        };
    }
    if (raw.status === 403) {
        return {
            state: 'failure',
            detail: '403 to a plain client: the edge is blocking non-browser traffic again'
                + '. A reviewer would see a wallet that cannot load a balance.',
        };
    }
    if (raw.status === 429) {
        return {
            state: 'failure',
            detail: '429 rate limited: this host is no longer covered by the zone rate-limit skip'
                + ', and the configured limits are far below one wallet cold-open.',
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
                detail: `${absenceCause(json, probe.coin)}: the demo's balance screen would be empty`,
            };
        }

        // Serving the coin and serving it CURRENTLY are different questions,
        // and only the second one answers "will the demo wallet's balance be
        // there". Fatal on the demo coin only: the rehearsal is funded on one
        // chain, so a stale chain nobody funds is a fact worth printing rather
        // than a reason to hold a submission.
        const served = `serving ${probe.coin} (${Object.keys(available).length} networks)`;
        // Checked before, and independent of, freshness below: a halt is the
        // fact a lag ceiling can only proxy, and a replica halted AT its
        // source's tip passes every lag check for as long as the source sits
        // idle (row 84's residue - measured 2026-08-10, twice, 22 minutes
        // apart, over a provably halted demo chain).
        const halt = replicaHaltVerdict(json, probe.coin);
        const fresh = indexerFreshness(json, probe.coin, nowMs,
            probe.isDemoCoin ? MAX_DEMO_LAG_BLOCKS : MAX_INDEXER_LAG_BLOCKS);
        if (probe.isDemoCoin) {
            if (halt.state === 'halted') {
                return {
                    state: 'failure',
                    detail: `${served}, but ${halt.detail}: the demo wallet's funding transaction`
                        + ' would never appear on the balance screen the reviewer is looking at',
                };
            }
            if (halt.state === 'unknown') {
                return {
                    state: 'inconclusive',
                    detail: `${served}, but ${halt.detail}, so its halt state cannot be checked`,
                };
            }
            if (fresh.state === 'unknown') {
                return {
                    state: 'inconclusive',
                    detail: `${served}, but ${fresh.detail}, so its freshness cannot be checked`,
                };
            }
            if (fresh.state === 'stale') {
                return {
                    state: 'failure',
                    detail: `${served}, but ${fresh.detail}: the demo wallet's funding transaction`
                        + ' would not appear on the balance screen the reviewer is looking at',
                };
            }
            return { state: 'live', detail: `${served}, demo chain current (${fresh.detail})` };
        }
        if (halt.state === 'halted') {
            return {
                state: 'live',
                detail: `${served} - NOT FUNDABLE: ${halt.detail}. Fund the demo wallet on ${DEMO_COIN}.`,
            };
        }
        if (fresh.state === 'stale') {
            return {
                state: 'live',
                detail: `${served} - NOT FUNDABLE: ${fresh.detail}. Fund the demo wallet on ${DEMO_COIN}.`,
            };
        }
        return { state: 'live', detail: served };
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
export async function probeOnce(url, {
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    origin = SHELL_ORIGIN,
} = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        // No User-Agent override on purpose: this must look like the plain
        // client a reviewer's device is not, and an allowlist is not.
        //
        // The Origin header is the half this gate was missing until 2026-08-07,
        // and it is the difference between "the service is up" and "the app can
        // use it". curl reaches these hosts; the store build is a WebView, so
        // every call it makes is bound by CORS, and a service answering 200 with
        // no Access-Control-Allow-Origin is unreachable to it. Not hypothetical:
        // on 2026-08-07 this gate reported exit 0 while the encoder and the hub
        // served no ACAO on any path, so a reviewer could read a balance and
        // could not send. Sending an Origin makes the probe ask what a browser
        // asks rather than what curl asks.
        const res = await fetchImpl(url, {
            method: 'GET',
            headers: { accept: 'application/json', origin },
            redirect: 'follow',
            signal: controller.signal,
        });
        // `undefined` and `null` mean different things here and must not be
        // collapsed. A real Response always carries headers, so `null` means
        // the header is genuinely ABSENT (blocked). `undefined` means the
        // response had no readable headers at all - an offline fixture - and
        // that is "cannot tell", not "blocked", per this file's own rule that a
        // check which cannot tell has to say so rather than fold into a verdict.
        const acao = typeof res.headers?.get === 'function'
            ? res.headers.get('access-control-allow-origin')
            : undefined;
        return { status: res.status, body: await res.text(), acao, origin };
    } catch (e) {
        return { error: e?.name === 'AbortError' ? `timed out after ${timeoutMs}ms` : (e?.message ?? String(e)) };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Fetch one probe whose real call is a POST. Same contract as probeOnce()
 * (never throws, same undefined/null header distinction), different verb.
 *
 * This exists because a probe's HTTP verb has to match the call it is standing
 * in for. The hub's JSON-RPC root answers a GET from the vhost's DocumentRoot
 * and a POST from the app behind it: two different resources at one URL, and
 * only one of them is what the wallet talks to. Probing the wrong one is not a
 * near-miss, it is a measurement of something else entirely.
 */
export async function postOnce(url, {
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    origin = SHELL_ORIGIN,
    body = {},
} = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetchImpl(url, {
            method: 'POST',
            // The same content-type the SDK's axios POST sends, which is also
            // what makes this request non-simple and gives the preflight below
            // something to be about.
            headers: { 'content-type': 'application/json', accept: 'application/json', origin },
            body: JSON.stringify(body),
            redirect: 'follow',
            signal: controller.signal,
        });
        const acao = typeof res.headers?.get === 'function'
            ? res.headers.get('access-control-allow-origin')
            : undefined;
        return { status: res.status, body: await res.text(), acao, origin };
    } catch (e) {
        return { error: e?.name === 'AbortError' ? `timed out after ${timeoutMs}ms` : (e?.message ?? String(e)) };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Issue the ONE request a browser actually sends before the POST a GET can
 * never provoke: an OPTIONS carrying Access-Control-Request-Method and
 * Access-Control-Request-Headers. Never throws, same contract as probeOnce().
 *
 * This is the request row 69 exists to add. Everything probeOnce() sends is
 * CORS-simple and skips the preflight step entirely, which is how a service
 * can pass every GET-based check here and still refuse the one request the
 * demo's `create_tx` call actually depends on.
 */
export async function preflightOnce(url, {
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    origin = SHELL_ORIGIN,
} = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetchImpl(url, {
            method: 'OPTIONS',
            headers: {
                origin,
                'access-control-request-method': 'POST',
                'access-control-request-headers': 'content-type',
            },
            redirect: 'follow',
            signal: controller.signal,
        });
        // Same undefined/null distinction as probeOnce(): undefined means no
        // readable headers at all (an offline fixture, "cannot tell"), null
        // means a real response that genuinely omits the header ("blocked").
        const acao = typeof res.headers?.get === 'function'
            ? res.headers.get('access-control-allow-origin')
            : undefined;
        const allowMethods = typeof res.headers?.get === 'function'
            ? res.headers.get('access-control-allow-methods')
            : undefined;
        return { status: res.status, acao, allowMethods, origin };
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
    origin = SHELL_ORIGIN,
} = {}) {
    const probes = demoProbesFor(networkKind, descriptors);
    if (probes.length === 0) {
        return { exit: EXIT.CONFIG, results: [], reason: `no descriptors for network kind "${networkKind}"` };
    }
    // `--burst` with no count parses to the string 'auto', which main()
    // resolves. Reaching here with it unresolved would compare 'auto' > 0,
    // come back false, and skip the burst in silence: the one outcome a probe
    // about an invisible limit must never have.
    if (typeof burst !== 'number') {
        throw new Error(`checkDemoEndpoints: burst must be a number (got ${JSON.stringify(burst)});`
            + ' resolve it with defaultBurstCount() first');
    }

    const results = [];
    for (const probe of probes) {
        // A probe carrying a postBody is POST-only at the HTTP layer, and its
        // GET is a DIFFERENT RESOURCE (row 72). Issuing one anyway and reading
        // its CORS headers is not a harmless extra data point: it is the bug.
        const raw = probe.postBody
            ? await postOnce(probe.url, { fetchImpl, timeoutMs, origin, body: probe.postBody })
            : await probeOnce(probe.url, { fetchImpl, timeoutMs, origin });
        const cors = corsVerdict(raw);
        let verdict = withCors(classifyProbe(probe, raw), cors);

        // Only the two POST-load-bearing services carry a preflightUrl (set in
        // demoProbesFor()). The main-request verdict above still runs for them
        // - it is what catches a service down entirely - and the preflight is
        // folded on top, same shape as withCors(), because either one blocked
        // is a FAILURE for this gate's purpose.
        let preflight;
        if (probe.preflightUrl) {
            const preflightRaw = await preflightOnce(probe.preflightUrl, { fetchImpl, timeoutMs, origin });
            preflight = preflightVerdict(preflightRaw);
            verdict = withPreflight(verdict, preflight);
        }

        results.push({
            ...probe,
            ...verdict,
            cors: cors.state,
            ...(preflight ? { preflight: preflight.state } : {}),
        });
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
                detail: `${burstResult.blocked}/${burst} rapid requests came back ${burstResult.statuses.join('/')}`
                    + ` (${burstResult.ratePerSec} req/sec observed):`
                    + ' a wallet cold-open fans out more than this per address',
            });
        } else {
            // A CLEAN burst is not silence, and letting it be silence is what
            // made the 2026-08-02 run read as evidence it was not. These hosts
            // are on the zone's twelve-hostname rate-limit SKIP, so an
            // unthrottled burst measures the skip and says nothing whatever
            // about the limit underneath it . Reported as a row so a
            // green run states what it measured rather than implying the
            // stronger thing it cannot see.
            results.push({
                service: 'rate-limit',
                coin: '-',
                url: burstResult.url,
                state: 'live',
                detail: `${burst}/${burst} rapid requests unthrottled in ${burstResult.elapsedMs}ms`
                    + ` (${burstResult.ratePerSec} req/sec observed). This host is on the zone's`
                    + ' rate-limit skip, so this measures the SKIP, not the limit under it:'
                    + ' run tools/release/cold-open-profile.mjs for what the limit must clear.',
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
 *
 * The elapsed time is reported alongside the statuses because "8 requests came
 * back 200" is not a rate. A rate limit is a count inside a counting period,
 * so how LONG the burst took decides whether it was ever a test of one: eight
 * requests spread over nine seconds by a slow origin would clear a limit that
 * the same eight, sent at once, would trip.
 */
export async function burstProbe(probes, { fetchImpl, timeoutMs, count }) {
    const target = probes.find((p) => p.service === 'explorer') ?? probes[0];
    const startedAt = Date.now();
    const replies = await Promise.all(
        Array.from({ length: count }, () => probeOnce(target.url, { fetchImpl, timeoutMs })),
    );
    const elapsedMs = Date.now() - startedAt;
    const statuses = [...new Set(replies.map((r) => r.error ? 'error' : String(r.status)))];
    const blocked = replies.filter((r) => r.status === 429 || r.status === 403).length;
    // Guard the divide: a fixture-backed burst can complete inside one clock
    // tick, and an Infinity in the printed line reads as a broken tool.
    const ratePerSec = elapsedMs > 0 ? Math.round((count / elapsedMs) * 1000) : count;
    return { url: target.url, count, blocked, statuses, elapsedMs, ratePerSec };
}

/**
 * How many requests `--burst` should fire when no count is given.
 *
 * DERIVED, by driving the wallet's own cold-open against a recording SDK, from
 * the number of requests one cold-open puts on the busiest single host. The
 * old default was 8, which nobody had derived from anything and which is
 * smaller than the fan-out a three-chain wallet actually produces, so a clean
 * run at 8 could not even have been a test of the demand.
 *
 * Imported lazily and only when it is needed: this gate's --help and probe
 * table work in a tree with no node_modules (the pristine clone the release
 * ceremony mandates), and the profiler reaches xchain-sdk. When it cannot be
 * loaded, this says so and the caller must pass an explicit count rather than
 * fall back to a made-up one.
 */
export async function defaultBurstCount() {
    const { coldOpenBurstSize } = await import('./cold-open-profile.mjs');
    return coldOpenBurstSize();
}

const USAGE = `verify-demo-endpoints.mjs - can a reviewer following the scripted demo
actually reach everything it needs? (Pre-submission demo gate.)

Usage:
  node tools/release/verify-demo-endpoints.mjs [--network <kind>] [--burst [n]] [--json]
  node tools/release/verify-demo-endpoints.mjs --origin https://localhost

Options:
  --network <kind>  network to probe, default testnet
  --origin <url>    the browser Origin to probe as, default capacitor://localhost
                    (what the iOS store build sends). Android sends
                    https://localhost and the hosted web wallet its own https
                    origin, so re-point this to check another shell. Every probe
                    carries an Origin: the store build is a WebView with no
                    native-HTTP bypass, so a service that answers 200 to curl
                    and serves no Access-Control-Allow-Origin is, to the app,
                    down. This gate reported exit 0 through exactly that. The
                    hub-rpc probe is a POST (a JSON-RPC ping, the only verb
                    that surface answers; its GET is the vhost's static landing
                    page, a different resource whose headers say nothing about
                    the hub). The encoder and hub-rpc probes ALSO send a CORS preflight
                    (OPTIONS with Access-Control-Request-Method: POST) at this
                    same origin, because their load-bearing call is a POST and
                    a GET can never provoke the preflight a browser actually
                    sends first; a blocked preflight means the POST is never
                    sent at all, and this gate reported exit 0 through that too.
  --burst [n]       also fire a small burst at one endpoint. With no count,
                    the size is MEASURED: the requests one wallet cold-open
                    puts on the busiest single host, driven out of the wallet's
                    own flows by tools/release/cold-open-profile.mjs. Opt-in
                    because it points at PRODUCTION: one request per host
                    cannot see a rate limit, and a wallet opening on three
                    chains is not one request. Note what a CLEAN burst means -
                    these hosts sit on the zone's twelve-hostname rate-limit
                    skip, so an unthrottled burst measures the SKIP and says
                    nothing about the limit under it.
  --json            machine-readable result instead of the table
  -h, --help        print this and exit 0

PROBES LIVE HOSTS. That is why --help is answered before the probes rather
than after them, so --help works with no network.

Exit codes:
  0  live          every demo endpoint reachable, and readable from the app's origin
  1  failure       DO NOT SUBMIT; a reviewer would hit this
  2  config        a configuration problem, not a reachability one
  3  inconclusive  something could not be reached. NOT a pass.
`;

function parseArgs(argv) {
    const args = { networkKind: 'testnet', burst: 0, json: false, help: false, origin: SHELL_ORIGIN };
    for (let i = 0; i < argv.length; i += 1) {
        if (argv[i] === '--network') args.networkKind = argv[i + 1];
        // `--burst` with no count means "the measured cold-open burst",
        // resolved in main() rather than here so parseArgs stays synchronous
        // and dependency-free. A NEXT ARG THAT IS NOT A NUMBER is not a count:
        // the old expression read `--burst --json` as 8.
        else if (argv[i] === '--burst') {
            const n = Number(argv[i + 1]);
            args.burst = Number.isFinite(n) && n > 0 ? n : 'auto';
        }
        else if (argv[i] === '--origin') args.origin = argv[i + 1];
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
    if (args.burst === 'auto') {
        try {
            args.burst = await defaultBurstCount();
            console.log(`Burst size ${args.burst}: the requests one wallet cold-open puts on the`
                + ' busiest single host, measured from the wallet\'s own flows.\n');
        } catch (e) {
            // No invented fallback. A burst whose size means nothing cannot
            // answer the question the burst exists to ask.
            console.log('Could not measure the cold-open burst size'
                + ` (${e?.message ?? e}). Pass --burst N explicitly, or run in a tree with`
                + ' dependencies installed.');
            return EXIT.CONFIG;
        }
    }
    const outcome = await checkDemoEndpoints(args);

    if (args.json) {
        console.log(JSON.stringify(outcome, null, 2));
        return outcome.exit;
    }

    console.log(`Demo-path endpoints, ${args.networkKind}, as seen from ${args.origin}`
        + ' (§2.1 pre-submission gate)\n');
    for (const r of outcome.results) {
        const mark = r.state === 'live' ? 'OK  ' : r.state === 'failure' ? 'FAIL' : '??  ';
        console.log(`${mark} ${r.service.padEnd(10)} ${r.url}`);
        console.log(`       ${r.detail}`);
    }
    console.log();
    if (outcome.exit === EXIT.LIVE) {
        console.log(`All demo endpoints reachable AND readable from ${args.origin}. Announce the submission window`
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
