// SPDX-License-Identifier: AGPL-3.0-or-later

import { derive, zeroDerivedKey } from '../../crypto/index.js';

const MAX_DERIVATION_INDEX = 0x7fffffff;

export async function scanChainType(opts) {
    const state = createState(opts.addressType);
    const context = {
        ...opts,
        sdk: opts.sdkRegistry.get(opts.chainId),
        state,
        deadline: Date.now() + opts.chainTimeoutMs,
    };
    safeCallback(opts.onProgress, startEvent(opts.chainId, opts.addressType));
    for (let index = opts.startIndex; ; index++) {
        if (await scanSingleIndex(context, index)) break;
    }
    emitFinished(context, state);
    return resultFor(opts.chainId, state);
}

async function scanSingleIndex(context, index) {
    const { state } = context;
    throwIfAborted(context.signal);
    if (Date.now() >= context.deadline) {
        failState(state, `chain scan exceeded ${context.chainTimeoutMs}ms`);
        return true;
    }
    const derived = deriveAt(context, state.addressType, index);
    const probe = await probeAddress(context, derived.address, index);
    appendProbe(state, derived, probe, index);
    updateSingleGap(state, probe);
    emitProgress(context, state.addressType, index, probe, state.consecutiveUnused);
    throwIfAborted(context.signal);
    return state.consecutiveUnused >= context.gapLimit || stopAtIndexLimit(state, index);
}

export async function scanSharedChainTypes(opts) {
    const states = opts.addressTypes.map(createState);
    const context = {
        ...opts,
        sdk: opts.sdkRegistry.get(opts.chainId),
        states,
        consecutiveUnused: 0,
        deadline: Date.now() + opts.chainTimeoutMs,
    };
    for (const type of opts.addressTypes) {
        safeCallback(opts.onProgress, startEvent(opts.chainId, type));
    }
    for (let index = opts.startIndex; ; index++) {
        if (await scanSharedIndex(context, index)) break;
    }
    for (const state of states) emitFinished(context, state);
    return states.map((state) => resultFor(opts.chainId, state));
}

async function scanSharedIndex(context, index) {
    throwIfAborted(context.signal);
    const active = context.states.filter((state) => !state.incomplete);
    if (active.length === 0) return true;
    if (Date.now() >= context.deadline) {
        for (const state of active) failState(state, `chain scan exceeded ${context.chainTimeoutMs}ms`);
        return true;
    }
    const records = deriveSharedAt(context, active, index);
    const probes = [];
    for (const record of records) {
        const probe = await probeAddress(context, record.address, index);
        probes.push({ ...record, ...probe });
    }
    updateSharedGap(context, probes);
    for (const record of probes) {
        appendProbe(record.state, record, record, index);
        emitProgress(context, record.state.addressType, index, record, context.consecutiveUnused);
    }
    throwIfAborted(context.signal);
    if (context.consecutiveUnused >= context.gapLimit) return true;
    if (index !== MAX_DERIVATION_INDEX) return false;
    for (const state of context.states.filter((item) => !item.incomplete)) {
        failState(state, indexLimitError());
    }
    return true;
}

function deriveAt(context, addressType, index) {
    const path = derivationPath(context, addressType, index);
    const dk = derive(context.hdRoot, path);
    try {
        const publicKey = dk.publicKeyHex;
        const address = context.sdk.wallet.deriveAddress(publicKey, { type: addressType });
        return { path, publicKey, address, addressType };
    } finally {
        zeroDerivedKey(dk);
    }
}

function deriveSharedAt(context, active, index) {
    const path = derivationPath(context, active[0].addressType, index);
    const dk = derive(context.hdRoot, path);
    const records = [];
    try {
        for (const state of active) {
            try {
                records.push({
                    state,
                    path,
                    publicKey: dk.publicKeyHex,
                    addressType: state.addressType,
                    address: context.sdk.wallet.deriveAddress(
                        dk.publicKeyHex,
                        { type: state.addressType },
                    ),
                });
            } catch (error) {
                failState(state, messageOf(error));
            }
        }
    } finally {
        zeroDerivedKey(dk);
    }
    return records;
}

function derivationPath(context, addressType, index) {
    const path = context.chainRegistry.derivationPathFor(
        context.chainId,
        addressType,
        context.accountIndex,
        context.change,
        index,
        { format: context.format },
    );
    if (!path) throw new Error(`no derivation path for ${context.chainId}/${addressType}`);
    return path;
}

async function probeAddress(context, address, index) {
    try {
        const value = await runWithTimeout(
            () => context.isUsedProbe(context.sdk, address),
            Math.min(context.perQueryTimeoutMs, Math.max(1, context.deadline - Date.now())),
            context.signal,
        );
        if (typeof value?.used !== 'boolean') throw new Error('probe returned an invalid result');
        return { used: value.used, unknown: false };
    } catch (error) {
        if (context.signal?.aborted) throw error;
        return {
            used: false,
            unknown: true,
            error: `probe failed for index ${index}: ${messageOf(error)}`,
        };
    }
}

function appendProbe(state, derived, probe, index) {
    state.addresses.push({
        index,
        path: derived.path,
        addressType: state.addressType,
        address: derived.address,
        publicKey: derived.publicKey,
        used: probe.used,
        unknown: probe.unknown,
    });
    if (probe.used) state.highestUsedIndex = index;
    if (probe.error && !state.error) state.error = probe.error;
}

function updateSingleGap(state, probe) {
    if (probe.used) state.consecutiveUnused = 0;
    else if (!probe.unknown) state.consecutiveUnused += 1;
}

function updateSharedGap(context, probes) {
    if (probes.some((probe) => probe.used)) context.consecutiveUnused = 0;
    else if (probes.length > 0 && probes.every((probe) => !probe.unknown)) {
        context.consecutiveUnused += 1;
    }
}

function createState(addressType) {
    return {
        addressType,
        addresses: [],
        highestUsedIndex: -1,
        consecutiveUnused: 0,
        incomplete: false,
        error: null,
        failureEmitted: false,
    };
}

function failState(state, error) {
    state.incomplete = true;
    state.error = error;
}

function stopAtIndexLimit(state, index) {
    if (index !== MAX_DERIVATION_INDEX) return false;
    failState(state, indexLimitError());
    return true;
}

function indexLimitError() {
    return `derivation index limit ${MAX_DERIVATION_INDEX} reached before the gap limit`;
}

function emitProgress(context, addressType, index, probe, consecutiveUnused) {
    safeCallback(context.onProgress, {
        phase: 'scan-progress',
        chainId: context.chainId,
        addressType,
        index,
        data: { used: probe.used, unknown: probe.unknown, consecutiveUnused },
    });
}

function emitFinished(context, state) {
    if (state.failureEmitted) return;
    const base = { chainId: context.chainId, addressType: state.addressType };
    if (state.incomplete) {
        safeCallback(context.onProgress, { phase: 'chain-failed', ...base, error: state.error });
    } else {
        safeCallback(context.onProgress, {
            phase: 'chain-complete',
            ...base,
            data: { highestUsedIndex: state.highestUsedIndex, scannedCount: state.addresses.length },
        });
    }
    state.failureEmitted = true;
}

function resultFor(chainId, state) {
    return {
        chainId,
        addressType: state.addressType,
        addresses: state.addresses,
        highestUsedIndex: state.highestUsedIndex,
        scannedCount: state.addresses.length,
        incomplete: state.incomplete,
        error: state.error,
    };
}

function startEvent(chainId, addressType) {
    return { phase: 'chain-start', chainId, addressType };
}

function messageOf(error) {
    return error?.message ? String(error.message) : String(error);
}

function safeCallback(fn, event) {
    if (typeof fn !== 'function') return;
    try { fn(event); } catch { /* caller bugs do not derail the scan */ }
}

function runWithTimeout(fn, timeoutMs, signal) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
            callback(value);
        };
        const onAbort = () => finish(reject, abortError(signal));
        const timer = setTimeout(() => finish(
            reject,
            new Error(`probe timed out after ${timeoutMs}ms`),
        ), timeoutMs);
        if (signal?.aborted) return onAbort();
        signal?.addEventListener('abort', onAbort, { once: true });
        Promise.resolve().then(fn).then(
            (value) => finish(resolve, value),
            (error) => finish(reject, error),
        );
    });
}

function throwIfAborted(signal) {
    if (signal?.aborted) throw abortError(signal);
}

function abortError(signal) {
    if (signal?.reason?.name === 'AbortError') return signal.reason;
    const error = new Error(typeof signal?.reason === 'string'
        ? signal.reason
        : 'Address discovery cancelled.');
    error.name = 'AbortError';
    return error;
}
