// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The undo-send row in the Safety panel: the opt-in switch, the seconds
// input with its writer-side cap, and the host-availability hint.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';

import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';

let settings = createDefaultSettings();
let update = vi.fn();
let messaging = {};

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings, loading: false, error: null, update, refresh: async () => {} }),
}));

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ shell: 'web', messaging }),
}));

const { UndoSendRow } = await import(
    '../../../packages/core/src/shared/components/settings/UndoSendRow.jsx');

const SWITCH = 'Hold signed sends before broadcast';
const INPUT_LABEL = 'Send hold duration in seconds';

function withGrace(grace) {
    const base = createDefaultSettings();
    settings = { ...base, grace: { ...base.grace, ...grace } };
}

function typeAndBlur(value) {
    const input = screen.getByLabelText(INPUT_LABEL);
    fireEvent.change(input, { target: { value } });
    fireEvent.blur(input);
}

beforeEach(() => {
    settings = createDefaultSettings();
    update = vi.fn(async () => settings);
    messaging = {};
});

afterEach(() => cleanup());

describe('UndoSendRow', () => {
    it('renders nothing while settings are absent', () => {
        settings = null;
        const { container } = render(<UndoSendRow />);
        expect(container.innerHTML).toBe('');
    });

    it('fresh defaults: unchecked switch, disabled input reading 5', () => {
        render(<UndoSendRow />);
        expect(screen.getByRole('switch', { name: SWITCH }).checked).toBe(false);
        const input = screen.getByLabelText(INPUT_LABEL);
        expect(input.disabled).toBe(true);
        expect(input.value).toBe('5');
    });

    it('clicking the switch writes undoSendEnabled once', () => {
        render(<UndoSendRow />);
        fireEvent.click(screen.getByRole('switch', { name: SWITCH }));
        expect(update).toHaveBeenCalledTimes(1);
        expect(update).toHaveBeenCalledWith({ grace: { undoSendEnabled: true } });
    });

    it('is checked and enables the input only when undoSendEnabled is true', () => {
        withGrace({ undoSendEnabled: true });
        render(<UndoSendRow />);
        expect(screen.getByRole('switch', { name: SWITCH }).checked).toBe(true);
        expect(screen.getByLabelText(INPUT_LABEL).disabled).toBe(false);
    });

    it('shows a stored 600 as 30', () => {
        withGrace({ undoSendEnabled: true, undoSendSeconds: 600 });
        render(<UndoSendRow />);
        expect(screen.getByLabelText(INPUT_LABEL).value).toBe('30');
    });

    it('typing 600 then blur writes 30', () => {
        withGrace({ undoSendEnabled: true });
        render(<UndoSendRow />);
        typeAndBlur('600');
        expect(update).toHaveBeenCalledWith({ grace: { undoSendSeconds: 30 } });
    });

    it('typing 12 writes 12', () => {
        withGrace({ undoSendEnabled: true });
        render(<UndoSendRow />);
        typeAndBlur('12');
        expect(update).toHaveBeenCalledWith({ grace: { undoSendSeconds: 12 } });
    });

    it('an empty value writes the default 5', () => {
        withGrace({ undoSendEnabled: true, undoSendSeconds: 12 });
        render(<UndoSendRow />);
        typeAndBlur('');
        expect(update).toHaveBeenCalledWith({ grace: { undoSendSeconds: 5 } });
    });

    it('logs a rejected update instead of throwing', async () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        update = vi.fn(async () => { throw new Error('nope'); });
        render(<UndoSendRow />);
        fireEvent.click(screen.getByRole('switch', { name: SWITCH }));
        await new Promise((r) => setTimeout(r, 0));
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });

    it('says the build cannot hold sends without sendHoldCancel', () => {
        render(<UndoSendRow />);
        expect(screen.getByText(/This build cannot hold sends/)).toBeTruthy();
    });

    it('describes the actual pre-broadcast hold when sendHoldCancel is a function', () => {
        messaging = { sendHoldCancel: () => {} };
        render(<UndoSendRow />);
        expect(screen.queryByText(/This build cannot hold sends/)).toBeNull();
        expect(screen.getByText(/holds each signed send/i)).toBeTruthy();
        expect(screen.getByText(/duration of 0 does not hold sends/i)).toBeTruthy();
    });
});
