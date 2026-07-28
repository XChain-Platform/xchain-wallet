// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// MessageConfirmScreen ( §5.5, message variant adapter).
//
// For surfaces that sign a MESSAGE rather than a transaction (Sign
// message, dApp signIn). Same shell, same two exits, same a11y contract
// as the action variant, but the anatomy collapses to what actually
// exists here: the full message text, the address that will sign it, and
// the credentials. No action intent (there is no action), no balance
// deltas (no coins move), no pre-flight (there is no chain state to
// check and nothing to broadcast).
//
// The signed bytes are the message itself, so the text is rendered
// verbatim and never truncated - a signature over text the user could
// not fully read is exactly the attack this surface has to prevent.

import { Input } from '@xchain-wallet/core/ui';
import { ConfirmActionModal } from './ConfirmActionModal.jsx';
import { SigningReadyNote } from '../safety/PanicFreezeNotice.jsx';

/**
 * @param {object} props
 * @param {ReturnType<typeof import('../hooks/useConfirmAction.js').useConfirmAction>} props.confirmAction
 * @param {'small'|'full'} [props.screenVariant]
 * @param {string} props.message                  the exact text being signed
 * @param {string} props.chainLabel
 * @param {string} [props.signingAddress]
 * @param {boolean} props.signerReady
 * @param {string} props.password
 * @param {(value: string) => void} props.onPasswordChange
 * @param {string} [props.hintClassName]
 */
export function MessageConfirmScreen({
    confirmAction,
    screenVariant = 'small',
    message,
    chainLabel,
    signingAddress,
    signerReady,
    password,
    onPasswordChange,
    hintClassName,
}) {
    return (
        <ConfirmActionModal
            variant="message"
            screenVariant={screenVariant}
            headline="Sign this message"
            phase={confirmAction.phase}
            composed={confirmAction.composed}
            report={null}
            reportLoading={false}
            acknowledged={confirmAction.acknowledged}
            onAcknowledge={confirmAction.acknowledge}
            canApprove
            onApprove={confirmAction.approve}
            onReject={confirmAction.reject}
            decoded={null}
            error={confirmAction.error}
            chainLabel={chainLabel}
            messageText={message}
            credentialsReady={signerReady || password.length > 0}
            credentials={(
                <>
                    {signingAddress ? (
                        <p className={hintClassName}>
                            Signing as <code>{signingAddress}</code>
                        </p>
                    ) : null}
                    {signerReady ? (
                        // : panic mode freezes signMessageFlow too, so
                        // this note is a claim the wallet cannot honour while
                        // a freeze is on.
                        <SigningReadyNote>
                            <p className={hintClassName}>
                                <span aria-hidden="true">🔓</span> Wallet unlocked. No password needed.
                            </p>
                        </SigningReadyNote>
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
