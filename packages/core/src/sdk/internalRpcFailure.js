// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The numeric JSON-RPC code is authoritative. These fixed encoder messages
// are a fallback for legacy envelopes that retained only error text.
const INTERNAL_RPC_FAILURE = /^(?:internal(?: server| encoder)? error|fee estimation failed|utxo fetch failed|transaction (?:status|block) lookup failed)(?:[.!?]|\s*:\s*.*)?$/i;

/** A JSON-RPC service failure, rather than a protocol verdict. */
export function isInternalRpcFailure(err, reason) {
    if (INTERNAL_RPC_FAILURE.test(String(reason || '').trim())) return true;
    const e = /** @type {any} */ (err || {});
    const rpcError = e.details?.rpcError || e.rpcError;
    const rpcCode = Number(rpcError?.code ?? e.rpcCode);
    if (rpcCode === -32603) return true;
    if (!Number.isInteger(rpcCode) || rpcCode < -32099 || rpcCode > -32000) return false;
    const protocolReason = rpcError?.data?.reason
        || e.details?.context?.reason || e.data?.reason || e.rpcReason;
    return !String(protocolReason || '').trim();
}
