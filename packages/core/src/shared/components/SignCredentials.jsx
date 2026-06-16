// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// SignCredentials — shared sign-screen block that switches between
// the software-wallet password input and the hardware-signer
// `HwSignBlock` based on `fromAddress.source`. Every review/sign
// form in the wallet renders this; the form owns the Submit button
// + flow wiring, but the credential-gathering UX is identical.
//
// Exposes status via the `onStatusChange` callback so forms can
// gate their Submit button on `status === 'available'` for HW
// sources. For software sources the status is implicit in whether
// the user has typed a password.
//
// Usage:
//
//   <SignCredentials
//       fromAddress={fromAddress}
//       chainId={chainId}
//       password={password}
//       onPasswordChange={setPassword}
//       onStatusChange={setHwStatus}
//       passwordRef={passwordRef}
//       submitError={submitError}
//       disabled={stage === 'submitting'}
//       getSignerStatus={messaging.getSignerStatus}
//   />

import { Input } from '../../ui/index.js';
import { HwSignBlock } from './HwSignBlock.jsx';

/**
 * @param {object} props
 * @param {{ address: string, source?: string, signerId?: string, signerLabel?: string, derivationPath?: string | null }} props.fromAddress
 * @param {string} [props.chainId]
 * @param {string} [props.password]
 * @param {(next: string) => void} [props.onPasswordChange]
 * @param {(state: { status: string, detail: string | null, refresh: () => void }) => void} [props.onStatusChange]
 * @param {React.Ref<HTMLInputElement>} [props.passwordRef]
 * @param {string | null} [props.submitError]
 * @param {boolean} [props.disabled]
 * @param {(opts: { signerId: string, chainId?: string }) => Promise<any>} [props.getSignerStatus]
 * @param {{ vendor: string, model: string, firmwareVersion: string | null } | null} [props.signerInfo]   firmware metadata; passed through to HwSignBlock so the firmware-update warning banner renders. Optional — when omitted, no banner shows (callers that haven't yet looked up the SignerRecord render gracefully).
 * @param {boolean} [props.unlocked]   when true for a software wallet, the password input is hidden — the unlocked session signs without it ("password only at unlock"). HW signing is unaffected (still confirms on-device).
 */
export function SignCredentials({
    fromAddress,
    chainId,
    password,
    onPasswordChange,
    onStatusChange,
    passwordRef,
    submitError,
    disabled,
    getSignerStatus,
    signerInfo,
    unlocked,
}) {
    const src = fromAddress?.source;
    const isHw = src === 'trezor' || src === 'ledger';
    if (isHw) {
        const signerKind = /** @type {'trezor'|'ledger'} */ (src);
        return (
            <HwSignBlock
                signerKind={signerKind}
                signerName={fromAddress.signerLabel || (signerKind === 'trezor' ? 'Trezor' : 'Ledger')}
                path={fromAddress.derivationPath || ''}
                address={fromAddress.address}
                chainId={chainId}
                getStatus={getSignerStatus && fromAddress.signerId
                    ? (opts) => getSignerStatus({
                        signerId: fromAddress.signerId,
                        chainId: opts?.chainId ?? chainId,
                    })
                    : null}
                onStatusChange={onStatusChange}
                signerInfo={signerInfo}
            />
        );
    }
    // Unlocked software session — no password needed ("password only at
    // unlock"). Show a brief note instead of the input; the form's submit
    // gate is relaxed in parallel (see useSignerReady).
    if (unlocked) {
        return (
            <p
                style={{
                    margin: 'var(--xc-space-2) 0 0',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--xc-space-1)',
                    fontSize: 'var(--xc-text-sm)',
                    color: 'var(--xc-text-muted)',
                }}
            >
                <span aria-hidden="true">🔓</span> Wallet unlocked — no password needed.
            </p>
        );
    }
    return (
        <Input
            ref={passwordRef}
            type="password"
            label="Password"
            hint="Required to sign."
            value={password || ''}
            onChange={(e) => onPasswordChange?.(e.target.value)}
            autoComplete="current-password"
            disabled={disabled}
            error={submitError || undefined}
        />
    );
}

/**
 * Helper — inspects a fromAddress to decide whether the parent form
 * should follow the HW submit path. Exported so callers can mirror
 * the detection logic in their handleSubmit without duplicating it.
 *
 * @param {{ source?: string } | null | undefined} fromAddress
 * @returns {boolean}
 */
export function isHwSource(fromAddress) {
    return fromAddress?.source === 'trezor' || fromAddress?.source === 'ledger';
}
