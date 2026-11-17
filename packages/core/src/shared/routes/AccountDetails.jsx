// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Account Details, opened from a My Accounts row and laid out like Wallet Details:
// the account card (tile, name, "Account N", Active bubble), then the shared
// Actions | Addresses | Details toggle (G102) with the actions as one
// ActionList (G101). Set as active account comes first (absent when active),
// then Edit account.
//
// Addresses (G131) lists the account's addresses by network, the same page
// for every wallet type. A hardware wallet's account also lists Add a
// Network for each network its device signs that the account lacks: only the
// device can give that address, so the row reads it from the device
// (hardware/HardwareNetworkRow.jsx) instead of deriving it.

import { useCallback, useEffect, useState } from 'react';
import {
    AddressText, EmptyState, Icon, ListPage, PageHeader, Screen, SectionHeader, StatusMessage,
} from '@xchain-wallet/core/ui';
import { ActionList, ActionListItem } from '../components/ActionList.jsx';
import { ActionsDetailsToggle } from '../components/ActionsDetailsToggle.jsx';
import {
    HardwareNetworkRow, hardwareNetworksToAdd, useAddHardwareNetwork,
} from '../components/hardware/HardwareNetworkRow.jsx';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useSupportedChains } from '../hooks/useSupportedChains.js';
import { accountAddressRows } from '../utils/accountViews.js';
import { isHardwareWallet } from '../../flows/hardwareWallet.js';
import { getActiveNetwork } from '../../flows/effectiveNetwork.js';
import { defaultRegistry } from '../../registry/index.js';
import { tickerForDescriptor } from '../../registry/coinTicker.js';
import { defaultAddressLabel } from '../../schemas/address.js';
import { AssetMark } from '../../ui/AssetMark.jsx';
import { IdentityAvatar } from '../components/WalletIdentity.jsx';
import { readWalletTile, tileRadius, walletTileText } from '../utils/walletTile.js';
import { t } from '../../i18n/index.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import '../../i18n/locales/en/accountPicker.js';
import '../../i18n/locales/en/coSigner.js';
import '../../i18n/locales/en/common.js';
import '../../i18n/locales/en/hardwareManage.js';
import '../../i18n/locales/en/history.js';
import '../../i18n/locales/en/home.js';
import '../../i18n/locales/en/settings.js';
import '../../i18n/locales/en/walletDetails.js';
import styles from './AccountDetails.module.css';
import listStyles from './CoSignerAccountList.module.css';
import pickerStyles from './WalletPicker.module.css';

const chainRegistry = defaultRegistry();

export function AccountDetails({ walletId, accountId, activeAccountId, onBack, onMakeActive, onRename, onExtendedKeys }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const [account, setAccount] = useState(/** @type {any} */ (null));
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [madeActive, setMadeActive] = useState(false);
    // A hardware wallet's keys stay on the device, so its accounts have no
    // extended-key export page to open.
    const [hardware, setHardware] = useState(false);
    useEffect(() => {
        let cancelled = false;
        Promise.resolve(messaging.listAccounts(walletId))
            .then((list) => { if (!cancelled) setAccount((Array.isArray(list) ? list : []).find((a) => a.id === accountId) || null); })
            .catch((err) => { if (!cancelled) setError(userFacingMessage(err, t('accountPicker.details.loadFailed'))); });
        if (typeof messaging.listWallets === 'function') {
            Promise.resolve(messaging.listWallets())
                .then((wallets) => {
                    const wallet = (Array.isArray(wallets) ? wallets : []).find((w) => w?.id === walletId);
                    if (!cancelled) setHardware(isHardwareWallet(wallet));
                })
                .catch(() => {});
        }
        return () => { cancelled = true; };
    }, [messaging, walletId, accountId]);
    const header = <PageHeader onBack={onBack} title={t('accountPicker.details.title')} />;
    if (error) return <Screen variant={variant} header={header}><ListPage><StatusMessage variant="error">{error}</StatusMessage></ListPage></Screen>;
    if (!account) return <Screen variant={variant} header={header}><ListPage><div>{t('common.loading')}</div></ListPage></Screen>;
    const numbered = t('accountPicker.defaultName', { number: (account.index ?? 0) + 1 });
    const name = account.name || numbered;
    const activeLabel = t('settings.developer.active');
    const isActive = madeActive || account.id === activeAccountId;
    const tile = readWalletTile(account.id);
    return (
        <Screen variant={variant} header={header}>
            <ListPage style={{ '--xc-section-gap': 'var(--xc-space-2)', gap: 'var(--xc-space-2)' }}>
                {/* The same identity card as Wallet Details: 8px inside the
                    card (G80) and My Accounts' Active bubble (G07). */}
                <div className={listStyles.list} data-identity-card="" style={{ display: 'flex', flexDirection: 'row', justifyContent: 'flex-start', textAlign: 'start', gap: 'var(--xc-space-2)', alignItems: 'center', padding: 'var(--xc-space-2)' }}>
                    <span aria-hidden="true" style={{ '--xc-avatar-shape': tileRadius(tile.shape), display: 'inline-flex' }}><IdentityAvatar name={name} text={walletTileText(name)} seed={account.id} context="list" variant="asset" tone={tile.colour} src={tile.image || null} /></span>
                    <div className={pickerStyles.identityText}>
                        <strong className={pickerStyles.identityName}>{name}</strong>
                        <span className={pickerStyles.identityMeta}>
                            <span>{numbered}</span>
                            {isActive ? <span className={pickerStyles.activeBadge}>{activeLabel}</span> : null}
                        </span>
                    </div>
                </div>
                <ActionsDetailsToggle
                    actions={(
                        <ActionList label={t('accountPicker.details.actionsList')}>
                            {!isActive && typeof onMakeActive === 'function' ? (
                                <ActionListItem
                                    icon={<Icon.CheckIcon />}
                                    onClick={() => { onMakeActive(account); setMadeActive(true); }}
                                    title={t('accountPicker.details.setActive')}
                                    description={t('accountPicker.details.setActiveLine')}
                                />
                            ) : null}
                            {typeof onRename === 'function' ? (
                                <ActionListItem
                                    icon={<Icon.PencilIcon />}
                                    onClick={() => onRename(account)}
                                    title={t('accountPicker.details.edit')}
                                    description={t('coSigner.detail.editLookDesc')}
                                />
                            ) : null}
                            {isActive && !hardware && typeof onExtendedKeys === 'function' ? (
                                <ActionListItem
                                    icon={<Icon.KeyIcon />}
                                    onClick={() => onExtendedKeys(account)}
                                    title={t('settings.thisWallet.extendedPublicKeys')}
                                    description={t('accountPicker.details.extendedKeysLine')}
                                />
                            ) : null}
                        </ActionList>
                    )}
                    details={(
                        /* The Wallet Details fact rows: label left, value right, 8px insets. */
                        <dl className={pickerStyles.detailList} aria-label={t('accountPicker.details.factsLabel')}>
                            {[
                                [t('walletDetails.name'), name],
                                [t('accountPicker.details.number'), String((account.index ?? 0) + 1)],
                                [t('history.filters.statusHeader'), isActive ? activeLabel : t('accountPicker.details.notActive')],
                            ].map(([k, v]) => (
                                <div key={k} className={pickerStyles.detailRow}>
                                    <dt className={pickerStyles.detailLabel}>{k}</dt>
                                    <dd className={pickerStyles.detailValue}>{v}</dd>
                                </div>
                            ))}
                        </dl>
                    )}
                    extra={{
                        id: 'addresses',
                        label: t('home.addresses'),
                        icon: <Icon.AddressIcon />,
                        panel: <AccountAddresses messaging={messaging} walletId={walletId} account={account} hardware={hardware} />,
                    }}
                />
            </ListPage>
        </Screen>
    );
}

/**
 * The Addresses tab: one flat list ordered by network and address index, with
 * each address in full where it fits (G99). A hardware account adds Add a
 * Network rows under it.
 */
function AccountAddresses({ messaging, walletId, account, hardware }) {
    const [byChain, setByChain] = useState(/** @type {Record<string, any[]> | null} */ (null));
    // Bumped after Add a Network fills a network in, to read the addresses again.
    const [version, setVersion] = useState(0);
    const [signer, setSigner] = useState(/** @type {any} */ (null));
    const [settings, setSettings] = useState(/** @type {any} */ (null));
    const chains = useSupportedChains(chainRegistry);

    // One read of the account's addresses, every network at once.
    useEffect(() => {
        let cancelled = false;
        if (typeof messaging.getAddressesByChain !== 'function') {
            setByChain({});
            return undefined;
        }
        Promise.resolve()
            .then(() => messaging.getAddressesByChain(walletId, account.id))
            .then((map) => { if (!cancelled) setByChain(map && typeof map === 'object' ? map : {}); })
            .catch(() => { if (!cancelled) setByChain({}); });
        return () => { cancelled = true; };
    }, [messaging, walletId, account.id, version]);

    // A hardware wallet's device record and network setting, for Add a Network.
    useEffect(() => {
        let cancelled = false;
        if (!hardware) return undefined;
        if (typeof messaging.listSigners === 'function') {
            Promise.resolve()
                .then(() => messaging.listSigners(walletId))
                .then((list) => {
                    const records = Array.isArray(list) ? list : [];
                    if (!cancelled) setSigner(records.find((r) => r?.walletId === walletId) || records[0] || null);
                })
                .catch(() => {});
        }
        if (typeof messaging.getSettings === 'function') {
            Promise.resolve()
                .then(() => messaging.getSettings())
                .then((record) => { if (!cancelled) setSettings(record || null); })
                .catch(() => { /* locked: Mainnet */ });
        }
        return () => { cancelled = true; };
    }, [messaging, walletId, hardware]);

    const onAdded = useCallback(() => setVersion((n) => n + 1), []);
    const addNetwork = useAddHardwareNetwork({
        messaging, walletId, signerId: hardware ? signer?.id : null, onAdded,
    });

    if (byChain === null) return <div role="status">{t('common.loading')}</div>;
    const rows = accountAddressRows(byChain, account.id, chains.map((c) => c.id));
    const toAdd = hardware && addNetwork.available ? hardwareNetworksToAdd({
        accounts: [account], byChain, chains, vendor: signer?.vendor, network: getActiveNetwork(settings),
    }) : [];

    return (
        <div className={styles.addresses} data-account-addresses="">
            {rows.length === 0 ? (
                <EmptyState
                    title={t('history.empty.noAddressesTitle')}
                    body={t('accountPicker.details.addressesEmptyBody')}
                />
            ) : null}
            {rows.length > 0 ? (
                <ActionList label={t('home.addresses')} data-account-address-list="">
                    {rows.map(({ chainId, record }) => {
                        const descriptor = chainRegistry.get(chainId);
                        const tick = descriptor ? tickerForDescriptor(descriptor) : '';
                        return (
                            <ActionListItem
                                key={`${chainId}:${record.id || record.address}`}
                                data-chain-id={chainId}
                                icon={<AssetMark chainId={chainId} tick={tick} isNative />}
                                title={record.label || defaultAddressLabel(record)}
                                description={<AddressText address={record.address} size="sm" />}
                                chevron={false}
                            />
                        );
                    })}
                </ActionList>
            ) : null}
            {toAdd.length > 0 ? (
                <section className={styles.addNetworkSection}>
                    <SectionHeader as="h3" title={t('hardwareManage.addNetworkTitle')} />
                    <ActionList label={t('hardwareManage.addNetworkList')}>
                        {toAdd.map((entry) => (
                            <HardwareNetworkRow
                                key={entry.key}
                                descriptor={entry.descriptor}
                                title={t('hardwareManage.addNetworkRow', {
                                    network: entry.descriptor.displayName || entry.descriptor.id,
                                })}
                                vendor={signer?.vendor || ''}
                                state={addNetwork.states[entry.key]}
                                onAdd={() => { void addNetwork.add(entry.accountId, entry.descriptor.id); }}
                            />
                        ))}
                    </ActionList>
                </section>
            ) : null}
        </div>
    );
}
