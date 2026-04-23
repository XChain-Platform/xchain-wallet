// ADS (Automatic Donation System) accumulator — §36.3.
//
// Model (per spec): each tx contributes `perTxAmountSats` to a per-chain
// accumulator. When the accumulator reaches `triggerAmountSats`, the
// *next* transaction on that chain should include a donation output
// equal to the current accumulated amount; the accumulator then
// resets and the donation is counted in `lifetimeDonatedSats`.
//
// This module ships three layers:
//
//   • `resolveAdsForNextTx`   — pure arithmetic only, ignores the chain
//                               descriptor. Returns the amount that
//                               WOULD be donated if ADS were fully
//                               configured. Kept for callers that
//                               want the raw accounting.
//
//   • `resolveAdsPlanForNextTx` — adds the configuration check from
//                               §5.5: if the chain descriptor's
//                               `adsDonationAddress` is the
//                               placeholder sentinel, `canSubmit` is
//                               false and the submission integration
//                               skips the output injection (counters
//                               still advance normally so the user's
//                               lifetimeTxCount reflects reality).
//
//   • `stepAdsAccumulator` + `commitAdsStep` — state transition after
//                               a broadcast. Pure + vault-aware pair.
//
// The submitAction integration (inject donation output into
// encoderOpts.customOutputs, then call commitAdsStep after a
// successful broadcast) now uses `resolveAdsPlanForNextTx` + the
// descriptor's `adsDonationAddress`.

import { isDonationAddressConfigured } from '../registry/validate.js';

/**
 * Check whether the NEXT transaction on `chainId` should include a
 * donation output (accumulator has already crossed the trigger on a
 * previous tx). Read-only.
 *
 * @param {import('../schemas/settings.js').Settings | null} settings
 * @param {string} chainId
 * @returns {{ donationAmount: number }}   0 if ADS disabled, chain not seeded, or trigger not reached
 */
export function resolveAdsForNextTx(settings, chainId) {
    if (!settings || !settings.ads || !settings.ads.enabled) {
        return { donationAmount: 0 };
    }
    const state = settings.ads.perChain?.[chainId];
    if (!state) return { donationAmount: 0 };
    if (state.accumulatedSats >= state.triggerAmountSats) {
        return { donationAmount: state.accumulatedSats };
    }
    return { donationAmount: 0 };
}

/**
 * Configuration-aware plan for the NEXT transaction. Combines the
 * arithmetic result from `resolveAdsForNextTx` with the chain
 * descriptor's donation-address status. `canSubmit` is true only when
 * both are met: the accumulator is over threshold AND the descriptor
 * carries a real address (not the §5.5 placeholder sentinel).
 *
 * Callers that want to actually inject the output check `canSubmit`.
 * Callers doing UI preview / stats use `donationAmount` directly.
 *
 * @param {import('../schemas/settings.js').Settings | null} settings
 * @param {string} chainId
 * @param {import('../registry/index.js').ChainRegistry} chainRegistry
 * @returns {{ donationAmount: number, donationAddress: string | null, canSubmit: boolean, reason: 'ok' | 'ads-disabled' | 'chain-not-seeded' | 'trigger-not-reached' | 'address-not-configured' | 'unknown-chain' }}
 */
export function resolveAdsPlanForNextTx(settings, chainId, chainRegistry) {
    const descriptor = chainRegistry?.get?.(chainId);
    if (!descriptor) {
        return {
            donationAmount: 0,
            donationAddress: null,
            canSubmit: false,
            reason: 'unknown-chain',
        };
    }
    if (!settings || !settings.ads || !settings.ads.enabled) {
        return {
            donationAmount: 0,
            donationAddress: null,
            canSubmit: false,
            reason: 'ads-disabled',
        };
    }
    const state = settings.ads.perChain?.[chainId];
    if (!state) {
        return {
            donationAmount: 0,
            donationAddress: null,
            canSubmit: false,
            reason: 'chain-not-seeded',
        };
    }
    if (state.accumulatedSats < state.triggerAmountSats) {
        return {
            donationAmount: 0,
            donationAddress: null,
            canSubmit: false,
            reason: 'trigger-not-reached',
        };
    }
    if (!isDonationAddressConfigured(descriptor)) {
        // Arithmetic says donate, but the address is still the §5.5
        // placeholder. Surface the amount so UI can show "pending
        // donation $X — address not yet configured" but do NOT inject.
        return {
            donationAmount: state.accumulatedSats,
            donationAddress: null,
            canSubmit: false,
            reason: 'address-not-configured',
        };
    }
    return {
        donationAmount: state.accumulatedSats,
        donationAddress: descriptor.adsDonationAddress,
        canSubmit: true,
        reason: 'ok',
    };
}

/**
 * Produce a new Settings with the per-chain ADS state advanced by one
 * transaction. Pure — returns a new object if something changed, or
 * the same reference if no change would be applied.
 *
 * - `donationIncluded = false` (normal): accumulator += perTxAmountSats;
 *   lifetimeTxCount += 1.
 * - `donationIncluded = true`: the tx we just broadcast carried the
 *   donation. lifetimeDonatedSats += the pre-reset accumulator;
 *   accumulator resets to perTxAmountSats (this tx's own contribution
 *   toward the next cycle); lifetimeTxCount += 1.
 *
 * @param {import('../schemas/settings.js').Settings} settings
 * @param {string} chainId
 * @param {{ donationIncluded: boolean }} params
 * @returns {import('../schemas/settings.js').Settings}
 */
export function stepAdsAccumulator(settings, chainId, { donationIncluded }) {
    if (!settings || !settings.ads || !settings.ads.enabled) return settings;
    const state = settings.ads.perChain?.[chainId];
    if (!state) return settings;

    const prior = state.accumulatedSats;
    const nextState = {
        ...state,
        lifetimeTxCount: state.lifetimeTxCount + 1,
    };
    if (donationIncluded) {
        nextState.lifetimeDonatedSats = state.lifetimeDonatedSats + prior;
        nextState.accumulatedSats = state.perTxAmountSats;
    } else {
        nextState.accumulatedSats = prior + state.perTxAmountSats;
    }

    return {
        ...settings,
        ads: {
            ...settings.ads,
            perChain: { ...settings.ads.perChain, [chainId]: nextState },
        },
    };
}

/**
 * Vault-aware: read current Settings, advance ADS state for `chainId`,
 * persist. No-op if no Settings record exists or ADS isn't enabled.
 *
 * @param {Object} opts
 * @param {import('../storage/Vault.js').Vault} opts.vault
 * @param {string} opts.chainId
 * @param {boolean} opts.donationIncluded
 * @returns {Promise<import('../schemas/settings.js').Settings | null>}
 */
export async function commitAdsStep({ vault, chainId, donationIncluded }) {
    if (!vault) throw new Error('commitAdsStep: vault is required');
    const settings = await vault.settings.get();
    if (!settings) return null;
    const next = stepAdsAccumulator(settings, chainId, { donationIncluded });
    if (next !== settings) {
        await vault.settings.put(next);
    }
    return next;
}
