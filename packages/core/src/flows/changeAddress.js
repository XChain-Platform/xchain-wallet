// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Change-address rotation (§35.1 Privacy, ).
//
// Settings > Privacy offers "Use a fresh change address for every send".
// Until this file existed the toggle drove nothing: every flow handed the
// encoder `change: source.address`, so the leftover value came straight
// back to the address that spent it - the exact reuse the setting says it
// prevents, and a security claim the wallet could not keep.
//
// What a rotation is here: the next unused address on the account's
// INTERNAL BIP44 branch (change=1) for the spending address's own
// (chain, network, addressType) tuple, persisted as an Address record with
// role 'change' before the transaction is built. Internal, not external,
// so a rotated change address never competes with a receive address for an
// index and never becomes the account's default operating address
// (flows/activeAddress.js picks from change=0 only).
//
// The record is persisted eagerly, before the PSBT exists. That burns an
// index when a send is abandoned, which is the correct trade: a gap in the
// internal branch is invisible and re-scannable, whereas handing the
// encoder an address the wallet has not written down would put change at a
// key the wallet cannot find after a restore.
//
// Fail-OPEN by design. Every reason a rotation cannot happen (rotation off,
// imported-WIF or watch-only source, no signer in hand, a signer that
// refuses to derive) resolves back to the spending address, which is what
// the wallet did before this file. A privacy preference must never be the
// reason a send cannot be composed.

import { createAddress } from '../schemas/address.js';
import { tickerForCoin } from '../registry/coinTicker.js';
import { indexSpaceSharedForWallet } from './_addressIndexSpace.js';

/** BIP44 internal branch. m / purpose' / coin' / account' / 1 / index */
export const CHANGE_BRANCH = 1;

/** HD-derived sources: these share one index space per branch per account. */
const HD_SOURCES = new Set(['hd', 'trezor', 'ledger']);

/**
 * Is change-address rotation switched on in this Settings record?
 *
 * Strict `=== true`: the flag is optional on v2-tolerant records and an
 * absent/garbled value must read as OFF, never as "rotate" (rotating
 * unasked moves a user's balance to an address they did not choose).
 *
 * @param {{ privacy?: { changeAddressRotation?: unknown } } | null | undefined} settings
 * @returns {boolean}
 */
export function changeRotationEnabled(settings) {
    return settings?.privacy?.changeAddressRotation === true;
}

/**
 * The BIP44 branch segment a derivation path ends on ('0' external,
 * '1' internal), read END-relative so a counterwallet-legacy path
 * (m/0'/C/I, which has no purpose/coin/account triple) parses the same way
 * a BIP39 one does. Returns null when the tail cannot be read.
 *
 * @param {unknown} derivationPath
 * @returns {{ branch: string, index: number } | null}
 */
export function branchOf(derivationPath) {
    if (typeof derivationPath !== 'string') return null;
    const parts = derivationPath.split('/');
    if (parts.length < 3) return null;
    const index = Number(parts[parts.length - 1]);
    if (!Number.isFinite(index)) return null;
    return { branch: parts[parts.length - 2], index };
}

/**
 * Next free internal index for one (account, chain, network, addressType)
 * tuple, given every persisted Address record.
 *
 * A counterwallet-legacy wallet derives m/0'/C/I for EVERY address type, so
 * its types share one index space and the addressType filter must not apply
 * (see ./_addressIndexSpace.js): partitioning by type there would re-issue
 * a key the wallet already holds under another encoding.
 *
 * @param {import('../schemas/address.js').Address[]} addresses
 * @param {Object} scope
 * @param {string} scope.accountId
 * @param {string} scope.coin
 * @param {string} scope.network
 * @param {string} scope.addressType
 * @param {boolean} scope.sharedIndexSpace
 * @returns {{ nextIndex: number, changeCount: number }}
 */
export function nextChangeIndex(addresses, {
    accountId, coin, network, addressType, sharedIndexSpace,
}) {
    let highest = -1;
    let changeCount = 0;
    for (const a of addresses || []) {
        if (a.accountId !== accountId) continue;
        if (a.chain !== coin) continue;
        if (a.network !== network) continue;
        if (!sharedIndexSpace && a.addressType !== addressType) continue;
        if (!HD_SOURCES.has(a.source)) continue;
        const parsed = branchOf(a.derivationPath);
        if (!parsed || parsed.branch !== String(CHANGE_BRANCH)) continue;
        changeCount += 1;
        if (parsed.index > highest) highest = parsed.index;
    }
    return { nextIndex: highest + 1, changeCount };
}

/**
 * The persisted Address record for a spending address on one chain.
 *
 * Matched on (address, coin, network) rather than address alone: the same
 * string can exist under two networks in a registry that carries both, and
 * the change branch must be allocated inside the right account.
 *
 * @param {import('../schemas/address.js').Address[]} addresses
 * @param {{ address: string, coin: string, network: string }} scope
 * @returns {import('../schemas/address.js').Address | null}
 */
export function findSourceRecord(addresses, { address, coin, network }) {
    for (const a of addresses || []) {
        if (a.address !== address) continue;
        if (a.chain !== coin) continue;
        if (a.network !== network) continue;
        return a;
    }
    return null;
}

/**
 * @typedef {Object} DeriveChangeAddressOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {import('../signers/Signer.js').Signer} signer   already-unlocked signer; this flow never unlocks one itself
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {string} chainId
 * @property {string} sourceAddress                            the spending address the change would otherwise return to
 */

/**
 * Derive + persist the next internal (change=1) address for the account
 * that owns `sourceAddress`.
 *
 * Returns null - never throws - when the source is not an HD address of a
 * known account, which is the imported-WIF / watch-only / unknown-address
 * case. Those wallets hold exactly one key per address and have no branch
 * to rotate onto; their change must keep returning to the spender.
 *
 * @param {DeriveChangeAddressOpts} opts
 * @returns {Promise<import('../schemas/address.js').Address | null>}
 */
export async function deriveChangeAddress({
    vault, walletId, signer, chainRegistry, chainId, sourceAddress,
}) {
    if (!vault || !signer || !chainRegistry) return null;
    if (typeof sourceAddress !== 'string' || sourceAddress.length === 0) return null;
    if (typeof signer.getAddresses !== 'function') return null;

    const descriptor = chainRegistry.get?.(chainId);
    if (!descriptor) return null;

    const allAddresses = await vault.addresses.list();
    const sourceRecord = findSourceRecord(allAddresses, {
        address: sourceAddress,
        coin: descriptor.coin,
        network: descriptor.networkKind,
    });
    // No record, no account, or a non-HD source: nothing to rotate onto.
    if (!sourceRecord) return null;
    if (!HD_SOURCES.has(sourceRecord.source)) return null;
    if (typeof sourceRecord.accountId !== 'string' || !sourceRecord.accountId) return null;

    const account = await vault.accounts.get(sourceRecord.accountId);
    if (!account) return null;

    // Keep the change output on the SAME script type as the spender. A
    // p2wpkh spend whose change lands in p2pkh is a louder chain-analysis
    // signal than the reuse this rotation removes.
    const addressType = sourceRecord.addressType;
    if (!Array.isArray(descriptor.addressTypes) || !descriptor.addressTypes.includes(addressType)) {
        return null;
    }

    const sharedIndexSpace = await indexSpaceSharedForWallet(vault, walletId);
    const { nextIndex, changeCount } = nextChangeIndex(allAddresses, {
        accountId: account.id,
        coin: descriptor.coin,
        network: descriptor.networkKind,
        addressType,
        sharedIndexSpace,
    });

    const [derived] = await signer.getAddresses({
        chainId,
        accountIndex: account.index,
        change: CHANGE_BRANCH,
        startIndex: nextIndex,
        count: 1,
        addressType,
    });
    if (!derived?.address || !derived?.publicKey || typeof derived.path !== 'string') {
        return null;
    }
    // A signer that ignored `change` and handed back an external address
    // would silently defeat the rotation AND collide with the receive
    // branch's index space. Refuse the result rather than persist it.
    const parsed = branchOf(derived.path);
    if (!parsed || parsed.branch !== String(CHANGE_BRANCH)) return null;
    if (derived.address === sourceAddress) return null;

    const signerKind = signer.kind;
    const record = createAddress({
        accountId: account.id,
        chain: descriptor.coin,
        network: descriptor.networkKind,
        source: signerKind === 'software' ? 'hd' : signerKind,
        addressType,
        derivationPath: derived.path,
        address: derived.address,
        publicKey: derived.publicKey,
        // Labelled, not hidden: the balance genuinely moves here, so the
        // address list and every balance surface must be able to show it.
        label: `${tickerForCoin(descriptor.coin)} Change #${changeCount + 1}`,
        role: 'change',
        signerId: signer.id,
    });
    await vault.addresses.put(record);
    return record;
}

/**
 * The address an action's change output should pay, honouring the
 * Settings > Privacy rotation preference.
 *
 * This is the single call every composing path makes. It resolves to
 * `sourceAddress` whenever a rotation is switched off or impossible, so a
 * caller can always use the result unconditionally.
 *
 * @param {DeriveChangeAddressOpts & { settings?: object }} opts
 * @returns {Promise<{ address: string, rotated: boolean, record: import('../schemas/address.js').Address | null }>}
 */
export async function resolveChangeAddress(opts) {
    const fallback = { address: opts?.sourceAddress, rotated: false, record: null };
    if (!changeRotationEnabled(opts?.settings)) return fallback;
    try {
        const record = await deriveChangeAddress(opts);
        if (!record) return fallback;
        return { address: record.address, rotated: true, record };
    } catch {
        // Fail open: a derivation failure must degrade to the pre-rotation
        // behaviour, not block the send. The user keeps the reuse they
        // asked to avoid, which the caller surfaces; they do not lose the
        // ability to spend.
        return fallback;
    }
}
