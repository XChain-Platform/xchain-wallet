// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// ActionConfirmScreen . Thin adapter that binds a form's
// useActionConfirmFlow state to <ConfirmActionModal> and renders the
// credentials block every software action form shares: an optional
// form-specific gate (e.g. DestroyForm's typed DESTROY) followed by
// either the "wallet unlocked" note or the password field.
//
// Forms render this in place of their own body while
// `actionConfirm.open` is true, exactly like a picker screen.

import { Input } from '@xchain-wallet/core/ui';
import { ConfirmActionModal } from './ConfirmActionModal.jsx';

/**
 * @param {object} props
 * @param {ReturnType<typeof import('../hooks/useActionConfirmFlow.js').useActionConfirmFlow>['confirmAction']} props.confirmAction
 * @param {'small'|'full'} [props.screenVariant]
 * @param {object|null} props.decoded            decodeAction output for the composed action
 * @param {string} props.chainLabel
 * @param {string} [props.feeText]
 * @param {boolean} props.signerReady            wallet already unlocked (no password needed)
 * @param {string} props.password
 * @param {(value: string) => void} props.onPasswordChange
 * @param {boolean} [props.credentialsReady]     override; defaults to signerReady || password typed
 * @param {import('react').ReactNode} [props.extraCredentials]   form-specific gate rendered above the password
 * @param {string} [props.hintClassName]
 * @param {object|null} [props.simulation]
 */
export function ActionConfirmScreen({
    confirmAction,
    screenVariant = 'small',
    decoded,
    chainLabel,
    feeText,
    signerReady,
    password,
    onPasswordChange,
    credentialsReady,
    extraCredentials = null,
    hintClassName,
    simulation = null,
}) {
    const credsComplete = credentialsReady !== undefined
        ? credentialsReady
        : (signerReady || password.length > 0);
    return (
        <ConfirmActionModal
            screenVariant={screenVariant}
            phase={confirmAction.phase}
            composed={confirmAction.composed}
            report={confirmAction.report}
            reportLoading={confirmAction.phase === 'preflighting'}
            acknowledged={confirmAction.acknowledged}
            onAcknowledge={confirmAction.acknowledge}
            canApprove={confirmAction.canApprove}
            onApprove={confirmAction.approve}
            onReject={confirmAction.reject}
            decoded={decoded}
            simulation={simulation}
            error={confirmAction.error}
            chainLabel={chainLabel}
            feeText={feeText}
            credentialsReady={credsComplete}
            credentials={(
                <>
                    {extraCredentials}
                    {signerReady ? (
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
                </>
            )}
        />
    );
}
