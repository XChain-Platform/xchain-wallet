// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Remote chain-registry sync (§9.7 / G007): fetch the hub's public
// GET /api/v1/chain-registry snapshot, verify its Ed25519 signature against a
// pinned federation key, and hot-swap the verified descriptors into the shared
// ChainRegistry. Fail-closed by design: an unsigned, unpinned, tampered, or
// structurally invalid payload changes nothing and the wallet keeps running on
// its bundled descriptors.

import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import { validateChainDescriptor } from './validate.js';

// The hub signs: 'XCHAIN_CHAIN_REGISTRY_V1|' + generated_at + '|' +
// sha256hex(JSON.stringify(descriptors)) with its Ed25519 identity
// (xchain-hub src/api.js chain-registry route). Key order survives the JSON
// round-trip on both sides, so the digest is byte-stable.
export const REGISTRY_SIGNING_DOMAIN = 'XCHAIN_CHAIN_REGISTRY_V1';

// Pinned federation registry signing key: the hub.xchain.io validator identity
// (signer_pubkey observed live 2026-07-06). Rotating the federation key means
// shipping a wallet update; that is the point of pinning.
export const REGISTRY_PINNED_PUBKEY_HEX =
    '4a523cf4ae4fe92d1ab6058cd9e6a9aa20d5e5e6f3acad436ccf6f7788f8e07c';

// Sanctioned public discovery endpoint (the only registry URL the wallet
// trusts by default; overridable for regtest/self-hosted federations).
export const REGISTRY_DEFAULT_URL = 'https://hub.xchain.io/api/v1/chain-registry';

/**
 * Verify a chain-registry response body against the pinned federation key.
 * Pure and side-effect free; network and registry mutation live in
 * syncChainRegistryFromHub().
 *
 * @param {object} body   parsed response ({ descriptors, generatedAt, signer_pubkey, signature })
 * @param {{ pinnedPubkeyHex?: string }} [opts]
 * @returns {{ ok: boolean, reason?: string }}
 */
export function verifyChainRegistry(body, opts = {}) {
    const pinned = (opts.pinnedPubkeyHex ?? REGISTRY_PINNED_PUBKEY_HEX).toLowerCase();
    if (!body || typeof body !== 'object') return { ok: false, reason: 'empty response' };
    if (!Array.isArray(body.descriptors) || body.descriptors.length === 0)
        return { ok: false, reason: 'no descriptors in response' };
    if (typeof body.generatedAt !== 'string' || !body.generatedAt)
        return { ok: false, reason: 'missing generatedAt' };
    // Unsigned responses are rejected outright: a standalone hub serves the
    // registry unsigned, but a pinning client must never accept that.
    if (typeof body.signature !== 'string' || !/^[0-9a-fA-F]{128}$/.test(body.signature))
        return { ok: false, reason: 'missing or malformed signature' };
    if (typeof body.signer_pubkey !== 'string' || body.signer_pubkey.toLowerCase() !== pinned)
        return { ok: false, reason: 'signer is not the pinned federation key' };

    const digest = bytesToHex(sha256(utf8ToBytes(JSON.stringify(body.descriptors))));
    const payload = REGISTRY_SIGNING_DOMAIN + '|' + body.generatedAt + '|' + digest;
    let valid = false;
    try {
        valid = ed25519.verify(hexToBytes(body.signature), utf8ToBytes(payload), hexToBytes(pinned));
    } catch (e) {
        return { ok: false, reason: 'signature verification error: ' + (e?.message ?? e) };
    }
    return valid ? { ok: true } : { ok: false, reason: 'signature does not verify' };
}

/**
 * Fetch, verify, and hot-swap the hub's chain registry into `registry`.
 * Every failure mode returns { ok: false, reason } and leaves the registry
 * untouched; the caller decides whether/where to surface it (boot sync is
 * silent by design, Developer Mode can show the reason).
 *
 * @param {{
 *   registry: import('./index.js').ChainRegistry,
 *   url?: string,
 *   pinnedPubkeyHex?: string,
 *   fetchImpl?: typeof fetch,
 * }} opts
 * @returns {Promise<{ ok: boolean, added?: string[], updated?: string[], skipped?: string[], generatedAt?: string, descriptors?: import('./validate.js').ChainDescriptor[], reason?: string }>}
 */
export async function syncChainRegistryFromHub(opts) {
    const { registry } = opts;
    const url = opts.url ?? REGISTRY_DEFAULT_URL;
    const doFetch = opts.fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
    if (!registry) return { ok: false, reason: 'no registry instance' };
    if (!doFetch) return { ok: false, reason: 'no fetch implementation available' };

    let body;
    try {
        const res = await doFetch(url, { method: 'GET', headers: { accept: 'application/json' } });
        if (!res.ok) return { ok: false, reason: 'registry endpoint returned HTTP ' + res.status };
        body = await res.json();
    } catch (e) {
        return { ok: false, reason: 'registry fetch failed: ' + (e?.message ?? e) };
    }

    const verdict = verifyChainRegistry(body, { pinnedPubkeyHex: opts.pinnedPubkeyHex });
    if (!verdict.ok) return { ok: false, reason: verdict.reason };

    // Validate the whole set BEFORE touching the registry: one bad descriptor
    // rejects the batch, so a partially-applied registry can never exist.
    for (const d of body.descriptors) {
        const res = validateChainDescriptor(d);
        if (!res.ok)
            return { ok: false, reason: 'invalid descriptor "' + (d?.id ?? '?') + '": ' + res.errors.join('; ') };
    }

    const summary = registry.applyRemoteDescriptors(body.descriptors);
    // The verified batch rides along so a multi-realm shell (Electron
    // main + renderer) can re-apply it in realms that cannot reach the
    // network themselves (desktop renderer CSP pins connect-src 'self').
    return { ok: true, generatedAt: body.generatedAt, descriptors: body.descriptors, ...summary };
}
