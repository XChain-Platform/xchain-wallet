// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// DisplaySection: §27.3 / §27.4 / Cluster I FOLLOWUP 1.
//
// Pinned / hidden token management. Pinned tokens float to the top of
// the balance list in the array's order; hidden tokens collapse into
// each tab's "Show N hidden" footer. Until this panel landed, the
// only way to manage either list was the per-row star / hide affordance
// on Home. There was no surface to see the whole list at a glance,
// reorder pinned tokens, or bulk-unhide.
//
// MVP scope (per FOLLOWUPS.md note "drag-reorder is non-trivial; an
// MVP without reorder still closes the gap"): up / down buttons rather
// than drag handles. Bulk "Unhide all" + per-row Unpin / Unhide.
// Token keys render as `chainId:tick`, sufficient to identify a row
// without a separate `messaging.getTokenInfo` round-trip.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Button,
    EmptyState,
    FormPage,
    FormSection,
    Icon,
    Input,
    Select,
    StatusMessage,
    Switch,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useSettings } from '../../hooks/useSettings.js';
import { useSupportedChains } from '../../hooks/useSupportedChains.js';
import { useMessaging } from '../../useMessaging.js';
import { tickerReferenceError } from '../../utils/tickerGrammar.js';
import { useConfirmModal } from '../../hooks/useConfirmModal.js';
import { ConfirmModal } from '../ConfirmModal.jsx';
import layoutStyles from './DisplaySection.module.css';
import {
    NUMBER_FORMAT_DEFAULT,
    SMALL_BALANCE_THRESHOLD_DEFAULT,
    pinnedTokensForWallet,
    pinnedTokensPatchForWallet,
} from '../../../schemas/settings.js';
import { clearAllChainFilters } from '../../utils/chainFilterMemory.js';
import { readActiveWallet } from '../../utils/activeWalletMemory.js';
import { ROW, ROW_COPY, ROW_HINT, ROW_LABEL, SettingsLoadError, Status } from './_settingsPrimitives.jsx';
import { t } from '../../../i18n/index.js';
import '../../../i18n/locales/en/issue.js';
import '../../../i18n/locales/en/settings.js';

const chainRegistry = registryLib.defaultRegistry();
const SEARCH_DEBOUNCE_MS = 200;

function tokenDisplayName(key, chains) {
    const tokenKey = String(key);
    const separator = tokenKey.lastIndexOf(':');
    if (separator < 0) return tokenKey;
    const chainId = tokenKey.slice(0, separator);
    const ticker = tokenKey.slice(separator + 1);
    const descriptor = chains.find((chain) => chain.id === chainId) || chainRegistry.get(chainId);
    const chainName = descriptor?.displayName
        || chainId.replace(/-(?:mainnet|testnet|regtest)$/i, '');
    return `${chainName}:${ticker}`;
}

const KEY_TEXT = {
    color: 'var(--xc-text)',
    fontFamily: 'var(--xc-font-mono, monospace)',
    fontSize: 'var(--xc-text-xs)',
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
};
const ACTIONS = {
    display: 'flex',
    gap: 'var(--xc-space-1)',
    flexShrink: 0,
};
export function DisplaySection() {
    const { messaging } = useMessaging();
    const { settings, loading, error, update } = useSettings();
    const chains = useSupportedChains();
    const confirmDialog = useConfirmModal();
    // Cluster O FOLLOWUP 3: show a brief confirmation after a
    // filter-reset run so the click doesn't feel inert.
    const [resetMessage, setResetMessage] = useState(/** @type {{ text: string, variant: 'info' | 'success' } | null} */ (null));
    const [displayMessage, setDisplayMessage] = useState(/** @type {string | null} */ (null));
    const [saveError, setSaveError] = useState(/** @type {{ key: string, message: string } | null} */ (null));
    const [watchChainId, setWatchChainId] = useState(() => chains[0]?.id || '');
    const [watchTicker, setWatchTicker] = useState('');
    const [watchMessage, setWatchMessage] = useState(/** @type {{ text: string, variant: 'info' | 'success' | 'error' } | null} */ (null));
    const [watching, setWatching] = useState(false);
    const [tokenQuery, setTokenQuery] = useState('');
    const [debouncedTokenQuery, setDebouncedTokenQuery] = useState('');
    const tokenSearchRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const tokenListsRef = useRef(/** @type {HTMLDivElement | null} */ (null));
    const watchRequestRef = useRef(0);

    const walletId = readActiveWallet();
    const legacyPinned = Array.isArray(settings?.pinnedTokens) ? settings.pinnedTokens : [];
    const pinned = walletId ? pinnedTokensForWallet(settings, walletId) : legacyPinned;
    const watched = Array.isArray(settings?.watchedTokens) ? settings.watchedTokens : [];
    const hidden = Array.isArray(settings?.hiddenTokens) ? settings.hiddenTokens : [];

    useEffect(() => {
        const handle = setTimeout(() => setDebouncedTokenQuery(tokenQuery), SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(handle);
    }, [tokenQuery]);

    useEffect(() => () => { watchRequestRef.current += 1; }, []);

    const tokenMatches = useCallback((key) => {
        const query = debouncedTokenQuery.trim().toLowerCase();
        if (!query) return true;
        const tokenKey = String(key);
        const separator = tokenKey.lastIndexOf(':');
        const chainId = separator >= 0 ? tokenKey.slice(0, separator) : '';
        const ticker = separator >= 0 ? tokenKey.slice(separator + 1) : tokenKey;
        const descriptor = chainRegistry.get(chainId);
        return [tokenKey, ticker, descriptor?.displayName, descriptor?.coin]
            .some((value) => String(value || '').toLowerCase().includes(query));
    }, [debouncedTokenQuery]);
    const filteredPinned = useMemo(() => pinned.filter(tokenMatches), [pinned, tokenMatches]);
    const filteredHidden = useMemo(() => hidden.filter(tokenMatches), [hidden, tokenMatches]);

    const handleTokenSearchKeyDown = (event) => {
        if (event.key !== 'ArrowDown') return;
        const result = tokenListsRef.current?.querySelector('[data-token-setting-result="true"] button:not(:disabled)');
        if (!result) return;
        event.preventDefault();
        result.focus();
    };
    const clearTokenSearch = () => {
        setTokenQuery('');
        setDebouncedTokenQuery('');
        tokenSearchRef.current?.focus();
    };

    const writePinned = useCallback(async (next) => {
        setSaveError(null);
        try {
            if (walletId) await update(pinnedTokensPatchForWallet(walletId, next));
            else await update({ pinnedTokens: next });
        } catch (err) {
            setSaveError({ key: 'pinnedTokens', message: 'Could not save the pinned tokens. Try again.' });
            // eslint-disable-next-line no-console
            console.error('display.pinnedTokens update failed:', err);
        }
    }, [update, walletId]);

    const writeHidden = useCallback(async (next) => {
        setSaveError(null);
        try {
            await update({ hiddenTokens: next });
        } catch (err) {
            setSaveError({ key: 'hiddenTokens', message: 'Could not save the hidden tokens. Try again.' });
            // eslint-disable-next-line no-console
            console.error('display.hiddenTokens update failed:', err);
        }
    }, [update]);

    const movePin = useCallback((idx, delta) => {
        const next = pinned.slice();
        const target = idx + delta;
        if (target < 0 || target >= next.length) return;
        const [row] = next.splice(idx, 1);
        next.splice(target, 0, row);
        writePinned(next);
    }, [pinned, writePinned]);

    const unpin = useCallback((key) => {
        writePinned(pinned.filter((k) => k !== key));
    }, [pinned, writePinned]);

    const unhide = useCallback((key) => {
        writeHidden(hidden.filter((k) => k !== key));
    }, [hidden, writeHidden]);

    const unhideAll = useCallback(() => {
        if (hidden.length === 0) return;
        writeHidden([]);
    }, [hidden, writeHidden]);

    const addWatchedToken = useCallback(async (event) => {
        event.preventDefault();
        const request = ++watchRequestRef.current;
        setWatchMessage(null);
        const tick = watchTicker.trim();
        const grammarError = tickerReferenceError(tick, { allowRef: true });
        if (grammarError) {
            setWatchMessage({ text: grammarError, variant: 'error' });
            return;
        }
        if (!watchChainId) {
            setWatchMessage({ text: 'Choose a network.', variant: 'error' });
            return;
        }
        const chain = chains.find((candidate) => candidate.id === watchChainId);
        const chainLabel = chain?.displayName || watchChainId;
        const enteredKey = `${watchChainId}:${tick}`;
        if (watched.includes(enteredKey)) {
            setWatchMessage({ text: `${tick} is already watched on ${chainLabel}.`, variant: 'info' });
            return;
        }
        if (typeof messaging?.getTokenInfo !== 'function') {
            setWatchMessage({ text: 'Token lookup is unavailable in this app.', variant: 'error' });
            return;
        }
        setWatching(true);
        try {
            const info = await messaging.getTokenInfo({ chainId: watchChainId, tick, demo: false });
            if (request !== watchRequestRef.current) return;
            const canonicalTick = typeof info?.canonicalTick === 'string'
                ? info.canonicalTick.trim()
                : '';
            if (!canonicalTick) {
                setWatchMessage({ text: `Token "${tick}" was not found on ${chainLabel}.`, variant: 'error' });
                return;
            }
            const key = `${watchChainId}:${canonicalTick}`;
            if (watched.includes(key)) {
                setWatchMessage({ text: `${canonicalTick} is already watched on ${chainLabel}.`, variant: 'info' });
                return;
            }
            await update({
                watchedTokens: [...watched, key],
                hiddenTokens: hidden.filter((candidate) => candidate !== key),
            });
            if (request !== watchRequestRef.current) return;
            setWatchTicker('');
            setWatchMessage({ text: `${canonicalTick} is now shown in balances.`, variant: 'success' });
        } catch {
            if (request === watchRequestRef.current) {
                setWatchMessage({ text: `Could not look up ${tick} on ${chainLabel}. Try again.`, variant: 'error' });
            }
        } finally {
            if (request === watchRequestRef.current) setWatching(false);
        }
    }, [chains, hidden, messaging, update, watchChainId, watchTicker, watched]);

    const removeWatchedToken = useCallback((key) => {
        setWatchMessage(null);
        update({ watchedTokens: watched.filter((candidate) => candidate !== key) })
            .catch(() => setWatchMessage({ text: 'Could not remove the watched token. Try again.', variant: 'error' }));
    }, [update, watched]);

    // Cluster O FOLLOWUP 3: reset all per-list chain-filter memory
    // entries. Affects History's enabledChains + the Home tab's coin-
    // family filter. Lives outside `update()` because the persistence
    // layer is localStorage, not vault settings (ephemeral UI prefs
    // that shouldn't survive a from-seed restore).
    const resetChainFilters = useCallback(() => {
        const count = clearAllChainFilters();
        setResetMessage(
            count === 0
                ? { text: t('settings.display.noFiltersToReset'), variant: 'info' }
                : { text: t('settings.display.resetFilters', { count }), variant: 'success' },
        );
    }, []);

    if (loading) return <Status text={t('common.loading')} />;
    if (error) return <SettingsLoadError error={error} />;
    if (!settings) return <Status text={t('common.settingsUnavailable')} tone="error" />;

    const showPinAffordance = settings?.showPinAffordance === true;
    const showHideAffordance = settings?.showHideAffordance === true;

    const setPinAffordance = (next) => {
        setSaveError(null);
        update({ showPinAffordance: !!next }).catch((err) => {
            setSaveError({ key: 'showPinAffordance', message: 'Could not save this display preference. Try again.' });
            // eslint-disable-next-line no-console
            console.error('display.showPinAffordance update failed:', err);
        });
    };
    const setHideAffordance = (next) => {
        setSaveError(null);
        update({ showHideAffordance: !!next }).catch((err) => {
            setSaveError({ key: 'showHideAffordance', message: 'Could not save this display preference. Try again.' });
            // eslint-disable-next-line no-console
            console.error('display.showHideAffordance update failed:', err);
        });
    };
    const updateDisplay = (key, patch) => {
        setDisplayMessage(null);
        setSaveError(null);
        update(patch).catch((err) => {
            // eslint-disable-next-line no-console
            console.error('display preference update failed:', err);
            setSaveError({ key, message: 'Could not save this display preference. Try again.' });
        });
    };
    const resetDisplay = async () => {
        const confirmed = await confirmDialog.confirm({
            title: 'Reset display settings?',
            message: 'This restores all balance display options and clears pinned tokens, hidden tokens, and saved list preferences. This cannot be undone.',
            confirmLabel: 'Reset settings',
            danger: true,
        });
        if (!confirmed) return;
        setDisplayMessage(null);
        setSaveError(null);
        update({
            pinnedTokens: [],
            pinnedTokensByWallet: {},
            watchedTokens: [],
            hiddenTokens: [],
            hideUnknownTokens: false,
            showPinAffordance: false,
            showHideAffordance: false,
            smallBalanceThreshold: SMALL_BALANCE_THRESHOLD_DEFAULT,
            numberFormat: NUMBER_FORMAT_DEFAULT,
            privacy: { hideSmallBalances: false },
        })
            .then(() => {
                clearAllChainFilters();
                setDisplayMessage('Display settings reset to defaults.');
            })
            .catch((err) => {
                // eslint-disable-next-line no-console
                console.error('display reset failed:', err);
                setSaveError({ key: 'reset', message: 'Could not reset display settings. Try again.' });
            });
    };

    return (
        <FormPage ref={tokenListsRef} as="div" sectioned fullWidth label={t('settings.display.displaySettings')}>
            <FormSection title={t('settings.display.balanceDisplay')}>
            <div style={ROW}>
                <Switch
                    label={t('settings.display.hideSmallBalances')}
                    description={t('settings.display.collapseBalancesBelowTheSelected')}
                    checked={settings.privacy?.hideSmallBalances === true}
                    onChange={(event) => updateDisplay('hideSmallBalances', { privacy: { hideSmallBalances: event.target.checked } })}
                />
            </div>
            <DisplaySaveError error={saveError} controlKey="hideSmallBalances" />
            <div style={ROW}>
                <Switch
                    label={t('settings.display.hideUnknownTokens')}
                    description={t('settings.display.collapseUnpricedTokensWithoutA')}
                    checked={settings.hideUnknownTokens === true}
                    onChange={(event) => updateDisplay('hideUnknownTokens', { hideUnknownTokens: event.target.checked })}
                />
            </div>
            <DisplaySaveError error={saveError} controlKey="hideUnknownTokens" />
            <div className={layoutStyles.fieldRow} style={{ ...ROW, display: 'grid' }}>
                <div style={ROW_COPY}>
                    <span style={{ color: 'var(--xc-text)', fontWeight: 500 }}>{t('settings.display.smallBalanceThreshold')}</span>
                    <span style={ROW_HINT}>{t('settings.display.useEachNetworkSRelay')}</span>
                </div>
                <Select
                    aria-label={t('settings.display.smallBalanceThreshold')}
                    value={settings.smallBalanceThreshold || SMALL_BALANCE_THRESHOLD_DEFAULT}
                    onChange={(e) => updateDisplay('smallBalanceThreshold', { smallBalanceThreshold: e.target.value })}
                >
                    {/* Native options remain because Select owns the listbox control, not its choices. */}
                    <option value="dust">{t('settings.display.networkDustRecommended')}</option>
                    <option value="0.0001">{t('settings.display.lessThan00001')}</option>
                    <option value="0.01">{t('settings.display.lessThan001')}</option>
                    <option value="1">{t('settings.display.lessThan1')}</option>
                </Select>
            </div>
            <DisplaySaveError error={saveError} controlKey="smallBalanceThreshold" />
            <div className={layoutStyles.fieldRow} style={{ ...ROW, display: 'grid' }}>
                <div style={ROW_COPY}>
                    <span style={{ color: 'var(--xc-text)', fontWeight: 500 }}>{t('settings.display.balanceNumberFormat')}</span>
                    <span style={ROW_HINT}>{t('settings.display.changeDisplayedFormattingWithoutChanging')}</span>
                </div>
                <Select
                    aria-label={t('settings.display.balanceNumberFormat')}
                    value={settings.numberFormat || NUMBER_FORMAT_DEFAULT}
                    onChange={(e) => updateDisplay('numberFormat', { numberFormat: e.target.value })}
                >
                    {/* Native options remain because Select owns the listbox control, not its choices. */}
                    <option value="full">1,234.50000000</option>
                    <option value="trim">1,234.5</option>
                    <option value="plain">1234.50000000</option>
                </Select>
            </div>
            <DisplaySaveError error={saveError} controlKey="numberFormat" />
            </FormSection>

            <FormSection
                title={t('settings.display.rowAffordances')}
            >
            <div style={ROW}>
                <Switch
                    label={t('settings.display.showPinButtonOnRows')}
                    description={t('settings.display.displayAStarOnEach')}
                    checked={showPinAffordance}
                    onChange={(event) => setPinAffordance(event.target.checked)}
                />
            </div>
            <DisplaySaveError error={saveError} controlKey="showPinAffordance" />
            <div style={ROW}>
                <Switch
                    label={t('settings.display.showHideButtonOnRows')}
                    description={t('settings.display.displayAHideAffordanceOn')}
                    checked={showHideAffordance}
                    onChange={(event) => setHideAffordance(event.target.checked)}
                />
            </div>
            <DisplaySaveError error={saveError} controlKey="showHideAffordance" />
            </FormSection>

            <FormSection
                title={t('settings.display.watchedTokens', { length: watched.length })}
                description={t('settings.display.addATokenByChain')}
            >
            <form className={layoutStyles.fieldRow} style={{ ...ROW, display: 'grid' }} onSubmit={addWatchedToken}>
                <div style={ROW_COPY}>
                    <span style={{ color: 'var(--xc-text)', fontWeight: 500 }}>{t('settings.display.tokenToWatch')}</span>
                </div>
                <div className={layoutStyles.watchControls}>
                    <Select
                        aria-label={t('settings.display.tokenChain')}
                        value={watchChainId}
                        onChange={(event) => {
                            watchRequestRef.current += 1;
                            setWatching(false);
                            setWatchChainId(event.target.value);
                        }}
                    >
                        {/* Native options remain because Select owns the listbox control, not its choices. */}
                        {chains.map((chain) => (
                            <option key={chain.id} value={chain.id}>
                                {chain.displayName}
                            </option>
                        ))}
                    </Select>
                    <Input
                        size="md"
                        aria-label={t('settings.display.tokenTicker')}
                        value={watchTicker}
                        onChange={(event) => {
                            watchRequestRef.current += 1;
                            setWatching(false);
                            setWatchTicker(event.target.value);
                        }}
                        placeholder={t('issue.ticker')}
                        autoComplete="off"
                    />
                    <Button type="submit" size="md" variant="secondary" icon={null} disabled={watching}>
                        {watching ? t('settings.backup.checking') : t('settings.display.watchToken')}
                    </Button>
                </div>
            </form>
            {watchMessage ? <StatusMessage variant={watchMessage.variant}>{watchMessage.text}</StatusMessage> : null}
            {watched.map((storedKey) => {
                const key = tokenDisplayName(storedKey, chains);
                return (
                    <div key={storedKey} style={ROW}>
                        <span style={KEY_TEXT} title={key}>{key}</span>
                        <Button
                            size="sm"
                            variant="ghost"
                            icon={null}
                            onClick={() => removeWatchedToken(storedKey)}
                            aria-label={t('settings.display.removeWatchedToken', { key })}
                        >
                            {t('send.recipient.remove')}
                        </Button>
                    </div>
                );
            })}
            </FormSection>

            <FormSection
                title={t('settings.display.pinnedTokens', { length: pinned.length })}
                description={t('settings.display.pinnedTokensFloatToThe')}
            >
            {(pinned.length > 0 || hidden.length > 0) ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--xc-space-1)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <Input
                            ref={tokenSearchRef}
                            size="md"
                            type="search"
                            value={tokenQuery}
                            onChange={(event) => setTokenQuery(event.target.value)}
                            onKeyDown={handleTokenSearchKeyDown}
                            placeholder={t('settings.display.searchTokenLists')}
                            aria-label={t('settings.display.searchPinnedAndHiddenTokens')}
                            autoComplete="off"
                            autoCorrect="off"
                            spellCheck={false}
                        />
                    </div>
                    {tokenQuery ? (
                        <Button size="md" variant="ghost" icon={null} onClick={clearTokenSearch} aria-label={t('settings.display.clearSettingsTokenSearch')}>
                            <Icon.XIcon />
                        </Button>
                    ) : null}
                </div>
            ) : null}

                <DisplaySaveError error={saveError} controlKey="pinnedTokens" />
                {pinned.length === 0 ? (
                    <EmptyState
                        title={t('settings.display.noPinnedTokens')}
                        titleAs="p"
                        body={t('settings.display.tapTheStarOnA')}
                    />
                ) : filteredPinned.length === 0 ? (
                    <EmptyState
                        title={t('settings.display.noMatchingPinnedTokens')}
                        titleAs="p"
                        body={t('settings.display.noPinnedTokensMatch', { value: debouncedTokenQuery.trim() })}
                    />
                ) : (
                    filteredPinned.map((storedKey) => {
                        const idx = pinned.indexOf(storedKey);
                        const key = tokenDisplayName(storedKey, chains);
                        return (
                            <div key={storedKey} style={ROW} data-token-setting-result="true">
                                <span style={KEY_TEXT} title={key}>{key}</span>
                                <div style={ACTIONS}>
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        icon={null}
                                        onClick={() => movePin(idx, -1)}
                                        disabled={idx === 0}
                                        aria-label={t('settings.display.moveUp', { key })}
                                    >
                                        ↑
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        icon={null}
                                        onClick={() => movePin(idx, 1)}
                                        disabled={idx === pinned.length - 1}
                                        aria-label={t('settings.display.moveDown', { key })}
                                    >
                                        ↓
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        icon={null}
                                        onClick={() => unpin(storedKey)}
                                        aria-label={t('settings.display.unpin', { key })}
                                    >
                                        <Icon.XIcon />
                                    </Button>
                                </div>
                            </div>
                        );
                    })
                )}
            </FormSection>

            <FormSection
                title={t('settings.display.hiddenTokens', { length: hidden.length })}
                description={t('settings.display.hiddenTokensCollapseIntoThe')}
            >
                <DisplaySaveError error={saveError} controlKey="hiddenTokens" />
                {hidden.length === 0 ? (
                    <EmptyState
                        title={t('settings.display.noHiddenTokens')}
                        titleAs="p"
                        body={t('settings.display.tapTheHideControlOn')}
                    />
                ) : filteredHidden.length === 0 ? (
                    <EmptyState
                        title={t('settings.display.noMatchingHiddenTokens')}
                        titleAs="p"
                        body={t('settings.display.noHiddenTokensMatch', { value: debouncedTokenQuery.trim() })}
                    />
                ) : (
                    <>
                        {filteredHidden.map((storedKey) => {
                            const key = tokenDisplayName(storedKey, chains);
                            return (
                                <div key={storedKey} style={ROW} data-token-setting-result="true">
                                    <span style={KEY_TEXT} title={key}>{key}</span>
                                    <div style={ACTIONS}>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            icon={null}
                                            onClick={() => unhide(storedKey)}
                                            aria-label={t('settings.display.unhide', { key })}
                                        >
                                            {t('settings.display.unhide2')}
                                        </Button>
                                    </div>
                                </div>
                            );
                        })}
                        <div style={ROW}>
                            <span style={ROW_LABEL}>{hidden.length} {t('settings.display.hidden')}</span>
                            <Button size="sm" variant="secondary" icon={null} onClick={unhideAll}>
                                {t('settings.display.unhideAll')}
                            </Button>
                        </div>
                    </>
                )}
            </FormSection>

            <FormSection
                title={t('settings.display.listPreferences')}
                description={t('settings.display.rememberTheLastSelectedChain')}
            >
            <div style={ROW}>
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                    <span style={ROW_LABEL}>{t('settings.display.savedChainFilters')}</span>
                </div>
                <Button size="sm" variant="secondary" icon={null} onClick={resetChainFilters}>
                    {t('settings.display.resetListPreferences')}
                </Button>
            </div>
            {/* Row results sit under the row at full width, like the other
                settings messages, not squeezed into the label column. */}
            {resetMessage ? (
                <StatusMessage variant={resetMessage.variant}>{resetMessage.text}</StatusMessage>
            ) : null}
            </FormSection>

            <FormSection title={t('settings.display.defaults')}>
            <div style={ROW}>
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                    <span style={ROW_LABEL}>{t('settings.display.resetDisplaySettings')}</span>
                    <span style={ROW_HINT}>{t('settings.display.restoresBalanceDisplayOptionsAnd')}</span>
                </div>
                <Button size="sm" variant="secondary" icon={null} onClick={resetDisplay}>
                    {t('settings.display.resetToDefaults')}
                </Button>
            </div>
            {displayMessage ? <StatusMessage variant="success">{displayMessage}</StatusMessage> : null}
            <DisplaySaveError error={saveError} controlKey="reset" />
            {confirmDialog.request ? (
                <ConfirmModal
                    {...confirmDialog.request}
                    onConfirm={confirmDialog.onConfirm}
                    onCancel={confirmDialog.onCancel}
                />
            ) : null}
            </FormSection>
        </FormPage>
    );
}

function DisplaySaveError({ error, controlKey }) {
    return error?.key === controlKey ? (
        <StatusMessage variant="error">{error.message}</StatusMessage>
    ) : null;
}
