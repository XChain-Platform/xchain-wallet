// §18.5 / Cluster N FOLLOWUP 3 — sign-flow risk classifier.
//
// Decides when the Hardware Wallet sign block should require an
// explicit "I've verified the path and address" checkbox before the
// Submit button enables. Spec hints at three risk dimensions:
//
//   1. Amount: a large-value send is more dangerous than a small one.
//      We re-use the user's `settings.grace.testSendThresholdSats`
//      (0 = disabled) so the same threshold that gates the existing
//      test-send confirmation also gates the cross-check confirm.
//
//   2. Recipient novelty: a never-sent-to recipient (no history row
//      and no contact match) is more dangerous than a known one.
//
//   3. Multisig coordinator approval: signing a multisig PSBT as one
//      cosigner is meaningfully different from a single-sig send.
//
// A user can also force always-on via `settings.privacy.alwaysRequire-
// HwExplicitConfirm` — that's the FOLLOWUP's "Settings toggle" half.
//
// Pure function: no I/O, no side effects. Caller computes the inputs
// (the form already has them) and passes them in.

/**
 * @typedef {Object} SignRiskInput
 * @property {'trezor' | 'ledger' | string | null | undefined} signerKind
 *   The chosen signer's source. The classifier returns `requireExplicitConfirm: false`
 *   for non-HW signers (the cross-check block isn't even rendered for them).
 * @property {number | string | null | undefined} amountSats
 *   Send amount in base units. Compared against `testSendThresholdSats`. Optional.
 * @property {boolean} [recipientNovel]
 *   Output of `checkRecipientNovelty`. Optional.
 * @property {boolean} [multisig]
 *   True when the user is signing as a cosigner in a multisig flow.
 *   Always triggers explicit confirm.
 * @property {{ testSendThresholdSats?: number, alwaysRequireHwExplicitConfirm?: boolean }} [settings]
 *   Settings used by the classifier. Both fields optional.
 */

/**
 * @typedef {Object} SignRiskResult
 * @property {boolean} requireExplicitConfirm   true → render the cross-check confirm checkbox AND gate Submit on it.
 * @property {string | null} reason             user-facing one-liner explaining *why* the explicit confirm is required. null when not required.
 */

/**
 * @param {SignRiskInput} input
 * @returns {SignRiskResult}
 */
export function classifySignRisk(input = {}) {
    const {
        signerKind,
        amountSats,
        recipientNovel,
        multisig,
        settings,
    } = input;

    // Software signers don't render the cross-check block at all.
    const isHw = signerKind === 'trezor' || signerKind === 'ledger';
    if (!isHw) {
        return { requireExplicitConfirm: false, reason: null };
    }

    // Settings toggle — always-on regardless of risk classification.
    if (settings?.alwaysRequireHwExplicitConfirm === true) {
        return {
            requireExplicitConfirm: true,
            reason: 'You’ve set the wallet to always require explicit cross-check confirm on hardware signs.',
        };
    }

    // Multisig coordinator approval — always confirm.
    if (multisig === true) {
        return {
            requireExplicitConfirm: true,
            reason: 'Multisig contributions deserve an explicit cross-check — your cosigners trust this signature.',
        };
    }

    // Recipient novelty — first time signing a send to this address.
    if (recipientNovel === true) {
        return {
            requireExplicitConfirm: true,
            reason: 'First-time recipient — confirm the address on your device matches what’s shown here.',
        };
    }

    // Large amount — `testSendThresholdSats` is the user-configured
    // "above this is large enough to need extra confirmation" knob.
    // 0 disables the threshold entirely.
    const threshold = Number.isFinite(settings?.testSendThresholdSats)
        ? Number(settings.testSendThresholdSats)
        : 0;
    if (threshold > 0) {
        const amount = Number(amountSats);
        if (Number.isFinite(amount) && amount >= threshold) {
            return {
                requireExplicitConfirm: true,
                reason: `Large amount (${amount.toLocaleString()} sats) — confirm both path and address on your device.`,
            };
        }
    }

    return { requireExplicitConfirm: false, reason: null };
}
