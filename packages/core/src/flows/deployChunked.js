// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PC-38: chunked DEPLOY for contracts whose source does not fit one action.
//
// A contract over the compiled-action cap deploys in two phases:
//   phase 1: one DEPLOY v4 carrier per ordered base64 slice
//   phase 2: one assembling DEPLOY v2 (or v3, with staking fields) carrying
//            CODE_HASH = sha256(utf8(source))
// The indexer reassembles the slices, sha256-verifies them, and runs the
// normal deploy.
//
// WHY THIS EXISTS instead of calling sdk.deployContract: that helper takes a
// WIF and drives its own sdk.session, so it can only sign for a caller that
// holds raw key material. The wallet never does - it signs through the vault,
// a hardware device, or a co-signer - so it drives the same plan on its own
// signing path. The plan itself comes from sdk.planDeploy so the chunk math
// stays consensus-exact (see the SDK's chunkHelper).
//
// THREE CONSENSUS RULES SHAPE THIS FLOW (xchain-indexer actions/deploy.js):
//   1. The assembler gathers chunks from THIS deployer only, so every leg
//      MUST be signed by the same source address. Resuming from a different
//      address silently orphans every chunk already paid for; the flow pins
//      the address into the record and refuses a mismatch.
//   2. Chunks must sit at a LOWER action_index than the assembling DEPLOY,
//      so each carrier is confirmed + indexed before the next leg is sent
//      (also gives leg N+1 confirmed change to spend).
//   3. Chunks dedup by position, lowest action_index wins. A re-sent chunk
//      therefore wastes a fee but can never corrupt the group, which is what
//      makes resume safe.
//
// Rule 2 is what this flow ENFORCES; it is no longer what the chain requires.
// From the deferred-assembly flag day a group deploys at whichever piece
// completes it, so the contract can sit at a chunk carrier's action_index and
// the assembler's own index is not the contract's. The wallet keeps sending
// sequentially (nothing here needs parallel legs), but it no longer ASSUMES the
// answer: it reads the contract's index off the explorer, and a resume asks
// what an already-broadcast assembler produced before re-sending it.
//
// Every leg is a real transaction with a real fee, so the run is RESUMABLE:
// each confirmed chunk is written to the pendingDeploy record before the next
// leg starts, and a resumed run re-verifies those action_indexes on chain
// before skipping them.

import { submitAction } from './submitAction.js';
import { normalizeSource } from './sendToken.js';
import { createPendingDeploy } from '../schemas/pendingDeploy.js';
import { preflightContractMeta, metaNameOf } from './contractMetaPreflight.js';

/**
 * Plan a deploy: does this source fit one inline DEPLOY, or does it need
 * chunking? Pure passthrough to the SDK's consensus-exact planner.
 *
 * @param {{ sdkRegistry: any, chainId: string, code: string, gasLimit?: string|number, constructorParams?: string|string[] }} args
 * @returns {{ codeHash: string, single: boolean, parts: string[] | null, totalChunks: number }}
 */
export function planChunkedDeploy({ sdkRegistry, chainId, code, gasLimit, constructorParams }) {
    if (!sdkRegistry) throw new Error('planChunkedDeploy: sdkRegistry is required');
    if (!chainId) throw new Error('planChunkedDeploy: chainId is required');
    if (typeof code !== 'string' || code.length === 0) {
        throw new Error('planChunkedDeploy: code is required');
    }
    const sdk = sdkRegistry.get(chainId);
    if (typeof sdk.planDeploy !== 'function') {
        throw new Error('planChunkedDeploy: this SDK build has no planDeploy (needs the PC-38 SDK leg)');
    }
    return sdk.planDeploy(code, { gasLimit, constructorParams });
}

/** DEPLOY v4 carrier params for one ordered slice. */
export function chunkCarrierParams({ codeHash, index, totalChunks, part }) {
    return {
        VERSION: '4',
        CODE_HASH: String(codeHash),
        CHUNK_INDEX: String(index),
        TOTAL_CHUNKS: String(totalChunks),
        CODE_PART: String(part),
    };
}

/**
 * Assembling DEPLOY params: v2 normally, v3 when the contract opts into
 * staking (the same v0->v1 split the inline lane makes). CODE_HASH replaces
 * inline code; there is no CODE field on this leg.
 */
// NOTE: there is deliberately no NAME field here. DEPLOY carries none in ANY
// version (indexer formats 0-4 are VERSION|CODE_(ENCODING|HASH)|GAS_LIMIT|...),
// so a NAME passed in is silently dropped by the serializer - verified on chain,
// where an assembling leg built with one emitted `DEPLOY|2|<hash>|<gas>`.
export function assembleParams({ codeHash, gasLimit, constructorParams, cooldownBlocks, slashDestination }) {
    const hasStaking = cooldownBlocks !== undefined && cooldownBlocks !== null && String(cooldownBlocks).trim() !== '';
    /** @type {Record<string, string>} */
    const p = {
        VERSION: hasStaking ? '3' : '2',
        CODE_HASH: String(codeHash),
        GAS_LIMIT: String(gasLimit),
    };
    const ctor = normalizeConstructorParams(constructorParams);
    if (ctor.length > 0) {
        if (hasStaking) {
            // v3 carries CONSTRUCTOR_PARAMS as ONE plain wire field, so it
            // accepts at most one entry (the SDK throws on more rather than
            // silently comma-joining them into a single corrupted arg on an
            // immutable deploy). Surface that here instead of at submit time.
            if (ctor.length > 1) {
                throw new Error('assembleParams: a stakeable contract (DEPLOY v3) carries '
                    + `CONSTRUCTOR_PARAMS as a single field and accepts one entry; got ${ctor.length}. `
                    + 'Pack the values into one param your constructor parses, or deploy without staking fields.');
            }
            [p.CONSTRUCTOR_PARAMS] = ctor;
        } else {
            // v2 declares `...CONSTRUCTOR_PARAMS`: a REST field. The serializer
            // emits one pipe-delimited segment per array entry, so it must get
            // the ARRAY. Pre-joining with '|' produces a single value CONTAINING
            // pipes, which the SDK validator rejects outright
            // ("CONSTRUCTOR_PARAMS[0] cannot contain pipe").
            p.CONSTRUCTOR_PARAMS = ctor;
        }
    }
    if (hasStaking) {
        p.COOLDOWN_BLOCKS = String(cooldownBlocks).trim();
        // Mirror the inline lane: blank destination means BURN, and saying so
        // in the params keeps the review screen honest.
        p.SLASH_DESTINATION = (slashDestination && String(slashDestination).trim()) || 'BURN';
    }
    return p;
}

/**
 * Constructor args as the ARRAY the wire wants, from either an array or the
 * pipe-delimited string the form collects. Empty segments are dropped so a
 * trailing separator cannot inject a blank argument.
 *
 * @param {string|string[]|undefined|null} v
 * @returns {string[]}
 */
export function normalizeConstructorParams(v) {
    if (v === undefined || v === null) return [];
    const arr = Array.isArray(v) ? v : String(v).split('|');
    return arr.map((s) => String(s).trim()).filter((s) => s.length > 0);
}

/**
 * The action_index of the leg that was just submitted, from EITHER shape the
 * indexer wait can resolve with.
 *
 * This used to read `indexed.action_index` alone, and that field only
 * exists on ONE of the two paths `waitForTxid` can settle from:
 *
 *   - the WEBSOCKET fast path settles with a NEW_ACTION event, which carries
 *     `action_index` at the top level;
 *   - the POLLING fallback settles with the explorer's TRANSACTION row,
 *     `{ tx_hash, block_index, actions: [ { action_index, action, status } ] }`,
 *     which carries no top-level index at all.
 *
 * So on any venue without a live explorer WebSocket - which is every venue
 * where the socket is down, blocked, or simply not connected yet - leg 1
 * resolved successfully and then read `null`, and the run aborted with "chunk 1
 * of N did not index" while that chunk was on chain, valid and paid for. The
 * lane could never complete, and a resume re-sent (and re-paid for) the same
 * chunk, because the record it re-verifies never got an actionIndex written
 * into it either. Found by driving a full three-leg deploy (campaign §11.3).
 *
 * One action per leg is not an assumption: each leg is a single `submitAction`
 * call carrying one `{ action: 'DEPLOY' }`, so its transaction holds exactly one
 * XChain action. The DEPLOY filter is belt-and-braces for a future batching
 * change, and falls back to the sole entry rather than refusing.
 */
export function indexedActionIndex(res) {
    const indexed = res && res.indexed;
    if (!indexed || typeof indexed !== 'object') return null;
    const direct = indexed.action_index ?? indexed.actionIndex;
    if (direct !== undefined && direct !== null) return String(direct);
    const actions = Array.isArray(indexed.actions) ? indexed.actions : [];
    const leg = actions.find((a) => String((a && a.action) || '').toUpperCase() === 'DEPLOY')
        || (actions.length === 1 ? actions[0] : null);
    const idx = leg && (leg.action_index ?? leg.actionIndex);
    return idx === undefined || idx === null ? null : String(idx);
}

/**
 * Confirm ONE recorded chunk against the chain by its action_index.
 *
 * A recorded action_index only counts as done when the chain still reports it
 * VALID and still attributes it to this group and position - a reorg can drop
 * it, and a stale record must never let the assembler run against a chunk that
 * no longer exists (the assembly would index invalid and burn the fee).
 */
async function confirmByActionIndex({ sdk, record, chunk, actionIndex }) {
    let row = null;
    try {
        row = await sdk.getAction(String(actionIndex));
    } catch {
        // Unreadable is NOT confirmed: the caller re-sends. Re-sending costs a
        // fee; skipping a missing chunk costs the whole assembly, so this fails
        // toward spending.
        return false;
    }
    const data = row && row.data && !Array.isArray(row.data) ? row.data : row;
    const status = String((data && (data.status || (data.state && data.state.status))) || '').toLowerCase();
    const hashOnChain = String((data && (data.code_hash || (data.state && data.state.code_hash))) || '');
    const posOnChain = data && (data.chunk_index ?? (data.state && data.state.chunk_index));
    if (status !== 'valid') return false;
    if (hashOnChain && hashOnChain !== record.codeHash) return false;
    if (posOnChain !== undefined && posOnChain !== null && Number(posOnChain) !== Number(chunk.index)) return false;
    return true;
}

/**
 * The action_index a broadcast txid ended up as, or null while it has none.
 *
 * This is the lookup that closes the double-pay window. A chunk's
 * action_index is only knowable once the indexer has read it, but its TXID is
 * known the moment it is broadcast - so a run interrupted DURING the indexer
 * wait leaves a chunk that is on chain, paid for, and invisible to a record
 * that only tracks action_indexes.
 */
async function actionIndexForTxid({ sdk, txid }) {
    if (typeof sdk.getTransaction !== 'function') return null;
    let tx = null;
    try {
        tx = await sdk.getTransaction(String(txid), 'tx_hash');
    } catch {
        return null;
    }
    const data = tx && tx.data && !Array.isArray(tx.data) ? tx.data : tx;
    const actions = Array.isArray(data && data.actions) ? data.actions : [];
    const leg = actions.find((a) => String((a && a.action) || '').toUpperCase() === 'DEPLOY')
        || (actions.length === 1 ? actions[0] : null);
    const idx = leg && (leg.action_index ?? leg.actionIndex);
    return idx === undefined || idx === null ? null : String(idx);
}

// Bounds for the contract-resolution poll below. Same numbers the indexer wait
// and the SDK's own resolver use, so a caller that passes `waitOpts` once gets
// one consistent patience budget for the whole run.
const RESOLVE_TIMEOUT_MS = 120000;
const RESOLVE_INTERVAL_MS = 1500;

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * The action-detail object out of whichever envelope the explorer route wrapped
 * it in: `{ data: {...} }`, `{ data: [ {...} ] }`, `{ data: { action: {...} } }`
 * or the bare row.
 */
function unwrapActionDetail(row) {
    let d = row && row.data !== undefined && row.data !== null ? row.data : row;
    if (Array.isArray(d)) d = d[0];
    if (d && typeof d === 'object' && d.action && typeof d.action === 'object'
        && (d.action.action_index !== undefined || d.action.actionIndex !== undefined)) {
        d = d.action;
    }
    return d && typeof d === 'object' ? d : null;
}

/**
 * Which action_index the contract of an assembling DEPLOY ended up at, asked of
 * the chain rather than assumed.
 *
 * WHY this is not simply the assembler's own index: with deferred assembly the
 * group deploys at whichever piece COMPLETES it, so a group whose pieces
 * confirmed out of order (a reorg can do that to a run that was sequenced
 * correctly) has its contract, its address and its state at a chunk CARRIER's
 * index. Only the explorer knows which, and it says so on the assembler's own
 * action detail:
 *
 *   deployed_contract_index  the contract's action_index, or null
 *   assembly_status          `valid`, `pending: ... (awaiting chunks)`, or a
 *                            terminal `invalid: ...` / failure string
 *
 * The status is what makes the poll terminate: an assembler CONSUMED by a
 * failed completion (a hash mismatch at the completing carrier, a source
 * drained of gas) keeps a null index forever, and without the status a client
 * would poll it until the timeout on every resume.
 *
 * Neither field present means an OLDER explorer, which can only mean today's
 * rule: a `valid` assembler IS the contract, an `invalid` one is a re-send.
 * `fieldPresent` tells the caller which world it is in, because only in the old
 * one may it fall back to the leg's own index.
 *
 * @param {{ sdk: any, actionIndex: string|number, timeoutMs?: number, intervalMs?: number }} args
 * @returns {Promise<{ contractActionIndex: string|null, status: string|null,
 *   terminal: boolean, fieldPresent: boolean }>}
 */
async function resolveDeployedContractIndex({ sdk, actionIndex, timeoutMs, intervalMs }) {
    const budget = Number(timeoutMs) > 0 ? Number(timeoutMs) : RESOLVE_TIMEOUT_MS;
    const wait = Number(intervalMs) > 0 ? Number(intervalMs) : RESOLVE_INTERVAL_MS;
    const deadline = Date.now() + budget;
    // What we answer if the poll runs out: unresolved, and NOT terminal, so the
    // caller keeps the run resumable instead of recording a contract that may
    // yet appear at another index.
    let unresolved = { contractActionIndex: null, status: null, terminal: false, fieldPresent: false };
    for (;;) {
        let detail = null;
        try {
            detail = unwrapActionDetail(await sdk.getAction(String(actionIndex)));
        } catch {
            // An unreadable explorer is not a verdict; keep polling.
            detail = null;
        }
        if (detail) {
            const idx = detail.deployed_contract_index;
            const assembly = detail.assembly_status;
            if (idx !== undefined || assembly !== undefined) {
                const status = assembly === undefined || assembly === null ? null : String(assembly);
                if (idx !== undefined && idx !== null && String(idx) !== '') {
                    return { contractActionIndex: String(idx), status, terminal: true, fieldPresent: true };
                }
                if (!/^pending/i.test(status || '')) {
                    return { contractActionIndex: null, status, terminal: true, fieldPresent: true };
                }
                unresolved = { contractActionIndex: null, status, terminal: false, fieldPresent: true };
            } else {
                const own = String((detail.status || (detail.state && detail.state.status)) || '');
                if (/^valid/i.test(own)) {
                    return { contractActionIndex: String(actionIndex), status: own, terminal: true, fieldPresent: false };
                }
                if (/^invalid/i.test(own)) {
                    return { contractActionIndex: null, status: own, terminal: true, fieldPresent: false };
                }
                unresolved = { contractActionIndex: null, status: own || null, terminal: false, fieldPresent: false };
            }
        }
        if (Date.now() + wait > deadline) return unresolved;
        await sleep(wait);
    }
}

/** The resumable stop when the group has not finished assembling yet. */
function stillAssemblingError(status) {
    return new Error('deployChunkedRun: the assembling DEPLOY has not deployed its contract yet '
        + `(${status || 'no answer from the explorer'}); the run is saved and can be resumed `
        + 'once the chain catches up');
}

/**
 * Re-verify a resumed record's chunks against the chain.
 *
 * TWO WAYS IN, and the second one is a separate case. A chunk recorded with an
 * `actionIndex` is checked directly. A chunk recorded with only a `txid` -
 * broadcast, but interrupted before the indexer answered - is resolved through
 * that txid first. Without the second path a resume re-sends and re-pays for a
 * chunk the chain already holds, which is exactly what the resume banner
 * promises will not happen ("Finishing costs only the remaining ones").
 *
 * MEASURED, on Bitcoin regtest: interrupting a two-chunk run during leg 2's
 * indexer wait produced THREE carriers - 2223 (chunk 0), 2224 (chunk 1, from
 * the interrupted run) and 2225 (chunk 1 again, from the resume). Consensus
 * rule 3 dedups by position, lowest action_index wins, so 2224 stood and 2225
 * was a fee paid for nothing. The window is the width of the indexer wait, up
 * to 120s per leg, on a flow whose own copy tells the user it takes a few
 * minutes and to leave the wallet open.
 *
 * @returns {Promise<{confirmed: Set<number>, backfilled: Array<{index: number, actionIndex: string}>}>}
 */
export async function verifyRecordedChunks({ sdkRegistry, chainId, record }) {
    const sdk = sdkRegistry.get(chainId);
    /** @type {Set<number>} */
    const confirmed = new Set();
    /** @type {Array<{index: number, actionIndex: string}>} */
    const backfilled = [];
    for (const c of record.chunks || []) {
        if (c.actionIndex) {
            if (await confirmByActionIndex({ sdk, record, chunk: c, actionIndex: c.actionIndex })) {
                confirmed.add(Number(c.index));
            }
            continue;
        }
        if (!c.txid) continue;
        const resolved = await actionIndexForTxid({ sdk, txid: c.txid });
        if (!resolved) continue;
        // Held to the SAME standard as a recorded index: valid, this group, this
        // position. A txid that indexed invalid is not a chunk the assembler can
        // use, and skipping it would buy an assembly that cannot succeed.
        if (await confirmByActionIndex({ sdk, record, chunk: c, actionIndex: resolved })) {
            confirmed.add(Number(c.index));
            backfilled.push({ index: Number(c.index), actionIndex: resolved });
        }
    }
    return { confirmed, backfilled };
}

/**
 * Run (or resume) a chunked deploy end to end.
 *
 * Legs are sequential by consensus requirement, and each is a separate signed
 * transaction: a hardware signer confirms N+1 times. Watcher mode is refused
 * (an encode-only wallet cannot complete a run whose later legs depend on
 * earlier ones being signed and confirmed first).
 *
 * @param {object} opts
 * @param {any} opts.vault
 * @param {string} opts.walletId
 * @param {string} [opts.password]
 * @param {any} [opts.signer]
 * @param {any} opts.chainRegistry
 * @param {any} opts.sdkRegistry
 * @param {string} opts.chainId
 * @param {any} opts.from
 * @param {string} opts.code
 * @param {string} opts.gasLimit
 * @param {string} [opts.name]   legacy label; the contract's own `meta.name` is used when absent
 * @param {string|string[]} [opts.constructorParams]
 * @param {string} [opts.cooldownBlocks]
 * @param {string} [opts.slashDestination]
 * @param {number} [opts.feePerKb]
 * @param {boolean} [opts.payFeeInNativeCoin]: pay each leg's protocol fee in the native
 *   coin. Every leg is its own priced DEPLOY (the carriers per CODE_PART byte, the assembler at
 *   VM_DEPLOY_BASE), so the flag belongs on all of them or the run stalls partway through.
 * @param {string} [opts.resumeId]   existing pendingDeploy id to continue
 * @param {(phase: string, data: object) => void} [opts.onProgress]
 * @param {(txid: string, opts?: object) => Promise<unknown>} [opts.waitForTxid]
 * @param {object} [opts.waitOpts]
 */
export async function deployChunkedRun(opts) {
    if (!opts) throw new Error('deployChunkedRun: opts is required');
    if (!opts.vault) throw new Error('deployChunkedRun: vault is required');
    if (typeof opts.code !== 'string' || !opts.code.trim()) {
        throw new Error('deployChunkedRun: code is required');
    }
    if (!opts.gasLimit) throw new Error('deployChunkedRun: gasLimit is required');
    // CONTRACT_META_REQUIRED, before any leg is planned or composed. A chunked
    // group is judged once, at completion, on the ASSEMBLED source - so a
    // source with no `meta` buys N paid carriers and an assembler that indexes
    // `invalid`. A resume is refused on the same read: its chunks are already
    // sunk, and the assembler it is about to pay for cannot succeed.
    const meta = preflightContractMeta({
        sdkRegistry: opts.sdkRegistry,
        chainId: opts.chainId,
        code: opts.code,
    });
    // The contract's own name for the record and the assembling leg's pending
    // line. `opts.name` stays ahead of it only so an older caller that still
    // passes one is not silently overridden.
    const contractName = opts.name || metaNameOf(meta) || undefined;
    // Each leg must be INDEXED before the next is built (consensus rule 2), so
    // the indexer wait is mandatory here, unlike every single-leg flow where it
    // is an optional hook. Default it from the SDK rather than making every
    // caller (software route, HW wrapper, tests) remember to pass one.
    const sdkForWait = opts.sdkRegistry && opts.sdkRegistry.get(opts.chainId);
    const waitForTxid = typeof opts.waitForTxid === 'function'
        ? opts.waitForTxid
        : (sdkForWait && typeof sdkForWait.waitForAction === 'function'
            ? (txid, o) => sdkForWait.waitForAction(txid, o)
            : null);
    if (!waitForTxid) {
        throw new Error('deployChunkedRun: no indexer wait available (each chunk must index before the next leg)');
    }
    const source = normalizeSource(opts.from, 'deployChunkedRun');
    const progress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};

    const plan = planChunkedDeploy({
        sdkRegistry: opts.sdkRegistry,
        chainId: opts.chainId,
        code: opts.code,
        gasLimit: opts.gasLimit,
        constructorParams: opts.constructorParams,
    });
    if (plan.single) {
        throw new Error('deployChunkedRun: this source fits a single DEPLOY; use deployAction instead');
    }

    const assembleFromOpts = assembleParams({
        codeHash: plan.codeHash,
        gasLimit: opts.gasLimit,
        constructorParams: opts.constructorParams,
        cooldownBlocks: opts.cooldownBlocks,
        slashDestination: opts.slashDestination,
    });

    // Resume or start. A resumed record is only usable for the SAME group and
    // the SAME deployer (consensus rule 1).
    let record = null;
    if (opts.resumeId) {
        record = await opts.vault.pendingDeploys.get(opts.resumeId);
        if (!record) throw new Error(`deployChunkedRun: no pending deploy "${opts.resumeId}"`);
        if (record.codeHash !== plan.codeHash) {
            throw new Error('deployChunkedRun: the source has changed since this deploy started '
                + '(CODE_HASH mismatch); its chunks cannot be reused, start a new deploy');
        }
        if (record.sourceAddress !== source.address) {
            throw new Error('deployChunkedRun: this deploy was started from '
                + record.sourceAddress + '; chunks are gathered per-deployer, so it must be '
                + 'finished from that same address');
        }
    } else {
        record = createPendingDeploy({
            walletId: opts.walletId,
            chainId: opts.chainId,
            sourceAddress: source.address,
            codeHash: plan.codeHash,
            code: opts.code,
            totalChunks: plan.totalChunks,
            assembleParams: assembleFromOpts,
            name: contractName,
        });
        await opts.vault.pendingDeploys.put(record);
    }

    // On a RESUME the assembling leg comes from the record, not from the
    // caller's current arguments. The record stores `assembleParams` for exactly
    // this - "the DEPLOY v2/v3 params for phase 2", per its schema - and nothing
    // read it back, so a resumed run rebuilt phase 2 from whatever the form
    // happened to hold. The form's resume button restores the CODE and the NAME
    // and nothing else, so a resumed deploy silently lost:
    //   - the GAS_LIMIT (measured empty after a real resume, so it fell back to
    //     the auto-suggested value: a different limit than the one planned),
    //   - CONSTRUCTOR_PARAMS entirely, and
    //   - COOLDOWN_BLOCKS / SLASH_DESTINATION, which drops a stakeable v3 deploy
    //     to a NON-stakeable v2 - silently, and a deploy is immutable.
    // The chunks are unaffected either way (CODE_HASH is a function of the source
    // alone, and the record's is checked above), so this is purely about phase 2
    // being the deploy that was planned.
    const assemble = (opts.resumeId && record.assembleParams
        && String(record.assembleParams.CODE_HASH || '') === String(plan.codeHash))
        ? record.assembleParams
        : assembleFromOpts;

    // The same patience budget the indexer wait gets, under the waiter's own
    // option names.
    const resolveBounds = {
        timeoutMs: opts.waitOpts && opts.waitOpts.timeout,
        intervalMs: opts.waitOpts && opts.waitOpts.pollInterval,
    };

    // A resume that already broadcast the assembling leg must ASK the chain what
    // that leg produced before it sends anything at all.
    //
    // Under deferred assembly the group deploys at whichever piece completes it,
    // so a resume that blindly re-sent the assembler would land it against a
    // COMPLETE group: the indexer deploys it inline, at the new assembler's
    // index, and the deployer has paid twice for two contracts, the second one
    // at an address nothing points at. The txid stamped at broadcast (below) is
    // the only handle a run interrupted during the indexer wait keeps.
    if (opts.resumeId && record.stage === 'assembling' && record.deployTxid) {
        const sdk = opts.sdkRegistry.get(opts.chainId);
        let assemblerIndex = await actionIndexForTxid({ sdk, txid: record.deployTxid });
        if (!assemblerIndex) {
            // Broadcast but not indexed YET: wait on it exactly as the
            // interrupted run would have, rather than paying for a second one.
            try {
                const waited = await waitForTxid(record.deployTxid, opts.waitOpts);
                assemblerIndex = indexedActionIndex({ indexed: waited });
            } catch {
                // Genuinely gone: fall through to the re-send below.
            }
        }
        if (assemblerIndex) {
            const resolved = await resolveDeployedContractIndex({
                sdk, actionIndex: assemblerIndex, ...resolveBounds,
            });
            if (resolved.contractActionIndex) {
                record = { ...record, contractActionIndex: resolved.contractActionIndex, stage: 'done' };
                await opts.vault.pendingDeploys.put(record);
                progress('assemble-done', { actionIndex: record.contractActionIndex, resumed: true });
                return {
                    txid: record.deployTxid,
                    contractActionIndex: record.contractActionIndex,
                    pendingDeployId: record.id,
                    codeHash: plan.codeHash,
                    totalChunks: plan.totalChunks,
                };
            }
            if (!resolved.terminal) throw stillAssemblingError(resolved.status);
            // Terminally failed (a hash mismatch at the completing piece, a
            // source drained of gas, or carriers that never arrived): re-sending
            // the assembler IS the fix, so fall through to it.
        }
    }

    const verified = opts.resumeId
        ? await verifyRecordedChunks({ sdkRegistry: opts.sdkRegistry, chainId: opts.chainId, record })
        : { confirmed: new Set(), backfilled: [] };
    const alreadyConfirmed = verified.confirmed;
    // Persist anything the txid lookup recovered, so a second interruption does
    // not have to re-derive it (and so the resume banner's "N of M" is honest).
    if (verified.backfilled.length > 0) {
        const byIndex = new Map(verified.backfilled.map((b) => [b.index, b.actionIndex]));
        record = {
            ...record,
            chunks: record.chunks.map((c) => (byIndex.has(Number(c.index))
                ? { ...c, actionIndex: byIndex.get(Number(c.index)) }
                : c)),
        };
        await opts.vault.pendingDeploys.put(record);
    }

    /**
     * Write a leg's txid into the record the moment it is broadcast.
     *
     * The chunk row used to be written only AFTER the indexer wait
     * returned, so a run interrupted during that wait - up to 120s per leg, on a
     * flow that tells the user it takes a few minutes - left a chunk on chain,
     * paid for, and invisible to the resumed run, which re-sent and re-paid for
     * it. `submitWithSigner` emits 'waiting' with the final txid immediately
     * after broadcast, which is the earliest moment the txid is knowable, so
     * that is where the record is stamped. `verifyRecordedChunks` resolves a
     * txid-only chunk through the chain on resume.
     */
    const stampChunkTxid = async (index, txid) => {
        if (index === null || !txid) return;
        record = {
            ...record,
            chunks: record.chunks.map((c) => (Number(c.index) === Number(index)
                ? { ...c, txid: String(txid) }
                : c)),
        };
        await opts.vault.pendingDeploys.put(record);
    };

    /**
     * The same stamp for the ASSEMBLING leg, which carries no chunk index and
     * so is invisible to `stampChunkTxid`. Without it a run interrupted during
     * the assembler's indexer wait resumes with stage `assembling` and no txid,
     * so the resume cannot ask what that leg produced and re-sends; against a
     * group that meanwhile completed, that buys a SECOND contract.
     */
    const stampDeployTxid = async (txid) => {
        if (!txid || record.stage !== 'assembling') return;
        record = { ...record, deployTxid: String(txid) };
        await opts.vault.pendingDeploys.put(record);
    };

    const submitLeg = async (params, label, chunkIndex = null) => submitAction({
        vault: opts.vault,
        walletId: opts.walletId,
        password: opts.password,
        signer: opts.signer,
        bip39Passphrase: opts.bip39Passphrase,
        chainRegistry: opts.chainRegistry,
        sdkRegistry: opts.sdkRegistry,
        chainId: opts.chainId,
        actionData: { action: 'DEPLOY', params },
        encoderOpts: {
            pubkey: source.publicKey,
            // Fund by address and return change to the spender: every leg
            // spends the previous leg's confirmed change from this same
            // address, and the tracker cannot resolve a raw pubkey to a script.
            sourceAddress: source.address,
            change: source.address,
            ...(opts.fee !== undefined && { fee: opts.fee }),
            ...(opts.feePerKb !== undefined && { feePerKb: opts.feePerKb }),
            ...(opts.rbf !== undefined && { rbf: opts.rbf }),
            // Per leg, not once for the run: each carrier and the assembler is a
            // separate DEPLOY the chain prices and checks on its own, so a flag
            // applied to only some of them buys N paid chunks and no contract.
            ...(opts.payFeeInNativeCoin !== undefined && { payFeeInNativeCoin: opts.payFeeInNativeCoin }),
        },
        signingPaths: [source.derivationPath
            ? { inputIndex: 0, path: source.derivationPath }
            : { inputIndex: 0, addressId: source.addressId }],
        pendingTxMeta: {
            fromAddress: source.address,
            toAddress: null,
            actionSummary: label,
        },
        waitForTxid,
        waitOpts: opts.waitOpts,
        onProgress: (phase, data) => {
            // 'waiting' is fired with the final txid right after broadcast and
            // before the indexer wait, which is exactly the window this closes.
            // Fire-and-forget: a failed vault write must not abort a leg that is
            // already on the wire, and the next persist covers it.
            if ((phase === 'waiting' || phase === 'broadcasting') && data && data.txid) {
                const stamp = chunkIndex === null
                    ? stampDeployTxid(data.txid)
                    : stampChunkTxid(chunkIndex, data.txid);
                stamp.catch(() => {});
            }
        },
    });

    // Phase 1: carriers, in order, each indexed before the next.
    for (let i = 0; i < plan.totalChunks; i++) {
        if (alreadyConfirmed.has(i)) {
            progress('chunk-skipped', { index: i, total: plan.totalChunks });
            continue;
        }
        // Second window: a chunk whose txid we hold but which the chain
        // does not YET carry an action for. `verifyRecordedChunks` could not
        // confirm it because the transaction is still unmined - measured live,
        // where a resume re-sent a chunk that was sitting in the mempool and
        // confirmed a moment later, producing two carriers for one position.
        //
        // Re-sending is not the honest move when the txid is known: WAIT on it,
        // exactly as the interrupted run would have. The wait is the same
        // `waitForTxid` every leg already uses, so a transaction that confirms
        // costs nothing extra, and one that is genuinely gone falls through to a
        // re-send after its own timeout - which is the right trade, since the
        // alternative pays a second fee every time.
        const pending = (record.chunks || []).find(
            (c) => Number(c.index) === i && c.txid && !c.actionIndex,
        );
        if (pending) {
            progress('chunk-waiting', { index: i, total: plan.totalChunks, txid: pending.txid });
            let recovered = null;
            try {
                const waited = await waitForTxid(pending.txid, opts.waitOpts);
                const idx = indexedActionIndex({ indexed: waited });
                if (idx && await confirmByActionIndex({
                    sdk: opts.sdkRegistry.get(opts.chainId), record, chunk: pending, actionIndex: idx,
                })) {
                    recovered = idx;
                }
            } catch {
                // Never confirmed inside the window, or unreadable: re-send below.
            }
            if (recovered) {
                record = {
                    ...record,
                    chunks: record.chunks.map((c) => (Number(c.index) === i
                        ? { ...c, actionIndex: recovered }
                        : c)),
                };
                await opts.vault.pendingDeploys.put(record);
                progress('chunk-done', { index: i, total: plan.totalChunks, actionIndex: recovered });
                continue;
            }
        }
        progress('chunk-start', { index: i, total: plan.totalChunks });
        const res = await submitLeg(
            chunkCarrierParams({
                codeHash: plan.codeHash,
                index: i,
                totalChunks: plan.totalChunks,
                part: plan.parts[i],
            }),
            `Deploy chunk ${i + 1} of ${plan.totalChunks}`,
            i,
        );
        const actionIndex = indexedActionIndex(res);
        if (!actionIndex) {
            throw new Error(`deployChunkedRun: chunk ${i + 1} of ${plan.totalChunks} did not index; `
                + 'the run is saved and can be resumed once the chain catches up');
        }
        // Persist BEFORE the next leg: a crash here must not lose a paid-for chunk.
        record = {
            ...record,
            chunks: record.chunks.map((c) => (c.index === i
                ? { ...c, txid: res.txid || (res.broadcast && res.broadcast.txid) || null, actionIndex }
                : c)),
        };
        await opts.vault.pendingDeploys.put(record);
        progress('chunk-done', { index: i, total: plan.totalChunks, actionIndex });
    }

    record = { ...record, stage: 'assembling' };
    await opts.vault.pendingDeploys.put(record);

    // Phase 2: assemble. Every carrier now sits at a lower action_index.
    progress('assemble-start', { totalChunks: plan.totalChunks });
    const deployRes = await submitLeg(assemble, `Deploy contract "${contractName || '(unnamed)'}" (assembling ${plan.totalChunks} chunks)`);
    const assemblerIndex = indexedActionIndex(deployRes);
    // The contract is not necessarily at the assembler's own index - see
    // `resolveDeployedContractIndex`. Recording the leg's index without asking
    // would name the wrong action as the contract for every group whose pieces
    // confirmed out of order, and every deposit, execution and state read the
    // wallet made afterwards would address a contract that is not there.
    const resolved = assemblerIndex
        ? await resolveDeployedContractIndex({
            sdk: opts.sdkRegistry.get(opts.chainId), actionIndex: assemblerIndex, ...resolveBounds,
        })
        : null;
    if (resolved && resolved.fieldPresent && !resolved.contractActionIndex && !resolved.terminal) {
        // Still awaiting chunks: the leg is on chain and its txid is stamped, so
        // the honest move is to stop resumably rather than record a contract
        // index that does not exist yet.
        throw stillAssemblingError(resolved.status);
    }
    record = {
        ...record,
        deployTxid: deployRes.txid || (deployRes.broadcast && deployRes.broadcast.txid) || record.deployTxid || null,
        // Fall back to the leg's own index ONLY where the explorer serves no
        // field to read (an older build), never where it answered.
        contractActionIndex: resolved && resolved.fieldPresent
            ? resolved.contractActionIndex
            : assemblerIndex,
        stage: 'done',
    };
    await opts.vault.pendingDeploys.put(record);
    progress('assemble-done', { actionIndex: record.contractActionIndex });

    return {
        ...deployRes,
        // The RESOLVED contract index, which `deployRes.indexed` does not carry:
        // that one is the assembling leg's own action, and the two differ
        // whenever another piece completed the group.
        contractActionIndex: record.contractActionIndex,
        pendingDeployId: record.id,
        codeHash: plan.codeHash,
        totalChunks: plan.totalChunks,
    };
}

/**
 * In-flight (not yet finished) chunked deploys for a wallet, newest first.
 * The form surfaces these as a resume banner: each one represents chunks
 * already paid for on chain.
 */
export async function listPendingDeploysForWallet({ vault, walletId }) {
    if (!vault) throw new Error('listPendingDeploysForWallet: vault is required');
    if (!walletId) throw new Error('listPendingDeploysForWallet: walletId is required');
    const rows = await vault.pendingDeploys.findBy('walletId', walletId);
    return rows
        .slice()
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/** Drop a record (finished, or abandoned by the user). */
export async function clearPendingDeploy({ vault, id }) {
    if (!vault) throw new Error('clearPendingDeploy: vault is required');
    if (!id) throw new Error('clearPendingDeploy: id is required');
    await vault.pendingDeploys.delete(id);
    return { id };
}
