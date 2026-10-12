// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// UndoSendRow (§29.8): Safety panel row that opts in to holding each signed
// send for a few seconds so it can be cancelled before it is broadcast.
//
// Writes `grace.undoSendEnabled` (the opt-in) and `grace.undoSendSeconds`.
// `validateSettings` has no upper bound on the seconds, so this row is the
// writer-side cap: typed values are capped at UNDO_SEND_SECONDS_MAX, and an
// empty or non-digit value falls back to UNDO_SEND_SECONDS_DEFAULT.
//
// The hint is honest about the host: until the messaging layer exposes
// `sendHoldCancel`, sends are not held, so the row says its choice is saved
// but not yet applied. The hint clears itself once the host route exists.

import {
    resolveUndoSendSeconds,
    UNDO_SEND_SECONDS_DEFAULT,
    UNDO_SEND_SECONDS_MAX,
    UNDO_SEND_SECONDS_MIN,
} from '../../../schemas/settings.js';
import { useSettings } from '../../hooks/useSettings.js';
import { useMessaging } from '../../useMessaging.js';
import { INPUT, ROW, ROW_LABEL, ToggleRow } from './_settingsPrimitives.jsx';

const HINT_UNAVAILABLE =
    'Not available yet: sends are not held on this build. Your choice here is saved and will apply once they are.';
const HINT_AVAILABLE =
    'Holds each signed send for the seconds below so you can cancel it before it is broadcast.';

export function UndoSendRow() {
    const { settings, update } = useSettings();
    const { messaging } = useMessaging();

    if (!settings) return null;

    const enabled = settings.grace?.undoSendEnabled === true;
    const seconds = resolveUndoSendSeconds(settings);
    const held = typeof messaging?.sendHoldCancel === 'function';

    return (
        <>
            <ToggleRow
                label="Give me time to cancel sends"
                hint={held ? HINT_AVAILABLE : HINT_UNAVAILABLE}
                checked={enabled}
                onChange={(v) => {
                    update({ grace: { undoSendEnabled: v } }).catch((err) => {
                        // eslint-disable-next-line no-console
                        console.error('grace.undoSendEnabled update failed:', err);
                    });
                }}
            />
            <div style={ROW}>
                <span style={ROW_LABEL}>Seconds to cancel a send</span>
                <input
                    key={seconds}
                    type="number"
                    inputMode="numeric"
                    min={UNDO_SEND_SECONDS_MIN}
                    max={UNDO_SEND_SECONDS_MAX}
                    step={1}
                    defaultValue={seconds}
                    disabled={!enabled}
                    onBlur={(e) => {
                        const raw = e.target.value.trim();
                        const n = /^\d+$/.test(raw)
                            ? Math.min(Number(raw), UNDO_SEND_SECONDS_MAX)
                            : UNDO_SEND_SECONDS_DEFAULT;
                        update({ grace: { undoSendSeconds: n } }).catch((err) => {
                            // eslint-disable-next-line no-console
                            console.error('grace.undoSendSeconds update failed:', err);
                        });
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                    aria-label="Seconds to cancel a send"
                    style={{ ...INPUT, width: 100, textAlign: 'right' }}
                />
            </div>
        </>
    );
}
