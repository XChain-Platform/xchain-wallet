// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// The clipboard auto-clear field shows what the user types, so it can be
// emptied and retyped; a value that is not a valid number yet is flagged and
// not saved, and the field returns to the stored value on blur.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';

const update = vi.fn(async () => {});

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({
        settings: createDefaultSettings(),
        loading: false,
        error: null,
        update,
    }),
}));

const { PrivacySection } = await import(
    '../../../packages/core/src/shared/components/settings/PrivacySection.jsx'
);

afterEach(() => {
    cleanup();
    update.mockClear();
});

describe('Clipboard auto-clear field typing', () => {
    it('lets the field be emptied without saving and restores the stored value on blur', () => {
        render(<PrivacySection />);
        const field = screen.getByRole('spinbutton');
        expect(field).toHaveValue(60);

        fireEvent.change(field, { target: { value: '' } });
        expect(field).toHaveValue(null);
        expect(update).not.toHaveBeenCalled();

        fireEvent.change(field, { target: { value: '45' } });
        expect(field).toHaveValue(45);
        expect(update).toHaveBeenCalledWith({ privacy: { clipboardAutoClearSeconds: 45 } });

        fireEvent.change(field, { target: { value: '' } });
        fireEvent.blur(field);
        expect(field).toHaveValue(60);
    });
});
