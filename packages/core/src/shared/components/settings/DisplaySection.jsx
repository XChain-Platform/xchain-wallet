// DisplaySection — §27.3 / §27.4 / Cluster I FOLLOWUP 1.
//
// Pinned / hidden token management. Pinned tokens float to the top of
// the balance list in the array's order; hidden tokens collapse into
// each tab's "Show N hidden" footer. Until this panel landed, the
// only way to manage either list was the per-row star / hide affordance
// on Home — there was no surface to see the whole list at a glance,
// reorder pinned tokens, or bulk-unhide.
//
// MVP scope (per FOLLOWUPS.md note "drag-reorder is non-trivial; an
// MVP without reorder still closes the gap"): up / down buttons rather
// than drag handles. Bulk "Unhide all" + per-row Unpin / Unhide.
// Token keys render as `chainId:tick` — sufficient to identify a row
// without a separate `messaging.getTokenInfo` round-trip.

import { useCallback, useState } from 'react';
import { Button, Icon } from '@xchain-wallet/core/ui';
import { useSettings } from '../../hooks/useSettings.js';
import { clearAllChainFilters } from '../../utils/chainFilterMemory.js';
import { ROW, ROW_HINT, ROW_LABEL, STACK, Status, ToggleRow } from './_settingsPrimitives.jsx';

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
    // Cluster O FOLLOWUP 3 — show a brief confirmation after a
    // filter-reset run so the click doesn't feel inert.
    const [resetMessage, setResetMessage] = useState(/** @type {string | null} */ (null));

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

    // Cluster O FOLLOWUP 3 — reset all per-list chain-filter memory
    // entries. Affects History's enabledChains + the Home tab's coin-
    // family filter. Lives outside `update()` because the persistence
    // layer is localStorage, not vault settings (per memory rule —
    // ephemeral UI prefs that shouldn't survive a from-seed restore).
    const resetChainFilters = useCallback(() => {
        const count = clearAllChainFilters();
        setResetMessage(
            count === 0
                ? 'No saved list filters to reset.'
                : `Reset ${count} saved list filter${count === 1 ? '' : 's'}. New filters apply on next visit.`,
        );
    }, []);

    if (loading) return <Status text="Loading…" />;
    if (error) return <Status text={`Settings unavailable: ${error.message}`} tone="error" />;
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

    return (
        <div style={STACK}>
            <h3 style={SECTION_HEADER}>Row affordances</h3>
            <p style={SECTION_HINT}>
                Whether each balance row shows a quick pin / hide button. Off by default to keep rows clean — your existing pinned and hidden tokens still apply either way and can be managed below.
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
        </div>
    );
}
