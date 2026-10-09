// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// broadcastQueueEngine: the queued-broadcast state machine over one shared
// store: rehydrate, merge, persist, settlement journal, vault rebuild and
// reconcile, seal and prune. The host registers the routes and calls these.

import {
    OWED_SETTLEMENT_LIMIT,
    owedRecordKey,
    sealBroadcastQueueStore,
} from './broadcastQueueStore.js';

/**
 * Carry the commit-landed marker of a queued reveal or phase-2 spend onto a queue
 * entry, so a permanent retry verdict keeps its record 'broadcast' rather than 'failed'.
 *
 * @param {{ commitLanded?: unknown, commitTxid?: unknown } | null | undefined} source
 * @returns {{ commitLanded?: true, commitTxid?: string }}
 */
function commitLandedFields(source) {
    if (source?.commitLanded !== true) return {};
    return {
        commitLanded: true,
        ...(typeof source.commitTxid === 'string' && source.commitTxid ? { commitTxid: source.commitTxid } : {}),
    };
}

/**
 * @param {{
 *   store: import('./broadcastQueueStore.js').BroadcastQueueStore,
 *   importedAddressIdsFor: (vault: any, walletId: string) => Promise<Set<string>>,
 *   discardQueuedBroadcast: (args: { vault: any, pendingTxId: string }) => Promise<unknown>,
 * }} deps
 */
export function createBroadcastQueueEngine({ store: queueStore, importedAddressIdsFor, discardQueuedBroadcast }) {
    /** @type {Map<string, import('./broadcastQueueStorage.js').QueueEntry[]>} */
    const queuedBroadcasts = queueStore.queues;
    // Fold a persisted snapshot into the live map instead of replacing it. A
    // retried rehydrate can land after this process already queued entries of
    // its own, and `getQueue` hands the routes the live array they splice, so
    // the array identity has to survive the merge.
    //
    // No per-entry tombstone is needed to stop the merge resurrecting a removed
    // entry. A merge runs while `queueStore.loaded` is false, which happens in
    // two windows. Before the first load latches, the map holds nothing but
    // entries `pushQueueEntry` added, whose saves persistQueue declined.
    // After a web lease reload whose read failed, the map also holds what this
    // store saved before it went dormant, and another writer may have removed
    // some of it since. `queueStore.persisted` tells the two apart: it records
    // what the key held at the last load or save that resolved, so a live entry
    // it names that the snapshot lacks was removed and is dropped, and one it
    // does not name never reached storage and stays. Before the first load the
    // record is empty, so that window keeps every live entry.
    //
    // The one removal that can run in that window is `pruneWalletFromQueue`,
    // so it records the walletId in `queueStore.prunedWallets`; the merge skips
    // those wallets, and the load's write-back drops them from the blob.
    //
    // One exception: `restoreQueueFromVault` also runs in that window, and it
    // rebuilds a PendingTx the blob may already hold under a different entry
    // id. Entries naming the same `pendingTxId` are one transaction, so the
    // live entry stays and takes the ADS verdict only the blob copy carries.
    //
    // That argument covers one process only. Across a reload it does not hold:
    // a retirement whose persistQueue write was refused leaves the entry in the
    // blob, and the next boot merges it back in. `reconcileRestoredEntries`
    // below is what judges those entries against the durable half.
    function mergeQueueSnapshot(snapshot, known) {
        // Drop in place what the key held before this read and no longer does.
        for (const [walletId, live] of queuedBroadcasts.entries()) {
            const named = known?.get(walletId);
            if (!named) continue;
            const stored = Array.isArray(snapshot[walletId]) ? snapshot[walletId] : [];
            const storedIds = new Set(stored.map((e) => e?.id));
            for (let i = live.length - 1; i >= 0; i -= 1) {
                if (named.has(live[i]?.id) && !storedIds.has(live[i].id)) live.splice(i, 1);
            }
        }
        for (const walletId of Object.keys(snapshot)) {
            if (queueStore.prunedWallets?.has(walletId)) continue;
            const arr = snapshot[walletId];
            if (!Array.isArray(arr) || arr.length === 0) continue;
            const restorable = arr.filter((e) => e && typeof e === 'object');
            if (restorable.length === 0) continue;
            const live = queuedBroadcasts.get(walletId);
            if (!live) {
                queuedBroadcasts.set(walletId, restorable);
                continue;
            }
            const held = new Set(live.map((e) => e.id));
            const byPendingTx = new Map(live.filter((e) => e.pendingTxId).map((e) => [e.pendingTxId, e]));
            const missing = [];
            for (const e of restorable) {
                if (held.has(e.id)) continue;
                const twin = e.pendingTxId ? byPendingTx.get(e.pendingTxId) : null;
                if (twin) adoptSnapshotVerdict(twin, e);
                else missing.push(e);
            }
            // Persisted entries were signed before anything this process
            // queued, so they go in front to keep the list oldest-first.
            if (missing.length > 0) live.unshift(...missing);
        }
    }
    // Copy the blob copy's ADS verdict onto a vault-rebuilt twin of the same
    // bytes; a rebuild carries none, and booking nothing under-counts it.
    function adoptSnapshotVerdict(live, persisted) {
        const verdict = persisted.adsCommit;
        if (live.adsCommit || live.signedTxHex !== persisted.signedTxHex) return;
        if (!verdict || typeof verdict !== 'object') return;
        if (typeof verdict.chainId !== 'string' || typeof verdict.donationIncluded !== 'boolean') return;
        live.adsCommit = { chainId: verdict.chainId, donationIncluded: verdict.donationIncluded };
    }
    async function ensureQueueLoaded() {
        // A sealed store serves nothing: a host built on it during a wipe must
        // not read the pre-wipe blob back into the map it shares.
        if (queueStore.loaded || queueStore.sealed || !queueStore.storage) {
            queueStore.loaded = true;
            return;
        }
        // Without the writer lease the key is another tab's: reading it here
        // would latch `loaded` and let the write-back below run unleased.
        if (queueStore.dormant) return;
        if (!queueStore.loadPromise) {
            queueStore.loadPromise = (async () => {
                // What the key held before this read, to tell a removal from
                // an entry that never reached storage.
                const known = queueStore.persisted;
                const knownQueues = known?.queues;
                const knownOwed = known?.owed;
                // Whatever this process already holds was queued or journaled
                // while the persist helpers were refusing to write, so the blob
                // does not carry it. Both write-backs below are conditional on
                // these: a plain cold boot must not add a storage write per
                // service-worker start.
                let heldEntries = false;
                for (const entries of queuedBroadcasts.values()) {
                    if (entries.length > 0) { heldEntries = true; break; }
                }
                const heldOwed = queueStore.owed.length > 0;
                let snapshot = null;
                try {
                    snapshot = await queueStore.storage.load();
                } catch (_e) {
                    snapshot = null;
                }
                // The wipe can seal the store during either read below, and a
                // read that started before it returns the pre-wipe blob; merging
                // that refills the map and journal the seal just emptied.
                if (queueStore.sealed) return false;
                // Fail closed. `load` resolves null only for a read that did
                // not reach the store; an empty queue is still an object.
                // Latching `queueStore.loaded` on a failed read lets the next persist
                // write the half-empty map over every wallet's persisted
                // entries.
                if (!snapshot || typeof snapshot !== 'object') return false;
                // A wallet removed while the read was failing is still in the
                // blob, so the write-back below has to run to drop it.
                const replayedPrune = queueStore.prunedWallets?.size > 0;
                // Read the journal before merging anything, so a failed read
                // leaves live state exactly as it was for the retry.
                let persistedOwed = null;
                if (typeof queueStore.storage.loadSettlements === 'function') {
                    try {
                        persistedOwed = await queueStore.storage.loadSettlements();
                    } catch (_e) {
                        // Both halves ride one storage key, so an unreadable
                        // journal is an unreadable key: fail closed exactly as a
                        // failed `load` does. `loaded` stays false, every persist
                        // keeps refusing, and the next access retries the read.
                        // Latching here would let the next journal write save
                        // this process's records over the unread ones.
                        return false;
                    }
                    if (queueStore.sealed) return false;
                }
                // Re-sample the journal after the reads: a record made while
                // one was in flight had its own persist refused, so the
                // write-back below is its only route to storage.
                const owedAtMerge = heldOwed || queueStore.owed.length > 0;
                mergeQueueSnapshot(snapshot, knownQueues);
                mergeOwedSettlements(persistedOwed, knownOwed);
                queueStore.loaded = true;
                // Once `loaded` latches no merge runs again, so the live map is
                // the whole truth and the pending prunes have nothing left to skip.
                queueStore.prunedWallets?.clear();
                // The recovery of the read is also the repair of the blob.
                // The write-back lands here rather than at the next mutation:
                // an MV3 worker evicted before one (~30s idle) loses every
                // entry queued while the read was failing. A renderer enqueue
                // names no PendingTx, so `restoreQueueFromVault` is no net for
                // it and the loss of signed bytes is total. Awaited inside the
                // single-flight promise so a save a later mutation issues
                // cannot be overtaken by this one.
                if (heldEntries || replayedPrune) await persistQueue();
                // The journal half needs no read check of its own here. Both
                // halves ride one storage key, and a `loadSettlements` that
                // threw returned above before `loaded` latched, so reaching
                // this line means the journal was read and merged; writing it
                // back cannot erase the owed writes recorded before this boot.
                if (owedAtMerge || replayedPrune) await persistOwedSettlements();
                return true;
            })();
        }
        const loaded = await queueStore.loadPromise;
        // Drop the single-flight latch on failure so the next access retries
        // rather than resolving forever against the same dead read.
        if (!loaded) queueStore.loadPromise = null;
    }
    // Resolve true only when the snapshot reached storage; every skip or refusal is false.
    /** @returns {Promise<boolean>} */
    async function persistQueue() {
        if (queueStore.sealed || queueStore.dormant || !queueStore.storage) return false;
        if (!queueStore.loaded) {
            await ensureQueueLoaded();
            // Storage is still unreadable, so the map is known-incomplete.
            // Keep it as the live truth for this process and leave what is on
            // disk alone; writing it back is the erasure this guards against.
            // A seal that landed during the wait also latches `loaded`, so it
            // is checked on its own: this save would recreate the wiped key.
            if (queueStore.sealed || queueStore.dormant || !queueStore.loaded) return false;
        }
        /** @type {Record<string, any[]>} */
        const snapshot = {};
        for (const [walletId, entries] of queuedBroadcasts.entries()) {
            if (entries.length > 0) snapshot[walletId] = [...entries];
        }
        try {
            await queueStore.storage.save(snapshot);
            return true;
        } catch (_e) {
            // Same tolerance as load: never block a queue mutation on
            // a storage failure.
            return false;
        }
    }
    // Hold a PendingTx write the vault refused until a vault takes it. Leaving
    // the queue is what makes an entry unretriable, and a record left 'queued'
    // after its bytes landed keeps netting the spend out of the balance.
    // The journal is `queueStore.owed`, shared like the map, so a record a
    // torn-down host writes is the one the next host's open vault drains.
    // Cap the journal so a vault that never reopens cannot grow the stored blob
    // without bound. Positional: the array is kept oldest-first, so the front goes.
    function capOwedSettlements() {
        if (queueStore.owed.length > OWED_SETTLEMENT_LIMIT) {
            queueStore.owed = queueStore.owed.slice(-OWED_SETTLEMENT_LIMIT);
        }
    }
    function mergeOwedSettlements(persisted, known) {
        if (!Array.isArray(persisted)) return;
        // A record the key held before this read and no longer does was
        // drained by another writer; the same rule as the queue merge above.
        if (known?.size > 0) {
            const stored = new Set(persisted.filter(Boolean).map(owedRecordKey));
            queueStore.owed = queueStore.owed.filter((s) => !known.has(owedRecordKey(s)) || stored.has(owedRecordKey(s)));
        }
        if (persisted.length === 0) return;
        const held = new Set(queueStore.owed.map((s) => s.pendingTxId));
        const restored = [];
        for (const owed of persisted) {
            if (!owed || typeof owed !== 'object') continue;
            if (typeof owed.pendingTxId !== 'string' || !owed.pendingTxId) continue;
            if (held.has(owed.pendingTxId)) continue;
            if (owed.walletId && queueStore.prunedWallets?.has(owed.walletId)) continue;
            held.add(owed.pendingTxId);
            restored.push({ ...owed });
        }
        // Persisted records go in front: persistOwedSettlements refuses while
        // `queueStore.loaded` is false, so the blob predates everything this process holds.
        queueStore.owed = [...restored, ...queueStore.owed];
        capOwedSettlements();
    }
    // Write the journal to the queue's own storage key. The wallet wipe clears
    // the local store by enumerated key, so a key of its own would outlive the
    // wallet whose transactions the journal names.
    async function persistOwedSettlements() {
        if (queueStore.sealed || queueStore.dormant || !queueStore.loaded) return;
        if (typeof queueStore.storage?.saveSettlements !== 'function') return;
        try {
            await queueStore.storage.saveSettlements(queueStore.owed.map((s) => ({ ...s })));
        } catch (_e) {
            // Same tolerance the queue save takes: a storage failure never
            // blocks the route that recorded the write.
        }
    }
    // Record what the replay needs and nothing else: a journal record names a
    // PendingTx and the write to apply, never signed bytes, and never enters
    // `queuedBroadcasts`, so no route can list or broadcast one.
    function recordOwedSettlement(walletId, pendingTxId, op, patch) {
        if (typeof pendingTxId !== 'string' || !pendingTxId) return;
        // One record per PendingTx, holding the latest write owed to it.
        queueStore.owed = queueStore.owed.filter((s) => s.pendingTxId !== pendingTxId);
        queueStore.owed.push({
            id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            ...(typeof walletId === 'string' && walletId ? { walletId } : {}),
            pendingTxId,
            op,
            ...(patch ? { patch } : {}),
            recordedAt: Date.now(),
        });
        capOwedSettlements();
        void persistOwedSettlements();
    }
    /**
     * Replay every owed write against an open vault. Each record is applied,
     * dropped because the PendingTx it names already left 'queued', or kept for
     * the next attempt while the vault stays unreachable. Never throws: the
     * routes that call it must not turn a settled broadcast into a route error.
     *
     * @param {any} vault
     */
    async function flushOwedSettlements(vault) {
        if (queueStore.owed.length === 0) return;
        try {
            // Track what this pass settled rather than what it kept: another
            // host sharing the journal can record a write while the awaits below
            // run, and replacing the journal with this pass's leftovers would drop it.
            /** @type {Set<object>} */
            const settled = new Set();
            for (const owed of [...queueStore.owed]) {
                let verdict;
                if (owed.op === 'discard') {
                    try {
                        await discardQueuedBroadcast({ vault, pendingTxId: owed.pendingTxId });
                        verdict = 'settled';
                    } catch (_e) {
                        verdict = 'unreachable';
                    }
                } else {
                    verdict = await applyPendingTxPatch(vault, owed.pendingTxId, owed.patch);
                }
                if (verdict !== 'unreachable') settled.add(owed);
            }
            if (settled.size === 0) return;
            // A retire has to be backed by a write that reached disk. Vault's
            // collection put/delete mutate the in-memory document BEFORE the
            // autosave and never restore it when that save rejects, so a
            // refused write stays readable in this process: the patch lane
            // re-reads its own unpersisted terminal status and reports
            // 'closed', and the discard lane finds the record already spliced
            // out and reports 'settled'. Both read as a settlement, and
            // retiring on either drops the journal record while disk still
            // holds the PendingTx as 'queued', so the landed transaction stays
            // queued for good and keeps netting its spend out of the balance.
            // One explicit save per draining pass decides it: either the
            // phantom write becomes real, or nothing here is durable and the
            // journal survives for the next pass. Keeping the records costs
            // nothing, because replay is safe to repeat - the patch lane is
            // idempotent and the discard lane no-ops on a record that is
            // already gone or terminal. A vault that exposes no save() keeps the old
            // behaviour rather than holding its journal forever.
            if (typeof vault?.save === 'function') {
                try {
                    await vault.save();
                } catch (_e) {
                    return;
                }
            }
            queueStore.owed = queueStore.owed.filter((s) => !settled.has(s));
            await persistOwedSettlements();
        } catch (_e) {
            // A journal that cannot drain stays as it is for the next route.
        }
    }
    /**
     * Stop this host writing the queue key, for the life of the process.
     * The seal lands on the shared store, so it also stops every host a lock
     * already tore down that shares it; the shell then builds a fresh store.
     *
     * The wallet wipe removes `xchain.broadcastQueue` and then drops the host,
     * but dropping a reference cancels nothing: `pushQueueEntry` fires its
     * persist without a caller awaiting it, and the broadcast route persists
     * and journals AFTER a network round trip that can outlive the wipe by
     * seconds. Either continuation resolves against a storage adapter that
     * still holds the pre-wipe halves in memory and writes the pair back, so
     * the key reappears carrying the wiped wallet's `signedTxHex` entries and a
     * journal naming its PendingTxs - data the user was told was erased, under
     * a walletId no vault has, which no route can ever list or discard again.
     *
     * Three things are needed and none of them alone is enough: the flag stops
     * later writers, emptying the live state stops a route serving what the
     * wipe removed, and the adapter's `clear()` drops its cached halves so a
     * write already past the flag stores an empty envelope instead of the
     * entries. A write that is already inside the shell's set() cannot be
     * recalled by anything here; that residue is why this runs BEFORE the key
     * removal rather than after it.
     *
     * @returns {Promise<void>}
     */
    async function sealBroadcastQueue() {
        await sealBroadcastQueueStore(queueStore);
    }
    /**
     * Drop one wallet's half of the queue surface when that wallet is removed.
     *
     * `removeWallet` prunes the vault side, PendingTx rows included, but the
     * queue is keyed by walletId on its own storage key and no join reaches it.
     * The blob is rewritten from the live map, so the entry has to leave memory
     * before the persist, and the journal records naming that wallet go with it
     * because the PendingTxs they would replay against no longer exist.
     *
     * @param {string} walletId
     */
    async function pruneWalletFromQueue(walletId) {
        if (typeof walletId !== 'string' || !walletId) return;
        // Read first: the persist rewrites the whole blob from the live map, so
        // a prune over a map that never loaded would drop this wallet on disk
        // and leave every other wallet's entries to the fail-closed gate.
        await ensureQueueLoaded();
        // The read is still failing, or the store is dormant, so neither
        // persist below can write and the blob keeps this wallet; the
        // recovering load or the lease reload drops it instead.
        if ((!queueStore.loaded || queueStore.dormant) && !queueStore.sealed) queueStore.prunedWallets?.add(walletId);
        const hadEntries = queuedBroadcasts.delete(walletId);
        recoveredWallets.delete(walletId);
        reconciledWallets.delete(walletId);
        const owedBefore = queueStore.owed.length;
        queueStore.owed = queueStore.owed.filter((s) => s.walletId !== walletId);
        if (hadEntries) await persistQueue();
        if (queueStore.owed.length !== owedBefore) await persistOwedSettlements();
    }
    function getQueue(walletId) {
        if (typeof walletId !== 'string' || !walletId) {
            throw new Error('broadcast.queue: walletId is required');
        }
        let q = queuedBroadcasts.get(walletId);
        if (!q) {
            q = [];
            queuedBroadcasts.set(walletId, q);
        }
        return q;
    }
    // Wallets whose durable records this process has already reconciled. The
    // scan reads four collections, and one pass per wallet per process covers
    // it: every later enqueue goes through `pushQueueEntry`.
    const recoveredWallets = new Set();
    /**
     * Address strings this wallet spends from: its accounts' addresses plus the
     * imported keys the wallet record links, which carry `accountId: null` and
     * are therefore missed by the account walk alone (§11.3.3). Same join
     * `removeWallet` applies when it decides which PendingTx rows die with the
     * wallet. Throws rather than narrowing when a collection is unreadable, so
     * the caller can refuse instead of attributing records by a partial answer.
     *
     * @param {any} vault
     * @param {string} walletId
     * @returns {Promise<Set<string>>}
     */
    async function ownedAddressesFor(vault, walletId) {
        const accounts = await vault.accounts.findBy('walletId', walletId);
        const accountIds = new Set(
            (Array.isArray(accounts) ? accounts : []).map((a) => a?.id).filter(Boolean),
        );
        const importedIds = await importedAddressIdsFor(vault, walletId);
        const all = await vault.addresses.list();
        /** @type {Set<string>} */
        const owned = new Set();
        for (const addr of Array.isArray(all) ? all : []) {
            if (!addr || typeof addr.address !== 'string' || !addr.address) continue;
            if ((addr.accountId && accountIds.has(addr.accountId)) || importedIds.has(addr.id)) {
                owned.add(addr.address);
            }
        }
        return owned;
    }
    /**
     * Rebuild queue entries from the durable half for signed transactions the
     * local store no longer holds. The two halves are not equally durable: the
     * signing flow writes the PendingTx as 'queued' into the vault and only
     * then asks this host to queue the bytes, and the queue's own blob is
     * best-effort (a quota refusal, a private window, or a shell with no
     * storage API at all leaves it empty while the vault keeps the record).
     * Nothing else reads a 'queued' record, so without this the signed bytes
     * are unreachable from every surface the user has.
     *
     * It runs while the blob is unreadable too, which is when the blob is worth
     * least. Nothing is written back in that window (persistQueue stays gated
     * on `queueStore.loaded`); the merge collapses a rebuilt entry into its blob twin
     * by `pendingTxId` once the read recovers. The settlement journal is unread
     * in that window as well, so a record it owes a write to can come back
     * until the read recovers, the replay lands, and the reconcile drops it.
     *
     * TWO STATUSES COME BACK, AND THEY COME BACK DIFFERENTLY LABELLED.
     * 'queued' is the record as the signing flow left it: signed, never sent.
     * 'broadcasting' is the claim the broadcast route stamps before the bytes
     * go out, so a worker that dies inside that network call leaves the record
     * at that status for good. Nothing else reads a 'broadcasting' record
     * either, because the History surfaces skip a PendingTx with no txid and
     * the signing flow leaves txid null until a broadcast answers, so excluding
     * it here is what makes those signed bytes unreachable from every surface
     * the user has. An entry rebuilt from one carries `resumedClaim`, which the
     * banner reads to say the attempt was interrupted and may already have been
     * sent.
     *
     * RE-OFFERING A RESUMED CLAIM IS SAFE BECAUSE THE BYTES ARE IDENTICAL.
     * A re-send carries the same txid, so a node that already holds the
     * transaction answers "already known" instead of accepting a second spend,
     * and the broadcast route reads that answer as delivery rather than as
     * death. The genuinely unsafe action is composing FRESH bytes for an
     * attempt that may have landed, which is why a resumed row offers a re-send
     * and never a re-compose. The settlement journal cannot stand in for this
     * judgement: it rides the same `xchain.broadcastQueue` key the queue
     * snapshot does, so it is gone in exactly the failure this read serves.
     *
     * Three conditions bound what comes back, and each is a refusal:
     *   - the record's `fromAddress` belongs to THIS wallet. An unreadable
     *     table or an empty address set restores nothing rather than guessing,
     *     because a wrong join would list one wallet's signed bytes under
     *     another.
     *   - no live queue entry names it. Every host a shell builds shares one
     *     queue store, so a broadcast genuinely in flight, even on a host a
     *     lock tore down, is held in that store's map; the records this read
     *     can reach are exactly the ones no live call owns.
     *   - no owed settlement names it. A journaled write belongs to an entry
     *     whose broadcast or discard already happened.
     *
     * @param {any} vault
     * @param {any} chainRegistry
     * @param {string} walletId
     */
    async function restoreQueueFromVault(vault, chainRegistry, walletId) {
        if (recoveredWallets.has(walletId)) return;
        let owned;
        let queued;
        let claimed = [];
        try {
            owned = await ownedAddressesFor(vault, walletId);
            if (owned.size === 0) return;
            queued = await vault.pendingTxs.findBy('status', 'queued');
        } catch (_e) {
            // A vault that cannot answer leaves the reconcile un-latched, so
            // the next list retries it against an open one.
            return;
        }
        try {
            claimed = await vault.pendingTxs.findBy('status', 'broadcasting');
        } catch (_e) {
            // The interrupted-claim half is additive. A vault that answers the
            // 'queued' read and refuses this one still gets its never-sent
            // records back rather than losing both halves to one refusal.
            claimed = [];
        }
        recoveredWallets.add(walletId);
        const candidates = [
            ...(Array.isArray(queued) ? queued.map((record) => ({ record, resumedClaim: false })) : []),
            ...(Array.isArray(claimed) ? claimed.map((record) => ({ record, resumedClaim: true })) : []),
        ];
        if (candidates.length === 0) return;
        const live = getQueue(walletId);
        const held = new Set(live.map((e) => e.pendingTxId).filter(Boolean));
        for (const owed of queueStore.owed) held.add(owed.pendingTxId);
        const restorable = candidates
            .filter(({ record: r }) => r
                && typeof r.txHex === 'string' && r.txHex
                && typeof r.id === 'string' && !held.has(r.id)
                && owned.has(r.fromAddress))
            .sort((a, b) => String(a.record.createdAt || '').localeCompare(String(b.record.createdAt || '')));
        for (const { record, resumedClaim } of restorable) {
            // Entries name a registry chain id; records name coin plus network.
            // A record whose chain this build cannot resolve has no SDK to
            // broadcast through, so listing it would only offer a button that
            // throws.
            const chainId = chainRegistry?.chainIdFor?.(record.chain, record.network);
            if (typeof chainId !== 'string' || !chainId) continue;
            held.add(record.id);
            pushQueueEntry(walletId, {
                chainId,
                signedTxHex: record.txHex,
                summary: record.actionSummary,
                signedAt: Date.parse(record.createdAt) || Date.now(),
                txid: record.txid,
                pendingTxId: record.id,
                ...(resumedClaim ? { resumedClaim: true } : {}),
                ...commitLandedFields(record),
                // No ADS verdict: it rode the entry, never the record, so the
                // donation this transaction may carry is not re-derivable here.
                // Booking nothing under-counts the accumulator; booking a guess
                // credits a donation that was never paid.
                adsCommit: null,
            });
        }
    }
    // Wallets whose rehydrated entries this process has already judged against
    // the durable half. Left un-latched when the vault could not answer, so the
    // next list retries against an open one.
    const reconciledWallets = new Set();
    /**
     * The inverse of `restoreQueueFromVault`: drop rehydrated entries the
     * durable half says are already retired.
     *
     * `persistQueue` is best effort and swallows a refused write, so a discard,
     * a permanent failure, or a landed broadcast can retire the record while the
     * blob keeps the entry. The next boot merges that stale blob back in and
     * offers the retired transaction for another broadcast. The comment above
     * `mergeQueueSnapshot` covers only resurrection WITHIN one process; this is
     * the cross-boot case it does not reach.
     *
     * Two refusals bound what is dropped, both of them conservative:
     *   - only an entry that names a `pendingTxId` is judged at all. A renderer
     *     enqueue (the PSBT lane) has no durable half, so nothing here can say
     *     anything about it and it stays; those entries still depend on the
     *     best-effort blob alone.
     *   - a read the vault refuses keeps the entry and leaves the wallet
     *     un-latched. An unreachable vault is not evidence of retirement, and
     *     deleting a live entry destroys signed bytes and the fee they carry.
     *
     * Dropping costs the user nothing a refusal would not: 'queued' and
     * 'broadcasting' are the only statuses either lane will broadcast (core's
     * drain and `applyPendingTxPatch` agree on that), so an entry whose record
     * is missing or terminal can no longer be sent by any route and listing it
     * only offers a button that throws.
     *
     * @param {any} vault
     * @param {string} walletId
     */
    async function reconcileRestoredEntries(vault, walletId) {
        if (!queueStore.loaded || reconciledWallets.has(walletId)) return;
        // A vault with no pendingTxs collection cannot answer, and an absent
        // reader must read as "cannot judge", never as "no record exists".
        if (typeof vault?.pendingTxs?.get !== 'function') return;
        const live = getQueue(walletId);
        const owning = live.filter((e) => typeof e?.pendingTxId === 'string' && e.pendingTxId);
        if (owning.length === 0) {
            reconciledWallets.add(walletId);
            return;
        }
        /** @type {Set<string>} */
        const retired = new Set();
        for (const entry of owning) {
            let record;
            try {
                record = await vault?.pendingTxs?.get(entry.pendingTxId);
            } catch (_e) {
                // Un-latched: the next list judges this wallet against a vault
                // that can answer.
                return;
            }
            if (!record) {
                retired.add(entry.id);
                continue;
            }
            if (record.status !== 'queued' && record.status !== 'broadcasting') {
                retired.add(entry.id);
            }
        }
        reconciledWallets.add(walletId);
        if (retired.size === 0) return;
        for (let i = live.length - 1; i >= 0; i -= 1) {
            if (retired.has(live[i].id)) live.splice(i, 1);
        }
        await persistQueue();
    }
    /**
     * The `onBroadcastFailure` hook every signing action route hands its flow:
     * signed bytes whose broadcast failed transiently join the queue now,
     * beside the PendingTx submitAction stamped 'queued', rather than only
     * after the next worker restart rebuilds them without their ADS verdict.
     * Awaits the rehydrate first so a push racing a worker restart cannot
     * orphan the persisted entries, and awaits the save after the push so the
     * entry's ADS verdict, which no PendingTx record carries, is on disk
     * before submitAction re-throws.
     *
     * @param {string | undefined} walletId
     * @returns {((entry: any) => Promise<boolean>) | undefined}
     */
    function enqueueOnBroadcastFailure(walletId) {
        if (typeof walletId !== 'string' || !walletId) return undefined;
        return async (entry) => {
            await ensureQueueLoaded();
            // A first list in the gap after the 'queued' stamp may have rebuilt
            // these bytes already; give that entry the verdict instead of a twin.
            const twin = liveTwinOf(walletId, entry);
            if (twin) adoptSnapshotVerdict(twin, entry);
            else pushQueueEntry(walletId, entry);
            return persistQueue();
        };
    }
    // Find the live entry for the same PendingTx and the same signed bytes.
    function liveTwinOf(walletId, entry) {
        const pendingTxId = entry?.pendingTxId;
        if (typeof pendingTxId !== 'string' || !pendingTxId) return null;
        return getQueue(walletId).find(
            (e) => e.pendingTxId === pendingTxId && e.signedTxHex === entry.signedTxHex,
        ) ?? null;
    }
    /**
     * Push a signed-but-unbroadcast tx onto the per-walletId queue.
     * Cluster G FOLLOWUP 1: used both by the action.* handlers' auto-
     * enqueue path (when `submitAction` reports a `BroadcastFailedError`)
     * and by the renderer's `enqueueBroadcastRequest` shim for callers
     * that want to enqueue directly (e.g. PsbtSignForm's broadcast leg).
     *
     * The entry submitAction hands over also names the PendingTx record it
     * stamped 'queued' (`pendingTxId`) and the ADS verdict the signed bytes
     * carry (`adsCommit`); both ride on the stored record so the broadcast
     * and discard routes can settle the durable half and book the donation
     * once the bytes actually land. Renderer enqueues carry neither.
     *
     * @param {string} walletId
     * `resumedClaim` marks an entry rebuilt from a record the broadcast route
     * had already claimed, so the banner can say the attempt was interrupted
     * and the broadcast route can read an "already known" reply as delivery.
     *
     * @param {{ chainId: string, signedTxHex: string, summary?: string, signedAt?: number, txid?: string, pendingTxId?: string | null, resumedClaim?: boolean, commitLanded?: true, commitTxid?: string | null, adsCommit?: { chainId: string, donationIncluded: boolean } | null }} entry
     * @returns {import('./broadcastQueueStorage.js').QueueEntry}
     */
    function pushQueueEntry(walletId, entry) {
        const id = `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const adsCommit = entry.adsCommit;
        const stored = {
            id,
            chainId: entry.chainId,
            signedTxHex: entry.signedTxHex,
            summary: typeof entry.summary === 'string' && entry.summary
                ? entry.summary
                : `Broadcast pending on ${entry.chainId}`,
            signedAt: typeof entry.signedAt === 'number' ? entry.signedAt : Date.now(),
            ...(entry.txid ? { txid: entry.txid } : {}),
            ...(typeof entry.pendingTxId === 'string' && entry.pendingTxId
                ? { pendingTxId: entry.pendingTxId }
                : {}),
            ...(entry.resumedClaim === true ? { resumedClaim: true } : {}),
            ...commitLandedFields(entry),
            ...(adsCommit
                && typeof adsCommit === 'object'
                && typeof adsCommit.chainId === 'string'
                && typeof adsCommit.donationIncluded === 'boolean'
                ? { adsCommit: { chainId: adsCommit.chainId, donationIncluded: adsCommit.donationIncluded } }
                : {}),
        };
        getQueue(walletId).push(stored);
        // Start a background save for the vault rebuild, which pushes in a loop.
        // Callers that need the entry on disk (the onBroadcastFailure hook and
        // the renderer enqueue route) await their own persistQueue() after this.
        void persistQueue();
        return stored;
    }
    /**
     * Settle the PendingTx half of a queued broadcast once the host queue has
     * settled its own. submitAction stamps its record 'queued' and names it on
     * the entry as `pendingTxId`; the two surfaces otherwise never reconcile,
     * and a record left 'queued' after the bytes landed keeps netting the spend
     * out of the balance, never subscribes for its confirmation, and stays
     * eligible for a re-broadcast the node would reject as already known.
     * Only a record the queue still owns is written (the same precondition
     * core's drain and discard apply), and a missing record or a locked vault
     * never turns a settled broadcast into a route error. Renderer enqueues
     * carry no id.
     *
     * The four outcomes are kept apart because each owes the caller something
     * different: 'settled' wrote the record, 'unowned' means the entry names no
     * record at all (a renderer enqueue has no durable half to settle),
     * 'closed' means the entry DOES name a record and that record is gone or
     * already terminal, and 'unreachable' means the vault refused the read or
     * the write and the caller journals it.
     *
     * 'unowned' and 'closed' were one verdict until the broadcast route needed
     * to tell them apart: 'closed' is evidence these bytes were retired and
     * must not go out, while 'unowned' says nothing about them and has to stay
     * broadcastable. Collapsing the two would make every PSBT-lane broadcast
     * fail permanently.
     *
     * @param {any} vault
     * @param {{ pendingTxId?: string }} entry
     * @param {object} patch
     * @returns {Promise<'settled' | 'unowned' | 'closed' | 'unreachable'>}
     */
    async function settleQueuedPendingTx(vault, entry, patch) {
        const pendingTxId = entry?.pendingTxId;
        if (typeof pendingTxId !== 'string' || !pendingTxId) return 'unowned';
        return applyPendingTxPatch(vault, pendingTxId, patch);
    }
    /**
     * Apply one patch to a PendingTx the queue still owns, reporting which of
     * the three outcomes above happened.
     *
     * Two statuses are writable. 'queued' is the record as the signing flow
     * left it; 'broadcasting' is the claim the broadcast route stamps before
     * the bytes go out, the same transition core's drain writes at the same
     * point. Every other status is terminal and belongs to whatever moved the
     * record there.
     *
     * @param {any} vault
     * @param {string} pendingTxId
     * @param {object} patch
     * @returns {Promise<'settled' | 'closed' | 'unreachable'>}
     */
    async function applyPendingTxPatch(vault, pendingTxId, patch) {
        let existing;
        try {
            existing = await vault?.pendingTxs?.get(pendingTxId);
        } catch (_e) {
            return 'unreachable';
        }
        if (!existing) return 'closed';
        if (existing.status !== 'queued' && existing.status !== 'broadcasting') return 'closed';
        try {
            await vault.pendingTxs.put({ ...existing, ...patch });
        } catch (_e) {
            return 'unreachable';
        }
        return 'settled';
    }
    return {
        ensureQueueLoaded,
        persistQueue,
        persistOwedSettlements,
        recordOwedSettlement,
        flushOwedSettlements,
        sealBroadcastQueue,
        pruneWalletFromQueue,
        getQueue,
        restoreQueueFromVault,
        reconcileRestoredEntries,
        enqueueOnBroadcastFailure,
        pushQueueEntry,
        settleQueuedPendingTx,
        applyPendingTxPatch,
    };
}
