// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// HwSignBlock: composite sign-screen block for hardware-wallet sign
// flows. Renders the §18.5 derivation-path cross-check plus a live
// device-status banner so the user knows when to expect the device
// prompt. Meant to slot into every review/sign screen in place of
// the software-signer password input when the source address is HW.
//
// Status banner variants:
//   - 'available'     → quiet "Ready to sign; confirm on device" line
//   - 'wrong-app'     → "Open the [coin] app on your Ledger" warning
//   - 'disconnected'  → "Device not detected; plug in and unlock"
//   - 'locked'        → "Device is locked; enter PIN" (Trezor path)
//   - 'cancelled'     → calm retry guidance after rejecting on the device
//   - 'idle'          → no banner (pre-first-poll)
//   - 'error'         → generic "Couldn't reach device" with detail
//
// The parent form is responsible for the Submit button copy + enable
// state. `HwSignBlock` exposes the status via the `useSignerStatus`
// hook so the parent can gate Submit on `status === 'available'`.

import { useCallback, useEffect, useRef } from 'react';
import { FieldNote } from '@xchain-wallet/core/ui';
import { useSignerStatus } from '../hooks/useSignerStatus.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import { DerivationPathCrossCheck } from './DerivationPathCrossCheck.jsx';
import { HwFirmwareBanner } from './HwFirmwareBanner.jsx';
import styles from './HwSignBlock.module.css';
import { t } from '../../i18n/index.js';

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
 * @param {boolean} [props.requireExplicitConfirm]   Cluster N FOLLOWUP 3: when true, render the cross-check confirm checkbox; parent gates Submit on the result via onConfirmedChange.
 * @param {string | null} [props.requireExplicitConfirmReason]   user-facing one-liner explaining *why* the explicit confirm is required (e.g. "First-time recipient, please confirm"). Surfaces above the checkbox.
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
    const getStatusRef = useRef(getStatus);
    getStatusRef.current = getStatus;
    // Callers commonly adapt their signer API inline. Keep that wrapper from
    // restarting polling while still rotating the reader with signer identity.
    const statusReader = useCallback(
        (options) => getStatusRef.current?.(options),
        [signerKind, signerName, path, address],
    );
    const { status, detail, refresh } = useSignerStatus({
        getStatus: getStatus ? statusReader : null,
        chainId,
    });
    const onStatusChangeRef = useRef(onStatusChange);
    onStatusChangeRef.current = onStatusChange;

    // Notify after commit so a parent can update its submit gate without
    // receiving a state update while this component renders.
    useEffect(() => {
        onStatusChangeRef.current?.({ status, detail, refresh });
    }, [status, detail, refresh]);

    // The host answers 'idle' with a detail when the paired device has no live
    // connection in this session (after a reload or a lock). That is a state
    // the reader can act on, unlike the empty pre-first-poll 'idle'.
    const notConnected = status === 'idle' && Boolean(detail);
    const shownStatus = notConnected ? 'not-connected' : status;

    return (
        <div className={styles.root}>
            {signerInfo ? <HwFirmwareBanner signerInfo={signerInfo} /> : null}
            {requireExplicitConfirm && requireExplicitConfirmReason ? (
                <FieldNote variant="warning" role="status">
                    {requireExplicitConfirmReason}
                </FieldNote>
            ) : null}
            <DerivationPathCrossCheck
                signerKind={signerKind}
                signerName={signerName}
                path={path}
                address={address}
                requireExplicitConfirm={requireExplicitConfirm}
                onConfirmedChange={onConfirmedChange}
            />
            {shownStatus !== 'idle' ? (
                <div className={styles.statusRow} data-status={notConnected ? 'disconnected' : status} role="status">
                    <span className={styles.statusDot} aria-hidden="true" />
                    <span className={styles.statusText}>
                        {statusCopy(shownStatus, signerKind, chainId)}
                    </span>
                    {shownStatus !== 'available' ? (
                        <button
                            type="button"
                            onClick={refresh}
                            className={styles.refresh}
                        >
                            {t('home.retryBalances')}
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
 */
export function statusCopy(status, signerKind, chainId, detail) {
    switch (status) {
        case 'available':
            return 'Ready. 1. Select the sign button below. 2. Review every detail on your device. 3. Approve on the device only if everything matches. To cancel, reject on the device; nothing will be signed.';
        case 'wrong-app':
            return `Open the ${coinNameFor(chainId) || 'correct'} app on your Ledger and try again.`;
        case 'unsupported-network':
            return `This device can't sign on ${coinNameFor(chainId) || 'this network'}. Use the software signer instead.`;
        case 'locked':
            return signerKind === 'trezor'
                ? 'Device is locked. Enter your PIN on the Trezor.'
                : 'Device is locked. Unlock it and try again.';
        case 'disconnected':
            return detail
                ? `Device not detected. ${userFacingMessage(detail, 'Check its connection, unlock it, and try again.')}`
                : 'Device not detected. Check its connection, unlock it, and try again.';
        case 'not-connected':
            return `This ${signerKind === 'trezor' ? 'Trezor' : 'Ledger'} is not connected in this session. Connect it again with Pair hardware signer, then try again.`;
        case 'cancelled':
            return 'Signing was cancelled on your device. Nothing was signed. Review the details and try again when you are ready.';
        case 'error':
            return detail
                ? `Couldn't reach device. ${userFacingMessage(detail, 'Check the connection and try again.')}`
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
