// SPDX-License-Identifier: AGPL-3.0-or-later

import { BALANCES_BATCH_MAX_ADDRESSES } from '../balances.js';
import { branchOf } from '../changeAddress.js';
import { isUnknownAddressTypeError } from '../sdkAddressTypes.js';

export async function scanBranch(opts) {
    const fresh = [];
    let unusedRun = 0;
    for (let start = 0; unusedRun < opts.gapLimit; start += BALANCES_BATCH_MAX_ADDRESSES) {
        throwIfAborted(opts.signal);
        const derived = await deriveWindow(opts, opts.addressType, start);
        const used = await timedUsage(opts, derived);
        throwIfAborted(opts.signal);
        for (let i = 0; i < derived.length && unusedRun < opts.gapLimit; i++) {
            const held = opts.knownAddresses.has(`${opts.chainId}|${derived[i].address}`);
            if (used[i] || held) {
                unusedRun = 0;
                if (used[i] && !held) fresh.push(derived[i]);
            } else {
                unusedRun += 1;
            }
        }
    }
    return fresh;
}

export async function scanSharedBranch(opts) {
    const fresh = [];
    let unusedRun = 0;
    for (let start = 0; unusedRun < opts.gapLimit; start += BALANCES_BATCH_MAX_ADDRESSES) {
        throwIfAborted(opts.signal);
        const windows = [];
        for (const addressType of opts.addressTypes) {
            let derived;
            try {
                derived = await deriveWindow(opts, addressType, start);
            } catch (err) {
                if (isUnknownAddressTypeError(err)) continue;
                throw err;
            }
            windows.push({ addressType, derived, used: await timedUsage(opts, derived) });
        }
        throwIfAborted(opts.signal);
        for (let i = 0; i < BALANCES_BATCH_MAX_ADDRESSES && unusedRun < opts.gapLimit; i++) {
            const index = start + i;
            const occupied = opts.heldIndices.has(index)
                || windows.some(({ used }) => used[i]);
            unusedRun = occupied ? 0 : unusedRun + 1;
            for (const window of windows) {
                const derived = window.derived[i];
                const held = opts.knownAddresses.has(`${opts.chainId}|${derived.address}`);
                if (window.used[i] && !held) {
                    fresh.push({ ...derived, addressType: window.addressType });
                }
            }
        }
    }
    return fresh;
}

async function deriveWindow(opts, addressType, startIndex) {
    const derived = await opts.signer.getAddresses({
        chainId: opts.chainId,
        accountIndex: opts.account.index,
        change: opts.branch,
        startIndex,
        count: BALANCES_BATCH_MAX_ADDRESSES,
        addressType,
    });
    if (!Array.isArray(derived) || derived.length !== BALANCES_BATCH_MAX_ADDRESSES) {
        throw new Error('The signer did not derive the requested addresses.');
    }
    for (const entry of derived) validateDerived(entry, opts.branch);
    return derived;
}

function validateDerived(derived, branch) {
    const parsed = branchOf(derived?.path);
    if (!derived?.address || !derived?.publicKey || !parsed || parsed.branch !== String(branch)) {
        throw new Error('The signer derived an address outside the requested branch.');
    }
}

function timedUsage(opts, derived) {
    return withTimeout(
        opts.readUsage(opts.sdk, derived.map((entry) => entry.address)),
        opts.readTimeoutMs,
    );
}

function withTimeout(promise, ms) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(
            `The explorer did not answer within ${Math.round(ms / 1000)} seconds.`,
        )), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function throwIfAborted(signal) {
    if (!signal?.aborted) return;
    const error = new Error('Address discovery cancelled.');
    error.name = 'AbortError';
    throw error;
}
