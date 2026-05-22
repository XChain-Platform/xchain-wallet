// Token-gated content flow — fetches a gated FILE's ciphertext from
// the explorer, finds the symmetric key in MESSAGEs addressed to the
// holder's address, decrypts the file client-side. No on-chain
// transaction is required to unlock.
//
// See xchain-documentation/protocol/TOKEN_GATED_CONTENT.md.
//
// Caching:
//   - keys cached by (address, keyHash) so unlocking one pack member
//     instantly unlocks every sibling sharing the same key.
//   - plaintexts cached by (address, actionIndex) for the session.
// Caches are in-memory, per-process. Clearing happens on wallet lock.

import { exportPrivateKey } from './exportPrivateKey.js';

const KEY_CACHE = /** @type {Map<string, Buffer>} */ (new Map());
const PT_CACHE  = /** @type {Map<string, Uint8Array>} */ (new Map());

const HANDOFF_TYPE = 'xchain.gated_keys.v1';

function keyKey(address, keyHash) { return address + '|' + String(keyHash).toLowerCase(); }
function ptKey(address, actionIndex) { return address + '|' + String(actionIndex); }

export function clearGatedContentCaches() {
    KEY_CACHE.clear();
    PT_CACHE.clear();
}

/**
 * Look up a cached symmetric key for an (address, keyHash) pair without
 * scanning MESSAGEs. Used by the Send flow to decide whether the holder
 * can re-encrypt the key for a recipient.
 *
 * @param {string} address
 * @param {string} keyHash
 * @returns {Buffer | null}
 */
export function getCachedGatedKey(address, keyHash) {
    return KEY_CACHE.get(keyKey(address, keyHash)) || null;
}

/**
 * Scan the holder's MESSAGEs (auto-decrypted by the SDK) for any
 * `xchain.gated_keys.v1` payloads and populate the per-address key
 * cache. Returns the map of keyHash → key Buffer that was discovered
 * in this scan. Subsequent unlock calls can reuse the cache without
 * re-scanning. Safe to call multiple times.
 *
 * @param {{
 *   sdk: import('xchain-sdk').XChainSDK,
 *   address: string,
 *   wif: string,
 *   opts?: object,
 * }} params
 * @returns {Promise<Record<string, Buffer>>}
 */
export async function scanGatedKeyHandoffs({ sdk, address, wif, opts }) {
    if (!sdk) throw new Error('scanGatedKeyHandoffs: sdk is required');
    if (!address) throw new Error('scanGatedKeyHandoffs: address is required');
    if (!wif) throw new Error('scanGatedKeyHandoffs: wif is required');

    const found = /** @type {Record<string, Buffer>} */ ({});
    // Pull MESSAGEs addressed to this address (received). The SDK
    // auto-decrypts ECIES (method 1) entries when wif is supplied.
    const messages = await sdk.getMessagesForAddress(
        address,
        { ...(opts || {}), wif, type: 'received' },
    );
    if (!Array.isArray(messages)) return found;

    for (const msg of messages) {
        // Only ECIES messages with a successfully-decrypted plaintext
        // can carry key handoffs. Skip everything else.
        const plaintext = msg && typeof msg.text === 'string' ? msg.text : null;
        if (!plaintext) continue;
        let parsed;
        try { parsed = JSON.parse(plaintext); } catch (_e) { continue; }
        if (!parsed || parsed.type !== HANDOFF_TYPE) continue;
        const keys = parsed.keys && typeof parsed.keys === 'object' ? parsed.keys : null;
        if (!keys) continue;
        for (const hashRaw of Object.keys(keys)) {
            const hash = String(hashRaw).toLowerCase();
            const b64 = keys[hashRaw];
            if (typeof b64 !== 'string') continue;
            let key;
            try { key = Buffer.from(b64, 'base64'); } catch (_e) { continue; }
            if (!Buffer.isBuffer(key) || key.length !== 32) continue;
            // Verify key matches its claimed hash (defends against malformed payloads).
            if (!sdk.gatedFile.verifyKey(key, hash)) continue;
            found[hash] = key;
            KEY_CACHE.set(keyKey(address, hash), key);
        }
    }
    return found;
}

/**
 * Unlock a single gated file. Fetches ciphertext from the explorer,
 * locates the symmetric key in the holder's MESSAGE history (using the
 * cache when populated), AES-256-GCM-decrypts. Verifies the key matches
 * the file's KEY_HASH before decrypting.
 *
 * @param {{
 *   sdk: import('xchain-sdk').XChainSDK,
 *   address: string,
 *   wif: string,
 *   actionIndex: number | string,
 *   keyHash: string,
 * }} params
 * @returns {Promise<Uint8Array>} decrypted plaintext bytes
 */
export async function unlockGatedFile({ sdk, address, wif, actionIndex, keyHash }) {
    if (!sdk) throw new Error('unlockGatedFile: sdk is required');
    if (!address) throw new Error('unlockGatedFile: address is required');
    if (!actionIndex) throw new Error('unlockGatedFile: actionIndex is required');
    if (!keyHash) throw new Error('unlockGatedFile: keyHash is required');

    const cachedPlaintext = PT_CACHE.get(ptKey(address, actionIndex));
    if (cachedPlaintext) return cachedPlaintext;

    // Resolve the key: cache first, fallback to a MESSAGE scan.
    let key = KEY_CACHE.get(keyKey(address, keyHash));
    if (!key) {
        if (!wif) throw new Error('unlockGatedFile: wif is required to scan key handoffs');
        const discovered = await scanGatedKeyHandoffs({ sdk, address, wif });
        key = discovered[String(keyHash).toLowerCase()] || KEY_CACHE.get(keyKey(address, keyHash)) || null;
    }
    if (!key) {
        const err = new Error('No key handoff found for this gated file. Ask the seller to re-send.');
        err.code = 'GATED_FILE_KEY_MISSING';
        throw err;
    }

    // Fetch the ciphertext bytes from the explorer.
    const ciphertext = await sdk.getGatedFileRaw(actionIndex);
    if (!ciphertext || !Buffer.isBuffer(ciphertext) || ciphertext.length === 0) {
        const err = new Error('Gated file ciphertext not available from explorer.');
        err.code = 'GATED_FILE_NOT_FOUND';
        throw err;
    }

    // Decrypt — GCM auth tag mismatch surfaces as a typed SDK error.
    const plaintext = sdk.gatedFile.decryptFileBytes(ciphertext, key);
    PT_CACHE.set(ptKey(address, actionIndex), plaintext);
    return plaintext;
}

/**
 * Unlock every file in a pack with a single key fetch + decrypt loop.
 * All files share the same KEY_HASH so the MESSAGE scan happens at most
 * once. Returns an array of `{ actionIndex, plaintext }` aligned with
 * the input `fileEntries`.
 *
 * @param {{
 *   sdk: import('xchain-sdk').XChainSDK,
 *   address: string,
 *   wif: string,
 *   keyHash: string,
 *   fileEntries: Array<{ actionIndex: number | string }>,
 * }} params
 * @returns {Promise<Array<{ actionIndex: string, plaintext: Uint8Array }>>}
 */
export async function unlockGatedPack({ sdk, address, wif, keyHash, fileEntries }) {
    if (!Array.isArray(fileEntries) || fileEntries.length === 0)
        return [];
    // Warm the cache once so per-file unlock skips the MESSAGE scan.
    if (!KEY_CACHE.has(keyKey(address, keyHash))) {
        if (!wif) throw new Error('unlockGatedPack: wif is required to scan key handoffs');
        await scanGatedKeyHandoffs({ sdk, address, wif });
    }
    const out = [];
    for (const entry of fileEntries) {
        const plaintext = await unlockGatedFile({
            sdk, address, wif,
            actionIndex: entry.actionIndex,
            keyHash,
        });
        out.push({ actionIndex: String(entry.actionIndex), plaintext });
    }
    return out;
}

/**
 * Build the JSON payload an issuer or current holder sends to a
 * recipient inside an ECIES MESSAGE alongside a SEND of a gated token.
 * The payload covers every distinct KEY_HASH the recipient needs to
 * unlock all gated files for the token.
 *
 * @param {{
 *   sdk: import('xchain-sdk').XChainSDK,
 *   keysByHash: Record<string, Buffer>,
 * }} params
 * @returns {string} JSON string ready for ECIES encryption
 */
export function buildKeyHandoffPayload({ sdk, keysByHash }) {
    if (!sdk) throw new Error('buildKeyHandoffPayload: sdk is required');
    return sdk.gatedFile.serializeKeyPayload(keysByHash);
}

/**
 * High-level wrapper used by the IPC handler. Exports the WIF for the
 * caller's address (password-gated), resolves the SDK for the address's
 * chain, then decrypts the gated file via `unlockGatedFile`. Returns
 * the plaintext as a base64 string so it can cross the IPC boundary
 * safely (Uint8Array doesn't structuredClone cleanly into the popup).
 *
 * @param {{
 *   vault: import('../storage/Vault.js').Vault,
 *   walletId: string,
 *   password: string,
 *   bip39Passphrase?: string,
 *   chainRegistry: import('../registry/index.js').ChainRegistry,
 *   sdkRegistry: import('../sdk/SDKRegistry.js').SDKRegistry,
 *   addressId: string,
 *   actionIndex: number | string,
 *   keyHash: string,
 * }} params
 * @returns {Promise<{ address: string, chainId: string, actionIndex: string, plaintextBase64: string, byteLength: number }>}
 */
export async function unlockGatedFileForAddress({
    vault,
    walletId,
    password,
    bip39Passphrase,
    chainRegistry,
    sdkRegistry,
    addressId,
    actionIndex,
    keyHash,
}) {
    if (!vault) throw new Error('unlockGatedFileForAddress: vault is required');
    if (!sdkRegistry) throw new Error('unlockGatedFileForAddress: sdkRegistry is required');
    if (!actionIndex) throw new Error('unlockGatedFileForAddress: actionIndex is required');
    if (!keyHash) throw new Error('unlockGatedFileForAddress: keyHash is required');

    const { wif, address, chainId } = await exportPrivateKey({
        vault,
        walletId,
        password,
        bip39Passphrase,
        chainRegistry,
        sdkRegistry,
        addressId,
    });

    const sdk = sdkRegistry.get(chainId);
    const plaintext = await unlockGatedFile({
        sdk,
        address,
        wif,
        actionIndex,
        keyHash,
    });

    return {
        address,
        chainId,
        actionIndex: String(actionIndex),
        plaintextBase64: Buffer.from(plaintext).toString('base64'),
        byteLength: plaintext.length,
    };
}

/**
 * List the gated files for a token by querying the explorer's
 * `/api/files/{tick}/token` endpoint and filtering for rows with a
 * non-empty `gate_ticker`. Results are grouped by `key_hash` so the
 * caller can render packs as a single header with all member files
 * underneath. Single-file gated entries are returned as one-element
 * groups.
 *
 * @param {{
 *   sdk: import('xchain-sdk').XChainSDK,
 *   tick: string,
 * }} params
 * @returns {Promise<Array<{
 *   keyHash: string,
 *   encryptionMethod: number,
 *   gateTicker: string,
 *   files: Array<{
 *     actionIndex: string,
 *     name: string,
 *     type: string | null,
 *     title: string | null,
 *     status: string | null,
 *   }>,
 * }>>}
 */
export async function listGatedFiles({ sdk, tick }) {
    if (!sdk) throw new Error('listGatedFiles: sdk is required');
    if (!tick) throw new Error('listGatedFiles: tick is required');
    const rows = await sdk.getFiles(tick, 'token');
    const list = Array.isArray(rows) ? rows : (rows && Array.isArray(rows.data) ? rows.data : []);
    const byKeyHash = /** @type {Map<string, any>} */ (new Map());
    for (const row of list) {
        const gate = row && row.gate_ticker ? String(row.gate_ticker) : null;
        if (!gate || gate !== String(tick)) continue;
        const keyHash = row.key_hash ? String(row.key_hash).toLowerCase() : null;
        if (!keyHash) continue;
        if (!byKeyHash.has(keyHash)) {
            byKeyHash.set(keyHash, {
                keyHash,
                encryptionMethod: Number(row.encryption_method) || 1,
                gateTicker: gate,
                files: [],
            });
        }
        byKeyHash.get(keyHash).files.push({
            actionIndex: String(row.action_index),
            name: row.name ? String(row.name) : '(unnamed)',
            type: row.type ? String(row.type) : null,
            title: row.title ? String(row.title) : null,
            status: row.status ? String(row.status) : null,
        });
    }
    return Array.from(byKeyHash.values());
}
