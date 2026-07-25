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
// verification notes in claude/specs/XCHAIN_WALLET_COVERAGE_SPEC.md.
//
// This module is the one compose-time chokepoint every SEND-building
// flow calls (sendToken, buildSendPsbt, the  confirm pipeline's
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
 * }} params
 * @returns {Promise<GatedSendPlan | null>}
 */
export async function prepareGatedSend({
    sdkRegistry, chainRegistry, vault, walletId, chainId, source, to, tick, amount, memo,
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

    const groups = await getGatedGroupsForSend({ sdk, chainId, tick: tickUpper });
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
 * }} params
 * @returns {Promise<{
 *   state: 'ungated' | 'ready' | 'partial' | 'blocked',
 *   groups: Array<{ keyHash: string, fileCount: number, haveKey: boolean }>,
 * }>}
 */
export async function gatedSendReadiness({
    sdkRegistry, chainRegistry, vault, walletId, chainId, tick, sourceAddress,
}) {
    const ungated = { state: /** @type {const} */ ('ungated'), groups: [] };
    const descriptor = chainRegistry?.get?.(chainId);
    const coin = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] : null;
    const tickUpper = String(tick || '').trim().toUpperCase();
    if (!tickUpper || tickUpper.startsWith('^') || (coin && tickUpper === coin)) return ungated;
    const sdk = sdkRegistry.get(chainId);
    if (!sdk?.gatedFile) return ungated;

    const groups = await getGatedGroupsForSend({ sdk, chainId, tick: tickUpper });
    if (groups.length === 0) return ungated;

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
    return { state, groups: rows };
}
