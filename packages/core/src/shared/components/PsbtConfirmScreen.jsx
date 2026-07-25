// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PsbtConfirmScreen ( §5.5, PSBT variant adapter).
//
// The sibling of <ActionConfirmScreen> for surfaces whose INPUT is a PSBT
// the wallet did not build (Sign transaction, dApp signPsbt, co-signer).
// Two things make it not just a prop change on the action variant:
//
//  1. The foregrounded content is the input/output enumeration
//     (<PsbtIntentPanel>), not a composed action's intent. The wallet
//     cannot rebuild a caller's PSBT, so pre-flight here is REPORT-ONLY:
//     findings inform, they never gate Approve.
//  2. It can REFUSE. When the PSBT spends this wallet's inputs and the
//     action data will not decode, an approval would be the user
//     authorizing bytes nobody can read. Outside developer mode that is
//     fail-closed - no credentials, no Approve, no override - mirroring
//     the extension's SignApproval posture.

import { Input } from '@xchain-wallet/core/ui';
import { ConfirmActionModal } from './ConfirmActionModal.jsx';
import { PsbtIntentPanel } from './PsbtIntentPanel.jsx';
import { isUnreadableActionReason } from './psbtDecodeReasons.js';

/**
 * The §5.5 fail-closed rule, as a pure predicate so it can be unit-tested
 * away from the React tree.
 *
 * Deliberately narrow, because a refusal has no override: it fires only when
 * the wallet's own coins are being spent AND an action is demonstrably present
 * that the wallet cannot display. A plain payment (no action at all) is signed
 * normally - the output enumeration already shows everything it does.
 *
 * @param {object} args
 * @param {boolean} args.spendsOwnInputs   the PSBT spends inputs this wallet controls
 * @param {boolean} args.actionDecoded     the XChain action data decoded
 * @param {string|null} [args.decodeReason]  why the action decode failed
 * @param {boolean} args.developerMode
 * @returns {string|null}   refusal copy, or null when the wallet may sign
 */
export function psbtRefusalReason({
    spendsOwnInputs, actionDecoded, decodeReason = null, developerMode,
}) {
    if (developerMode) return null;
    if (!spendsOwnInputs) return null;
    if (actionDecoded) return null;
    if (!isUnreadableActionReason(decodeReason)) return null;
    return 'This transaction spends from your wallet and carries XChain action data '
        + 'the wallet cannot read. It will not sign what it cannot show you. Turn on '
        + 'developer mode if you need to inspect and sign it anyway.';
}

/**
 * @param {object} props
 * @param {ReturnType<typeof import('../hooks/useConfirmAction.js').useConfirmAction>} props.confirmAction
 * @param {'small'|'full'} [props.screenVariant]
 * @param {object|null} props.decomposed              decomposePsbt output
 * @param {Set<string>} [props.ownAddresses]
 * @param {string} [props.signingAddress]
 * @param {object|null} [props.decodedAction]         { summary } for the action carried inside
 * @param {string|null} [props.decodeError]
 * @param {boolean} [props.spendsOwnInputs]
 * @param {boolean} [props.developerMode]
 * @param {string} props.chainLabel
 * @param {boolean} props.signerReady
 * @param {string} props.password
 * @param {(value: string) => void} props.onPasswordChange
 * @param {string} [props.hintClassName]
 */
export function PsbtConfirmScreen({
    confirmAction,
    screenVariant = 'small',
    decomposed,
    ownAddresses,
    signingAddress,
    decodedAction = null,
    decodeError = null,
    spendsOwnInputs = false,
    developerMode = false,
    chainLabel,
    signerReady,
    password,
    onPasswordChange,
    hintClassName,
}) {
    const refusal = psbtRefusalReason({
        spendsOwnInputs,
        actionDecoded: !!decodedAction,
        decodeReason: decodeError,
        developerMode,
    });

    return (
        <ConfirmActionModal
            variant="psbt"
            screenVariant={screenVariant}
            phase={confirmAction.phase}
            composed={confirmAction.composed}
            report={confirmAction.report}
            reportLoading={confirmAction.phase === 'preflighting'}
            acknowledged={confirmAction.acknowledged}
            onAcknowledge={confirmAction.acknowledge}
            // Report-only (§5.5): the report cannot gate Approve on this
            // variant, so canApprove is not read from it.
            canApprove
            onApprove={confirmAction.approve}
            onReject={confirmAction.reject}
            decoded={decodedAction}
            error={confirmAction.error}
            chainLabel={chainLabel}
            refusal={refusal}
            psbtPanel={(
                <PsbtIntentPanel
                    decomposed={decomposed}
                    ownAddresses={ownAddresses}
                    signingAddress={signingAddress}
                    decodedAction={decodedAction}
                    decodeError={decodeError}
                />
            )}
            credentialsReady={signerReady || password.length > 0}
            credentials={signerReady ? (
                <p className={hintClassName}>
                    <span aria-hidden="true">🔓</span> Wallet unlocked. No password needed.
                </p>
            ) : (
                <Input
                    type="password"
                    label="Password"
                    hint="Required to sign."
                    value={password}
                    onChange={(e) => onPasswordChange(e.target.value)}
                    autoComplete="current-password"
                />
            )}
        />
    );
}
