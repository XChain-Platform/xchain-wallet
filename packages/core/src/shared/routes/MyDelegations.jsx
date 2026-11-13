// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useMemo, useState } from 'react';
import {
    AddressField, Button, EmptyState, Icon, ListPage, ListRow, PageHeader, Screen, StatusMessage,
} from '@xchain-wallet/core/ui';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { preferredSourceId } from '../addressSelection.js';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import { summaryAddress } from '../components/formStandard/index.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/governance.js';
import local from './GovernancePolls.module.css';

function sinceText(row) {
    const seconds = Number(row?.timestamp);
    if (Number.isFinite(seconds) && seconds > 0) {
        return t('governance.delegations.since', { when: new Date(seconds * 1000).toLocaleDateString() });
    }
    if (row?.block_index !== undefined && row?.block_index !== null && row.block_index !== '') {
        return t('governance.delegations.sinceBlock', { block: String(row.block_index) });
    }
    return null;
}

/**
 * My delegations: the live vote delegations one address has set, one per
 * governance token (token, delegate, since when), each with a Clear button
 * that opens the short clear form. The list is one read for the address;
 * the explorer already leaves out delegations that were re-pointed or
 * cleared. The address defaults to the active one on the network and can be
 * changed with the address picker.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} props.chainId
 * @param {(chainId: string, clear: { tick: string, delegate: string, address: string }) => void} props.onClear
 * @param {(chainId: string) => void} [props.onDelegate]
 * @param {() => void} props.onBack
 */
export function MyDelegations({ walletId, chainId: initialChainId, onClear, onDelegate, onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);

    // Seeded from Governance polls; the address picker can move it to
    // another network, and Clear acts on the network shown.
    const [chainId, setChainId] = useState(initialChainId);
    const [wallet, setWallet] = useState(
        /** @type {{ byChain: Record<string, any[]>, active: Record<string, any> } | null} */ (null),
    );
    const [pickedId, setPickedId] = useState(/** @type {string | null} */ (null));
    const [addressError, setAddressError] = useState(/** @type {string | null} */ (null));
    const [pickerOpen, setPickerOpen] = useState(false);
    const [listState, setListState] = useState(
        /** @type {{ address: string, rows: any[] | null, error: string | null } | null} */ (null),
    );
    const [reload, setReload] = useState(0);

    useEffect(() => {
        let cancelled = false;
        setAddressError(null);
        Promise.all([
            messaging.getAddressesByChain(walletId),
            typeof messaging.getActiveAddresses === 'function' ? messaging.getActiveAddresses(walletId) : Promise.resolve({}),
        ])
            .then(([byChain, active]) => {
                if (!cancelled) setWallet({ byChain: byChain || {}, active: active || {} });
            })
            .catch((err) => {
                if (!cancelled) setAddressError(userFacingMessage(err, t('governance.error.addresses')));
            });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    const addresses = wallet ? (wallet.byChain[chainId] || []) : null;
    // The picked address, else the active one on this network.
    const address = useMemo(() => {
        if (!addresses) return null;
        const id = addresses.some((a) => a.id === pickedId)
            ? pickedId
            : preferredSourceId(addresses, wallet?.active?.[chainId]);
        return addresses.find((a) => a.id === id)?.address || null;
    }, [addresses, pickedId, wallet, chainId]);

    // One read for the whole list: the address's live delegations.
    useEffect(() => {
        if (!address) return undefined;
        let cancelled = false;
        setListState({ address, rows: null, error: null });
        Promise.resolve()
            .then(() => messaging.governanceVoteDelegations({ chainId, address }))
            .then((response) => {
                if (cancelled) return;
                const rows = Array.isArray(response) ? response : (Array.isArray(response?.data) ? response.data : []);
                setListState({ address, rows: rows.filter((row) => row && row.delegate), error: null });
            })
            .catch((err) => {
                if (!cancelled) setListState({ address, rows: null, error: userFacingMessage(err, t('governance.delegations.error')) });
            });
        return () => { cancelled = true; };
    }, [address, chainId, messaging, reload]);

    const header = (
        <PageHeader
            onBack={onBack}
            title={t('governance.delegations.title')}
            trailing={onDelegate ? (
                <Button
                    variant="ghost"
                    size="sm"
                    icon={<Icon.PlusIcon />}
                    onClick={() => onDelegate(chainId)}
                    aria-label={t('governance.delegateVotes')}
                    title={t('governance.delegateVotes')}
                />
            ) : null}
        />
    );
    const wrap = (children) => <Screen variant={variant} header={header}>{children}</Screen>;

    if (pickerOpen) {
        return (
            <OwnAddressPickerScreen
                variant={variant}
                title={t('governance.delegations.addressTitle')}
                walletId={walletId}
                chainId={chainId}
                onChainChange={(next) => { setChainId(next); setPickedId(null); }}
                onPick={(picked) => { setPickedId(picked.id); setPickerOpen(false); }}
                onBack={() => setPickerOpen(false)}
            />
        );
    }

    if (addressError) {
        return wrap(<ListPage notices={<StatusMessage variant="error">{addressError}</StatusMessage>} />);
    }
    if (!addresses) {
        return wrap(
            <ListPage notices={(
                <StatusMessage variant="status" label={t('governance.loadingAddressesLabel')} busy>{t('governance.loadingAddresses')}</StatusMessage>
            )} />,
        );
    }
    if (!address) {
        return wrap(
            <ListPage>
                <EmptyState title={t('governance.noAddress.title')} body={t('governance.noAddress.body')} />
            </ListPage>,
        );
    }

    const current = listState?.address === address ? listState : null;
    const rows = current?.rows ?? null;
    return wrap(
        <ListPage
            notices={current?.error ? (
                <StatusMessage
                    variant="error"
                    recovery={{ label: t('common.tryAgain'), onAction: () => setReload((n) => n + 1) }}
                >
                    {current.error}
                </StatusMessage>
            ) : !rows ? (
                <StatusMessage variant="status" label={t('governance.delegations.loadingLabel')} busy>{t('governance.delegations.loading')}</StatusMessage>
            ) : null}
        >
            <AddressField
                label={t('governance.delegations.address')}
                help={t('governance.delegations.addressHelp')}
                icon="addresses"
                value={address}
                readOnly
                onChange={() => {}}
                onIconClick={() => setPickerOpen(true)}
                iconLabel={t('governance.delegations.chooseAddress')}
            />
            {rows && rows.length === 0 ? (
                <EmptyState title={t('governance.delegations.empty.title')} body={t('governance.delegations.empty.body')} />
            ) : null}
            {rows && rows.length > 0 ? (
                /* Safari needs an explicit list role because this class removes list styling. */
                <ul className={local.pollList} role="list" aria-label={t('governance.delegations.title')}>
                    {rows.map((row) => {
                        const tick = String(row.tick || '');
                        const delegate = String(row.delegate || '');
                        const since = sinceText(row);
                        return (
                            <li key={`${tick}:${String(row.action_index ?? delegate)}`}>
                                <ListRow
                                    className={local.pollCard}
                                    leading={<span className={local.pollIcon} aria-hidden="true"><Icon.UsersIcon /></span>}
                                    title={<span className={local.pollTitle}>{tick}</span>}
                                    subtitle={(
                                        <span className={local.pollText} style={{ display: 'block' }}>
                                            {[t('governance.delegations.to', { delegate: summaryAddress(delegate) }), since].filter(Boolean).join(' · ')}
                                        </span>
                                    )}
                                    trailing={(
                                        <Button
                                            type="button"
                                            variant="secondary"
                                            size="sm"
                                            icon={<Icon.TrashIcon />}
                                            aria-label={t('governance.delegations.clearLabel', { tick })}
                                            onClick={() => onClear(chainId, { tick, delegate, address })}
                                        >
                                            {t('common.clear')}
                                        </Button>
                                    )}
                                />
                            </li>
                        );
                    })}
                </ul>
            ) : null}
        </ListPage>,
    );
}
