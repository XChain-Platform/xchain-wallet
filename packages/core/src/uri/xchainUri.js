// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// xchain: URI parser, §47.
//
// Three URI shapes (the first is preferred for new QRs):
//
//   1. Coin-code form:  xchain:<COINCODE>/<action>?to=&amount=&tick=&memo=
//      e.g. xchain:TBTC/send?to=tb1q…&amount=1&tick=PEPECREATURE
//      Short single token combines coin + network (BTC / TBTC / RBTC,
//      LTC / TLTC / RLTC, DOGE / TDOGE / RDOGE; same convention used
//      across explorer/encoder/hub URL paths). The action segment
//      (send / receive / future routes) drives wallet routing.
//
//   2. Legacy path-style:  xchain://<chainId>/<tick>?amount=&to=&memo=&kind=receive
//      Pre-coin-code QRs that may already be in the wild. Still parsed
//      so existing QRs keep working.
//
//   3. BIP21-style:  xchain:<address>?amount=&tick=&memo=&label=&message=
//      Mirrors per-chain BIP21 (`bitcoin:bc1q…?amount=0.1`) but with the
//      cross-chain `xchain` scheme. The receiving wallet picks the chain
//      based on the address format.
//
// Output is a normalized navigation intent that Send / Receive routes
// consume directly. Returns `{ kind: 'unknown' }` for malformed input
// rather than throwing; the caller already had a string from a QR scan
// or paste, so we don't want to abort their flow over a typo.

import { parseBip21Uri, InvalidBip21Error } from './bip21.js';
import { chainIdForCoinCode, coinCodeForChainId, isKnownCoinCode } from './coinCodes.js';
import { neutralizeControlText } from '../shared/utils/textHardening.js';

const PATH_PREFIX = 'xchain://';
const BIP21_PREFIX = 'xchain:';

// Actions that map to `kind: 'receive'` on the parsed intent. Everything
// else is treated as kind:'send' by default, with the literal action
// preserved in `intent.action` so new screens can route on it.
const RECEIVE_ACTIONS = new Set(['receive']);

// Actions that map to `kind: 'execute'` (contract method invocation,
// protocol/XChain_URI_Scheme.md `execute` section). Explorers build these
// links so a "Write Contract" button lands on the EXECUTE form prefilled.
const EXECUTE_ACTIONS = new Set(['execute']);

const FEE_PRIORITIES = new Set(['low', 'normal', 'fast']);

// Numeric URI fields (contract action_index, gas limit). Same gate the
// explorer applies to its /contract/{idx} route params.
const NUMERIC_RE = /^[0-9]+$/;

// Raw chainIds accepted from legacy path-style / BIP21 `chain=` input
// (registry ids look like 'bitcoin-mainnet'). Anything else is dropped so an
// unvetted string never rides the intent into screen state.
const CHAIN_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/i;

function normalizeFeePriority(raw) {
    if (typeof raw !== 'string') return undefined;
    const lower = raw.toLowerCase();
    return FEE_PRIORITIES.has(lower) ? lower : undefined;
}

/**
 * @typedef {Object} XchainUriIntent
 * @property {'send' | 'receive' | 'execute' | 'unknown'} kind   routing bucket the wallet uses to pick a screen
 * @property {string} [action]                      literal action segment from a coin-code URI ('send' / 'receive' / 'execute' / etc.) when present
 * @property {string} [contractActionIndex]         execute: the deployed contract's action_index
 * @property {string} [method]                      execute: contract method name to invoke
 * @property {string} [executeParams]               execute: raw pipe-delimited positional params string
 * @property {string} [gasLimit]                    execute: gas limit override
 * @property {string} [chainId]                     resolved chainId for coin-code or legacy path-style URIs
 * @property {string} [tick]                       'BTC' / 'XCP' / '^TICK_ID' / etc.
 * @property {string} [address]                     destination (send) or wallet address (receive)
 * @property {string} [amount]                      decimal string in display units
 * @property {string} [memo]
 * @property {'low' | 'normal' | 'fast'} [feePriority]   receiver's preferred fee tier; scanners may pre-select but users can override
 * @property {string} [label]
 * @property {string} [message]
 * @property {Record<string, string>} [params]      remaining query params (includes the named ones for caller convenience)
 * @property {string[]} [required]                  names of `req-*` params; if non-empty the caller MUST decide whether to honor each or reject the URI per BIP21
 */

/**
 * @param {string} uri
 * @param {{ chainRegistry?: { chainIdFor: (coin: string, networkKind: string) => string | null } }} [deps]
 *        Registry is only needed to resolve coin codes (`xchain:TBTC/...`)
 *        back to chainIds. Without it, coin-code URIs still parse but
 *        intent.chainId will be undefined; the caller can resolve later.
 * @returns {XchainUriIntent}
 */
export function parseXchainUri(uri, deps) {
    if (typeof uri !== 'string') return { kind: 'unknown' };
    const raw = uri.trim();
    if (raw.length === 0) return { kind: 'unknown' };
    const lower = raw.toLowerCase();

    if (lower.startsWith(PATH_PREFIX)) {
        return parsePathStyle(raw);
    }
    if (lower.startsWith(BIP21_PREFIX)) {
        // Disambiguate `xchain:<CODE>/<action>?...` from `xchain:<address>?...`
        // by inspecting the first path segment. Coin codes never contain
        // characters that addresses use (they're 3–5 ASCII letters), and
        // a slash before the query is a strong signal for the routed form.
        const afterScheme = raw.slice(BIP21_PREFIX.length);
        const queryAt = afterScheme.indexOf('?');
        const pathPart = queryAt === -1 ? afterScheme : afterScheme.slice(0, queryAt);
        const firstSeg = pathPart.split('/')[0];
        if (pathPart.includes('/') && isKnownCoinCode(firstSeg)) {
            return parseCoinCodeStyle(raw, deps?.chainRegistry);
        }
        return parseBip21Style(raw);
    }
    return { kind: 'unknown' };
}

// Intent fields that land in an editable form field a link can prefill,
// have no legitimate reason to carry a bidi override or a raw control
// character, and are not otherwise gated above: MEMO is free text a user
// composes (not a channel for smuggling invisible formatting into a
// signing screen), and tick / EXECUTE method / EXECUTE params / label /
// message are short machine-facing tokens. `address` and `amount` are
// deliberately excluded - see `hardenUriIntentText` below.
const HARDENED_INTENT_FIELDS = ['memo', 'tick', 'method', 'executeParams', 'label', 'message'];

/**
 * Neutralize a parsed intent's free-text fields before a shell turns it
 * into prefill state. `parseXchainUri` stays a pure parser; this is a
 * deliberate second step, applied once at each place a shell reads an
 * intent into `useState` (the popup / web boot effects, `ScanRoute`,
 * `Send`'s smart-paste), so the URI is what gets hardened and a value the
 * user later TYPES into the same field is never touched.
 *
 * Two fields are excluded on purpose, because "strip anything a signing
 * screen shouldn't render raw" is the wrong rule for them:
 *
 * - `address`: this function never mutates it. A destination is validated
 *   by its own checksum (base58check / bech32) before signing, and a bidi
 *   or control character embedded in it cannot survive that decode, so a
 *   hostile address is already unroutable without this function's help.
 *   Touching the string here buys nothing and adds a way to corrupt an
 *   address that was fine - a lost payment, which is a worse failure than
 *   the one this function exists to close.
 * - `amount`: every consumer parses it as a plain decimal (or rejects it)
 *   before it reaches a signing surface, so a hidden character already
 *   invalidates it downstream. Neutralizing it here would not change
 *   whether a tampered amount gets signed, only whether the rejection
 *   happens with or without this pass, so it is left as the parser
 *   produced it.
 *
 * @param {XchainUriIntent} intent
 * @returns {XchainUriIntent} a shallow copy with the hardened fields replaced
 */
/**
 * Gate a chainId that arrived from untrusted input, returning it only if it
 * looks like a registry id and `undefined` otherwise.
 *
 * Exported because a chainId reaches a ROUTING decision, and the same BIP21
 * `chain=` param arrives by two different roads: through this parser, and
 * through `bip21.js` when `ScanRoute` classifies a scanned `bitcoin:` QR.
 * The second road had no gate, so a scanned link could ride an arbitrary
 * string into screen state on a path where the first road drops it. One
 * exported gate rather than a second copy of the regex, so the two roads
 * cannot drift apart again.
 *
 * @param {unknown} value
 * @returns {string | undefined}
 */
export function safeChainIdParam(value) {
    return typeof value === 'string' && CHAIN_ID_RE.test(value) ? value : undefined;
}

export function hardenUriIntentText(intent) {
    if (!intent) return intent;
    const out = { ...intent };
    for (const field of HARDENED_INTENT_FIELDS) {
        if (typeof out[field] === 'string') out[field] = neutralizeControlText(out[field]);
    }
    return out;
}

function parseCoinCodeStyle(raw, chainRegistry) {
    // raw === 'xchain:<CODE>/<action>?<params>'
    const after = raw.slice(BIP21_PREFIX.length);
    const queryIdx = after.indexOf('?');
    const pathPart = queryIdx === -1 ? after : after.slice(0, queryIdx);
    const queryPart = queryIdx === -1 ? '' : after.slice(queryIdx + 1);

    const segments = pathPart.split('/').filter(Boolean);
    if (segments.length === 0) return { kind: 'unknown' };
    const code = segments[0];
    const action = segments[1] ? segments[1].toLowerCase() : 'send';

    const { params, required, errors } = parseQuery(queryPart);
    if (errors.length > 0) return { kind: 'unknown' };

    /** @type {XchainUriIntent} */
    const intent = {
        kind: EXECUTE_ACTIONS.has(action) ? 'execute'
            : (RECEIVE_ACTIONS.has(action) ? 'receive' : 'send'),
        action,
    };
    const chainId = chainRegistry ? chainIdForCoinCode(code, chainRegistry) : null;
    if (chainId) intent.chainId = chainId;
    // Execute intents carry ONLY the contract call target: send-shaped fields
    // (tick/to/amount/memo) must not leak into an EXECUTE prefill, and the
    // numeric fields are gated so a crafted link can't ride an arbitrary
    // string into screen state (a failed gate just drops the field; the
    // route falls back to its manual form). `params` (the query param) holds
    // the raw pipe-delimited positional string; parseQuery has already
    // percent-decoded it, so `|` separators round-trip intact.
    if (intent.kind === 'execute') {
        if (params.contract && NUMERIC_RE.test(params.contract)) intent.contractActionIndex = params.contract;
        if (params.method) intent.method = params.method;
        if (params.params) intent.executeParams = params.params;
        if (params.gas && NUMERIC_RE.test(params.gas)) intent.gasLimit = params.gas;
    } else {
        if (params.tick) intent.tick = params.tick;
        if (params.to) intent.address = params.to;
        if (params.amount) intent.amount = params.amount;
        if (params.memo) intent.memo = params.memo;
    }
    if (params.label) intent.label = params.label;
    if (params.message) intent.message = params.message;
    const feePriority = normalizeFeePriority(params.feePriority);
    if (feePriority) intent.feePriority = feePriority;
    intent.params = params;
    // BIP21: a `req-*` param the wallet does not implement invalidates the
    // whole URI. XChain implements none, so any req- param rejects the URI
    // rather than silently dropping the required directive.
    if (required.length > 0) return { kind: 'unknown' };
    return intent;
}

function parsePathStyle(raw) {
    // raw === 'xchain://<chainId>/<tick>?...' (case-sensitive after the scheme)
    const after = raw.slice(PATH_PREFIX.length);
    const queryIdx = after.indexOf('?');
    const pathPart = queryIdx === -1 ? after : after.slice(0, queryIdx);
    const queryPart = queryIdx === -1 ? '' : after.slice(queryIdx + 1);

    const segments = pathPart.split('/').filter(Boolean);
    if (segments.length === 0) return { kind: 'unknown' };

    /** @type {XchainUriIntent} */
    const intent = {
        kind: 'send',
        chainId: safeChainIdParam(segments[0]),
        tick: segments.length > 1 ? segments[1] : undefined,
    };

    const { params, required, errors } = parseQuery(queryPart);
    if (errors.length > 0) return { kind: 'unknown' };

    if (params.amount) intent.amount = params.amount;
    if (params.memo) intent.memo = params.memo;
    if (params.label) intent.label = params.label;
    if (params.message) intent.message = params.message;
    if (params.to) intent.address = params.to;
    if (params.kind === 'receive') intent.kind = 'receive';
    const feePriority = normalizeFeePriority(params.feePriority);
    if (feePriority) intent.feePriority = feePriority;
    intent.params = params;
    // BIP21: reject on any unimplemented req- param (see parseCoinCodeStyle).
    if (required.length > 0) return { kind: 'unknown' };
    return intent;
}

function parseBip21Style(raw) {
    let parts;
    try {
        parts = parseBip21Uri(raw);
    } catch (err) {
        if (err instanceof InvalidBip21Error) return { kind: 'unknown' };
        throw err;
    }
    /** @type {XchainUriIntent} */
    const intent = {
        kind: 'send',
        address: parts.address,
        params: parts.params,
    };
    if (parts.amount) intent.amount = parts.amount;
    if (parts.label) intent.label = parts.label;
    if (parts.message) intent.message = parts.message;
    if (parts.params?.memo) intent.memo = parts.params.memo;
    if (parts.params?.tick) intent.tick = parts.params.tick;
    const gatedChain = safeChainIdParam(parts.params?.chain);
    if (gatedChain) intent.chainId = gatedChain;
    const feePriority = normalizeFeePriority(parts.params?.feePriority);
    if (feePriority) intent.feePriority = feePriority;
    // BIP21: reject on any unimplemented req- param (see parseCoinCodeStyle).
    if (parts.required?.length > 0) return { kind: 'unknown' };
    return intent;
}

function parseQuery(queryPart) {
    /** @type {Record<string, string>} */
    const params = {};
    /** @type {string[]} */
    const required = [];
    /** @type {string[]} */
    const errors = [];
    if (!queryPart) return { params, required, errors };
    for (const pair of queryPart.split('&')) {
        if (!pair) continue;
        const eq = pair.indexOf('=');
        if (eq === -1) {
            errors.push(`malformed param "${pair}"`);
            continue;
        }
        let key = pair.slice(0, eq);
        let value;
        try {
            value = decodeURIComponent(pair.slice(eq + 1));
        } catch {
            errors.push(`unable to decode "${pair}"`);
            continue;
        }
        try { key = decodeURIComponent(key); } catch { /* keep raw */ }
        if (key.startsWith('req-')) {
            // Store under the FULL `req-<name>` key (like bip21.js), never the
            // bare name: a req- value must not be silently applied as if it
            // were an ordinary param. `required` carries the bare names so the
            // caller can reject the URI (XChain implements no req- variables).
            required.push(key.slice(4));
            params[key] = value;
        } else {
            params[key] = value;
        }
    }
    return { params, required, errors };
}

/**
 * Render a localized human-readable description of a parsed intent.
 * Used by confirmation prompts and deep-link previews ("Send 0.5 BTC to
 * bc1q…7qz3"). Consumers pass through the i18n namespace exported from
 * `@xchain-wallet/core` so the helper picks up the active locale.
 *
 * The shape of the returned string is driven by which fields the intent
 * actually carries: a bare `xchain://bitcoin-mainnet` URI yields just
 * "Send"; a fully-populated send yields the full sentence.
 *
 * @param {XchainUriIntent} intent
 * @param {{ i18n: { t: (key: string, vars?: Record<string, string | number>) => string } }} deps
 * @returns {string}
 */
export function describeXchainIntent(intent, deps) {
    const t = deps?.i18n?.t;
    if (typeof t !== 'function') {
        throw new Error('describeXchainIntent: deps.i18n.t is required');
    }
    if (!intent || intent.kind === 'unknown') {
        return t('uri.intent.unknown');
    }
    // Contract EXECUTE intents (explorer Write-tab deep links). A missing
    // contract index is unroutable, so it reads as an unrecognized link.
    if (intent.kind === 'execute') {
        if (!intent.contractActionIndex) return t('uri.intent.unknown');
        const evars = { contract: intent.contractActionIndex };
        if (intent.method) {
            evars.method = intent.method;
            return t('uri.intent.executeMethod', evars);
        }
        return t('uri.intent.execute', evars);
    }
    const isReceive = intent.kind === 'receive';
    const hasAmount = Boolean(intent.amount && intent.tick);
    const hasAsset = Boolean(intent.tick && !intent.amount);
    const hasAddress = typeof intent.address === 'string' && intent.address.length > 0;
    const vars = {};
    if (hasAmount) {
        vars.amount = intent.amount;
        vars.tick = intent.tick;
    } else if (hasAsset) {
        vars.tick = intent.tick;
    }
    if (hasAddress) vars.address = shortenAddress(intent.address);

    if (isReceive) {
        if (hasAmount && hasAddress) return t('uri.intent.receiveAmountAt', vars);
        if (hasAmount) return t('uri.intent.receiveAmount', vars);
        if (hasAsset && hasAddress) return t('uri.intent.receiveAssetAt', vars);
        if (hasAsset) return t('uri.intent.receiveAsset', vars);
        if (hasAddress) return t('uri.intent.receiveAt', vars);
        return t('uri.intent.receive');
    }
    if (hasAmount && hasAddress) return t('uri.intent.sendAmountTo', vars);
    if (hasAmount) return t('uri.intent.sendAmount', vars);
    if (hasAsset && hasAddress) return t('uri.intent.sendAssetTo', vars);
    if (hasAsset) return t('uri.intent.sendToken', vars);
    if (hasAddress) return t('uri.intent.sendTo', vars);
    return t('uri.intent.send');
}

function shortenAddress(addr) {
    if (typeof addr !== 'string' || addr.length <= 14) return addr;
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * Build a coin-code URI: `xchain:<CODE>/<action>?<params>`.
 *
 * @param {XchainUriIntent & { action?: string }} intent
 * @param {{ chainRegistry: { descriptorFor: (id: string) => any } }} deps
 *        Registry resolves intent.chainId to its short coin code.
 * @returns {string}
 */
export function buildXchainUri(intent, deps) {
    if (!intent) throw new Error('buildXchainUri: intent is required');
    if (!intent.chainId) throw new Error('buildXchainUri: intent.chainId is required');
    const chainRegistry = deps?.chainRegistry;
    if (!chainRegistry) throw new Error('buildXchainUri: deps.chainRegistry is required');
    const code = coinCodeForChainId(intent.chainId, chainRegistry);
    if (!code) {
        throw new Error(`buildXchainUri: no coin code for chainId "${intent.chainId}"`);
    }
    const action = (intent.action || (intent.kind === 'receive' ? 'receive' : 'send')).toLowerCase();

    const params = [];
    if (intent.address) params.push(`to=${encodeURIComponent(intent.address)}`);
    if (intent.amount) params.push(`amount=${encodeURIComponent(intent.amount)}`);
    if (intent.tick) params.push(`tick=${encodeURIComponent(intent.tick)}`);
    if (intent.memo) params.push(`memo=${encodeURIComponent(intent.memo)}`);
    const feePriority = normalizeFeePriority(intent.feePriority);
    if (feePriority) params.push(`feePriority=${feePriority}`);
    if (intent.label) params.push(`label=${encodeURIComponent(intent.label)}`);
    if (intent.message) params.push(`message=${encodeURIComponent(intent.message)}`);
    return params.length > 0
        ? `xchain:${code}/${action}?${params.join('&')}`
        : `xchain:${code}/${action}`;
}
