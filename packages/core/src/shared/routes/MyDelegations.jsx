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
    AddressText, Button, EmptyState, Icon, ListPage, ListRow, PageHeader, Screen, StatusMessage,
} from '@xchain-wallet/core/ui';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { preferredSourceId } from '../addressSelection.js';
import { useGovernanceChainIds } from '../hooks/useGovernanceAddressesPresent.js';
import { ListFilterMenu } from '../components/ListFilterMenu.jsx';
import { TickerIcon } from '../components/TickerIcon.jsx';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/governance.js';
import local from './GovernancePolls.module.css';

/**
 * My delegations: a standard list page of the live vote delegations the
 * active address on the network has set, one row per governance token (the
 * token's icon and name, the delegate's full address); the whole row opens
 * the short clear form. The list is one read for the address; the explorer
 * already leaves out delegations that were re-pointed or cleared. The title
 * bar's Filter is only a search box (token or delegate address).
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} [props.chainId]  omitted when opened from the menu
 * @param {(chainId: string, clear: { tick: string, delegate: string, address: string }) => void} props.onClear
 * @param {(chainId: string) => void} [props.onDelegate]
 * @param {() => void} props.onBack
 */
export function MyDelegations({ walletId, chainId: initialChainId, onClear, onDelegate, onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);

    const governanceChains = useGovernanceChainIds();
    const [wallet, setWallet] = useState(
        /** @type {{ byChain: Record<string, any[]>, active: Record<string, any> } | null} */ (null),
    );
    const [addressError, setAddressError] = useState(/** @type {string | null} */ (null));
    const [listState, setListState] = useState(
        /** @type {{ address: string, rows: any[] | null, error: string | null } | null} */ (null),
    );
    const [reload, setReload] = useState(0);
    // The standard filter's search text (token or delegate).
    const [query, setQuery] = useState('');

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

    // Seeded from Governance polls; Clear acts on this network. Opened from
    // the menu, it is the first voting network this wallet has an address on.
    const chainId = initialChainId
        || governanceChains.find((cid) => (wallet?.byChain?.[cid] || []).length > 0)
        || governanceChains[0];
    const addresses = wallet ? (wallet.byChain[chainId] || []) : null;
    const defaultId = addresses ? preferredSourceId(addresses, wallet?.active?.[chainId]) : null;
    // The active address on this network.
    const address = useMemo(
        () => (addresses ? addresses.find((a) => a.id === defaultId)?.address || null : null),
        [addresses, defaultId],
    );

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

    // Title bar: the standard filter, only a search box (token or a pasted or
    // partial delegate address, operator 2026-11-13), left of the Delegate
    // votes plus; the page body is only the list.
    const filterMenu = address ? (
        <ListFilterMenu
            query={query}
            onQueryChange={setQuery}
            label={t('governance.delegations.filter')}
            searchPlaceholder={t('governance.delegations.searchPlaceholder')}
            searchLabel={t('governance.delegations.searchLabel')}
        />
    ) : null;
    const header = (
        <PageHeader
            onBack={onBack}
            title={t('governance.delegations.title')}
            trailing={filterMenu || onDelegate ? (
                <>
                    {filterMenu}
                    {onDelegate ? (
                        <Button
                            variant="secondary"
                            icon={<Icon.PlusIcon />}
                            onClick={() => onDelegate(chainId)}
                            aria-label={t('governance.delegateVotes')}
                            title={t('governance.delegateVotes')}
                        >
                            {null}
                        </Button>
                    ) : null}
                </>
            ) : null}
        />
    );
    const wrap = (children) => <Screen variant={variant} header={header}>{children}</Screen>;

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
    const allRows = current?.rows ?? null;
    // Search matches the token and the delegate address.
    const q = query.trim().toLowerCase();
    const rows = allRows && q
        ? allRows.filter((row) => [row.tick, row.delegate].some((v) => String(v || '').toLowerCase().includes(q)))
        : allRows;
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
            {rows && rows.length === 0 ? (
                allRows.length > 0 ? (
                    <EmptyState title={t('governance.delegations.noMatch.title')} body={t('governance.delegations.noMatch.body')} />
                ) : (
                    <EmptyState title={t('governance.delegations.empty.title')} body={t('governance.delegations.empty.body')} />
                )
            ) : null}
            {rows && rows.length > 0 ? (
                /* Safari needs an explicit list role because this class removes list styling. */
                <ul className={local.pollList} role="list" aria-label={t('governance.delegations.title')}>
                    {rows.map((row) => {
                        const tick = String(row.tick || '');
                        const delegate = String(row.delegate || '');
                        return (
                            <li key={`${tick}:${String(row.action_index ?? delegate)}`}>
                                <ListRow
                                    /* The token's icon with its network pip, as in the token picker (operator 2026-11-13). */
                                    leading={<span aria-hidden="true"><TickerIcon chainId={chainId} tick={tick} /></span>}
                                    title={tick}
                                    /* Only the delegate's address, in full when it fits (G99); no "since"
                                       line (operator 2026-11-13). */
                                    subtitle={<AddressText address={delegate} fit />}
                                    /* The whole row opens Clear vote delegation; a chevron, no ✕ (operator 2026-11-13). */
                                    chevron
                                    tooltip={t('governance.delegations.clearLabel', { tick })}
                                    onClick={() => onClear(chainId, { tick, delegate, address })}
                                />
                            </li>
                        );
                    })}
                </ul>
            ) : null}
        </ListPage>,
    );
}
