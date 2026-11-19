// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// TokenListsSection: Settings, Appearance, Tokens (2026-11-14).
//
// One list page for the three token lists the wallet keeps: Watched (kept in
// Balances even at zero), Pinned (first in Balances) and Hidden (collapsed).
// Framed icon tabs choose the list; the tabs carry no counts. A row is the
// wallet's own token row and opens that token's page, whose Actions list
// holds Stop watching, Pin to top and Hide. The plus in the header opens the
// Add Watched Token page.

import { useMemo, useState } from 'react';
import {
    Button,
    EmptyState,
    Icon,
    ListPage,
    ListRow,
    PageHeader,
    Screen,
    SegmentedControl,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { AssetMark } from '../../../ui/AssetMark.jsx';
import { useSettings } from '../../hooks/useSettings.js';
import { useSupportedChains } from '../../hooks/useSupportedChains.js';
import { ListFilterMenu } from '../ListFilterMenu.jsx';
import { pinnedTokensForWallet } from '../../../schemas/settings.js';
import { readActiveWallet } from '../../utils/activeWalletMemory.js';
import { SettingsLoadError, Status } from './_settingsPrimitives.jsx';
import styles from './TokenListsSection.module.css';
import { t } from '../../../i18n/index.js';
import '../../../i18n/locales/en/home.js';
import '../../../i18n/locales/en/routes.js';
import '../../../i18n/locales/en/settings.js';

const chainRegistry = registryLib.defaultRegistry();

export const ADD_WATCHED_TOKEN_PAGE_ID = 'display-tokens-add';

/** Splits a stored `chainId:tick` key into the parts a row shows. */
export function describeTokenKey(storedKey, chains = []) {
    const tokenKey = String(storedKey);
    const separator = tokenKey.lastIndexOf(':');
    const chainId = separator >= 0 ? tokenKey.slice(0, separator) : '';
    const tick = separator >= 0 ? tokenKey.slice(separator + 1) : tokenKey;
    const descriptor = chains.find((chain) => chain.id === chainId) || chainRegistry.get(chainId);
    const network = descriptor?.displayName
        || chainId.replace(/-(?:mainnet|testnet|regtest)$/i, '');
    return {
        key: tokenKey,
        chainId,
        tick,
        network,
        isNative: Boolean(descriptor?.coin) && descriptor.coin === tick,
    };
}

const TABS = ['watched', 'pinned', 'hidden'];

/**
 * @param {object} props
 * @param {boolean} [props.nested]
 * @param {() => void} [props.onBack]
 * @param {string} [props.backLabel]
 * @param {string} [props.variant]
 * @param {(token: { chainId: string, tick: string, kind: string }) => void} [props.onOpenToken]  opens the token's own page
 * @param {(pageId: string) => void} [props.onOpenPage]   opens a Settings page by id (the plus)
 */
export function TokenListsSection({ nested = false, onBack, backLabel, variant, onOpenToken, onOpenPage }) {
    const { settings, loading, error, update } = useSettings({ reportsOwnError: true });
    const chains = useSupportedChains();
    const [tab, setTab] = useState('watched');
    const [query, setQuery] = useState('');
    const [saveFailed, setSaveFailed] = useState(false);

    const walletId = readActiveWallet();
    const watched = Array.isArray(settings?.watchedTokens) ? settings.watchedTokens : [];
    const hidden = Array.isArray(settings?.hiddenTokens) ? settings.hiddenTokens : [];
    const pinned = settings
        ? (walletId ? pinnedTokensForWallet(settings, walletId) : (Array.isArray(settings.pinnedTokens) ? settings.pinnedTokens : []))
        : [];
    const lists = { watched, pinned, hidden };

    const needle = query.trim().toLowerCase();
    const shown = useMemo(() => {
        const keys = lists[tab] || [];
        if (!needle) return keys;
        return keys.filter((key) => {
            const info = describeTokenKey(key, chains);
            return [key, info.tick, info.network].some((value) => String(value || '').toLowerCase().includes(needle));
        });
    }, [tab, needle, watched, pinned, hidden, chains]);

    const unhideAll = () => {
        if (hidden.length === 0) return;
        setSaveFailed(false);
        Promise.resolve(update({ hiddenTokens: [] })).catch(() => setSaveFailed(true));
    };

    const tabLabels = {
        watched: [Icon.EyeIcon, t('settings.display.tabWatched')],
        pinned: [null, t('settings.display.tabPinned')],
        hidden: [Icon.EyeOffIcon, t('routes.addressList.hidden')],
    };
    const emptyText = {
        watched: [t('settings.display.noWatchedTokens'), t('settings.display.tapThePlusToWatch')],
        pinned: [t('settings.display.noPinnedTokens'), t('settings.display.pinFromATokenPage')],
        hidden: [t('settings.display.noHiddenTokens'), t('settings.display.hideFromATokenPage')],
    };

    const header = (
        <PageHeader
            nested={nested}
            onBack={onBack}
            backLabel={backLabel}
            title={t('home.tabs.tokens')}
            trailing={settings ? (
                <>
                    <ListFilterMenu
                        query={query}
                        onQueryChange={setQuery}
                        label={t('settings.display.filterTokens')}
                        searchPlaceholder={t('settings.display.searchTokenLists')}
                        searchLabel={t('settings.display.searchTokenListsLabel')}
                    />
                    {typeof onOpenPage === 'function' ? (
                        <Button
                            type="button"
                            variant="secondary"
                            icon={<Icon.PlusIcon />}
                            aria-label={t('settings.display.addWatchedToken')}
                            title={t('settings.display.addWatchedToken')}
                            onClick={() => onOpenPage(ADD_WATCHED_TOKEN_PAGE_ID)}
                        >
                            {null}
                        </Button>
                    ) : null}
                </>
            ) : null}
        />
    );

    let body;
    if (loading) body = <Status text={t('common.loading')} />;
    else if (error) body = <SettingsLoadError error={error} />;
    else if (!settings) body = <Status text={t('common.settingsUnavailable')} tone="error" />;
    else {
        const [emptyTitle, emptyBody] = emptyText[tab];
        const unhideRow = tab === 'hidden' && hidden.length > 0 ? (
            <li data-token-action="unhide-all">
                <ListRow
                    type="button"
                    leading={<span className={styles.actionIcon} aria-hidden="true"><Icon.EyeIcon /></span>}
                    title={t('settings.display.unhideAll')}
                    onClick={unhideAll}
                />
            </li>
        ) : null;
        body = (
            <ListPage>
                {saveFailed ? <Status text={t('settings.display.couldNotSaveTokenLists')} tone="error" /> : null}
                <SegmentedControl
                    aria-label={t('settings.display.tokenListTabs')}
                    value={tab}
                    onChange={setTab}
                    items={TABS.map((id) => {
                        const [TabIcon, label] = tabLabels[id];
                        return {
                            id,
                            label: (
                                <>
                                    {TabIcon ? <TabIcon aria-hidden="true" /> : <span aria-hidden="true">★</span>}
                                    <span>{label}</span>
                                </>
                            ),
                        };
                    })}
                />
                {(lists[tab] || []).length === 0 ? (
                    <EmptyState title={emptyTitle} titleAs="p" body={emptyBody} />
                ) : shown.length === 0 ? (
                    <EmptyState
                        title={t('home.tabs.noMatchingTokens')}
                        titleAs="p"
                        body={t('settings.display.noTokensMatch', { value: query.trim() })}
                    />
                ) : (
                    <ul className={styles.list} aria-label={tabLabels[tab][1]} data-token-list={tab}>
                        {shown.map((storedKey) => {
                            const info = describeTokenKey(storedKey, chains);
                            const clickable = typeof onOpenToken === 'function' && info.chainId;
                            return (
                                <li key={storedKey} data-token-key={storedKey}>
                                    <ListRow
                                        leading={<AssetMark chainId={info.chainId} tick={info.tick} isNative={info.isNative} />}
                                        title={info.tick}
                                        subtitle={<span className={styles.subtitle}>{info.network}</span>}
                                        chevron={Boolean(clickable)}
                                        aria-label={clickable ? t('settings.display.openToken', { tick: info.tick, network: info.network }) : undefined}
                                        onClick={clickable
                                            ? () => onOpenToken({ chainId: info.chainId, tick: info.tick, kind: info.isNative ? 'native' : 'token' })
                                            : undefined}
                                    />
                                </li>
                            );
                        })}
                        {unhideRow}
                    </ul>
                )}
                {shown.length === 0 && unhideRow ? (
                    <ul className={styles.list} aria-label={t('settings.display.unhideAll')}>{unhideRow}</ul>
                ) : null}
            </ListPage>
        );
    }

    return (
        <Screen variant={variant} header={header} scrollKey={`tokens-${tab}`} restoreScroll={false}>
            {body}
        </Screen>
    );
}
