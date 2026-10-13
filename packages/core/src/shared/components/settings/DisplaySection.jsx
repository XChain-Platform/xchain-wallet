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

import { useCallback, useState } from 'react';
import { Button, Icon } from '@xchain-wallet/core/ui';
import { useSettings } from '../../hooks/useSettings.js';
import {
    NUMBER_FORMAT_DEFAULT,
    SMALL_BALANCE_THRESHOLD_DEFAULT,
} from '../../../schemas/settings.js';
import { clearAllChainFilters } from '../../utils/chainFilterMemory.js';
import { ROW, ROW_HINT, ROW_LABEL, SELECT, STACK, SettingsLoadError, Status, ToggleRow } from './_settingsPrimitives.jsx';

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
    const { settings, loading, error, update } = useSettings();
    // Cluster O FOLLOWUP 3: show a brief confirmation after a
    // filter-reset run so the click doesn't feel inert.
    const [resetMessage, setResetMessage] = useState(/** @type {string | null} */ (null));
    const [displayMessage, setDisplayMessage] = useState(/** @type {string | null} */ (null));

    const pinned = Array.isArray(settings?.pinnedTokens) ? settings.pinnedTokens : [];
    const hidden = Array.isArray(settings?.hiddenTokens) ? settings.hiddenTokens : [];

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
    const resetDisplay = () => {
        setDisplayMessage(null);
        update({
            pinnedTokens: [],
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

            <h3 style={SECTION_HEADER}>Pinned tokens ({pinned.length})</h3>
            <p style={SECTION_HINT}>
                Pinned tokens float to the top of every balance tab in this order. Use ↑ / ↓ to reorder, ✕ to unpin.
            </p>
            {pinned.length === 0 ? (
                <div style={ROW}>
                    <span style={EMPTY_HINT}>No pinned tokens. Tap the star on a balance row to pin it.</span>
                </div>
            ) : (
                pinned.map((key, idx) => (
                    <div key={key} style={ROW}>
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
                ))
            )}

            <h3 style={SECTION_HEADER}>Hidden tokens ({hidden.length})</h3>
            <p style={SECTION_HINT}>
                Hidden tokens collapse into the "Show N hidden" footer of each balance tab. Unhide individually or all at once.
            </p>
            {hidden.length === 0 ? (
                <div style={ROW}>
                    <span style={EMPTY_HINT}>No hidden tokens. Tap the hide affordance on a balance row to hide it.</span>
                </div>
            ) : (
                <>
                    {hidden.map((key) => (
                        <div key={key} style={ROW}>
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
                    <span style={ROW_HINT}>Restores balance display options and clears pinned, hidden, and saved list preferences.</span>
                    {displayMessage ? <span role="status" aria-live="polite" style={ROW_HINT}>{displayMessage}</span> : null}
                </div>
                <Button size="sm" variant="secondary" icon={null} onClick={resetDisplay}>
                    Reset to defaults
                </Button>
            </div>
        </div>
    );
}
