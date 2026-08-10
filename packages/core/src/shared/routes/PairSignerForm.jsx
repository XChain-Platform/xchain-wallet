// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useState } from 'react';
import {
    Screen,
    PageHeader,
    Button,
    Input,
 Icon, StatusMessage,} from '@xchain-wallet/core/ui';
import {
    signers as signersLib,
} from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { isWebHidSupported, detectBrowserFamilyForWebHidHint } from '../utils/webhidSupport.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import styles from './PairSignerForm.module.css';

const { checkFirmware } = signersLib;

/**
 * Pair hardware signer (§17.6 / §18.3).
 *
 * Four-stage flow:
 *
 *   vendor:  user picks Trezor / Ledger.
 *   pairing: shell-supplied factory runs (Trezor Connect popup opens,
 *            or Ledger WebHID prompts + app check). On success the
 *            flow advances to `confirm` with the pairingInfo payload.
 *   confirm: device info + firmware verdict + label input. User
 *            confirms; we persist via `messaging.registerSigner`.
 *   done:    show the SignerRecord id + return to caller.
 *
 * The pairing factories (`pairTrezor` + `pairLedger`) are passed in
 * as props rather than imported from shell packages. The shared
 * route stays decoupled from shell-specific transport modules.
 *
 * When a factory is `undefined`, the corresponding vendor card shows
 * a "not available" note (for example, when the desktop factory
 * lands later and the web shell has both but popup has only WebHID).
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {null | (() => Promise<{ signer: any, pairingInfo: PairingInfo }>)} [props.pairTrezor]
 * @param {null | (() => Promise<{ signer: any, pairingInfo: PairingInfo }>)} [props.pairLedger]
 * @param {() => void} props.onBack
 * @param {() => void} [props.onPaired]
 * @param {(signerId: string, signer: any) => void} [props.onSignerPaired]   called after the SignerRecord is persisted. The shell registers the live Signer instance with its port bridge so background sign requests can reach it
 *
 * @typedef {{ vendor: 'trezor' | 'ledger', model: string, deviceIdentifier: string, firmwareVersion: string | null }} PairingInfo
 */
export function PairSignerForm({
    walletId,
    pairTrezor,
    pairLedger,
    onBack,
    onPaired,
    onSignerPaired,
}) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [stage, setStage] = useState(
        /** @type {'vendor' | 'pairing' | 'confirm' | 'saving' | 'done' | 'error'} */ ('vendor'),
    );
    const [vendor, setVendor] = useState(/** @type {'trezor' | 'ledger' | null} */ (null));
    const [pairingInfo, setPairingInfo] = useState(/** @type {PairingInfo | null} */ (null));
    const [liveSigner, setLiveSigner] = useState(/** @type {any | null} */ (null));
    const [label, setLabel] = useState('');
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [savedRecord, setSavedRecord] = useState(/** @type {any | null} */ (null));

    const webHidSupported = isWebHidSupported();
    const browserFamily = detectBrowserFamilyForWebHidHint();
    const ledgerNeedsWebHid = !webHidSupported;
    const ledgerCanPair = pairLedger && webHidSupported;

    async function handlePickVendor(v) {
        const factory = v === 'trezor' ? pairTrezor : pairLedger;
        if (!factory) {
            setError(`${labelFor(v)} pairing is not available in this context.`);
            return;
        }
        if (v === 'ledger' && !webHidSupported) {
            setError(
                browserFamily === 'firefox' || browserFamily === 'safari'
                    ? `Ledger pairing requires WebHID, which is not supported in ${browserFamily === 'firefox' ? 'Firefox' : 'Safari'}. Switch to Chrome, Edge, or Brave to pair a Ledger.`
                    : 'Ledger pairing requires the WebHID API, which is not available in this browser. Switch to Chrome, Edge, or Brave to pair a Ledger.',
            );
            return;
        }
        setVendor(v);
        setStage('pairing');
        setError(null);
        try {
            const { pairingInfo: info, signer } = await factory();
            setPairingInfo(info);
            setLiveSigner(signer);
            setLabel(`${labelFor(v)} #1`);
            setStage('confirm');
        } catch (err) {
            // D-52 / D-64: the pairing factories throw function-prefixed
            // precondition errors ("pairTrezorSigner: ..."), and Trezor
            // Connect hands back library internals verbatim. Filter both
            // before they reach the dialog; copy already written for a
            // reader passes through untouched.
            setError(userFacingMessage(err, 'Pairing failed.'));
            setStage('error');
        }
    }

    async function handleSave(event) {
        event.preventDefault();
        if (!pairingInfo || !vendor) return;
        setStage('saving');
        setError(null);
        try {
            const record = await messaging.registerSigner({
                walletId,
                kind: vendor,
                vendor: pairingInfo.vendor,
                model: pairingInfo.model,
                deviceIdentifier: pairingInfo.deviceIdentifier,
                firmwareVersion: pairingInfo.firmwareVersion,
                label: label.trim() || undefined,
            });
            setSavedRecord(record);
            if (onSignerPaired && record?.id && liveSigner) {
                try { onSignerPaired(record.id, liveSigner); } catch { /* shell swallow */ }
            }
            setStage('done');
        } catch (err) {
            setError(userFacingMessage(err, 'Save failed.'));
            setStage('confirm');
        }
    }

        const header = (
        <PageHeader
            onBack={onBack}
            title="Pair hardware signer"
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{children}</div> : children}
        </Screen>
    );

    if (stage === 'vendor' || stage === 'error') {
        return wrap(
            <>
                <p className={styles.stageHint}>Which kind of device are you pairing?</p>
                <ul className={styles.vendorGrid}>
                    <li>
                        <button
                            type="button"
                            className={styles.vendorCard}
                            onClick={() => handlePickVendor('trezor')}
                            disabled={!pairTrezor}
                        >
                            <span className={styles.vendorName}>Trezor</span>
                            <span className={styles.vendorTag}>
                                {pairTrezor ? 'Connect via Trezor Connect popup.' : 'Not available in this context.'}
                            </span>
                        </button>
                    </li>
                    <li>
                        <button
                            type="button"
                            className={styles.vendorCard}
                            onClick={() => handlePickVendor('ledger')}
                            disabled={!ledgerCanPair}
                        >
                            <span className={styles.vendorName}>Ledger</span>
                            <span className={styles.vendorTag}>
                                {!pairLedger
                                    ? 'Not available in this context.'
                                    : ledgerNeedsWebHid
                                    ? browserFamily === 'firefox'
                                        ? 'WebHID required. Firefox is not supported. Switch to Chrome, Edge, or Brave.'
                                        : browserFamily === 'safari'
                                        ? 'WebHID required. Safari is not supported. Switch to Chrome, Edge, or Brave.'
                                        : 'WebHID required. This browser does not support it. Switch to Chrome, Edge, or Brave.'
                                    : 'Connect via WebHID. Chrome, Edge, or Brave on desktop.'}
                            </span>
                        </button>
                    </li>
                </ul>
                {error ? (
                    <StatusMessage
                        variant="error"
                        recovery={
                            vendor && !/WebHID|not supported|not available/i.test(error)
                                ? { label: 'Try again', onAction: () => handlePickVendor(vendor) }
                                : undefined
                        }
                    >
                        {error}
                    </StatusMessage>
                ) : null}
                <div className={styles.actions}>
                </div>
            </>,
        );
    }

    if (stage === 'pairing') {
        return wrap(
            <>
                <p className={styles.summary}>
                    Waiting for {labelFor(vendor)}…
                </p>
                <p className={styles.stageHint}>
                    {vendor === 'trezor'
                        ? 'Authorize the connection in the Trezor Connect popup that just opened.'
                        : 'Plug in your Ledger, enter the PIN, and open the Bitcoin app. Grant the WebHID permission if your browser asks.'}
                </p>
            </>,
        );
    }

    if (stage === 'done' && savedRecord) {
        return wrap(
            <>
                <h2 className={styles.successTitle}>{savedRecord.label} paired</h2>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Model</dt>
                    <dd className={styles.detailsValue}>{savedRecord.model}</dd>
                    <dt className={styles.detailsLabel}>Firmware</dt>
                    <dd className={styles.detailsValue}>{savedRecord.firmwareVersion ?? 'unknown'}</dd>
                    <dt className={styles.detailsLabel}>Record id</dt>
                    <dd className={styles.detailsValue}>
                        <code className={styles.code}>{savedRecord.id}</code>
                    </dd>
                </dl>
                <div className={styles.actions}>
                    <Button variant="primary" onClick={onPaired || onBack}>Done</Button>
                </div>
            </>,
        );
    }

    // stage === 'confirm' or 'saving': pairingInfo present
    const verdict = pairingInfo
        ? checkFirmware({
            vendor: pairingInfo.vendor,
            model: pairingInfo.model,
            version: pairingInfo.firmwareVersion ?? '',
        })
        : null;

    return wrap(
        <form onSubmit={handleSave} noValidate>
            <p className={styles.stageHint}>
                Confirm the device you just paired.
            </p>
            <dl className={styles.detailsList}>
                <dt className={styles.detailsLabel}>Vendor</dt>
                <dd className={styles.detailsValue}>{labelFor(pairingInfo?.vendor)}</dd>
                <dt className={styles.detailsLabel}>Model</dt>
                <dd className={styles.detailsValue}>
                    {verdict?.displayName || pairingInfo?.model}
                </dd>
                <dt className={styles.detailsLabel}>Firmware</dt>
                <dd className={styles.detailsValue}>
                    {pairingInfo?.firmwareVersion ?? 'unknown'}
                </dd>
                <dt className={styles.detailsLabel}>Device id</dt>
                <dd className={styles.detailsValue}>
                    <code className={styles.code}>{pairingInfo?.deviceIdentifier}</code>
                </dd>
            </dl>
            {verdict ? <FirmwareBanner verdict={verdict} /> : null}
            <Input
                label="Label"
                hint="Shows wherever this signer appears in the UI."
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                autoComplete="off"
                maxLength={40}
            />
            {error ? (
                <StatusMessage variant="error" className={styles.error}>{error}</StatusMessage>
            ) : null}
            <div className={styles.actions}>
                <Button
                    type="submit"
                    variant="primary"
                    loading={stage === 'saving'}
                    disabled={verdict?.status === 'unsupported'}
                >
                    {verdict?.status === 'unsupported' ? 'Update firmware first' : 'Save'}
                </Button>
            </div>
        </form>,
    );
}

function FirmwareBanner({ verdict }) {
    if (verdict.status === 'ok') return null;
    const variantClass = verdict.status === 'vulnerable' || verdict.status === 'unsupported'
        ? styles.errorBanner
        : styles.warningBanner;
    return (
        <StatusMessage variant="error" className={variantClass}>
            <p className={styles.bannerDetail}>{verdict.detail}</p>
            {verdict.updateUrl ? (
                <a
                    className={styles.updateLink}
                    href={verdict.updateUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    Open vendor update tool →
                </a>
            ) : null}
        </StatusMessage>
    );
}

function labelFor(vendor) {
    if (vendor === 'trezor') return 'Trezor';
    if (vendor === 'ledger') return 'Ledger';
    return 'device';
}
