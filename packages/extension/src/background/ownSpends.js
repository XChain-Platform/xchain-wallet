// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Coins this wallet's own sends are spending, shared by every surface the
// background serves.
//
// The encoder holds a build's inputs for five minutes, so a review left open
// longer than that lets another surface build a different payment over the
// same coins. Whichever is approved second then conflicts with the first on
// the network: a higher fee replaces the first payment while both screens
// report it accepted, and a lower one is refused. The tracker cannot catch it,
// because the second transaction was built before the first went out. So each
// send claims its inputs before signing; a claim lasts HOLD_MS from the claim
// and again from a broadcast, and a send whose inputs another claim holds is
// refused before anything is signed. A send that ends unbroadcast drops its
// claim. With a store the claims outlive a restart of the extension worker.

import { flows } from '@xchain-wallet/core';

// Long enough to outlast any review built before the other send went out; a
// confirmed spend leaves the tracker anyway, so later builds never see it.
export const OWN_SPEND_HOLD_MS = 30 * 60 * 1000;

const keyOf = (chainId, txid, vout) => `${chainId}|${String(txid).toLowerCase()}:${Number(vout)}`;

/**
 * The outpoints a PSBT spends, read with the chain SDK's own decomposer.
 *
 * @param {any} sdk
 * @param {string} psbtHex
 * @returns {Array<{ txid: string, vout: number }>}
 */
export function psbtOutpoints(sdk, psbtHex) {
    if (typeof psbtHex !== 'string' || !psbtHex || typeof sdk?.wallet?.decomposePsbt !== 'function') return [];
    let inputs;
    // A PSBT the decomposer cannot read fails at signing with its own error; claim nothing here.
    try { ({ inputs } = sdk.wallet.decomposePsbt(psbtHex)); } catch { return []; }
    return (Array.isArray(inputs) ? inputs : [])
        .filter((i) => i && i.prevTxHash && Number.isInteger(Number(i.prevTxIndex)))
        .map((i) => ({ txid: String(i.prevTxHash), vout: Number(i.prevTxIndex) }));
}

/**
 * @typedef {{ key: string, claim: string, until: number }} OwnSpend
 * @typedef {{ load: () => Promise<OwnSpend[]>, save: (entries: OwnSpend[]) => Promise<void> }} OwnSpendStore
 */

/**
 * @param {{ store?: OwnSpendStore, now?: () => number, holdMs?: number }} [opts]
 */
export function createOwnSpendLedger({ store, now = () => Date.now(), holdMs = OWN_SPEND_HOLD_MS } = {}) {
    /** @type {OwnSpend[]} */
    let held = [];
    let nextClaim = 0;
    // One load shared by every caller, so a claim made while it runs is never overwritten by it.
    const hydrated = store
        ? Promise.resolve().then(() => store.load()).then(
            (loaded) => { held = [...(Array.isArray(loaded) ? loaded : []), ...held]; },
            () => {},
        )
        : Promise.resolve();

    async function persist() {
        if (!store) return;
        try { await store.save(held.slice()); } catch { /* best-effort: the in-memory claims still hold */ }
    }

    return {
        /**
         * Claim a send's inputs before it signs. The check and the claim run
         * with no await between them, so two surfaces approving at once cannot
         * both pass.
         *
         * @returns {Promise<string>} the claim id, '' when there was nothing to claim
         */
        async claim(chainId, outpoints) {
            await hydrated;
            if (!Array.isArray(outpoints) || outpoints.length === 0) return '';
            const at = now();
            held = held.filter((e) => e.until > at);
            const keys = new Set(held.map((e) => e.key));
            const spent = outpoints.filter((o) => keys.has(keyOf(chainId, o.txid, o.vout)));
            if (spent.length > 0) {
                const err = new Error(flows.livenessMessage({ spent }));
                err.name = flows.INPUTS_ALREADY_SPENT_NAME;
                throw err;
            }
            nextClaim += 1;
            const claim = `${at}-${nextClaim}`;
            for (const o of outpoints) held.push({ key: keyOf(chainId, o.txid, o.vout), claim, until: at + holdMs });
            await persist();
            return claim;
        },
        /** The send broadcast: hold its inputs for holdMs from now. */
        async keep(claim) {
            if (!claim) return;
            const until = now() + holdMs;
            for (const e of held) if (e.claim === claim) e.until = until;
            await persist();
        },
        /** The send ended without a broadcast: free its inputs. */
        async release(claim) {
            if (!claim) return;
            held = held.filter((e) => e.claim !== claim);
            await persist();
        },
    };
}
