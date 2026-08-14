// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// gatedSendGuard (PC-26): once a token has an active gated FILE, the
// indexer rejects any SEND of it that is not paired IN THE SAME
// TRANSACTION with a MESSAGE v2 to the destination carrying the pack
// key(s). The pairing is structural: sibling actions only exist inside
// a BATCH (the indexer's SIBLING_ACTIONS is populated by the BATCH
// handler alone), so a bare gated SEND is ALWAYS rejected, even for a
// single recipient. See Token_Gated_Content.md and the §12 B1-a
// verification notes in the wallet coverage spec.
//
// This module is the one compose-time chokepoint every SEND-building
// flow calls (sendToken, buildSendPsbt, the confirm pipeline's
// SEND branch): detect a gated tick, resolve the pack keys the wallet
// holds, ECIES-encrypt the handoff to the recipient's on-chain pubkey,
// and rewrite the plain SEND into the atomic
//
//   BATCH|0|SEND|0|TICK|AMOUNT|DESTINATION[|MEMO];MESSAGE|2|COIN|DEST|<ECIES(0x01||K...)>
//
// Failure policy (spec PC-26): holding NO key for any active pack
// hard-blocks (the send would strand the recipient with content the
// sender could have unlocked for them); holding a SUBSET composes with
// what we have and surfaces a warning (the indexer's check is
// presence-only, so a partial handoff passes validation - the caller
// must show the missing packs); a recipient with no on-chain pubkey
// hard-blocks (ECIES has nothing to encrypt to; only addresses that
// have spent at least once reveal a pubkey).
//
// Compose is HW- and watcher-safe: ECIES needs only the recipient's
// public key plus a fresh ephemeral key (§5 signer note; the ECDH
// limitation is on the UNLOCK side, not here). What HW/watch-only
// cannot do is RECOVER a key they don't hold (the scan needs the
// private key), so their key source is the vault's gatedKeys rows.

import { getCachedGatedKey, listGatedFiles } from './gatedContent.js';
import {
    PubkeyNotFoundError,
    PubkeyMismatchError,
    recipientPubkeyMatchesAddress,
} from './messageAction.js';
import { gatedKeyId } from '../schemas/gatedKey.js';
import { isDemoGatedActionIndex } from './demoGatedContent.js';
import { indexerWatermark } from './balances.js';
import { resolveGateMinAmountActive } from './protocolActivations.js';

const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

export class GatedSendKeysMissingError extends Error {
    /**
     * @param {string} tick
     * @param {string[]} missingKeyHashes
     */
    constructor(tick, missingKeyHashes) {
        super(
            `${tick} has token-gated content, and this wallet holds none of its ${missingKeyHashes.length} unlock key(s). `
            + 'A send without the key(s) attached would be rejected by the network. '
            + 'Recover the keys first (unlock the gated content once from an address that received the token), then retry.',
        );
        this.name = 'GatedSendKeysMissingError';
        this.code = 'GATED_SEND_KEYS_MISSING';
        // D-160: this message is written for the user and must reach them
        // whole. Without the marker `humanizeError`'s keyword chain matched
        // its own phrase "rejected by the network" and replaced the whole
        // recovery path with "The network is unreachable. Check your
        // connection and try again." - on the Send form, which calls that
        // helper directly.
        this.userFacing = true;
        this.tick = tick;
        this.missingKeyHashes = missingKeyHashes;
    }
}

export class GatedRecipientPubkeyMissingError extends Error {
    /**
     * @param {string} tick
     * @param {string} destination
     */
    constructor(tick, destination) {
        super(
            `${tick} has token-gated content, and ${destination} has no transaction history on this chain. `
            + 'Gated tokens can only be sent to addresses that have spent at least once '
            + '(the unlock key is encrypted to the recipient\'s public key, which is only revealed by spending).',
        );
        this.name = 'GatedRecipientPubkeyMissingError';
        this.code = 'GATED_SEND_NO_RECIPIENT_PUBKEY';
        // D-160: this one reaches the user intact TODAY, but only because its
        // wording happens to dodge the keyword chain - marked so that stays a
        // decision rather than an accident of phrasing.
        this.userFacing = true;
        this.tick = tick;
        this.destination = destination;
    }
}

// Per-(chainId, tick) gated-group memo so compose retries and the
// readiness probe don't re-hit the explorer on every call. Short TTL:
// a newly published gated FILE must start guarding sends within a
// minute, and a false "gated" after the last file deactivates is
// harmless (an extra MESSAGE sibling never invalidates a SEND).
const GROUPS_TTL_MS = 60_000;
/** @type {Map<string, { at: number, groups: any[] }>} */
const GROUPS_CACHE = new Map();

export function clearGatedGroupsCache() {
    GROUPS_CACHE.clear();
}

// ---------------------------------------------------------------------------
// PC-29 unlock-threshold lane (GATE_MIN_AMOUNT; inert until the
// flag day pins activation heights). Post-activation SEND rule: a pack's
// key-handoff MESSAGE is required only when the destination's POST-SEND
// balance of the gate tick meets the pack's threshold; below it, a plain
// SEND is valid and deliberately carries no key (the publisher chose the
// threshold; handing the key to a below-threshold recipient would defeat
// it). Exact decimal math throughout - platform amounts are decimal
// strings up to 8dp, so everything is compared as BigInt at a fixed
// 18-digit fractional scale.

const THRESHOLD_SCALE = 18;

// Was `.replace(/0+$/, '')`: unanchored, so js/polynomial-redos flags the
// O(n^2) worst case where the string does NOT end in '0' (the engine
// backtracks the trailing run at every start position before giving up).
// A while-loop strips the exact same trailing '0's in one O(n) pass.
function stripTrailingZeros(s) {
    let end = s.length;
    while (end > 0 && s.charCodeAt(end - 1) === 48 /* '0' */) end--;
    return s.slice(0, end);
}

/** @param {string} s @returns {{ int: string, frac: string } | null} */
function parseDecimal(s) {
    const m = /^(\d+)(?:\.(\d+))?$/.exec(String(s ?? '').trim());
    if (!m) return null;
    return { int: m[1], frac: stripTrailingZeros(m[2] || '') };
}

/** @param {string} s @returns {bigint | null} value at THRESHOLD_SCALE */
function decimalToScaled(s) {
    const p = parseDecimal(s);
    if (!p || p.frac.length > THRESHOLD_SCALE) return null;
    return BigInt(p.int) * 10n ** BigInt(THRESHOLD_SCALE)
        + BigInt(p.frac.padEnd(THRESHOLD_SCALE, '0') || '0');
}

/**
 * Effective unlock threshold for a gated group: the minimum across its
 * files, where a file WITHOUT a threshold makes the whole pack
 * unconditional (that file's handoff rule always applies, and the pack
 * shares one key). Returns null for "no effective threshold".
 *
 * @param {any} group
 * @returns {string | null}
 */
export function gatedGroupThreshold(group) {
    const files = Array.isArray(group?.files) ? group.files : [];
    if (files.length === 0) return null;
    let min = null;
    let minScaled = null;
    for (const f of files) {
        const t = f?.gateMinAmount;
        if (t == null || String(t).trim() === '') return null;
        const scaled = decimalToScaled(t);
        if (scaled === null || scaled <= 0n) return null;
        if (minScaled === null || scaled < minScaled) { min = String(t).trim(); minScaled = scaled; }
    }
    return min;
}

/**
 * Split a tick's gated groups into the packs whose key handoff the send
 * MUST carry and the packs the destination's post-send balance does not
 * qualify for. Pre-activation (every chain until the train pins
 * heights) this returns all groups as required with zero network calls.
 * Failure policy while active: an unreadable destination balance treats
 * every pack as required - that direction always composes a VALID send
 * (an extra handoff never invalidates one), whereas guessing "below
 * threshold" could compose a plain SEND the indexer rejects.
 *
 * @param {{
 *   sdkRegistry: import('../sdk/SDKRegistry.js').SDKRegistry,
 *   chainId: string,
 *   sdk: object,
 *   to: string,
 *   tick: string,
 *   amount: string | number,
 *   groups: any[],
 *   heights?: Record<string, number | null>,   test-only activation override
 * }} params
 * @returns {Promise<{ requiredGroups: any[], belowThresholdKeyHashes: string[] }>}
 */
export async function splitGroupsByThreshold({ sdkRegistry, chainId, sdk, to, tick, amount, groups, heights }) {
    const allRequired = { requiredGroups: groups, belowThresholdKeyHashes: [] };
    const thresholds = groups.map((g) => gatedGroupThreshold(g));
    if (!thresholds.some((t) => t !== null)) return allRequired;

    const active = await resolveGateMinAmountActive({
        chainId,
        heights,
        getBlockHeight: async () => {
            const { watermark } = await indexerWatermark({ sdkRegistry, chainId });
            return watermark;
        },
    });
    if (!active) return allRequired;

    const amountScaled = decimalToScaled(String(amount));
    if (amountScaled === null) return allRequired;

    let postSendScaled = null;
    try {
        const resp = await sdk.getBalances(to);
        const rows = Array.isArray(resp) ? resp : (resp && Array.isArray(resp.data) ? resp.data : []);
        const tickUpper = String(tick).toUpperCase();
        const row = rows.find((r) => String(r?.tick || '').toUpperCase() === tickUpper);
        // No row = zero balance (a first-time recipient), which is a real
        // answer, not a failure.
        const div = Number(row?.divisibility ?? row?.decimals ?? 0);
        const qty = BigInt(String(row?.quantity ?? row?.amount ?? '0'));
        if (!Number.isInteger(div) || div < 0 || div > THRESHOLD_SCALE) throw new Error('bad divisibility');
        postSendScaled = qty * 10n ** BigInt(THRESHOLD_SCALE - div) + amountScaled;
    } catch (_e) {
        return allRequired;
    }

    const requiredGroups = [];
    const belowThresholdKeyHashes = [];
    groups.forEach((g, i) => {
        const t = thresholds[i] === null ? null : decimalToScaled(thresholds[i]);
        if (t === null || postSendScaled >= t) requiredGroups.push(g);
        else belowThresholdKeyHashes.push(String(g.keyHash).toLowerCase());
    });
    return { requiredGroups, belowThresholdKeyHashes };
}

/**
 * Real (non-demo) gated groups for a tick, TTL-memoized. Demo fixtures
 * are display-only and must never make a real send compose as gated.
 *
 * @param {{ sdk: object, chainId: string, tick: string }} params
 * @returns {Promise<any[]>}
 */
export async function getGatedGroupsForSend({ sdk, chainId, tick }) {
    const cacheKey = `${chainId}|${String(tick).toUpperCase()}`;
    const hit = GROUPS_CACHE.get(cacheKey);
    if (hit && Date.now() - hit.at < GROUPS_TTL_MS) return hit.groups;
    const all = await listGatedFiles({ sdk, tick });
    const groups = (Array.isArray(all) ? all : []).filter((g) => {
        const files = Array.isArray(g?.files) ? g.files : [];
        return files.length > 0 && !files.every((f) => isDemoGatedActionIndex(f.actionIndex));
    });
    GROUPS_CACHE.set(cacheKey, { at: Date.now(), groups });
    return groups;
}

/**
 * Resolve the pack keys this wallet holds for a tick's gated groups.
 * Vault rows first (durable; the only source HW/watch-only sessions
 * have), then the in-memory scan cache under the sending address (a
 * prior unlock this session). Every candidate is re-verified against
 * its KEY_HASH before use: a corrupted row must never hand off a key
 * that cannot unlock the file it claims to.
 *
 * @param {{
 *   sdk: object,
 *   vault?: import('../storage/Vault.js').Vault | null,
 *   walletId?: string | null,
 *   chainId: string,
 *   tick: string,
 *   sourceAddress?: string | null,
 *   groups: any[],
 * }} params
 * @returns {Promise<{ keysByHash: Record<string, Buffer>, missingKeyHashes: string[] }>}
 */
export async function resolveGatedSendKeys({ sdk, vault, walletId, chainId, tick, sourceAddress, groups }) {
    /** @type {Record<string, Buffer>} */
    const keysByHash = {};
    /** @type {string[]} */
    const missingKeyHashes = [];
    for (const group of groups) {
        const keyHash = String(group.keyHash).toLowerCase();
        let key = null;
        if (vault?.gatedKeys && walletId) {
            const row = await vault.gatedKeys.get(gatedKeyId({
                walletId, chainId, gateTicker: tick, keyHash,
            }));
            if (row?.keyHex) {
                const candidate = Buffer.from(row.keyHex, 'hex');
                if (sdk.gatedFile.verifyKey(candidate, keyHash)) key = candidate;
            }
        }
        if (!key && sourceAddress) {
            const cached = getCachedGatedKey(sourceAddress, keyHash);
            if (cached && sdk.gatedFile.verifyKey(cached, keyHash)) key = cached;
        }
        if (key) keysByHash[keyHash] = key;
        else missingKeyHashes.push(keyHash);
    }
    return { keysByHash, missingKeyHashes };
}

/**
 * @typedef {Object} GatedSendPlan
 * @property {{ action: 'BATCH', params: { VERSION: '0', COMMAND: string } }} actionData
 * @property {string[]} attachedKeyHashes
 * @property {string[]} missingKeyHashes   non-empty = partial handoff; caller must warn
 * @property {Array<{ code: string, message: string }>} warnings
 */

/**
 * The guard. Returns null when the tick needs no gating (native coin,
 * no active real gated groups), otherwise the BATCH(SEND, MESSAGE)
 * rewrite plan. Throws typed errors on the two hard-block cases.
 *
 * Detection failure policy: listGatedFiles already swallows explorer
 * errors into an empty list, so a dead explorer degrades to a plain
 * SEND. That is the right direction: the indexer rejects an unpaired
 * gated send (funds stay put, the action just fails to validate),
 * whereas blocking every send whenever the explorer hiccups would DoS
 * ungated sends too.
 *
 * @param {{
 *   sdkRegistry: import('../sdk/SDKRegistry.js').SDKRegistry,
 *   chainRegistry: import('../registry/index.js').ChainRegistry,
 *   vault?: import('../storage/Vault.js').Vault | null,
 *   walletId?: string | null,
 *   chainId: string,
 *   source: { address: string },
 *   to: string,
 *   tick: string,
 *   amount: string | number,
 *   memo?: string,
 *   _activationHeights?: Record<string, number | null>,   test-only PC-29 override
 * }} params
 * @returns {Promise<GatedSendPlan | null>}
 */
export async function prepareGatedSend({
    sdkRegistry, chainRegistry, vault, walletId, chainId, source, to, tick, amount, memo,
    _activationHeights,
}) {
    const descriptor = chainRegistry?.get?.(chainId);
    const coin = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] : null;
    const tickUpper = String(tick).trim().toUpperCase();
    // Native-coin sends move coin, not a tick; nothing can gate them.
    if (coin && tickUpper === coin) return null;
    // TICK_ID (^id) sends bypass detection by design: gate_ticker rows
    // carry the ticker name, so a ^id alias cannot match. The indexer
    // still rejects an unpaired gated send, so the failure mode is a
    // rejected action, never stranded funds. Send.jsx composes by name.
    if (tickUpper.startsWith('^')) return null;

    const sdk = sdkRegistry.get(chainId);
    if (!sdk?.gatedFile || !sdk?.messaging) return null;

    const allGroups = await getGatedGroupsForSend({ sdk, chainId, tick: tickUpper });
    if (allGroups.length === 0) return null;

    // PC-29 threshold lane: packs the destination's post-send balance
    // does not qualify for are dropped from the handoff set (their key
    // deliberately stays with the sender). If NO pack qualifies, the
    // whole send goes out as a plain SEND - post-activation that is the
    // protocol's below-threshold lane. Inert until the flag day.
    const { requiredGroups: groups, belowThresholdKeyHashes } = await splitGroupsByThreshold({
        sdkRegistry, chainId, sdk, to, tick: tickUpper, amount, groups: allGroups,
        heights: _activationHeights,
    });
    if (groups.length === 0) return null;

    // The BATCH COMMAND is ';'-joined; a separator inside MEMO would
    // splice a phantom sub-action. The protocol rejects these characters
    // in MEMO anyway, so failing here only moves the error earlier.
    if (typeof memo === 'string' && /[|;]/.test(memo)) {
        throw new Error('prepareGatedSend: memo cannot contain | or ; characters');
    }

    const { keysByHash, missingKeyHashes } = await resolveGatedSendKeys({
        sdk, vault, walletId, chainId, tick: tickUpper,
        sourceAddress: source?.address, groups,
    });
    const attachedKeyHashes = Object.keys(keysByHash);
    if (attachedKeyHashes.length === 0) {
        throw new GatedSendKeysMissingError(tickUpper, missingKeyHashes);
    }

    if (!coin) throw new Error(`prepareGatedSend: cannot resolve protocol coin ticker for ${chainId}`);

    // Recipient pubkey rail: the handoff is ECIES-encrypted to the
    // destination's on-chain-revealed pubkey, and the explorer answer is
    // hostile-capable, so re-derive the address from the returned key
    // (same anti-substitution bind the MESSAGE flow enforces).
    const pubkey = await sdk.getPublicKey(to);
    if (!pubkey) throw new GatedRecipientPubkeyMissingError(tickUpper, to);
    if (!recipientPubkeyMatchesAddress(sdk, pubkey, to, descriptor)) {
        throw new PubkeyMismatchError(to);
    }

    // serializeKeyPayload re-verifies every key against its hash map
    // entry; eciesEncryptBytes generates the fresh ephemeral key.
    const payload = sdk.gatedFile.serializeKeyPayload(keysByHash);
    const handoff = sdk.messaging.eciesEncryptBytes(payload, pubkey);

    // Canonical sub-commands via createAction (explicit versions, the
    // pre-flag-day BATCH requirement), then joined per BATCH.md.
    /** @type {Record<string, string>} */
    const sendParams = { TICK: tick, AMOUNT: String(amount), DESTINATION: to };
    if (memo !== undefined && memo !== null && memo !== '') sendParams.MEMO = memo;
    const sendCmd = sdk.actions.createAction({ action: 'SEND', params: sendParams }).actionString;
    const messageCmd = sdk.actions.createAction({
        action: 'MESSAGE',
        params: {
            VERSION: '2',
            COIN: coin,
            DESTINATION: to,
            ENCRYPTED_MESSAGE: handoff.ciphertext,
        },
    }).actionString;

    const warnings = missingKeyHashes.length > 0
        ? [{
            code: 'GATED_SEND_PARTIAL_KEYS',
            message: `Attaching ${attachedKeyHashes.length} of ${groups.length} unlock keys for ${tickUpper}; `
                + `the recipient will not be able to open the pack(s) ${missingKeyHashes.join(', ')}.`,
        }]
        : [];
    if (belowThresholdKeyHashes.length > 0) {
        warnings.push({
            code: 'GATED_SEND_BELOW_THRESHOLD',
            message: `The recipient's ${tickUpper} balance after this send stays below the unlock `
                + `threshold for ${belowThresholdKeyHashes.length} pack(s); per the publisher's setting, `
                + 'those keys are not attached.',
        });
    }

    return {
        actionData: { action: 'BATCH', params: { VERSION: '0', COMMAND: `${sendCmd};${messageCmd}` } },
        attachedKeyHashes,
        missingKeyHashes,
        warnings,
    };
}

/**
 * Pre-submit readiness report for the Send UI: is the tick gated, and
 * which pack keys does the wallet hold? Secret-free (key hashes and
 * booleans only) so it can cross the messaging boundary. `state`:
 *   'ungated'  no active gated groups (or native/^id tick)
 *   'ready'    every pack key held
 *   'partial'  some keys held; send composes but the caller must warn
 *   'blocked'  no keys held; the flow guard would hard-block
 *
 * @param {{
 *   sdkRegistry: import('../sdk/SDKRegistry.js').SDKRegistry,
 *   chainRegistry: import('../registry/index.js').ChainRegistry,
 *   vault?: import('../storage/Vault.js').Vault | null,
 *   walletId?: string | null,
 *   chainId: string,
 *   tick: string,
 *   sourceAddress?: string | null,
 *   to?: string | null,                    destination, for the PC-29 threshold lane
 *   amount?: string | number | null,       send amount, for the PC-29 threshold lane
 *   _activationHeights?: Record<string, number | null>,   test-only PC-29 override
 * }} params
 * @returns {Promise<{
 *   state: 'ungated' | 'ready' | 'partial' | 'blocked',
 *   groups: Array<{ keyHash: string, fileCount: number, haveKey: boolean }>,
 *   belowThresholdCount?: number,
 * }>}
 */
export async function gatedSendReadiness({
    sdkRegistry, chainRegistry, vault, walletId, chainId, tick, sourceAddress, to, amount,
    _activationHeights,
}) {
    const ungated = { state: /** @type {const} */ ('ungated'), groups: [] };
    const descriptor = chainRegistry?.get?.(chainId);
    const coin = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] : null;
    const tickUpper = String(tick || '').trim().toUpperCase();
    if (!tickUpper || tickUpper.startsWith('^') || (coin && tickUpper === coin)) return ungated;
    const sdk = sdkRegistry.get(chainId);
    if (!sdk?.gatedFile) return ungated;

    const allGroups = await getGatedGroupsForSend({ sdk, chainId, tick: tickUpper });
    if (allGroups.length === 0) return ungated;

    // Mirror the compose-time threshold lane when the caller supplied a
    // destination + amount; without them the probe conservatively treats
    // every pack as required (pre-activation this is a no-op anyway).
    let groups = allGroups;
    let belowThresholdCount = 0;
    if (to && amount != null && String(amount).trim() !== '') {
        const split = await splitGroupsByThreshold({
            sdkRegistry, chainId, sdk, to, tick: tickUpper, amount, groups: allGroups,
            heights: _activationHeights,
        });
        groups = split.requiredGroups;
        belowThresholdCount = split.belowThresholdKeyHashes.length;
        if (groups.length === 0) return { ...ungated, belowThresholdCount };
    }

    const { keysByHash } = await resolveGatedSendKeys({
        sdk, vault, walletId, chainId, tick: tickUpper, sourceAddress, groups,
    });
    const rows = groups.map((g) => ({
        keyHash: String(g.keyHash).toLowerCase(),
        fileCount: Array.isArray(g.files) ? g.files.length : 0,
        haveKey: Boolean(keysByHash[String(g.keyHash).toLowerCase()]),
    }));
    const held = rows.filter((r) => r.haveKey).length;
    const state = held === rows.length ? 'ready' : (held === 0 ? 'blocked' : 'partial');
    return { state, groups: rows, ...(belowThresholdCount > 0 ? { belowThresholdCount } : {}) };
}
