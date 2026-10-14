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
import { AddressText, Checkbox, InfoTip } from '@xchain-wallet/core/ui';
import styles from './DerivationPathCrossCheck.module.css';
import { t } from '../../i18n/index.js';

/**
 * DerivationPathCrossCheck (§18.5): reusable UI block that sits above
 * a sign button when the signer is a hardware device. Displays the
 * three facts the user must confirm against the device screen, then
 * the explicit cross-check instruction copy.
 *
 * Rendered by sign screens (shared SignApproval, the wallet's own
 * send/issue/etc. review stages) whenever `signer.kind` is `trezor`
 * or `ledger`. Does not render anything for software signers, which
 * have no physical confirmation step.
 *
 * The wallet explicitly instructs the user to compare BOTH the
 * derivation path AND the address shown on the device against the
 * values rendered here. This protects against a compromised host
 * asking the device to sign for a different address (or a different
 * sub-account at a different path) than the UI claims (§18.5 threat).
 *
 * Per-vendor hint copy describes what the device actually displays so
 * users without prior HW experience know where to look:
 *   - Trezor screens always show address + path side-by-side on the
 *     confirmation step.
 *   - Ledger Nano S Plus / Nano X / Stax show the address (path on a
 *     secondary screen accessible via the right button on Nano models).
 *
 * @param {object} props
 * @param {string} props.signerName     e.g. "Trezor Model T (My Trezor)"
 * @param {string} props.signerKind     'trezor' | 'ledger'
 * @param {string} props.path           concrete BIP32 path
 * @param {string} props.address        the address the signature will be produced from
 * @param {boolean} [props.requireExplicitConfirm]   when true, render an "I've verified path + address" checkbox; parent reads value via onConfirmedChange. Defaults to false (instruction copy only).
 * @param {(confirmed: boolean) => void} [props.onConfirmedChange]   fired when the explicit-confirm checkbox toggles
 */
export function DerivationPathCrossCheck({
    signerName,
    signerKind,
    path,
    address,
    requireExplicitConfirm,
    onConfirmedChange,
}) {
    const deviceLabel = signerKind === 'trezor'
        ? 'Trezor'
        : signerKind === 'ledger' ? 'Ledger' : 'your device';

    const [confirmed, setConfirmed] = useState(false);
    const onConfirmedChangeRef = useRef(onConfirmedChange);
    onConfirmedChangeRef.current = onConfirmedChange;

    // Reset the checkbox whenever the path or address changes. The user
    // must re-confirm if the values they were verifying have rotated under
    // them. Safer than carrying a stale "yes I verified" through a route
    // change.
    useEffect(() => {
        setConfirmed(false);
        onConfirmedChangeRef.current?.(false);
    }, [path, address]);

    function handleToggle(event) {
        const next = event.target.checked;
        setConfirmed(next);
        onConfirmedChange?.(next);
    }

    return (
        <section className={styles.root} aria-label={t('components.derivationPathCrossCheck.hardwareSignerVerification')}>
            <p className={styles.title}>{t('components.derivationPathCrossCheck.signingWithHardwareDevice')}</p>
            <dl className={styles.grid}>
                <dt className={styles.label}>{t('components.derivationPathCrossCheck.signer')}</dt>
                <dd className={styles.value}>{signerName}</dd>
                <dt className={styles.label}>
                    {t('components.derivationPathCrossCheck.derivationPath')}
                    <InfoTip
                        aria={t('components.derivationPathCrossCheck.derivationPathHelp')}
                        label={t('components.derivationPathCrossCheck.locatesThisAccountWithinYour')}
                    />
                </dt>
                <dd className={styles.value}><code className={styles.path}>{path}</code></dd>
                <dt className={styles.label}>{t('routes.addressList.address')}</dt>
                <dd className={styles.value}><AddressText address={address} /></dd>
            </dl>
            <p className={styles.instruction}>
                {t('components.derivationPathCrossCheck.verify')} <strong>{t('components.derivationPathCrossCheck.both')}</strong> {t('components.derivationPathCrossCheck.theDerivationPathAndAddress')} <strong>{deviceLabel}</strong> {t('components.derivationPathCrossCheck.matchTheValuesAboveApprove')}
            </p>
            <p className={styles.deviceHint}>
                {t('components.derivationPathCrossCheck.ifEitherValueIsDifferent')}
            </p>
            <p className={styles.deviceHint}>
                {signerKind === 'trezor'
                    ? t('components.derivationPathCrossCheck.trezorDisplaysTheAddressAnd')
                    : signerKind === 'ledger'
                    ? t('components.derivationPathCrossCheck.ledgerDisplaysTheAddressOn')
                    : t('components.derivationPathCrossCheck.stepThroughTheDeviceScreens')}
            </p>
            {requireExplicitConfirm ? (
                <Checkbox
                    className={styles.confirmRow}
                    label={t('components.derivationPathCrossCheck.iVeVerifiedThePath', { deviceLabel })}
                    checked={confirmed}
                    onChange={handleToggle}
                />
            ) : null}
        </section>
    );
}
