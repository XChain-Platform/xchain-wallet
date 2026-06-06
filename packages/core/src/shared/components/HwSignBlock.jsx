// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// HwSignBlock — composite sign-screen block for hardware-wallet sign
// flows. Renders the §18.5 derivation-path cross-check plus a live
// device-status banner so the user knows when to expect the device
// prompt. Meant to slot into every review/sign screen in place of
// the software-signer password input when the source address is HW.
//
// Status banner variants:
//   - 'available'     → quiet "Ready to sign — confirm on device" line
//   - 'wrong-app'     → "Open the [coin] app on your Ledger" warning
//   - 'disconnected'  → "Device not detected — plug in and unlock"
//   - 'locked'        → "Device is locked — enter PIN" (Trezor path)
//   - 'idle'          → no banner (pre-first-poll)
//   - 'error'         → generic "Couldn't reach device" with detail
//
// The parent form is responsible for the Submit button copy + enable
// state — `HwSignBlock` exposes the status via the `useSignerStatus`
// hook so the parent can gate Submit on `status === 'available'`.

import { useSignerStatus } from '../hooks/useSignerStatus.js';
import { DerivationPathCrossCheck } from './DerivationPathCrossCheck.jsx';
import { HwFirmwareBanner } from './HwFirmwareBanner.jsx';
import styles from './HwSignBlock.module.css';

/**
 * @param {object} props
 * @param {'trezor'|'ledger'} props.signerKind
 * @param {string} props.signerName                   e.g. "Trezor Model T (My Trezor)"
 * @param {string} props.path                         BIP32 path for the source address
 * @param {string} props.address                      the source address string
 * @param {string} [props.chainId]                    forwarded to getStatus (Ledger uses it for wrong-app detection)
 * @param {((opts?: object) => Promise<any>) | null} props.getStatus   signer.getStatus; pass null to disable polling
 * @param {(state: { status: string, detail: string | null, refresh: () => void }) => void} [props.onStatusChange]   parent subscribes to status
 * @param {{ vendor: string, model: string, firmwareVersion: string | null } | null} [props.signerInfo]   firmware metadata for the warning banner; when omitted the banner is suppressed (graceful for callers that don't have the SignerRecord on hand)
 * @param {boolean} [props.requireExplicitConfirm]   Cluster N FOLLOWUP 3 — when true, render the cross-check confirm checkbox; parent gates Submit on the result via onConfirmedChange.
 * @param {string | null} [props.requireExplicitConfirmReason]   user-facing one-liner explaining *why* the explicit confirm is required (e.g. "First-time recipient — confirm…"). Surfaces above the checkbox.
 * @param {(confirmed: boolean) => void} [props.onConfirmedChange]   parent subscribes to the checkbox state.
 */
export function HwSignBlock({
    signerKind,
    signerName,
    path,
    address,
    chainId,
    getStatus,
    onStatusChange,
    signerInfo,
    requireExplicitConfirm,
    requireExplicitConfirmReason,
    onConfirmedChange,
}) {
    const { status, detail, refresh } = useSignerStatus({ getStatus, chainId });

    // Surface the live state so the parent form can gate its Submit
    // button without re-polling. A memoized snapshot via useRef would
    // make this a zero-render no-op; a simple call each render is
    // fine for the poll cadence we use.
    if (onStatusChange) onStatusChange({ status, detail, refresh });

    return (
        <div className={styles.root}>
            {signerInfo ? <HwFirmwareBanner signerInfo={signerInfo} /> : null}
            {requireExplicitConfirm && requireExplicitConfirmReason ? (
                <p
                    role="status"
                    style={{
                        margin: 0,
                        padding: 'var(--xc-space-2) var(--xc-space-3)',
                        background: 'var(--xc-warning-bg, var(--xc-surface-raised))',
                        border: '1px solid var(--xc-warning, var(--xc-border))',
                        borderRadius: 'var(--xc-radius-sm)',
                        fontSize: 'var(--xc-text-sm)',
                        color: 'var(--xc-text)',
                    }}
                >
                    {requireExplicitConfirmReason}
                </p>
            ) : null}
            <DerivationPathCrossCheck
                signerKind={signerKind}
                signerName={signerName}
                path={path}
                address={address}
                requireExplicitConfirm={requireExplicitConfirm}
                onConfirmedChange={onConfirmedChange}
            />
            {status !== 'idle' ? (
                <div className={styles.statusRow} data-status={status} role="status">
                    <span className={styles.statusDot} aria-hidden="true" />
                    <span className={styles.statusText}>
                        {statusCopy(status, signerKind, chainId, detail)}
                    </span>
                    {status !== 'available' ? (
                        <button
                            type="button"
                            onClick={refresh}
                            className={styles.refresh}
                        >
                            Retry
                        </button>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}

/**
 * @param {string} status
 * @param {'trezor'|'ledger'} signerKind
 * @param {string | undefined} chainId
 * @param {string | null} detail
 */
function statusCopy(status, signerKind, chainId, detail) {
    switch (status) {
        case 'available':
            return 'Ready to sign — confirm on your device when you tap Send.';
        case 'wrong-app':
            return `Open the ${coinNameFor(chainId) || 'correct'} app on your Ledger and try again.`;
        case 'locked':
            return signerKind === 'trezor'
                ? 'Device is locked — enter your PIN on the Trezor.'
                : 'Device is locked — unlock it and try again.';
        case 'disconnected':
            return detail
                ? `Device not detected. ${detail}`
                : 'Device not detected — plug in and unlock.';
        case 'error':
            return detail
                ? `Couldn't reach device. ${detail}`
                : "Couldn't reach device.";
        default:
            return '';
    }
}

/** @param {string | undefined} chainId */
function coinNameFor(chainId) {
    switch (chainId) {
        case 'bitcoin-mainnet':
        case 'bitcoin-testnet':
        case 'bitcoin-regtest':
            return 'Bitcoin';
        case 'litecoin-mainnet':
        case 'litecoin-testnet':
            return 'Litecoin';
        case 'dogecoin-mainnet':
            return 'Dogecoin';
        default:
            return null;
    }
}
