// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { isDeviceAddressSource } from '../../schemas/constants.js';
import { useEffect, useState } from 'react';
import {
    CopyButton,
    AddressField,
    Button,
    FormPage,
    Icon,
    ListPage,
    Notice,
    PageHeader,
    Screen,
    useFormErrors,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/multisig.js';
import { KeyQR } from '../components/KeyQR.jsx';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import { xpubForNetwork } from '../utils/multisigXpub.js';
import styles from './IssueTokenForm.module.css';
import local from './MultisigCosignerShare.module.css';

const chainRegistry = registryLib.defaultRegistry();
const BTC_CHAIN_IDS = chainRegistry.byCoin('bitcoin').map((descriptor) => descriptor.id);

/**
 * "Share as cosigner" (§22.2): a standalone Form Standard page that exports
 * the public key material one address contributes to someone else's multisig.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 */
export function MultisigCosignerShare({
    walletId,
    onBack,
}) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const formErrors = useFormErrors();
    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [chainId, setChainId] = useState(/** @type {string | null} */ (null));
    const [addressId, setAddressId] = useState('');
    const [pickerOpen, setPickerOpen] = useState(false);
    const [info, setInfo] = useState(/** @type {any} */ (null));
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [loading, setLoading] = useState(false);
    const addresses = chainId ? addressesByChain?.[chainId] || [] : [];
    const selectedAddress = addresses.find((address) => address.id === addressId) || null;
    const networkKind = chainId ? chainRegistry.get(chainId)?.networkKind : null;
    const selectedInfo = info?.walletId === walletId
        && info?.chainId === chainId
        && info?.addressId === addressId
        ? info.value
        : null;
    const sharePayload = selectedInfo
        ? buildSharePayload({ info: selectedInfo, address: selectedAddress, networkKind })
        : null;

    useEffect(() => {
        let cancelled = false;
        messaging.getAddressesByChain(walletId)
            .then((byChain) => {
                if (cancelled) return;
                const next = byChain || {};
                setAddressesByChain(next);
                setChainId(BTC_CHAIN_IDS.find((id) => Array.isArray(next[id]) && next[id].length > 0)
                    || BTC_CHAIN_IDS[0]
                    || null);
            })
            .catch((err) => {
                if (!cancelled) {
                    setAddressesByChain({});
                    setError(userFacingMessage(err, 'Could not load this wallet\'s addresses.'));
                }
            });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    function chooseAddress(address) {
        setAddressId(address?.id || '');
        setInfo(null);
        setError(null);
        formErrors.clear('cosigner-share-address');
        setPickerOpen(false);
    }

    async function handleShare(event) {
        event?.preventDefault();
        if (!selectedAddress) {
            formErrors.validate({
                'cosigner-share-address': 'Choose an address to share.',
            });
            return;
        }
        formErrors.reset();
        setInfo(null);
        setError(null);
        if (typeof messaging.getMultisigCosignerInfo !== 'function') {
            setError('Sharing cosigner keys is not available in this shell.');
            return;
        }
        setLoading(true);
        try {
            const result = await messaging.getMultisigCosignerInfo({ walletId, addressId });
            if ((result?.addressId && result.addressId !== addressId)
                || (result?.address && result.address !== selectedAddress.address)) {
                setError('The wallet returned cosigner keys for a different address. Select the address again.');
                return;
            }
            setInfo({ walletId, chainId, addressId, value: result });
        } catch (err) {
            setError(userFacingMessage(err, 'Could not read this wallet\'s cosigner keys.'));
        } finally {
            setLoading(false);
        }
    }

    if (pickerOpen) {
        return (
            <OwnAddressPickerScreen
                variant={variant}
                title={t('multisig.share.address')}
                walletId={walletId}
                chainId={chainId}
                onChainChange={(nextChainId) => {
                    setChainId(nextChainId);
                    setAddressId('');
                    setInfo(null);
                    setError(null);
                }}
                unavailableReason={unavailableAddressReason}
                onPick={chooseAddress}
                onBack={() => setPickerOpen(false)}
            />
        );
    }

    const guidance = (
        <Notice tone="info" title={t('multisig.share.noticeTitle')} role="note">
            {t('multisig.share.instructions')} {t('multisig.share.availability')}
        </Notice>
    );

    const header = <PageHeader onBack={onBack} title={t('multisig.share.title')} />;
    if (!addressesByChain) {
        return (
            <Screen variant={variant} header={header}>
                <ListPage><p className={styles.hint}>{t('multisig.share.loadingWallet')}</p></ListPage>
            </Screen>
        );
    }

    return (
        <Screen variant={variant} header={header}>
            <FormPage
                label={t('multisig.share.title')}
                onSubmit={handleShare}
                errors={formErrors}
                status={[guidance, error ? <Notice key="share-error" tone="danger">{error}</Notice> : null]}
            >
                <div className={local.shareActionStack}>
                    <AddressField
                        id="cosigner-share-address"
                        label={t('multisig.share.address')}
                        help={t('multisig.share.addressHelp')}
                        icon="addresses"
                        value={selectedAddress?.address || ''}
                        readOnly
                        onChange={() => {}}
                        onIconClick={() => setPickerOpen(true)}
                        iconLabel={t('multisig.share.chooseAddress')}
                        placeholder={t('multisig.share.selectAddress')}
                        error={formErrors.errorFor('cosigner-share-address')}
                    />
                    <Button
                        type="submit"
                        variant="success"
                        block
                        icon={<Icon.ShareIcon />}
                        loading={loading}
                    >
                        {t('multisig.share.button')}
                    </Button>
                </div>
                {selectedInfo ? (
                    <>
                        <div className={local.payload}>
                            <strong>{t('multisig.share.payload')}</strong>
                            <p className={styles.hint}>{t('multisig.share.payloadHint')}</p>
                            <KeyQR value={sharePayload} size={256} alt={t('multisig.share.qrAlt')} />
                            <CopyButton value={sharePayload} label={t('multisig.share.copyPayload')} />
                        </div>
                        <dl className={styles.detailsList}>
                            <ShareRow label={t('multisig.share.xpub')} value={xpubForNetwork(selectedInfo.xpub, networkKind)} hint={selectedInfo.accountPath ? t('multisig.share.account', { path: selectedInfo.accountPath }) : null} />
                            <ShareRow label={t('multisig.share.publicKey')} value={selectedInfo.pubkey} />
                            <ShareRow label={t('multisig.share.masterFingerprint')} value={selectedInfo.fingerprint} />
                            <ShareRow label={t('multisig.share.derivationPath')} value={selectedInfo.derivationPath} />
                        </dl>
                        <p role="note" className={styles.hint}>{t('multisig.share.identityCheck')}</p>
                    </>
                ) : null}
            </FormPage>
        </Screen>
    );
}

function buildSharePayload({ info, address, networkKind }) {
    return JSON.stringify({
        type: 'xchain-multisig-cosigner',
        version: 1,
        network: networkKind || null,
        address: address?.address || null,
        xpub: xpubForNetwork(info.xpub, networkKind) || null,
        pubkey: info.pubkey || null,
        fingerprint: info.fingerprint || null,
        derivationPath: info.derivationPath || null,
    }, null, 2);
}

export function canShareAddress(address) {
    return !address?.source || address.source === 'hd';
}

export function unavailableAddressReason(address) {
    if (address?.source === 'watch-only') return t('multisig.share.watchOnlyUnavailable');
    if (isDeviceAddressSource(address?.source)) {
        return t('multisig.share.hardwareUnavailable');
    }
    if (address?.source === 'imported-wif') return t('multisig.share.importedUnavailable');
    return null;
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
