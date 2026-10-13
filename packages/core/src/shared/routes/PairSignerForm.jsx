// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useRef, useState } from 'react';
import {
    Screen,
    PageHeader,
    Button,
    FormPage,
    Input,
    Icon,
    StatusMessage,
} from '@xchain-wallet/core/ui';
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
 * @param {(signerId: string) => void} [props.onSignerUnpaired]
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
    onSignerUnpaired,
}) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);

    const [stage, setStage] = useState(
        /** @type {'vendor' | 'pairing' | 'confirm' | 'saving' | 'done' | 'error'} */ ('vendor'),
    );
    const [vendor, setVendor] = useState(/** @type {'trezor' | 'ledger' | null} */ (null));
    const [pairingInfo, setPairingInfo] = useState(/** @type {PairingInfo | null} */ (null));
    const [liveSigner, setLiveSigner] = useState(/** @type {any | null} */ (null));
    const [label, setLabel] = useState('');
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [savedRecord, setSavedRecord] = useState(/** @type {any | null} */ (null));
    const [pairedSigners, setPairedSigners] = useState(/** @type {any[]} */ ([]));
    const [unpairingId, setUnpairingId] = useState(/** @type {string | null} */ (null));
    const [notice, setNotice] = useState(/** @type {string | null} */ (null));
    const unpairedIds = useRef(new Set());
    const locallyPairedRecords = useRef(new Map());

    const webHidSupported = isWebHidSupported();
    const browserFamily = detectBrowserFamilyForWebHidHint();
    const ledgerNeedsWebHid = !webHidSupported;
    const ledgerCanPair = pairLedger && webHidSupported;

    useEffect(() => {
        let cancelled = false;
        unpairedIds.current.clear();
        locallyPairedRecords.current.clear();
        if (typeof messaging.listSigners !== 'function') return () => { cancelled = true; };
        messaging.listSigners(walletId)
            .then((records) => {
                if (!cancelled) {
                    const listed = Array.isArray(records)
                        ? records.filter((record) => !unpairedIds.current.has(record.id))
                        : [];
                    const listedIds = new Set(listed.map((record) => record.id));
                    setPairedSigners([
                        ...listed,
                        ...Array.from(locallyPairedRecords.current.values())
                            .filter((record) => !listedIds.has(record.id)),
                    ]);
                }
            })
            .catch(() => {
                if (!cancelled) setError('Could not load paired devices. You can still pair a new one.');
            });
        return () => { cancelled = true; };
    }, [messaging, walletId]);

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
        setNotice(null);
        try {
            const { pairingInfo: info, signer } = await factory();
            setPairingInfo(info);
            setLiveSigner(signer);
            setLabel(`${labelFor(v)} #1`);
            setStage('confirm');
        } catch (err) {
            setError(pairingErrorMessage(err, v));
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
            unpairedIds.current.delete(record?.id);
            if (record?.id) locallyPairedRecords.current.set(record.id, record);
            setSavedRecord(record);
            setPairedSigners((records) => [
                ...records.filter((item) => item.id !== record?.id),
                record,
            ]);
            if (onSignerPaired && record?.id && liveSigner) {
                try { onSignerPaired(record.id, liveSigner); } catch { /* shell swallow */ }
            }
            setStage('done');
        } catch (err) {
            setError(userFacingMessage(err, 'Save failed.'));
            setStage('confirm');
        }
    }

    async function handleUnpair(record) {
        if (!record?.id || typeof messaging.unregisterSigner !== 'function') {
            setError('This device cannot be unpaired in this app.');
            return;
        }
        setUnpairingId(record.id);
        setError(null);
        setNotice(null);
        try {
            await messaging.unregisterSigner(record.id);
            unpairedIds.current.add(record.id);
            locallyPairedRecords.current.delete(record.id);
            if (onSignerUnpaired) {
                try { onSignerUnpaired(record.id); } catch { /* shell cleanup is best effort */ }
            }
            setPairedSigners((records) => records.filter((item) => item.id !== record.id));
            if (savedRecord?.id === record.id) {
                setSavedRecord(null);
                setStage('vendor');
            }
            setNotice(`${record.label || labelFor(record.vendor)} unpaired. You can pair it again at any time.`);
        } catch (err) {
            setError(userFacingMessage(err, 'Could not unpair this device. Check the connection and try again.'));
        } finally {
            setUnpairingId(null);
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
            {children}
        </Screen>
    );

    if (stage === 'vendor' || stage === 'error') {
        return wrap(
            <FormPage
                label="Choose hardware signer"
                status={error ? (
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
                ) : notice ? <StatusMessage variant="success">{notice}</StatusMessage> : null}
            >
                <p className={styles.stageHint}>Which kind of device are you pairing?</p>
                {pairedSigners.length > 0 ? (
                    <PairedDeviceList
                        records={pairedSigners}
                        unpairingId={unpairingId}
                        onUnpair={handleUnpair}
                    />
                ) : null}
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
            </FormPage>,
        );
    }

    if (stage === 'pairing') {
        return wrap(
            <FormPage label="Pair hardware signer">
                <p className={styles.summary}>
                    Waiting for {labelFor(vendor)}…
                </p>
                <p className={styles.stageHint}>
                    {vendor === 'trezor'
                        ? 'Authorize the connection in the Trezor Connect popup that just opened.'
                        : 'Plug in your Ledger, enter the PIN, and open the Bitcoin app. Grant the WebHID permission if your browser asks.'}
                </p>
            </FormPage>,
        );
    }

    if (stage === 'done' && savedRecord) {
        return wrap(
            <FormPage
                label="Paired hardware signer"
                status={error ? <StatusMessage variant="error">{error}</StatusMessage> : null}
                actions={(
                    <div className={styles.actions}>
                        <Button
                            variant="danger"
                            loading={unpairingId === savedRecord.id}
                            onClick={() => handleUnpair(savedRecord)}
                        >
                            {unpairingId === savedRecord.id ? 'Unpairing' : 'Unpair'}
                        </Button>
                        <Button variant="primary" onClick={onPaired || onBack}>Done</Button>
                    </div>
                )}
            >
                <h2 className={styles.successTitle}>
                    {savedRecord.label} <span className={styles.pairedBadge}>Paired</span>
                </h2>
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
            </FormPage>,
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
        <FormPage
            label="Confirm hardware signer"
            onSubmit={handleSave}
            status={error ? (
                <StatusMessage variant="error" className={styles.error}>{error}</StatusMessage>
            ) : null}
            actions={(
                <Button
                    type="submit"
                    variant="primary"
                    loading={stage === 'saving'}
                    disabled={verdict?.status === 'unsupported'}
                >
                    {verdict?.status === 'unsupported' ? 'Update firmware first' : 'Save'}
                </Button>
            )}
        >
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
            {verdict ? <FirmwareBanner verdict={verdict} vendor={pairingInfo?.vendor} /> : null}
            <Input
                label="Label"
                hint="Shows wherever this signer appears in the UI."
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                autoComplete="off"
                maxLength={40}
            />
        </FormPage>,
    );
}

function FirmwareBanner({ verdict, vendor }) {
    if (verdict.status === 'ok') return null;
    const variantClass = verdict.status === 'vulnerable' || verdict.status === 'unsupported'
        ? styles.errorBanner
        : styles.warningBanner;
    return (
        <StatusMessage variant="error" className={variantClass}>
            <p className={styles.bannerDetail}>
                {verdict.status === 'unsupported'
                    ? firmwareUpdateAdvice(vendor, verdict.recommended)
                    : verdict.detail}
            </p>
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

function PairedDeviceList({ records, unpairingId, onUnpair }) {
    return (
        <section className={styles.pairedSection} aria-labelledby="paired-devices-heading">
            <h2 id="paired-devices-heading" className={styles.pairedHeading}>Paired devices</h2>
            <ul className={styles.pairedList}>
                {records.map((record) => (
                    <li key={record.id} className={styles.pairedRow}>
                        <span className={styles.pairedIdentity}>
                            <strong>{record.label || `${labelFor(record.vendor)} ${record.model || ''}`.trim()}</strong>
                            <span className={styles.pairedMeta}>{labelFor(record.vendor)} {record.model || ''}</span>
                        </span>
                        <span className={styles.pairedBadge}>Paired</span>
                        <Button
                            size="sm"
                            variant="ghost"
                            loading={unpairingId === record.id}
                            onClick={() => onUnpair(record)}
                        >
                            {unpairingId === record.id ? 'Unpairing' : 'Unpair'}
                        </Button>
                    </li>
                ))}
            </ul>
        </section>
    );
}

function pairingErrorMessage(err, vendor) {
    const raw = String(
        err && typeof err === 'object' ? err.message || err.name || '' : err || '',
    );
    if (/firmware.*(?:too old|outdated|unsupported)|(?:too old|unsupported).*firmware/i.test(raw)) {
        return firmwareUpdateAdvice(vendor);
    }
    if (/wrong app|app.*(?:not|isn't).*open|app is open|0x6a82|0x6e00|cla_not_supported|(?:bitcoin test|testnet).*app/i.test(raw)) {
        return 'The Bitcoin app is not open on your Ledger. Open the Bitcoin app on the device, then try again.';
    }
    if (/cancel|reject|denied|declined|user.*closed|popup.*closed/i.test(raw)) {
        return `Pairing was canceled. Approve the connection on your ${labelFor(vendor)} and in any browser prompt, then try again.`;
    }
    if (/no (?:compatible )?device|device.*not found|not found.*device|device.*disconnected|not connected|unable to claim|transport.*(?:unavailable|missing)|hid.*not found/i.test(raw)) {
        return `No ${labelFor(vendor)} was found. Connect and unlock the device, then try again.`;
    }
    return userFacingMessage(err, `Could not pair your ${labelFor(vendor)}. Connect and unlock the device, then try again.`);
}

function firmwareUpdateAdvice(vendor, recommended) {
    const tool = vendor === 'trezor' ? 'Trezor Suite' : 'Ledger Live';
    const version = recommended ? ` to version ${recommended} or newer` : '';
    return `This ${labelFor(vendor)} firmware is too old. Update it${version} with ${tool}, reconnect the device, then try again.`;
}

function labelFor(vendor) {
    if (vendor === 'trezor') return 'Trezor';
    if (vendor === 'ledger') return 'Ledger';
    return 'device';
}
