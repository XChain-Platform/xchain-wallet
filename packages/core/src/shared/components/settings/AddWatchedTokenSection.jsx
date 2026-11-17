// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// AddWatchedTokenSection: the Add Watched Token page (2026-11-14), opened by
// the plus on Settings, Appearance, Tokens. One token search across every
// network; each result has a plus that watches it, or a "Watching" label when
// it is already watched. A watched token stays in Balances even at zero.

import { useEffect, useRef, useState } from 'react';
import { Button, EmptyState, Icon, Input, ListPage, ListRow } from '@xchain-wallet/core/ui';
import { AssetMark } from '../../../ui/AssetMark.jsx';
import { useSettings } from '../../hooks/useSettings.js';
import { useSupportedChains } from '../../hooks/useSupportedChains.js';
import { useMessaging } from '../../useMessaging.js';
import { describeTokenKey } from './TokenListsSection.jsx';
import { SettingsLoadError, Status } from './_settingsPrimitives.jsx';
import styles from './TokenListsSection.module.css';
import { t } from '../../../i18n/index.js';
import '../../../i18n/locales/en/settings.js';

const SEARCH_DEBOUNCE_MS = 250;
const MIN_QUERY_CHARS = 2;
const RESULTS_PER_NETWORK = 10;

export function AddWatchedTokenSection() {
    const { messaging } = useMessaging();
    const { settings, loading, error, update } = useSettings({ reportsOwnError: true });
    const chains = useSupportedChains();
    const [query, setQuery] = useState('');
    const [results, setResults] = useState(/** @type {Array<{ key: string, chainId: string, tick: string }>} */ ([]));
    const [busy, setBusy] = useState(false);
    const [searchFailed, setSearchFailed] = useState(false);
    const [saveFailed, setSaveFailed] = useState(false);
    const searchRef = useRef(0);

    const watched = Array.isArray(settings?.watchedTokens) ? settings.watchedTokens : [];
    const hidden = Array.isArray(settings?.hiddenTokens) ? settings.hiddenTokens : [];
    const chainKey = chains.map((chain) => chain.id).join(',');

    useEffect(() => {
        const text = query.trim().toUpperCase();
        const request = ++searchRef.current;
        setSearchFailed(false);
        if (text.length < MIN_QUERY_CHARS || typeof messaging?.searchTokens !== 'function') {
            setResults([]);
            setBusy(false);
            return undefined;
        }
        setBusy(true);
        const handle = setTimeout(async () => {
            const lookups = await Promise.all(chains.map(async (chain) => {
                try {
                    const hits = await messaging.searchTokens({ chainId: chain.id, query: text, limit: RESULTS_PER_NETWORK });
                    return { chainId: chain.id, hits: Array.isArray(hits) ? hits : [], failed: false };
                } catch {
                    return { chainId: chain.id, hits: [], failed: true };
                }
            }));
            if (request !== searchRef.current) return;
            const found = [];
            for (const { chainId, hits } of lookups) {
                for (const hit of hits) {
                    if (hit && typeof hit.tick === 'string' && hit.tick) {
                        found.push({ key: `${chainId}:${hit.tick}`, chainId, tick: hit.tick });
                    }
                }
            }
            setResults(found);
            setSearchFailed(lookups.some(({ failed }) => failed));
            setBusy(false);
        }, SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(handle);
        // chains is read through chainKey so a new array of the same networks does not search again.
    }, [query, messaging, chainKey]);

    const watch = (key) => {
        if (watched.includes(key)) return;
        setSaveFailed(false);
        Promise.resolve(update({
            watchedTokens: [...watched, key],
            hiddenTokens: hidden.filter((candidate) => candidate !== key),
        })).catch(() => setSaveFailed(true));
    };

    if (loading) return <Status text={t('common.loading')} />;
    if (error) return <SettingsLoadError error={error} />;
    if (!settings) return <Status text={t('common.settingsUnavailable')} tone="error" />;

    const typed = query.trim().length >= MIN_QUERY_CHARS;
    return (
        <ListPage>
            <Input
                size="md"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('settings.display.searchAllNetworks')}
                aria-label={t('settings.display.searchTokensToWatch')}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
            />
            {saveFailed ? <Status text={t('settings.display.couldNotSaveTokenLists')} tone="error" /> : null}
            {searchFailed ? <Status text={t('settings.display.couldNotSearchAll')} tone="error" /> : null}
            {busy ? <Status text={t('settings.display.searchingNetworks')} /> : null}
            {typed && !busy && results.length === 0 && !searchFailed ? (
                <EmptyState
                    title={t('settings.display.noTokensFound')}
                    titleAs="p"
                    body={t('settings.display.noTokensFoundBody', { value: query.trim() })}
                />
            ) : null}
            {results.length > 0 ? (
                <ul className={styles.list} aria-label={t('settings.page.searchResults')} data-token-search-results="true">
                    {results.map(({ key, chainId, tick }) => {
                        const info = describeTokenKey(key, chains);
                        const isWatched = watched.includes(key);
                        return (
                            <li key={key} data-token-key={key}>
                                <ListRow
                                    leading={<AssetMark chainId={chainId} tick={tick} isNative={info.isNative} />}
                                    title={tick}
                                    subtitle={<span className={styles.subtitle}>{`${tick}, ${info.network}`}</span>}
                                    trailing={isWatched ? (
                                        <span className={styles.watching}>{t('settings.display.watchingLabel')}</span>
                                    ) : (
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="secondary"
                                            icon={<Icon.PlusIcon />}
                                            aria-label={t('settings.display.watchTokenOn', { tick, network: info.network })}
                                            title={t('settings.display.watchToken')}
                                            onClick={() => watch(key)}
                                        >
                                            {null}
                                        </Button>
                                    )}
                                />
                            </li>
                        );
                    })}
                </ul>
            ) : null}
        </ListPage>
    );
}
