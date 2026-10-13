// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useState } from 'react';
import {
    CopyButton,
    FormPage,
    FormSection,
    StatusMessage,
} from '@xchain-wallet/core/ui';
import { t } from '../../i18n/index.js';
import { KeyQR } from '../components/KeyQR.jsx';
import { useMessaging } from '../useMessaging.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import { xpubForNetwork } from '../utils/multisigXpub.js';
import styles from './IssueTokenForm.module.css';

/**
 * "Share as cosigner" (§22.2): shows the public key material one of this
 * wallet's addresses contributes to someone else's multisig, each value
 * copyable, so the other party can add this wallet as an external cosigner.
 *
 * Collapsed by default under Create multisig; the values are public keys
 * and reveal nothing that can spend.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {Array<{ id: string, address: string, label?: string, source?: string }>} props.addresses   this wallet's addresses on the multisig network
 * @param {'mainnet' | 'testnet' | 'regtest'} [props.networkKind]
 */
export function MultisigCosignerShare({ walletId, addresses, networkKind }) {
    const { messaging } = useMessaging();
    const [addressId, setAddressId] = useState('');
    const [info, setInfo] = useState(/** @type {any} */ (null));
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const selectedAddress = addresses.find((address) => address.id === addressId) || null;
    const selectedInfo = info?.walletId === walletId && info?.addressId === addressId
        ? info.value
        : null;
    const sharePayload = selectedInfo
        ? buildSharePayload({ info: selectedInfo, address: selectedAddress, networkKind })
        : null;

    useEffect(() => {
        if (addressId && !addresses.some((address) => address.id === addressId)) {
            setAddressId('');
            setInfo(null);
            setError(null);
        }
    }, [addressId, addresses]);

    useEffect(() => {
        setInfo(null);
        setError(null);
        if (!addressId) return undefined;
        // A shell without the route keeps the manual path rather than crashing.
        if (typeof messaging.getMultisigCosignerInfo !== 'function') {
            setError('Sharing cosigner keys is not available in this shell.');
            return undefined;
        }
        let cancelled = false;
        messaging.getMultisigCosignerInfo({ walletId, addressId })
            .then((r) => {
                if (!cancelled) setInfo({ walletId, addressId, value: r });
            })
            .catch((err) => {
                if (!cancelled) setError(userFacingMessage(err, 'Could not read this wallet\'s cosigner keys.'));
            });
        return () => { cancelled = true; };
    }, [walletId, addressId, messaging]);

    return (
        <FormPage as="div" sectioned label={t('multisig.share.title')}>
            <FormSection title={t('multisig.share.title')}>
                <details style={{ margin: '0 0 var(--xc-space-3) 0' }}>
                    <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{t('multisig.share.title')}</summary>
            <p className={styles.hint} style={{ textAlign: 'left', margin: 'var(--xc-space-2) 0' }}>
                {t('multisig.share.instructions')}
            </p>
            <p className={styles.hint} style={{ textAlign: 'left', margin: 'var(--xc-space-2) 0' }}>
                {t('multisig.share.availability')}
            </p>
            <label className={styles.pickerLabel}>
                <span>{t('multisig.share.address')}</span>
                <select
                    className={styles.picker}
                    value={addressId}
                    onChange={(e) => setAddressId(e.target.value)}
                >
                    <option value="">{t('multisig.share.selectAddress')}</option>
                    {addresses.map((a) => (
                        <option key={a.id} value={a.id} disabled={!canShareAddress(a)}>
                            {a.address} {a.label ? `· ${a.label}` : ''}{unavailableAddressLabel(a)}
                        </option>
                    ))}
                </select>
            </label>
            {error ? <StatusMessage variant="error" className={styles.error}>{error}</StatusMessage> : null}
            {selectedInfo ? (
                <>
                    <div style={payloadStyle}>
                        <strong>{t('multisig.share.payload')}</strong>
                        <p className={styles.hint} style={{ textAlign: 'left', margin: 0 }}>
                            {t('multisig.share.payloadHint')}
                        </p>
                        <KeyQR
                            value={sharePayload}
                            size={200}
                            alt={t('multisig.share.qrAlt')}
                        />
                        <textarea
                            readOnly
                            aria-label={t('multisig.share.payloadAriaLabel')}
                            value={sharePayload}
                            rows={8}
                            style={payloadTextStyle}
                        />
                        <CopyButton
                            value={sharePayload}
                            label={t('multisig.share.copyPayload')}
                        />
                    </div>
                    <dl className={styles.detailsList}>
                        <ShareRow label={t('multisig.share.xpub')} value={xpubForNetwork(selectedInfo.xpub, networkKind)} hint={selectedInfo.accountPath ? t('multisig.share.account', { path: selectedInfo.accountPath }) : null} />
                        <ShareRow label={t('multisig.share.publicKey')} value={selectedInfo.pubkey} />
                        <ShareRow label={t('multisig.share.masterFingerprint')} value={selectedInfo.fingerprint} />
                        <ShareRow label={t('multisig.share.derivationPath')} value={selectedInfo.derivationPath} />
                    </dl>
                    <p role="note" className={styles.hint} style={{ textAlign: 'left' }}>
                        {t('multisig.share.identityCheck')}
                    </p>
                </>
            ) : null}
                </details>
            </FormSection>
        </FormPage>
    );
}

function buildSharePayload({ info, address, networkKind }) {
    return JSON.stringify({
        type: 'xchain-multisig-cosigner',
        version: 1,
        network: networkKind || null,
        address: info.address || address?.address || null,
        xpub: xpubForNetwork(info.xpub, networkKind) || null,
        pubkey: info.pubkey || null,
        fingerprint: info.fingerprint || null,
        derivationPath: info.derivationPath || null,
    }, null, 2);
}

function canShareAddress(address) {
    return !address?.source || address.source === 'hd';
}

function unavailableAddressLabel(address) {
    if (address?.source === 'watch-only') return ' (watch-only, unavailable)';
    if (address?.source === 'trezor' || address?.source === 'ledger') {
        return ' (hardware, export on device)';
    }
    if (address?.source === 'imported-wif') return ' (imported key, unavailable)';
    return '';
}

function ShareRow({ label, value, hint = null }) {
    return (
        <>
            <dt className={styles.detailsLabel}>{label}</dt>
            <dd className={styles.detailsValue}>
                {value ? (
                    <>
                        <code style={monoStyle} data-testid={`cosigner-share-${label.toLowerCase().replace(/\s+/g, '-')}`}>{value}</code>
                        {hint ? <span style={{ display: 'block', color: 'var(--xc-text-muted)' }}>{hint}</span> : null}
                        <CopyButton value={value} ariaLabel={t('multisig.share.copyField', { label })} />
                    </>
                ) : t('multisig.share.unavailable')}
            </dd>
        </>
    );
}

const monoStyle = {
    display: 'block',
    fontFamily: 'var(--xc-font-mono)',
    overflowWrap: 'anywhere',
    wordBreak: 'break-word',
};

const payloadStyle = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 'var(--xc-space-2)',
    margin: 'var(--xc-space-3) 0',
};

const payloadTextStyle = {
    boxSizing: 'border-box',
    width: '100%',
    resize: 'vertical',
    fontFamily: 'var(--xc-font-mono)',
    fontSize: 'var(--xc-text-xs)',
    overflowWrap: 'anywhere',
};
