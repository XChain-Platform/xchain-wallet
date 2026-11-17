// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { SOUND_PALETTE } from '../../../packages/core/src/notifications/notificationSounds.js';

const soundStore = vi.hoisted(() => ({
    list: vi.fn(),
    save: vi.fn(),
    remove: vi.fn(),
    validate: vi.fn(),
    play: vi.fn(),
}));

vi.mock('../../../packages/core/src/notifications/customSounds.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        listCustomSounds: soundStore.list,
        saveCustomSound: soundStore.save,
        deleteCustomSound: soundStore.remove,
        validateCustomSoundFile: soundStore.validate,
        playCustomSound: soundStore.play,
    };
});

let settings;
let update;
vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings, loading: false, error: null, update, refresh: async () => {} }),
}));
vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ shell: 'popup', messaging: { supportsNotificationSoundPlayback: true } }),
}));

const {
    ADD_SOUND_PAGE_PREFIX,
    AddSoundPage,
    SoundPickerPage,
    soundPickerSectionFor,
} = await import('../../../packages/core/src/shared/components/settings/NotificationsSection.jsx');
const {
    CUSTOM_SOUND_ICON_OPTIONS,
} = await import('../../../packages/core/src/ui/icons/customSoundIcons.jsx');
const {
    availableCustomSoundIcons,
} = await import('../../../packages/core/src/shared/components/settings/CustomSoundIconField.jsx');

const decoded = { bytes: new ArrayBuffer(8), duration: 3, mimeType: 'audio/mpeg' };

beforeEach(() => {
    settings = createDefaultSettings();
    update = vi.fn(async () => settings);
    soundStore.list.mockResolvedValue([]);
    soundStore.save.mockResolvedValue({ id: 'custom:new', name: 'Soft Coin', icon: 'lucide:alarm-clock', duration: 3, mimeType: 'audio/mpeg' });
    soundStore.remove.mockResolvedValue(true);
    soundStore.validate.mockResolvedValue(decoded);
    soundStore.play.mockResolvedValue(true);
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

async function fillValidForm(name = 'Soft Coin') {
    const file = new File(['audio'], 'soft.mp3', { type: 'audio/mpeg' });
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [file] } });
    await vi.waitFor(() => expect(soundStore.validate).toHaveBeenCalledWith(file));
    fireEvent.change(screen.getByRole('textbox', { name: /^Name/ }), { target: { value: name } });
}

describe('Add Sound', () => {
    const fileHelp = 'Choose a WAV, MP3, OGG, M4A or AAC audio file, up to 30 seconds.';

    it('keeps format help linked to the audio-only file picker', () => {
        render(<AddSoundPage />);

        const picker = document.querySelector('input[type="file"]');
        const field = screen.getByRole('textbox', { name: /^Sound file/ });
        const help = screen.getByText(fileHelp);

        expect(picker).toHaveAttribute('accept', 'audio/wav,audio/mpeg,audio/ogg,audio/mp4,audio/aac,.wav,.mp3,.ogg,.m4a,.aac');
        expect(field).toHaveAttribute('aria-describedby', help.id);
        expect(field).not.toHaveAttribute('aria-invalid');
    });

    it('shows file failures inline without a top summary and clears them after a valid pick', async () => {
        soundStore.validate
            .mockRejectedValueOnce(new Error('The selected file could not be decoded as audio.'))
            .mockResolvedValueOnce(decoded);
        render(<AddSoundPage />);
        const picker = document.querySelector('input[type="file"]');
        const field = screen.getByRole('textbox', { name: /^Sound file/ });

        fireEvent.change(picker, { target: { files: [new File(['wrong'], 'renamed.mp3', { type: 'audio/mpeg' })] } });

        const error = await screen.findByText('The selected file could not be decoded as audio.');
        expect(field).toHaveAttribute('aria-invalid', 'true');
        expect(field).toHaveAttribute('aria-describedby', error.id);
        expect(screen.queryByLabelText('Form errors')).toBeNull();
        expect(screen.queryByText(/Fix 1 thing to continue/)).toBeNull();

        fireEvent.change(picker, { target: { files: [new File(['audio'], 'valid.mp3', { type: 'audio/mpeg' })] } });

        await vi.waitFor(() => expect(soundStore.validate).toHaveBeenCalledTimes(2));
        const help = await screen.findByText(fileHelp);
        expect(field).not.toHaveAttribute('aria-invalid');
        expect(field).toHaveAttribute('aria-describedby', help.id);
        expect(screen.queryByText('The selected file could not be decoded as audio.')).toBeNull();
    });

    it('resolves as a responsive form page and saves valid decoded audio', async () => {
        const onAdded = vi.fn();
        render(<AddSoundPage onAdded={onAdded} />);
        await fillValidForm();
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await vi.waitFor(() => expect(soundStore.save).toHaveBeenCalledWith({
            name: 'Soft Coin',
            icon: 'lucide:alarm-clock',
            ...decoded,
        }));
        expect(onAdded).toHaveBeenCalledWith(expect.objectContaining({ id: 'custom:new' }));
        expect(screen.queryByRole('radio')).toBeNull();
        expect(await screen.findByRole('button', { name: /Icon: Alarm Clock/ })).toBeTruthy();
    });

    it('offers at least 100 icons without any built-in sound icon', () => {
        const builtIn = new Set(SOUND_PALETTE.map((sound) => sound.icon));
        const builtInSources = new Set(['music-2', 'wine', 'bell', 'guitar', 'broadcast', 'alert-circle', 'droplet', 'gong']);
        expect(CUSTOM_SOUND_ICON_OPTIONS.length).toBeGreaterThanOrEqual(100);
        expect(CUSTOM_SOUND_ICON_OPTIONS.filter((option) => builtIn.has(option.value))).toEqual([]);
        expect(CUSTOM_SOUND_ICON_OPTIONS.filter((option) => builtInSources.has(option.source))).toEqual([]);
    });

    it('omits icons used by custom sounds but preserves an edited sound own icon', () => {
        const used = ['lucide:cat', 'lucide:piano'];
        expect(availableCustomSoundIcons(used).map((option) => option.value)).not.toContain('lucide:cat');
        expect(availableCustomSoundIcons(used, 'lucide:cat').map((option) => option.value)).toContain('lucide:cat');
        expect(availableCustomSoundIcons(['HeartIcon']).map((option) => option.value)).not.toContain('lucide:heart');
        expect(availableCustomSoundIcons(['HeartIcon'], 'HeartIcon').map((option) => option.value)).toContain('HeartIcon');
    });

    it('opens the standard full-page icon list, filters from the header, and writes a choice', async () => {
        render(<AddSoundPage />);
        const field = await screen.findByRole('button', { name: 'Icon: Alarm Clock' });
        fireEvent.click(field);

        expect(await screen.findByRole('heading', { level: 1, name: 'Choose Icon' })).toBeTruthy();
        expect(screen.getByRole('list', { name: 'Sound icons' })).toBeTruthy();
        expect(document.querySelectorAll('[data-settings-choice]').length).toBeGreaterThanOrEqual(100);
        expect(screen.queryByRole('dialog', { name: 'Choose Icon' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Search icons' }));
        fireEvent.change(screen.getByRole('searchbox', { name: 'Search icons' }), { target: { value: 'piano' } });
        expect(document.querySelectorAll('[data-settings-choice]')).toHaveLength(1);
        fireEvent.click(screen.getByText('Piano').closest('button'));

        expect(await screen.findByRole('button', { name: 'Icon: Piano' })).toBeTruthy();
        expect(screen.queryByRole('heading', { level: 1, name: 'Choose Icon' })).toBeNull();
    });

    it('removes an existing custom sound icon from the list', async () => {
        soundStore.list.mockResolvedValue([{ id: 'custom:old', name: 'Cat Call', icon: 'lucide:cat', duration: 2 }]);
        render(<AddSoundPage />);
        await vi.waitFor(() => expect(soundStore.list).toHaveBeenCalled());
        fireEvent.click(await screen.findByRole('button', { name: 'Icon: Alarm Clock' }));

        await screen.findByRole('list', { name: 'Sound icons' });
        expect(screen.queryByText('Cat')).toBeNull();
    });

    it('keeps the unsaved file and name while the full-page picker is open', async () => {
        render(<AddSoundPage />);
        await fillValidForm('Keep My Draft');
        expect(screen.getByRole('textbox', { name: /^Sound file/ })).toHaveValue('soft.mp3');
        fireEvent.click(await screen.findByRole('button', { name: 'Icon: Alarm Clock' }));
        fireEvent.click(await screen.findByText('Piano'));

        expect(await screen.findByRole('textbox', { name: /^Name/ })).toHaveValue('Keep My Draft');
        expect(screen.getByRole('textbox', { name: /^Sound file/ })).toHaveValue('soft.mp3');
        expect(screen.getByRole('button', { name: 'Icon: Piano' })).toBeTruthy();
    });

    it('keeps the SVG catalog behind the Add Sound lazy boundary', () => {
        const entry = readFileSync(join(process.cwd(), 'packages/core/src/shared/components/settings/NotificationsSection.jsx'), 'utf8');
        expect(entry).toContain("lazy(() => import('./CustomSoundIconField.jsx')");
        expect(entry).not.toMatch(/^import .*customSoundIcons/m);
    });

    it('rejects a duplicate name without writing audio', async () => {
        soundStore.list.mockResolvedValue([{ id: 'custom:old', name: 'Soft Coin', icon: 'BellIcon', duration: 2 }]);
        render(<AddSoundPage />);
        await vi.waitFor(() => expect(soundStore.list).toHaveBeenCalled());
        await fillValidForm('soft coin');
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        expect(await screen.findAllByText('A sound with this name already exists.')).not.toHaveLength(0);
        expect(screen.getByLabelText('Form errors')).toHaveTextContent('Fix 1 thing to continue');
        expect(soundStore.save).not.toHaveBeenCalled();
    });

    it('exposes the Add Sound route and returns to its family picker after save', () => {
        const onReturnTo = vi.fn();
        const section = soundPickerSectionFor(`${ADD_SOUND_PAGE_PREFIX}incomingPending`, { onReturnTo });
        expect(section.title).toBe('Add Sound');
        expect(section.flat).toBe(true);
        section.props.onAdded();
        expect(onReturnTo).toHaveBeenCalledWith('notifications-sound:incomingPending');
    });

    it('puts Add Sound in the Choose Sound header action', () => {
        const onOpen = vi.fn();
        const section = soundPickerSectionFor('notifications-sound:incomingPending', { onOpen });
        render(section.trailing);
        fireEvent.click(screen.getByRole('button', { name: 'Add Sound' }));
        expect(onOpen).toHaveBeenCalledWith('notifications-add-sound:incomingPending');
    });
});

describe('custom rows', () => {
    const custom = { id: 'custom:coin', name: 'Coin Drop', icon: 'CoinsIcon', duration: 2, mimeType: 'audio/mpeg' };

    it('appears after built-ins, previews, selects, and saves like a built-in', async () => {
        soundStore.list.mockResolvedValue([custom]);
        render(<SoundPickerPage familyKey="incomingPending" />);
        const row = await screen.findByText('Coin Drop');
        fireEvent.click(row.closest('button'));
        expect(soundStore.play).toHaveBeenCalledWith('custom:coin');
        await vi.waitFor(() => expect(update).toHaveBeenCalledWith({ sounds: { perKind: { incomingPending: 'custom:coin' } } }));
        expect(row.closest('button')).toHaveAttribute('aria-current', 'true');
    });

    it('deleting the selected custom sound falls back to the family default', async () => {
        settings = { ...createDefaultSettings(), sounds: { enabled: true, perKind: { incomingPending: 'custom:coin' } } };
        soundStore.list.mockResolvedValue([custom]);
        render(<SoundPickerPage familyKey="incomingPending" />);
        fireEvent.click(await screen.findByRole('button', { name: 'Delete Coin Drop' }));
        await vi.waitFor(() => expect(soundStore.remove).toHaveBeenCalledWith('custom:coin'));
        expect(update).toHaveBeenCalledWith({ sounds: { perKind: { incomingPending: 'pluck' } } });
    });
});
