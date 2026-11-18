// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// CoSignerAccountList (§22, P4 passive co-signer, management UI).
//
// Lists the agent accounts this wallet co-signs for, newest first. Entry
// point to create a new account (the provision wizard) or open one for
// detail / policy edit / enable-disable.

import { userFacingMessage } from '../utils/userFacingMessage.js';
import { useEffect, useRef, useState } from 'react';
import {
    Screen,
    PageHeader,
    Button,
    ChainBadge,
    AddressText,
    EmptyState,
    Icon,
    ListPage,
    ListRow,
    StatusMessage,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { ListFilterMenu } from '../components/ListFilterMenu.jsx';
import {
    LIST_DETAIL_MIN_WIDTH,
    ListDetailSplit,
    listDetailStyles,
    useWideContent,
} from '../components/PanelSplit.jsx';
import { formatAtomicAmount, formatTokenQuantity } from '../utils/amountFormat.js';
// Agents wear the same initials tile as wallets and accounts, stored by id.
import { IdentityAvatar } from '../components/WalletIdentity.jsx';
import { readWalletTile, tileRadius, walletTileText } from '../utils/walletTile.js';
import { TILE_TOPIC } from '../utils/recordChanges.js';
import { useRecordRevision } from '../hooks/useRecordRevision.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/coSigner.js';
import '../../i18n/locales/en/send.js';
import styles from './IssueTokenForm.module.css';
import listStyles from './CoSignerAccountList.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 * @param {() => void} props.onProvision              open the new-account wizard
 * @param {(accountId: string) => void} props.onOpen  open an account's detail
 * @param {string | null} [props.selectedAccountId]
 * @param {(accountId: string) => void} [props.onSelectAccount]
 * @param {(accountId: string) => import('react').ReactNode} [props.renderAccount]
 * @param {(accountId: string, page: { measureRef: (el: HTMLElement | null) => void }) => import('react').ReactNode} [props.renderAccountPage]
 */
/**
 * A balance row's amount for reading: the atomic quantity at its
 * divisibility, grouped, with trailing zeros dropped (0.4821, 12,000).
 *
 * @param {{ quantity: string, divisibility: number }} row
 * @returns {string}
 */
export function formatHolding(row) {
    const raw = String(row?.quantity ?? '');
    const scale = Number(row?.divisibility);
    if (!/^\d+$/.test(raw) || !Number.isInteger(scale) || scale <= 0) return formatAtomicAmount(raw, 0);
    const padded = raw.padStart(scale + 1, '0');
    return formatTokenQuantity(`${padded.slice(0, -scale)}.${padded.slice(-scale)}`, scale);
}

/**
 * One account's holdings as one line, "0.4821 BTC · 2 tokens", from the
 * balances read for every row at once.
 *
 * @param {Record<string, { balances: any, error: string | null }> | null} byId  null while loading
 * @param {string} accountId
 * @returns {string}
 */
export function balanceSummary(byId, accountId) {
    if (byId === null) return t('coSigner.balanceLoading');
    const entry = byId[accountId];
    const shape = entry && entry.balances;
    if (!shape || !shape.native) return t('send.balance.unknown');
    const native = `${formatHolding(shape.native)} ${shape.native.tick}`;
    const held = Array.isArray(shape.tokens) ? shape.tokens.filter((row) => row && row.quantity !== '0').length : 0;
    return held > 0 ? `${native} · ${t('coSigner.tokenCount', { count: held })}` : native;
}

export function CoSignerAccountList({
    walletId,
    onBack,
    onProvision,
    onOpen,
    selectedAccountId = null,
    onSelectAccount,
    renderAccount,
    renderAccountPage,
}) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const canSplit = typeof renderAccount === 'function';
    const [layoutRef, wideContent, measured] = useWideContent(LIST_DETAIL_MIN_WIDTH, canSplit);
    const twoPanel = canSplit && wideContent;
    const detailRoute = typeof renderAccountPage === 'function' && Boolean(selectedAccountId);
    const listShown = !detailRoute || (measured && twoPanel);

    const [accounts, setAccounts] = useState(/** @type {any[] | null} */ (null));
    const [error, setError] = useState(/** @type {string | null} */ (null));
    // Balances keyed by account id, from one read for every row; null while loading.
    const [balances, setBalances] = useState(/** @type {Record<string, any> | null} */ (null));
    // The standard filter's search text (G95).
    const [query, setQuery] = useState('');
    const [localPick, setLocalPick] = useState(/** @type {string | null} */ (null));

    // A write to an agent (rename, turn off, a new one) reads the rows again
    // in place, so the open detail beside them stays mounted.
    const accountsRevision = useRecordRevision('cosigner-accounts');
    // Edit look stores the tile on this device; the rows draw it on render.
    useRecordRevision(TILE_TOPIC);
    const readScope = useRef(/** @type {object | null} */ (null));

    useEffect(() => {
        if (!listShown) {
            readScope.current = null;
            return undefined;
        }
        let cancelled = false;
        const refresh = readScope.current?.walletId === walletId && readScope.current?.messaging === messaging;
        readScope.current = { walletId, messaging };
        if (!refresh) {
            setAccounts(null);
            setError(null);
        }
        Promise.resolve()
            .then(() => messaging.listCoSignerAccounts({ walletId }))
            .then((list) => {
                if (cancelled) return;
                setAccounts(Array.isArray(list) ? list : []);
                setError(null);
            })
            .catch((err) => {
                // A failed refresh keeps the rows already shown.
                if (!cancelled && !refresh) setError(userFacingMessage(err, 'Failed to load agent accounts.'));
            });
        return () => { cancelled = true; };
    }, [walletId, messaging, listShown, accountsRevision]);

    useEffect(() => {
        if (!listShown) return undefined;
        let cancelled = false;
        setBalances(null);
        // A shell without the balances route shows each row's balance as unavailable.
        Promise.resolve()
            .then(() => (typeof messaging.getCoSignerAccountBalances === 'function'
                ? messaging.getCoSignerAccountBalances({ walletId })
                : {}))
            .then((byId) => { if (!cancelled) setBalances(byId && typeof byId === 'object' ? byId : {}); })
            .catch(() => { if (!cancelled) setBalances({}); });
        return () => { cancelled = true; };
    }, [walletId, messaging, listShown]);

    // The filter (search) and a plus at the far right of the title line (G95).
    const header = (
        <PageHeader
            onBack={onBack}
            title="My Agents"
            trailing={(
                <>
                    <ListFilterMenu
                        query={query}
                        onQueryChange={setQuery}
                        label={t('coSigner.list.filter')}
                        searchPlaceholder={t('coSigner.list.searchPlaceholder')}
                        searchLabel={t('coSigner.list.searchLabel')}
                    />
                    <Button
                        variant="ghost"
                        size="sm"
                        icon={<Icon.PlusIcon />}
                        onClick={onProvision}
                        aria-label="New agent account"
                        title="New agent account"
                    />
                </>
            )}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            <div ref={layoutRef} className={listDetailStyles.layoutRoot} data-list-detail="list">
                {children}
            </div>
        </Screen>
    );
    const accountRows = accounts || [];
    const selectedExists = accountRows.some((account) => account.id === selectedAccountId);
    const localExists = accountRows.some((account) => account.id === localPick);
    const shownAccountId = twoPanel && accountRows.length > 0
        ? (localExists ? localPick : selectedExists ? selectedAccountId : accountRows[0].id)
        : null;
    const selectedAccount = accountRows.find((account) => account.id === shownAccountId) || null;

    useEffect(() => {
        if (shownAccountId && shownAccountId !== selectedAccountId) onSelectAccount?.(shownAccountId);
    }, [shownAccountId, selectedAccountId, onSelectAccount]);

    if (detailRoute && !(measured && twoPanel)) {
        if (!measured) {
            return (
                <Screen variant={variant} header={header}>
                    <div ref={layoutRef} className={listDetailStyles.layoutRoot} data-list-detail="measuring" />
                </Screen>
            );
        }
        return renderAccountPage(selectedAccountId, { measureRef: layoutRef });
    }

    if (error) return wrap(<ListPage><StatusMessage variant="error">{error}</StatusMessage></ListPage>);
    if (!accounts) return wrap(<ListPage><p className={styles.hint}>Loading…</p></ListPage>);

    // Search matches the name and the shared address, the text a row shows.
    const q = query.trim().toLowerCase();
    const shown = q
        ? accounts.filter((a) => [a.name, a.aggregateAddress].some((v) => String(v || '').toLowerCase().includes(q)))
        : accounts;

    const openAccount = (accountId) => {
        if (!twoPanel) {
            onOpen(accountId);
            return;
        }
        setLocalPick(accountId);
        onSelectAccount?.(accountId);
    };

    const list = (
        <ListPage>
            {accounts.length === 0 ? (
                <EmptyState
                    title="No agent accounts yet"
                    body="Create one to let an agent share a 2-of-2 address with this wallet."
                />
            ) : shown.length === 0 ? (
                <EmptyState title="No matching agent accounts" body="Try another name or address." />
            ) : (
                // One flush list card with divider lines, rows never boxed apart (U41, U58).
                /* Safari needs an explicit list role because this class removes list styling. */
                <ul aria-label="Agent accounts" className={listStyles.list} role="list" data-xc-split-list={twoPanel ? '' : undefined}>
                    {shown.map((a) => {
                        const descriptor = chainRegistry.get(a.chainId);
                        const tile = readWalletTile(a.id);
                        return (
                            <li key={a.id} data-selected={twoPanel && shownAccountId === a.id ? 'true' : undefined}>
                                <ListRow
                                    type="button"
                                    data-xc-split-row={twoPanel ? '' : undefined}
                                    onClick={() => openAccount(a.id)}
                                    aria-current={twoPanel && shownAccountId === a.id ? 'true' : undefined}
                                    // The initials tile, or the colour, shape and image Edit look saved.
                                    leading={(
                                        <span aria-hidden="true" data-agent-tile="" style={{ '--xc-avatar-shape': tileRadius(tile.shape), display: 'inline-flex' }}>
                                            <IdentityAvatar name={a.name || 'Agent'} text={walletTileText(a.name)} seed={a.id} context="list" variant="asset" tone={tile.colour} src={tile.image || null} />
                                        </span>
                                    )}
                                    title={a.name}
                                    chevron
                                    // Three lines by ruling: the name, what the account
                                    // holds, then the address in full when it fits (G99).
                                    // The scheme lives on the detail page. The network is
                                    // the trailing badge only (U12, G61).
                                    subtitle={(
                                        <>
                                            <span className={listStyles.rowFacts} data-testid="agent-balance">{balanceSummary(balances, a.id)}</span>
                                            <AddressText address={a.aggregateAddress} fit />
                                        </>
                                    )}
                                    trailing={(
                                        <span className={listStyles.rowTrailing}>
                                            {descriptor ? <ChainBadge descriptor={descriptor} size="sm" showName={false} /> : null}
                                            <span className={`${listStyles.statusPill} ${a.enabled ? listStyles.statusActive : ''}`}>
                                                {a.enabled ? 'Active' : 'Turned off'}
                                            </span>
                                        </span>
                                    )}
                                />
                            </li>
                        );
                    })}
                </ul>
            )}
        </ListPage>
    );

    if (twoPanel && selectedAccount) {
        return (
            <Screen variant={variant} header={header} bodyClassName={listDetailStyles.twoPanelBody}>
                <ListDetailSplit
                    measureRef={layoutRef}
                    storageKey="agents"
                    resizeLabel="Resize the agents list"
                    resizeHint="Drag to resize the agents list, or press Enter to reset."
                    layoutName="two-panel"
                    list={list}
                    listLabel="Agent accounts"
                    detail={renderAccount(shownAccountId)}
                    detailLabel={selectedAccount.name || 'Agent account'}
                />
            </Screen>
        );
    }

    return wrap(list);
}
