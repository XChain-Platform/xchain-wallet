// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// resolveSigner: background-side helper that inspects an address (or
// address id) and figures out how it should be signed. Returns a
// descriptor that tells the caller which code path to take rather
// than constructing the signer itself. The background owns the
// password (for software) and the transport function (for HW), so it
// does the final construction.
//
// Why a descriptor instead of a signer?
// -------------------------------------
//   - SoftwareSigner needs the wallet record + password → constructed
//     via `unlockWallet` inside `submitAction` today.
//   - RemoteSigner needs a transport function the background owns
//     (it wraps a renderer-side messaging channel) plus the live
//     SignerRecord for metadata (displayName, kind, model).
//
// Separating "which kind?" from "build it" keeps this helper pure
// and testable. Callers supply their own transport factory.

import { RemoteSigner } from '../signers/RemoteSigner.js';

/**
 * @typedef {Object} SoftwareSignerDescriptor
 * @property {'software'} kind
 * @property {import('../schemas/address.js').Address} address
 */

/**
 * @typedef {Object} HwSignerDescriptor
 * @property {'trezor'|'ledger'} kind
 * @property {import('../schemas/address.js').Address} address
 * @property {import('../schemas/signer.js').SignerRecord} signerRecord
 */

/**
 * @typedef {SoftwareSignerDescriptor | HwSignerDescriptor} SignerDescriptor
 */

export class SignerResolutionError extends Error {
    constructor(message, details) {
        super(message);
        this.name = 'SignerResolutionError';
        if (details) Object.assign(this, details);
    }
}

/**
 * Decide which signer kind an address needs. HD + imported-WIF
 * addresses route to `'software'`; addresses persisted during HW
 * pairing (§17.6) carry `source: 'trezor' | 'ledger'` and a
 * `signerId` pointing at the SignerRecord.
 *
 * Watch-only addresses are not signable. Callers that reach this
 * helper on a watch-only path have a bug, so we throw loud.
 *
 * @param {Object} opts
 * @param {import('../storage/Vault.js').Vault} opts.vault
 * @param {import('../schemas/address.js').Address} opts.address
 * @returns {Promise<SignerDescriptor>}
 */
export async function resolveSigner({ vault, address }) {
    if (!vault) throw new SignerResolutionError('resolveSigner: vault is required');
    if (!address || typeof address !== 'object') {
        throw new SignerResolutionError('resolveSigner: address is required');
    }
    const source = address.source;
    if (source === 'watch-only') {
        throw new SignerResolutionError(
            `resolveSigner: address "${address.address}" is watch-only (no signer available)`,
            { addressId: address.id, source },
        );
    }
    if (source === 'hd' || source === 'imported-wif') {
        return { kind: 'software', address };
    }
    if (source === 'trezor' || source === 'ledger') {
        if (!address.signerId) {
            throw new SignerResolutionError(
                `resolveSigner: address "${address.address}" has source="${source}" but no signerId`,
                { addressId: address.id, source },
            );
        }
        const signerRecord = await vault.signers.find(address.signerId);
        if (!signerRecord) {
            throw new SignerResolutionError(
                `resolveSigner: no SignerRecord for id "${address.signerId}"`,
                { addressId: address.id, signerId: address.signerId, source },
            );
        }
        if (signerRecord.kind !== source) {
            throw new SignerResolutionError(
                `resolveSigner: address source "${source}" doesn't match signer kind "${signerRecord.kind}"`,
                { addressId: address.id, signerId: address.signerId, source, signerKind: signerRecord.kind },
            );
        }
        return { kind: signerRecord.kind, address, signerRecord };
    }
    throw new SignerResolutionError(
        `resolveSigner: unknown address.source "${source}"`,
        { addressId: address.id, source },
    );
}

/**
 * Construct a `RemoteSigner` for an HW descriptor. Separated from
 * `resolveSigner` so callers can inject the transport function. The
 * background owns the transport (it wraps a renderer-side messaging
 * channel), and tests swap it with a mock that drives a real
 * TrezorSigner / LedgerSigner directly.
 *
 * @param {HwSignerDescriptor} descriptor
 * @param {import('../signers/RemoteSigner.js').RemoteSignerTransport} transport
 * @returns {RemoteSigner}
 */
export function buildRemoteSigner(descriptor, transport) {
    if (!descriptor || (descriptor.kind !== 'trezor' && descriptor.kind !== 'ledger')) {
        throw new SignerResolutionError(
            `buildRemoteSigner: descriptor must be HW (got kind="${descriptor?.kind}")`,
        );
    }
    if (typeof transport !== 'function') {
        throw new SignerResolutionError('buildRemoteSigner: transport must be a function');
    }
    const rec = descriptor.signerRecord;
    return new RemoteSigner({
        id: rec.id,
        displayName: rec.label || `${rec.vendor} ${rec.model}`,
        kind: descriptor.kind,
        transport,
    });
}
