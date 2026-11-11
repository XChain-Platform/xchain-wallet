// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { receiveMultisigAddress } from './multisigAddress.js';
import { decodeMultisigSpend, multisigSighash } from './multisigSpend.js';

export const MULTISIG_TRANSACTION_MISMATCH =
    'This signing request does not match its transaction. Do not sign it.';

export function findMatchingMultisigConfig(wallet, session) {
    const wanted = new Set(session.cosignerPubkeys.map((pubkey) => pubkey.toLowerCase()));
    return (Array.isArray(wallet?.multisigs) ? wallet.multisigs : []).find((config) =>
        config?.scheme === session.scheme
        && config.threshold === session.threshold
        && Array.isArray(config.cosigners)
        && config.cosigners.length === wanted.size
        && config.cosigners.every((cosigner) => wanted.has(String(cosigner.pubkey).toLowerCase())));
}

/** Bind a classical session's message hash and script to its persisted wallet config. */
export async function assertMultisigTransactionBinding({ vault, sdkRegistry, session }) {
    if (!session?.psbtHex || session.scheme === 'taproot-musig2') return null;
    try {
        const wallet = await vault.wallets.get(session.walletId);
        const config = findMatchingMultisigConfig(wallet, session);
        if (!config || !sdkRegistry) throw new Error('missing config or SDK registry');
        const derived = await receiveMultisigAddress({
            vault,
            sdkRegistry,
            walletId: session.walletId,
            chainId: session.chainId,
            multisigConfigId: config.id,
        });
        const script = session.scheme === 'p2wsh-multisig'
            ? derived.witnessScript
            : derived.redeemScript;
        const spend = decodeMultisigSpend(session.psbtHex);
        if (!script || spend.script !== script.toLowerCase()) throw new Error('script mismatch');
        const msgHash = multisigSighash({
            scheme: session.scheme,
            script,
            unsignedTxHex: spend.unsignedTxHex,
            amount: spend.input.amount,
        });
        if (msgHash !== session.msgHash.toLowerCase()) throw new Error('hash mismatch');
        return { config, script: script.toLowerCase(), spend };
    } catch {
        throw new Error(MULTISIG_TRANSACTION_MISMATCH);
    }
}

