// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The Edit wallet and Edit account icon image uses the standard file field.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import { TileLookFields } from '../../../packages/core/src/shared/components/TileLookFields.jsx';

afterEach(() => cleanup());

function mount(image = null) {
    const onImage = vi.fn();
    render(
        <TileLookFields
            kind="wallet"
            colour="#7B2C8F"
            onColour={() => {}}
            shape="circle"
            onShape={() => {}}
            image={image}
            onImage={onImage}
        />,
    );
    return onImage;
}

describe('TileLookFields icon image', () => {
    it('is the standard file field with Upload at its edge while no image is set', () => {
        mount();
        const field = screen.getByLabelText(/^Icon image/, { selector: 'input:not([type="file"])' });
        expect(field.closest('[data-file-field]')).not.toBeNull();
        expect(field).toHaveValue('');
        expect(field).toHaveAttribute('placeholder', 'Choose an image');
        expect(screen.getByRole('button', { name: 'Choose an image' })).toBeInTheDocument();
        expect(screen.getByLabelText('Icon image file')).toHaveAttribute('accept', 'image/png,image/jpeg,image/webp,image/gif');
    });

    it('refuses a file that is not an image in the field', async () => {
        const onImage = mount();
        fireEvent.change(screen.getByLabelText('Icon image file'), {
            target: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] },
        });
        expect(await screen.findByText('Choose an image file.')).toBeInTheDocument();
        expect(onImage).not.toHaveBeenCalled();
    });

    it('shows Image set with X once an image is set, and X clears it', () => {
        const onImage = mount('data:image/png;base64,AAAA');
        const field = screen.getByLabelText(/^Icon image/, { selector: 'input:not([type="file"])' });
        expect(field).toHaveValue('Image set');
        fireEvent.click(screen.getByRole('button', { name: 'Remove image' }));
        expect(onImage).toHaveBeenCalledWith(null);
    });
});
