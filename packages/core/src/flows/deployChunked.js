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
// Every leg is a real transaction with a real fee, so the run is RESUMABLE:
// each confirmed chunk is written to the pendingDeploy record before the next
// leg starts, and a resumed run re-verifies those action_indexes on chain
// before skipping them.

import { submitAction } from './submitAction.js';
import { normalizeSource } from './sendToken.js';
import { createPendingDeploy } from '../schemas/pendingDeploy.js';

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

function indexedActionIndex(res) {
    const idx = res && res.indexed
        && (res.indexed.action_index ?? res.indexed.actionIndex);
    return idx === undefined || idx === null ? null : String(idx);
}

/**
 * Re-verify a resumed record's recorded chunks against the chain. A recorded
 * action_index only counts as done when the chain still reports it VALID and
 * still attributes it to this group and position - a reorg can drop it, and a
 * stale record must never let the assembler run against a chunk that no
 * longer exists (the assembly would index invalid and burn the fee).
 *
 * @returns {Promise<Set<number>>} the chunk indexes confirmed on chain
 */
export async function verifyRecordedChunks({ sdkRegistry, chainId, record }) {
    const sdk = sdkRegistry.get(chainId);
    /** @type {Set<number>} */
    const confirmed = new Set();
    for (const c of record.chunks || []) {
        if (!c.actionIndex) continue;
        let row = null;
        try {
            row = await sdk.getAction(String(c.actionIndex));
        } catch {
            // Unreadable is NOT confirmed: fall through and re-send the chunk.
            // Re-sending costs a fee; skipping a missing chunk costs the whole
            // assembly, so this fails toward spending.
            continue;
        }
        const data = row && row.data && !Array.isArray(row.data) ? row.data : row;
        const status = String((data && (data.status || (data.state && data.state.status))) || '').toLowerCase();
        const hashOnChain = String((data && (data.code_hash || (data.state && data.state.code_hash))) || '');
        const posOnChain = data && (data.chunk_index ?? (data.state && data.state.chunk_index));
        if (status !== 'valid') continue;
        if (hashOnChain && hashOnChain !== record.codeHash) continue;
        if (posOnChain !== undefined && posOnChain !== null && Number(posOnChain) !== Number(c.index)) continue;
        confirmed.add(Number(c.index));
    }
    return confirmed;
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
 * @param {string} [opts.name]
 * @param {string|string[]} [opts.constructorParams]
 * @param {string} [opts.cooldownBlocks]
 * @param {string} [opts.slashDestination]
 * @param {number} [opts.feePerKb]
 * @param {boolean} [opts.payFeeInNativeCoin]  : pay each leg's protocol fee in the native
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

    const assemble = assembleParams({
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
            assembleParams: assemble,
            name: opts.name,
        });
        await opts.vault.pendingDeploys.put(record);
    }

    const alreadyConfirmed = opts.resumeId
        ? await verifyRecordedChunks({ sdkRegistry: opts.sdkRegistry, chainId: opts.chainId, record })
        : new Set();

    const submitLeg = async (params, label) => submitAction({
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
    });

    // Phase 1: carriers, in order, each indexed before the next.
    for (let i = 0; i < plan.totalChunks; i++) {
        if (alreadyConfirmed.has(i)) {
            progress('chunk-skipped', { index: i, total: plan.totalChunks });
            continue;
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
    const deployRes = await submitLeg(assemble, `Deploy contract "${opts.name || '(unnamed)'}" (assembling ${plan.totalChunks} chunks)`);
    record = {
        ...record,
        deployTxid: deployRes.txid || (deployRes.broadcast && deployRes.broadcast.txid) || null,
        contractActionIndex: indexedActionIndex(deployRes),
        stage: 'done',
    };
    await opts.vault.pendingDeploys.put(record);
    progress('assemble-done', { actionIndex: record.contractActionIndex });

    return { ...deployRes, pendingDeployId: record.id, codeHash: plan.codeHash, totalChunks: plan.totalChunks };
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
