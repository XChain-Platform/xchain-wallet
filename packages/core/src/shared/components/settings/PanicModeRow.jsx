// PanicModeRow — §26.5 / G068 Safety panel row. Distinct from the
// `settings.panicMode.enabled` schema toggle (which gates whether the
// feature is offered): this row owns the live runtime activation state
// stored in localStorage via `flows/panicMode.js`.
//
// States:
//   inactive   "Activate panic mode" button. Clicking arms the
//              24-hour signing freeze immediately; no confirmation
//              modal — the moment of decision IS the moment of risk.
//   active     Status line with countdown + "Deactivate" button. The
//              countdown ticks once per minute; the persisted
//              expiresAt is the source of truth.
//
// The `enabled` schema toggle controls visibility of this row; when
// the user disables panic mode in preferences and a freeze is active,
// the row stays visible until the freeze ends so they can deactivate
// it explicitly.

import { useEffect, useState } from 'react';
import {
    activatePanicMode,
    deactivatePanicMode,
    getPanicModeState,
    getPanicRemainingMs,
} from '../../../flows/panicMode.js';
import { ROW, ROW_HINT } from './_settingsPrimitives.jsx';

export function PanicModeRow() {
    const [state, setState] = useState(getPanicModeState);
    const [remainingMs, setRemainingMs] = useState(() =>
        getPanicRemainingMs(getPanicModeState()),
    );

    useEffect(() => {
        if (remainingMs <= 0) return undefined;
        const handle = window.setInterval(() => {
            const ms = getPanicRemainingMs(state);
            setRemainingMs(ms);
            if (ms <= 0) {
                setState(getPanicModeState());
                window.clearInterval(handle);
            }
        }, 60_000);
        return () => window.clearInterval(handle);
    }, [state, remainingMs]);

    const isActive = remainingMs > 0;

    function handleActivate() {
        const next = activatePanicMode();
        setState(next);
        setRemainingMs(getPanicRemainingMs(next));
    }

    function handleDeactivate() {
        deactivatePanicMode();
        setState(getPanicModeState());
        setRemainingMs(0);
    }

    const labelStyle = { color: 'var(--xc-text)', fontWeight: 500 };
    const buttonStyle = {
        background: 'var(--xc-surface-raised)',
        color: 'var(--xc-text)',
        border: '1px solid var(--xc-border-strong)',
        borderRadius: 'var(--xc-radius-sm)',
        padding: 'var(--xc-space-1) var(--xc-space-3)',
        fontSize: 'var(--xc-text-sm)',
        cursor: 'pointer',
    };
    const dangerButtonStyle = {
        ...buttonStyle,
        borderColor: 'var(--xc-danger)',
        color: 'var(--xc-danger)',
        fontWeight: 600,
    };

    if (isActive) {
        return (
            <div style={ROW}>
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                    <span style={labelStyle}>Panic mode is active</span>
                    <span style={ROW_HINT}>
                        Signing is frozen until the timer expires.{' '}
                        <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                            {formatPanicCountdown(remainingMs)}
                        </span>{' '}
                        remaining.
                    </span>
                </div>
                <button type="button" onClick={handleDeactivate} style={buttonStyle}>
                    Deactivate
                </button>
            </div>
        );
    }

    return (
        <div style={ROW}>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                <span style={labelStyle}>Panic mode</span>
                <span style={ROW_HINT}>
                    Activate to freeze ALL signing for 24 hours. Balances and history stay readable; new
                    sends, multisig contributions, and message signatures will refuse until the timer
                    expires or you deactivate.
                </span>
            </div>
            <button type="button" onClick={handleActivate} style={dangerButtonStyle}>
                Activate
            </button>
        </div>
    );
}

function formatPanicCountdown(ms) {
    const totalMin = Math.max(0, Math.ceil(ms / 60_000));
    if (totalMin < 60) return `${totalMin}m`;
    const hours = Math.floor(totalMin / 60);
    const mins = totalMin % 60;
    return mins === 0 ? `${hours}h` : `${hours}h ${mins}m`;
}
