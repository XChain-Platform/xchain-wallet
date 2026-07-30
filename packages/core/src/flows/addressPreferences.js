// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PC-32: ADDRESS v0 on-chain address preferences.
//
// Wire: VERSION|FEE_PREFERENCE|REQUIRE_MEMO|DISPENSER_PREFERENCE|MEMO
//
// The protocol's blank-field semantics are a footgun this flow refuses to
// expose: the indexer's getAddressPreferences folds every VALID row in
// action_index order and overwrites FEE_PREFERENCE and REQUIRE_MEMO with
// Number(value) - so a row that leaves either blank stores NULL and reads
// back as 0, silently REVERTING the prior setting (only
// DISPENSER_PREFERENCE has a null-guard). Therefore every write through
// this flow carries ALL THREE fields explicitly; the form re-fetches
// current values at confirm time and shows all three being written.
//
// Valid values come from the indexer's own validValues table
// (xchain-indexer/src/actions/address.js), NOT the doc's option list:
// FEE_PREFERENCE {0,1,2} (the documented 3 = community-dev indexes
// INVALID at HEAD), REQUIRE_MEMO {0,1}, DISPENSER_PREFERENCE {1,2}.

import { submitAction } from './submitAction.js';
import { normalizeSource } from './sendToken.js';

export const VALID_FEE_PREFERENCE = ['0', '1', '2'];
export const VALID_REQUIRE_MEMO = ['0', '1'];
export const VALID_DISPENSER_PREFERENCE = ['1', '2'];

// Read-side defaults, mirroring the indexer's getAddressPreferences.
export const DEFAULT_PREFERENCES = Object.freeze({
    feePreference: 2,       // donate to protocol development
    requireMemo: 0,         // no memo required on inbound SENDs
    dispenserPreference: 1, // only the owner may open dispensers here
});

/**
 * Compose + sign + broadcast an ADDRESS v0 preferences write for the
 * source address itself (preferences always apply to SOURCE).
 *
 * @param {object} opts   standard action-flow opts (vault/walletId/password
 *   or signer/chainRegistry/sdkRegistry/chainId/from, fee knobs,
 *   prebuiltPsbt, payFeeInNativeCoin) plus
 *   `params: { FEE_PREFERENCE, REQUIRE_MEMO, DISPENSER_PREFERENCE, MEMO? }`
 *   where the three preference fields are REQUIRED strings.
 */
export async function addressPreferencesAction(opts) {
    if (!opts) throw new Error('addressPreferencesAction: opts is required');
    if (!opts.params || typeof opts.params !== 'object') {
        throw new Error('addressPreferencesAction: params is required');
    }
    const fee = String(opts.params.FEE_PREFERENCE ?? '');
    const memoReq = String(opts.params.REQUIRE_MEMO ?? '');
    const disp = String(opts.params.DISPENSER_PREFERENCE ?? '');
    // Write-all-three rail: a blank field is NOT "keep current" on this
    // action (FEE_PREFERENCE / REQUIRE_MEMO would silently revert to 0),
    // so blanks are refused here rather than passed through.
    if (!VALID_FEE_PREFERENCE.includes(fee)) {
        throw new Error('addressPreferencesAction: params.FEE_PREFERENCE must be one of '
            + VALID_FEE_PREFERENCE.join('/') + ' (blank would silently revert to default)');
    }
    if (!VALID_REQUIRE_MEMO.includes(memoReq)) {
        throw new Error('addressPreferencesAction: params.REQUIRE_MEMO must be one of '
            + VALID_REQUIRE_MEMO.join('/') + ' (blank would silently revert to 0)');
    }
    if (!VALID_DISPENSER_PREFERENCE.includes(disp)) {
        throw new Error('addressPreferencesAction: params.DISPENSER_PREFERENCE must be one of '
            + VALID_DISPENSER_PREFERENCE.join('/'));
    }
    const source = normalizeSource(opts.from, 'addressPreferencesAction');

    /** @type {Record<string, string>} */
    const params = {
        VERSION: '0',
        FEE_PREFERENCE: fee,
        REQUIRE_MEMO: memoReq,
        DISPENSER_PREFERENCE: disp,
    };
    if (opts.params.MEMO !== undefined) params.MEMO = String(opts.params.MEMO);

    const pendingTxMeta = opts.trackPendingTx === false ? undefined : {
        fromAddress: source.address,
        toAddress: null,
        actionSummary: `Set on-chain preferences for ${source.address}`,
    };

    return submitAction({
        vault: opts.vault,
        walletId: opts.walletId,
        password: opts.password,
        signer: opts.signer,
        bip39Passphrase: opts.bip39Passphrase,
        chainRegistry: opts.chainRegistry,
        sdkRegistry: opts.sdkRegistry,
        chainId: opts.chainId,
        actionData: { action: 'ADDRESS', params },
        encoderOpts: {
            pubkey: source.publicKey,
            // The other flow still on the legacy sign path (D-146's sibling
            // sweep): no confirm screen means no prebuilt PSBT, so `createTx`
            // runs live and selects UTXOs from whatever names the spender. A
            // bare pubkey is not something the utxo-tracker can turn into a
            // script - the D-7 family, fixed the same way in advancedAction.js,
            // sendToken, dispenserAction and the three ORDER flows. The fee
            // quote reads it too (submitWithSigner), and an ADDRESS dry run
            // happens not to need a source today; that is the indexer's choice
            // to change, not a reason to leave it unnamed.
            sourceAddress: source.address,
            change: source.address,
            ...(opts.fee !== undefined && { fee: opts.fee }),
            ...(opts.feePerKb !== undefined && { feePerKb: opts.feePerKb }),
            ...(opts.rbf !== undefined && { rbf: opts.rbf }),
            // PC-51: opt-in native-coin protocol fee (quotable action); submitAction's
            // preflight refuses at sign time (NativeFeeForfeitError) if unpriceable.
            ...(opts.payFeeInNativeCoin !== undefined && { payFeeInNativeCoin: opts.payFeeInNativeCoin }),
        },
        signingPaths: [source.derivationPath
            ? { inputIndex: 0, path: source.derivationPath }
            : { inputIndex: 0, addressId: source.addressId }],
        prebuiltPsbt: opts.prebuiltPsbt,
        pendingTxMeta,
        waitForTxid: opts.waitForTxid,
        waitOpts: opts.waitOpts,
        onProgress: opts.onProgress,
    });
}

function rowsOf(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    return [];
}

function isBlank(v) {
    return v === null || v === undefined || v === '';
}

/**
 * The address's CURRENT effective preferences, derived from its valid
 * ADDRESS-action history exactly the way consensus derives them: fold the
 * valid rows in action_index order, where FEE_PREFERENCE / REQUIRE_MEMO
 * overwrite unconditionally (a NULL field numerifies to 0, reproducing the
 * revert footgun) and DISPENSER_PREFERENCE only overwrites when non-null.
 * Mirrors xchain-indexer db.getAddressPreferences; the explorer has no
 * "current preferences" endpoint, so the wallet replays the fold from
 * `getAddresses(addr, 'address')`.
 *
 * @param {{ sdkRegistry: any, chainId: string, address: string }} args
 * @returns {Promise<{ feePreference: number, requireMemo: number,
 *   dispenserPreference: number, onChain: boolean }>}
 *   `onChain` is false when no valid ADDRESS v0 row exists (all values are
 *   protocol defaults).
 */
export async function currentAddressPreferences({ sdkRegistry, chainId, address }) {
    if (!sdkRegistry) throw new Error('currentAddressPreferences: sdkRegistry is required');
    if (!chainId) throw new Error('currentAddressPreferences: chainId is required');
    if (!address) throw new Error('currentAddressPreferences: address is required');
    const sdk = sdkRegistry.get(chainId);

    const resp = await sdk.getAddresses(String(address), 'address');
    // v1 (controller bind) rows never reach the addresses table (the indexer
    // writes address_controllers instead), so every row here is a v0 write -
    // including an all-blank one, which consensus folds as a revert-to-0 on
    // FEE_PREFERENCE / REQUIRE_MEMO. No defensive filtering beyond status:
    // parity with the indexer fold beats prettier data.
    const rows = rowsOf(resp)
        .filter((r) => String(r?.status || '').toLowerCase() === 'valid')
        .sort((a, b) => Number(a?.action_index || 0) - Number(b?.action_index || 0));

    const prefs = { ...DEFAULT_PREFERENCES, onChain: rows.length > 0 };
    for (const row of rows) {
        // Deliberate Number(null) === 0: consensus reads a blank field back
        // as 0 for these two, so the wallet must display the same truth.
        prefs.feePreference = Number(row.fee_preference);
        prefs.requireMemo = Number(row.require_memo);
        if (!isBlank(row.dispenser_preference)) {
            prefs.dispenserPreference = Number(row.dispenser_preference);
        }
    }
    return prefs;
}

/** Human labels for display; 0 and 2 share an effect (donate to protocol dev). */
export function feePreferenceLabel(v) {
    const n = Number(v);
    if (n === 1) return 'Destroy the fee (reduces supply)';
    if (n === 0) return 'Donate to protocol development (default)';
    return 'Donate to protocol development';
}

export function requireMemoLabel(v) {
    return Number(v) === 1 ? 'Memo required on incoming sends' : 'No memo required';
}

export function dispenserPreferenceLabel(v) {
    return Number(v) === 2 ? 'Anyone may open a dispenser here' : 'Only this address may open dispensers (default)';
}
