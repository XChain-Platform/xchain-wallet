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
import { Button, Icon } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useSettings } from '../../hooks/useSettings.js';
import { useSupportedChains } from '../../hooks/useSupportedChains.js';
import { useMessaging } from '../../useMessaging.js';
import { tickerReferenceError } from '../../utils/tickerGrammar.js';
import { useConfirmModal } from '../../hooks/useConfirmModal.js';
import { ConfirmModal } from '../ConfirmModal.jsx';
import {
    NUMBER_FORMAT_DEFAULT,
    SMALL_BALANCE_THRESHOLD_DEFAULT,
} from '../../../schemas/settings.js';
import { clearAllChainFilters } from '../../utils/chainFilterMemory.js';
import { INPUT, ROW, ROW_HINT, ROW_LABEL, SELECT, STACK, SettingsLoadError, Status, ToggleRow } from './_settingsPrimitives.jsx';

const chainRegistry = registryLib.defaultRegistry();
const SEARCH_DEBOUNCE_MS = 200;

const SECTION_HEADER = {
    fontSize: 'var(--xc-text-sm)',
    fontWeight: 600,
    color: 'var(--xc-text)',
    marginTop: 'var(--xc-space-3)',
    marginBottom: 'var(--xc-space-1)',
};
const SECTION_HINT = {
    color: 'var(--xc-text-muted)',
    fontSize: 'var(--xc-text-xs)',
    lineHeight: 1.3,
    marginBottom: 'var(--xc-space-2)',
};
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
const EMPTY_HINT = { ...ROW_LABEL, fontStyle: 'italic' };

export function DisplaySection() {
    const { messaging } = useMessaging();
    const { settings, loading, error, update } = useSettings();
    const chains = useSupportedChains();
    const confirmDialog = useConfirmModal();
    // Cluster O FOLLOWUP 3: show a brief confirmation after a
    // filter-reset run so the click doesn't feel inert.
    const [resetMessage, setResetMessage] = useState(/** @type {string | null} */ (null));
    const [displayMessage, setDisplayMessage] = useState(/** @type {string | null} */ (null));
    const [watchChainId, setWatchChainId] = useState(() => chains[0]?.id || '');
    const [watchTicker, setWatchTicker] = useState('');
    const [watchMessage, setWatchMessage] = useState(/** @type {string | null} */ (null));
    const [watching, setWatching] = useState(false);
    const [tokenQuery, setTokenQuery] = useState('');
    const [debouncedTokenQuery, setDebouncedTokenQuery] = useState('');
    const tokenSearchRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const tokenListsRef = useRef(/** @type {HTMLDivElement | null} */ (null));

    const pinned = Array.isArray(settings?.pinnedTokens) ? settings.pinnedTokens : [];
    const watched = Array.isArray(settings?.watchedTokens) ? settings.watchedTokens : [];
    const hidden = Array.isArray(settings?.hiddenTokens) ? settings.hiddenTokens : [];

    useEffect(() => {
        const handle = setTimeout(() => setDebouncedTokenQuery(tokenQuery), SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(handle);
    }, [tokenQuery]);

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
        try {
            await update({ pinnedTokens: next });
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error('display.pinnedTokens update failed:', err);
        }
    }, [update]);

    const writeHidden = useCallback(async (next) => {
        try {
            await update({ hiddenTokens: next });
        } catch (err) {
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
        setWatchMessage(null);
        const tick = watchTicker.trim();
        const grammarError = tickerReferenceError(tick, { allowRef: true });
        if (grammarError) {
            setWatchMessage(grammarError);
            return;
        }
        if (!watchChainId) {
            setWatchMessage('Choose a chain.');
            return;
        }
        const chain = chains.find((candidate) => candidate.id === watchChainId);
        const chainLabel = chain ? `${chain.displayName} (${chain.networkKind})` : watchChainId;
        const enteredKey = `${watchChainId}:${tick}`;
        if (watched.includes(enteredKey)) {
            setWatchMessage(`${tick} is already watched on ${chainLabel}.`);
            return;
        }
        if (typeof messaging?.getTokenInfo !== 'function') {
            setWatchMessage('Token lookup is unavailable in this app.');
            return;
        }
        setWatching(true);
        try {
            const info = await messaging.getTokenInfo({ chainId: watchChainId, tick, demo: false });
            const canonicalTick = typeof info?.canonicalTick === 'string'
                ? info.canonicalTick.trim()
                : '';
            if (!canonicalTick) {
                setWatchMessage(`Token "${tick}" was not found on ${chainLabel}.`);
                return;
            }
            const key = `${watchChainId}:${canonicalTick}`;
            if (watched.includes(key)) {
                setWatchMessage(`${canonicalTick} is already watched on ${chainLabel}.`);
                return;
            }
            await update({
                watchedTokens: [...watched, key],
                hiddenTokens: hidden.filter((candidate) => candidate !== key),
            });
            setWatchTicker('');
            setWatchMessage(`${canonicalTick} is now shown in balances.`);
        } catch {
            setWatchMessage(`Could not look up ${tick} on ${chainLabel}. Try again.`);
        } finally {
            setWatching(false);
        }
    }, [chains, hidden, messaging, update, watchChainId, watchTicker, watched]);

    const removeWatchedToken = useCallback((key) => {
        setWatchMessage(null);
        update({ watchedTokens: watched.filter((candidate) => candidate !== key) })
            .catch(() => setWatchMessage('Could not remove the watched token. Try again.'));
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
                ? 'No saved list filters to reset.'
                : `Reset ${count} saved list filter${count === 1 ? '' : 's'}. New filters apply on next visit.`,
        );
    }, []);

    if (loading) return <Status text="Loading…" />;
    if (error) return <SettingsLoadError error={error} />;
    if (!settings) return <Status text="Settings unavailable." tone="error" />;

    const showPinAffordance = settings?.showPinAffordance === true;
    const showHideAffordance = settings?.showHideAffordance === true;

    const setPinAffordance = (next) => {
        update({ showPinAffordance: !!next }).catch((err) => {
            // eslint-disable-next-line no-console
            console.error('display.showPinAffordance update failed:', err);
        });
    };
    const setHideAffordance = (next) => {
        update({ showHideAffordance: !!next }).catch((err) => {
            // eslint-disable-next-line no-console
            console.error('display.showHideAffordance update failed:', err);
        });
    };
    const updateDisplay = (patch) => {
        setDisplayMessage(null);
        update(patch).catch((err) => {
            // eslint-disable-next-line no-console
            console.error('display preference update failed:', err);
            setDisplayMessage('Could not save the display preference. Try again.');
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
        update({
            pinnedTokens: [],
            watchedTokens: [],
            hiddenTokens: [],
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
                setDisplayMessage('Could not reset display settings. Try again.');
            });
    };

    return (
        <div style={STACK}>
            <h3 style={SECTION_HEADER}>Balance display</h3>
            <ToggleRow
                label="Hide small balances"
                hint="Collapse balances below the selected threshold into an expandable section. Pinned and escrowed balances stay visible."
                checked={settings.privacy?.hideSmallBalances === true}
                onChange={(next) => updateDisplay({ privacy: { hideSmallBalances: next } })}
            />
            <div style={ROW}>
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                    <span style={{ color: 'var(--xc-text)', fontWeight: 500 }}>Small-balance threshold</span>
                    <span style={ROW_HINT}>Dust uses each network&apos;s relay limit and 0.0001 units for divisible tokens. Other choices apply in whole asset units.</span>
                </div>
                <select
                    aria-label="Small-balance threshold"
                    value={settings.smallBalanceThreshold || SMALL_BALANCE_THRESHOLD_DEFAULT}
                    onChange={(e) => updateDisplay({ smallBalanceThreshold: e.target.value })}
                    style={SELECT}
                >
                    <option value="dust">Network dust (recommended)</option>
                    <option value="0.0001">Less than 0.0001</option>
                    <option value="0.01">Less than 0.01</option>
                    <option value="1">Less than 1</option>
                </select>
            </div>
            <div style={ROW}>
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                    <span style={{ color: 'var(--xc-text)', fontWeight: 500 }}>Balance number format</span>
                    <span style={ROW_HINT}>Formatting changes display only. Stored and submitted amounts keep their exact value.</span>
                </div>
                <select
                    aria-label="Balance number format"
                    value={settings.numberFormat || NUMBER_FORMAT_DEFAULT}
                    onChange={(e) => updateDisplay({ numberFormat: e.target.value })}
                    style={SELECT}
                >
                    <option value="full">1,234.50000000</option>
                    <option value="trim">1,234.5</option>
                    <option value="plain">1234.50000000</option>
                </select>
            </div>

            <h3 style={SECTION_HEADER}>Row affordances</h3>
            <p style={SECTION_HINT}>
                Whether each balance row shows a quick pin / hide button. Off by default to keep rows clean. Your existing pinned and hidden tokens still apply either way and can be managed below.
            </p>
            <ToggleRow
                label="Show pin button on rows"
                hint="Display a star on each balance row to pin / unpin the token from Home."
                checked={showPinAffordance}
                onChange={setPinAffordance}
            />
            <ToggleRow
                label="Show hide button on rows"
                hint="Display a hide affordance on each balance row to collapse the token into the Hidden section."
                checked={showHideAffordance}
                onChange={setHideAffordance}
            />

            <h3 style={SECTION_HEADER}>Watched tokens ({watched.length})</h3>
            <p style={SECTION_HINT}>
                Add a token by chain and ticker to keep it in Balances even when its balance is zero.
            </p>
            <form style={ROW} onSubmit={addWatchedToken}>
                <select
                    aria-label="Token chain"
                    value={watchChainId}
                    onChange={(event) => setWatchChainId(event.target.value)}
                    style={SELECT}
                >
                    {chains.map((chain) => (
                        <option key={chain.id} value={chain.id}>
                            {chain.displayName} ({chain.networkKind})
                        </option>
                    ))}
                </select>
                <input
                    aria-label="Token ticker"
                    value={watchTicker}
                    onChange={(event) => setWatchTicker(event.target.value)}
                    placeholder="Ticker"
                    autoComplete="off"
                    style={{ ...INPUT, flex: 1, minWidth: 120 }}
                />
                <Button type="submit" size="sm" variant="secondary" icon={null} disabled={watching}>
                    {watching ? 'Checking…' : 'Watch token'}
                </Button>
            </form>
            {watchMessage ? <span role="status" aria-live="polite" style={ROW_HINT}>{watchMessage}</span> : null}
            {watched.map((key) => (
                <div key={key} style={ROW}>
                    <span style={KEY_TEXT} title={key}>{key}</span>
                    <Button
                        size="sm"
                        variant="ghost"
                        icon={null}
                        onClick={() => removeWatchedToken(key)}
                        aria-label={`Remove watched token ${key}`}
                    >
                        Remove
                    </Button>
                </div>
            ))}

            {(pinned.length > 0 || hidden.length > 0) ? (
                <div style={{ display: 'flex', gap: 'var(--xc-space-1)' }}>
                    <input
                        ref={tokenSearchRef}
                        type="search"
                        value={tokenQuery}
                        onChange={(event) => setTokenQuery(event.target.value)}
                        onKeyDown={handleTokenSearchKeyDown}
                        placeholder="Search token lists"
                        aria-label="Search pinned and hidden tokens"
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                        style={{ ...INPUT, flex: 1, minWidth: 0 }}
                    />
                    {tokenQuery ? (
                        <Button size="sm" variant="ghost" icon={null} onClick={clearTokenSearch} aria-label="Clear settings token search">
                            <Icon.XIcon />
                        </Button>
                    ) : null}
                </div>
            ) : null}

            <div ref={tokenListsRef} style={{ display: 'contents' }}>
                <h3 style={SECTION_HEADER}>Pinned tokens ({pinned.length})</h3>
                <p style={SECTION_HINT}>
                    Pinned tokens float to the top of every balance tab in this order. Use ↑ / ↓ to reorder, ✕ to unpin.
                </p>
                {pinned.length === 0 ? (
                    <div style={ROW}>
                        <span style={EMPTY_HINT}>No pinned tokens. Tap the star on a balance row to pin it.</span>
                    </div>
                ) : filteredPinned.length === 0 ? (
                    <div style={ROW} role="status">
                        <span style={EMPTY_HINT}>No pinned tokens match "{debouncedTokenQuery.trim()}".</span>
                    </div>
                ) : (
                    filteredPinned.map((key) => {
                        const idx = pinned.indexOf(key);
                        return (
                            <div key={key} style={ROW} data-token-setting-result="true">
                                <span style={KEY_TEXT} title={key}>{key}</span>
                                <div style={ACTIONS}>
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        icon={null}
                                        onClick={() => movePin(idx, -1)}
                                        disabled={idx === 0}
                                        aria-label={`Move ${key} up`}
                                    >
                                        ↑
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        icon={null}
                                        onClick={() => movePin(idx, 1)}
                                        disabled={idx === pinned.length - 1}
                                        aria-label={`Move ${key} down`}
                                    >
                                        ↓
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        icon={null}
                                        onClick={() => unpin(key)}
                                        aria-label={`Unpin ${key}`}
                                    >
                                        <Icon.XIcon />
                                    </Button>
                                </div>
                            </div>
                        );
                    })
                )}

                <h3 style={SECTION_HEADER}>Hidden tokens ({hidden.length})</h3>
                <p style={SECTION_HINT}>
                    Hidden tokens collapse into the "Show N hidden" footer of each balance tab. Unhide individually or all at once.
                </p>
                {hidden.length === 0 ? (
                    <div style={ROW}>
                        <span style={EMPTY_HINT}>No hidden tokens. Tap the hide affordance on a balance row to hide it.</span>
                    </div>
                ) : filteredHidden.length === 0 ? (
                    <div style={ROW} role="status">
                        <span style={EMPTY_HINT}>No hidden tokens match "{debouncedTokenQuery.trim()}".</span>
                    </div>
                ) : (
                    <>
                        {filteredHidden.map((key) => (
                            <div key={key} style={ROW} data-token-setting-result="true">
                                <span style={KEY_TEXT} title={key}>{key}</span>
                                <div style={ACTIONS}>
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        icon={null}
                                        onClick={() => unhide(key)}
                                        aria-label={`Unhide ${key}`}
                                    >
                                        Unhide
                                    </Button>
                                </div>
                            </div>
                        ))}
                        <div style={ROW}>
                            <span style={ROW_LABEL}>{hidden.length} hidden</span>
                            <Button size="sm" variant="secondary" icon={null} onClick={unhideAll}>
                                Unhide all
                            </Button>
                        </div>
                    </>
                )}
            </div>

            <h3 style={SECTION_HEADER}>List preferences</h3>
            <p style={SECTION_HINT}>
                Each balance and history list remembers the chain filter you last selected. Reset to start every list at "show all".
            </p>
            <div style={ROW}>
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                    <span style={ROW_LABEL}>Saved chain filters</span>
                    {resetMessage ? (
                        <span role="status" aria-live="polite" style={ROW_HINT}>{resetMessage}</span>
                    ) : null}
                </div>
                <Button size="sm" variant="secondary" icon={null} onClick={resetChainFilters}>
                    Reset list preferences
                </Button>
            </div>

            <h3 style={SECTION_HEADER}>Defaults</h3>
            <div style={ROW}>
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                    <span style={ROW_LABEL}>Reset display settings</span>
                    <span style={ROW_HINT}>Restores balance display options and clears watched, pinned, hidden, and saved list preferences.</span>
                    {displayMessage ? <span role="status" aria-live="polite" style={ROW_HINT}>{displayMessage}</span> : null}
                </div>
                <Button size="sm" variant="secondary" icon={null} onClick={resetDisplay}>
                    Reset to defaults
                </Button>
            </div>
            {confirmDialog.request ? (
                <ConfirmModal
                    {...confirmDialog.request}
                    onConfirm={confirmDialog.onConfirm}
                    onCancel={confirmDialog.onCancel}
                />
            ) : null}
        </div>
    );
}
