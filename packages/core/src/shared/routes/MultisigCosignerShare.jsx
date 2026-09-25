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
import { CopyButton, StatusMessage } from '@xchain-wallet/core/ui';
import { useMessaging } from '../useMessaging.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
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
 * @param {Array<{ id: string, address: string, label?: string }>} props.addresses   this wallet's addresses on the multisig network
 */
export function MultisigCosignerShare({ walletId, addresses }) {
    const { messaging } = useMessaging();
    const [addressId, setAddressId] = useState('');
    const [info, setInfo] = useState(/** @type {any} */ (null));
    const [error, setError] = useState(/** @type {string | null} */ (null));

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
            .then((r) => { if (!cancelled) setInfo(r); })
            .catch((err) => {
                if (!cancelled) setError(userFacingMessage(err, 'Could not read this wallet\'s cosigner keys.'));
            });
        return () => { cancelled = true; };
    }, [walletId, addressId, messaging]);

    return (
        <details style={{ margin: '0 0 var(--xc-space-3) 0' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Share this wallet as a cosigner</summary>
            <p className={styles.hint} style={{ textAlign: 'left', margin: 'var(--xc-space-2) 0' }}>
                Give these values to the person creating the multisig. In their
                wallet they add a cosigner with origin "External xpub" and paste
                each one into the field of the same name. They are public keys:
                they show the shared address but cannot spend from it.
            </p>
            <label className={styles.pickerLabel}>
                <span>Address to share</span>
                <select
                    className={styles.picker}
                    value={addressId}
                    onChange={(e) => setAddressId(e.target.value)}
                >
                    <option value="">Select address</option>
                    {addresses.map((a) => (
                        <option key={a.id} value={a.id}>
                            {a.address} {a.label ? `· ${a.label}` : ''}
                        </option>
                    ))}
                </select>
            </label>
            {error ? <StatusMessage variant="error" className={styles.error}>{error}</StatusMessage> : null}
            {info ? (
                <dl className={styles.detailsList}>
                    <ShareRow label="xpub" value={info.xpub} note={info.accountPath ? `Account ${info.accountPath}` : null} />
                    <ShareRow label="Public key" value={info.pubkey} />
                    <ShareRow label="Master fingerprint" value={info.fingerprint} />
                    <ShareRow label="Derivation path" value={info.derivationPath} />
                </dl>
            ) : null}
        </details>
    );
}

function ShareRow({ label, value, note = null }) {
    return (
        <>
            <dt className={styles.detailsLabel}>{label}</dt>
            <dd className={styles.detailsValue}>
                {value ? (
                    <>
                        <code style={monoStyle} data-testid={`cosigner-share-${label.toLowerCase().replace(/\s+/g, '-')}`}>{value}</code>
                        {note ? <span style={{ display: 'block', color: 'var(--xc-text-muted)' }}>{note}</span> : null}
                        <CopyButton value={value} ariaLabel={`Copy ${label}`} />
                    </>
                ) : 'Not available from this signer'}
            </dd>
        </>
    );
}

const monoStyle = {
    display: 'block',
    fontFamily: 'var(--xc-font-mono)',
    wordBreak: 'break-all',
};
