// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Token-gated content flow. Fetches a gated FILE's ciphertext from
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
import { inflateGatedPlaintext, resolveGatedCompression } from './payloadCompression.js';
import { createGatedKey, gatedKeyId } from '../schemas/gatedKey.js';
import {
    getDemoGatedGroupsForTick,
    getDemoGatedPlaintextBase64,
    isDemoGatedActionIndex,
} from './demoGatedContent.js';

// @noble/hashes is pure-JS so this code path works in every shell
// target (popup / extension service worker / web bundle / desktop
// renderer. Node's `crypto` module isn't reachable from Vite's
// browser builds, hence the swap.
import { sha256 } from '@noble/hashes/sha2';

const KEY_CACHE = /** @type {Map<string, Buffer>} */ (new Map());
const PT_CACHE  = /** @type {Map<string, Uint8Array>} */ (new Map());

function keyKey(address, keyHash) { return address + '|' + String(keyHash).toLowerCase(); }
function ptKey(address, actionIndex) { return address + '|' + String(actionIndex); }
function sha256Hex(buf) {
    // Copy into the ambient Uint8Array class before hashing: @noble/hashes
    // type-checks its input against it, and a Buffer is not a subclass of
    // it in dual-realm hosts (vitest's jsdom; any embedder with a foreign
    // Buffer polyfill).
    const digest = sha256(Uint8Array.from(buf));
    let out = '';
    for (let i = 0; i < digest.length; i += 1) {
        out += digest[i].toString(16).padStart(2, '0');
    }
    return out;
}

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
 * Scan the holder's MESSAGEs (auto-decrypted by the SDK) for binary
 * key-handoff payloads and populate the per-address key cache. Each
 * ECIES MESSAGE addressed to the holder is treated as a candidate
 * handoff: the binary payload is parsed into 32-byte keys, each is
 * hashed, and the resulting (address, sha256(K)) → K entry lands in
 * the cache. Returns the map of keyHash → key Buffer discovered in
 * this scan. Safe to call multiple times.
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
    // auto-decrypts ECIES (method 1) entries when wif is supplied and
    // exposes the raw plaintext via msg.bytes so binary key-handoff
    // payloads survive without utf8 corruption.
    const messages = await sdk.getMessagesForAddress(
        address,
        { ...(opts || {}), wif, type: 'received' },
    );
    if (!Array.isArray(messages)) return found;

    for (const msg of messages) {
        const bytes = msg && Buffer.isBuffer(msg.bytes) ? msg.bytes : null;
        if (!bytes) continue;

        let candidateKeys;
        try { candidateKeys = sdk.gatedFile.parseKeyPayload(bytes); }
        catch (_e) { continue; }
        if (!Array.isArray(candidateKeys) || candidateKeys.length === 0) continue;

        for (const key of candidateKeys) {
            if (!Buffer.isBuffer(key) || key.length !== 32) continue;
            const hash = sha256Hex(key);
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
export async function unlockGatedFile({ sdk, address, wif, actionIndex, keyHash, compression = null }) {
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

    // Decrypt. GCM auth tag mismatch surfaces as a typed SDK error.
    const decrypted = sdk.gatedFile.decryptFileBytes(ciphertext, key);

    // Inflate AFTER decrypt (spec §5.4). Gated payloads are compressed
    // before encryption, so this is the only place the original bytes can be
    // recovered: the serving layer holds no key and never inflates ciphertext.
    // Fail-closed: an invalid stream or a tripped ratio guard yields the
    // decrypted bytes as stored-form, never partial output and never a throw.
    const declared = await resolveGatedCompression({ sdk, actionIndex, declared: compression });
    const result = await inflateGatedPlaintext(decrypted, declared);
    const plaintext = Buffer.from(result.bytes);

    // Cache the FINAL bytes so a repeat unlock neither re-inflates nor re-probes.
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
 * Build the binary payload an issuer or current holder sends to a
 * recipient inside an ECIES MESSAGE alongside a SEND of a gated token.
 * The payload covers every distinct K the recipient needs to unlock
 * all gated files for the token. The recipient hashes each 32-byte
 * candidate to identify which gated FILE it unlocks.
 *
 * Pass the returned Buffer as the `message` field of `sdk.sendMessage`
 * (or `messaging.send`). The messaging layer detects the Buffer and
 * encrypts via the binary ECIES path so the bytes survive intact.
 *
 * @param {{
 *   sdk: import('xchain-sdk').XChainSDK,
 *   keysByHash: Record<string, Buffer>,
 * }} params
 * @returns {Buffer} Binary payload ready for ECIES encryption.
 */
export function buildKeyHandoffPayload({ sdk, keysByHash }) {
    if (!sdk) throw new Error('buildKeyHandoffPayload: sdk is required');
    return sdk.gatedFile.serializeKeyPayload(keysByHash);
}

/**
 * High-level wrapper used by the IPC handler. Resolution order (PC-27):
 *
 *   1. Demo fixtures (no crypto).
 *   2. Vault gatedKeys row for (walletId, chainId, gateTicker, keyHash),
 *      when the caller supplies `gateTicker` + `chainId`: decryption is
 *      pure AES with the stored K, so no password, no WIF export, and
 *      no MESSAGE scan. This is what makes unlock durable across
 *      lock/restart and reachable for keys that arrived at publish
 *      time (HW issuers) or from a prior recovery scan.
 *   3. Password-gated WIF export + ECIES MESSAGE scan (software
 *      signers only). On success the recovered key is persisted back
 *      into the vault (source 'recovered') so step 2 serves the next
 *      unlock.
 *
 * Returns the plaintext as a base64 string so it can cross the IPC
 * boundary safely (Uint8Array doesn't structuredClone cleanly into
 * the popup).
 *
 * @param {{
 *   vault: import('../storage/Vault.js').Vault,
 *   walletId: string,
 *   password?: string,
 *   bip39Passphrase?: string,
 *   chainRegistry: import('../registry/index.js').ChainRegistry,
 *   sdkRegistry: import('../sdk/SDKRegistry.js').SDKRegistry,
 *   addressId?: string,
 *   actionIndex: number | string,
 *   keyHash: string,
 *   gateTicker?: string,   enables the vault key cache (read + write-back)
 *   chainId?: string,      required alongside gateTicker for the vault path
 * }} params
 * @returns {Promise<{ address: string | null, chainId: string, actionIndex: string, plaintextBase64: string, byteLength: number }>}
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
    gateTicker,
    chainId,
    compression = null,
}) {
    if (!actionIndex) throw new Error('unlockGatedFileForAddress: actionIndex is required');
    if (!keyHash) throw new Error('unlockGatedFileForAddress: keyHash is required');

    // Demo content short-circuit: bypass crypto entirely so the demo
    // wallet can show what unlocked files look like without needing a
    // real key handoff or explorer ciphertext.
    if (isDemoGatedActionIndex(actionIndex)) {
        const demo = getDemoGatedPlaintextBase64(actionIndex);
        if (demo) {
            return {
                address: 'demo',
                chainId: 'demo',
                actionIndex: String(actionIndex),
                plaintextBase64: demo.plaintextBase64,
                byteLength: demo.byteLength,
            };
        }
    }

    if (!vault) throw new Error('unlockGatedFileForAddress: vault is required');
    if (!sdkRegistry) throw new Error('unlockGatedFileForAddress: sdkRegistry is required');

    const keyHashLower = String(keyHash).toLowerCase();

    // Step 2: durable vault key cache. Re-verified against KEY_HASH so
    // a corrupted row can never decrypt-and-serve the wrong bytes.
    if (walletId && gateTicker && chainId && vault.gatedKeys) {
        const row = await vault.gatedKeys.get(gatedKeyId({
            walletId, chainId, gateTicker, keyHash: keyHashLower,
        }));
        if (row?.keyHex) {
            const key = Buffer.from(row.keyHex, 'hex');
            const sdk = sdkRegistry.get(chainId);
            if (sdk.gatedFile.verifyKey(key, keyHashLower)) {
                const cacheAddr = `vault:${walletId}`;
                let plaintext = PT_CACHE.get(ptKey(cacheAddr, actionIndex));
                if (!plaintext) {
                    const ciphertext = await sdk.getGatedFileRaw(actionIndex);
                    if (!ciphertext || !Buffer.isBuffer(ciphertext) || ciphertext.length === 0) {
                        const err = new Error('Gated file ciphertext not available from explorer.');
                        err.code = 'GATED_FILE_NOT_FOUND';
                        throw err;
                    }
                    const decrypted = sdk.gatedFile.decryptFileBytes(ciphertext, key);
                    // Inflate-after-decrypt, same rule as unlockGatedFile (§5.4).
                    const declared = await resolveGatedCompression({ sdk, actionIndex, declared: compression });
                    const inflatedResult = await inflateGatedPlaintext(decrypted, declared);
                    plaintext = Buffer.from(inflatedResult.bytes);
                    PT_CACHE.set(ptKey(cacheAddr, actionIndex), plaintext);
                }
                return {
                    address: null,
                    chainId,
                    actionIndex: String(actionIndex),
                    plaintextBase64: Buffer.from(plaintext).toString('base64'),
                    byteLength: plaintext.length,
                };
            }
        }
    }

    // Step 3: password-gated WIF export + MESSAGE scan.
    const { wif, address, chainId: addrChainId } = await exportPrivateKey({
        vault,
        walletId,
        password,
        bip39Passphrase,
        chainRegistry,
        sdkRegistry,
        addressId,
    });

    const sdk = sdkRegistry.get(addrChainId);
    const plaintext = await unlockGatedFile({
        sdk,
        address,
        wif,
        actionIndex,
        keyHash,
    });

    // Write-back: the scan just proved this address holds K for the
    // pack; persist it so the next unlock (and the PC-26 send guard /
    // PC-34 migrate gate) reads the vault instead of re-scanning. A
    // failed cache write must not fail an unlock that already
    // succeeded, so persistence errors are swallowed.
    if (walletId && gateTicker && vault.gatedKeys) {
        try {
            const key = getCachedGatedKey(address, keyHashLower);
            if (key && sdk.gatedFile.verifyKey(key, keyHashLower)) {
                const id = gatedKeyId({
                    walletId, chainId: addrChainId, gateTicker, keyHash: keyHashLower,
                });
                const existing = await vault.gatedKeys.get(id);
                if (!existing?.keyHex) {
                    await vault.gatedKeys.put(createGatedKey({
                        walletId,
                        chainId: addrChainId,
                        gateTicker,
                        keyHash: keyHashLower,
                        keyHex: key.toString('hex'),
                        source: 'recovered',
                    }));
                }
            }
        } catch (_e) {
            // Cache-persist only; the unlock result stands.
        }
    }

    return {
        address,
        chainId: addrChainId,
        actionIndex: String(actionIndex),
        plaintextBase64: Buffer.from(plaintext).toString('base64'),
        byteLength: plaintext.length,
    };
}

/**
 * PC-26 key-recovery scan, vault-persisted. Runs the ECIES MESSAGE scan
 * across the wallet's software-signable addresses on a chain and writes
 * every key that matches one of `tick`'s active gated packs into the
 * vault's gatedKeys collection (source 'recovered'), so recovered keys
 * survive lock/restart and back both the send guard and the PC-34
 * migrate gate. Keys found for OTHER ticks stay in the in-memory scan
 * cache only (they cannot be attributed to a gateTicker without
 * enumerating every tick's files; a later scan for that tick will
 * persist them).
 *
 * Software signers only: the scan decrypts with each address's private
 * key. HW / watch-only addresses are skipped (their key source is a
 * vault row written at publish time).
 *
 * @param {{
 *   vault: import('../storage/Vault.js').Vault,
 *   walletId: string,
 *   password: string,
 *   bip39Passphrase?: string,
 *   chainRegistry: import('../registry/index.js').ChainRegistry,
 *   sdkRegistry: import('../sdk/SDKRegistry.js').SDKRegistry,
 *   chainId: string,
 *   tick: string,
 *   addresses: Array<import('../schemas/address.js').Address>,   wallet addresses on chainId (caller enumerates; the host has the byChain helper)
 * }} params
 * @returns {Promise<{ recoveredKeyHashes: string[], stillMissingKeyHashes: string[], scannedAddresses: number }>}
 */
export async function recoverGatedKeysForTick({
    vault, walletId, password, bip39Passphrase, chainRegistry, sdkRegistry, chainId, tick, addresses,
}) {
    if (!vault) throw new Error('recoverGatedKeysForTick: vault is required');
    if (!walletId) throw new Error('recoverGatedKeysForTick: walletId is required');
    if (!tick) throw new Error('recoverGatedKeysForTick: tick is required');
    const sdk = sdkRegistry.get(chainId);
    const tickUpper = String(tick).trim().toUpperCase();

    // Target hashes: the tick's active real (non-demo) packs.
    const groups = (await listGatedFiles({ sdk, tick: tickUpper })).filter((g) => {
        const files = Array.isArray(g?.files) ? g.files : [];
        return files.length > 0 && !files.every((f) => isDemoGatedActionIndex(f.actionIndex));
    });
    const wanted = new Set(groups.map((g) => String(g.keyHash).toLowerCase()));
    if (wanted.size === 0) {
        return { recoveredKeyHashes: [], stillMissingKeyHashes: [], scannedAddresses: 0 };
    }

    // Already in the vault? Don't rescan for those.
    for (const hash of [...wanted]) {
        const row = await vault.gatedKeys.get(gatedKeyId({
            walletId, chainId, gateTicker: tickUpper, keyHash: hash,
        }));
        if (row?.keyHex && sdk.gatedFile.verifyKey(Buffer.from(row.keyHex, 'hex'), hash)) {
            wanted.delete(hash);
        }
    }

    const recovered = /** @type {string[]} */ ([]);
    let scanned = 0;
    const scannable = (Array.isArray(addresses) ? addresses : []).filter((a) => a
        && a.source !== 'watch-only' && a.source !== 'trezor' && a.source !== 'ledger');
    for (const addr of scannable) {
        if (wanted.size === 0) break;
        let wif;
        let address;
        try {
            ({ wif, address } = await exportPrivateKey({
                vault, walletId, password, bip39Passphrase,
                chainRegistry, sdkRegistry, addressId: addr.id,
            }));
        } catch (err) {
            // A wrong password must surface (retrying every address under
            // bad creds hammers the KDF and hides the real problem); an
            // address the signer cannot export is just skipped.
            if (err?.name === 'WrongPasswordError' || err?.name === 'InvalidPasswordError') throw err;
            continue;
        }
        scanned += 1;
        let found;
        try {
            found = await scanGatedKeyHandoffs({ sdk, address, wif });
        } catch (_e) {
            continue;
        }
        for (const [hash, key] of Object.entries(found)) {
            const lower = String(hash).toLowerCase();
            if (!wanted.has(lower)) continue;
            if (!sdk.gatedFile.verifyKey(key, lower)) continue;
            await vault.gatedKeys.put(createGatedKey({
                walletId,
                chainId,
                gateTicker: tickUpper,
                keyHash: lower,
                keyHex: key.toString('hex'),
                source: 'recovered',
            }));
            wanted.delete(lower);
            recovered.push(lower);
        }
    }
    return {
        recoveredKeyHashes: recovered,
        stillMissingKeyHashes: [...wanted],
        scannedAddresses: scanned,
    };
}

/**
 * PC-34 migrate gate, custody leg: re-scope the source wallet's stored
 * gated keys to another wallet in the SAME vault. Vault rows are keyed
 * by walletId, so after a BIP39 migration the new wallet cannot see
 * keys recovered/published under the legacy wallet - and it can never
 * re-derive them on-chain either (handoff MESSAGEs are ECIES-encrypted
 * to the OLD addresses). Copying the rows is what actually makes the
 * "keys survive migration" promise true for the new wallet.
 *
 * Pure vault operation (no password, no network): keyHex never leaves
 * the background context. Rows already present under the target wallet
 * are left untouched (never overwrite a key the target trusts); the
 * original rows stay with the legacy wallet.
 *
 * @param {{
 *   vault: import('../storage/Vault.js').Vault,
 *   fromWalletId: string,
 *   toWalletId: string,
 *   chainId?: string,    optional scope; default = every chain's rows
 * }} params
 * @returns {Promise<{ copied: number, skipped: number }>}
 */
export async function copyGatedKeysToWallet({ vault, fromWalletId, toWalletId, chainId }) {
    if (!vault) throw new Error('copyGatedKeysToWallet: vault is required');
    if (!fromWalletId) throw new Error('copyGatedKeysToWallet: fromWalletId is required');
    if (!toWalletId) throw new Error('copyGatedKeysToWallet: toWalletId is required');
    if (fromWalletId === toWalletId) return { copied: 0, skipped: 0 };
    const rows = (await vault.gatedKeys.list()).filter((r) => r.walletId === fromWalletId
        && (!chainId || r.chainId === chainId));
    let copied = 0;
    let skipped = 0;
    for (const row of rows) {
        const targetId = gatedKeyId({
            walletId: toWalletId,
            chainId: row.chainId,
            gateTicker: row.gateTicker,
            keyHash: row.keyHash,
        });
        const existing = await vault.gatedKeys.get(targetId);
        if (existing?.keyHex) { skipped += 1; continue; }
        await vault.gatedKeys.put(createGatedKey({
            walletId: toWalletId,
            chainId: row.chainId,
            gateTicker: row.gateTicker,
            keyHash: row.keyHash,
            keyHex: row.keyHex,
            source: row.source,
        }));
        copied += 1;
    }
    return { copied, skipped };
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
 *     gateMinAmount: string | null,   PC-29 unlock threshold; null until the
 *                                     GATE_MIN_AMOUNT flag day lands and the
 *                                     explorer starts serving the column
 *   }>,
 * }>>}
 */
export async function listGatedFiles({ sdk, tick }) {
    if (!tick) throw new Error('listGatedFiles: tick is required');

    // Demo content short-circuit: known demo tickers serve in-memory
    // fixtures so the wallet's Unlock tab has something to render even
    // when no real explorer is wired up.
    const demoGroups = getDemoGatedGroupsForTick(tick);

    // No SDK + demo groups available => return demo only (skip explorer).
    if (!sdk) {
        if (demoGroups.length > 0) return demoGroups;
        throw new Error('listGatedFiles: sdk is required');
    }

    const rows = await sdk.getFiles(tick, 'token').catch(() => []);
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
            // PC-29: tolerate both snake and camel spellings; absent or
            // non-positive reads as "no threshold".
            gateMinAmount: (() => {
                const v = row.gate_min_amount ?? row.gateMinAmount;
                if (v == null || String(v).trim() === '') return null;
                const s = String(v).trim();
                return /^\d+(\.\d+)?$/.test(s) && Number(s) > 0 ? s : null;
            })(),
        });
    }
    return [...demoGroups, ...Array.from(byKeyHash.values())];
}
