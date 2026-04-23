// ADS (Automatic Donation System) accumulator — §36.3.
//
// Model (per spec): each tx contributes `perTxAmountSats` to a per-chain
// accumulator. When the accumulator reaches `triggerAmountSats`, the
// *next* transaction on that chain should include a donation output
// equal to the current accumulated amount; the accumulator then
// resets and the donation is counted in `lifetimeDonatedSats`.
//
// This module ships the arithmetic + state-transition logic. The
// submitAction integration (inject donation output into
// encoderOpts.customOutputs, then call commitAdsStep after a
// successful broadcast) needs a per-chain donation address, which is
// a §5.5 placeholder for now — this module stays address-agnostic.
//
// `stepAdsAccumulator` is pure; `commitAdsStep` is the vault-aware
// wrapper that persists the updated Settings.

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
