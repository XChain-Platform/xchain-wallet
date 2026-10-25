// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// A scanned payment request names its token. The scanner applies the same
// ticker grammar the deep-link route applies, so a malformed name is refused
// at the scan instead of reaching the Send form.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ScanRoute } from '../../../packages/core/src/shared/routes/ScanRoute.jsx';

vi.mock('@xchain-wallet/core/ui', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, QrScanner: () => null };
});

const BTC = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

function scan(text) {
    const onClassified = vi.fn();
    render(<ScanRoute onClassified={onClassified} onBack={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Or paste it here'), { target: { value: text } });
    fireEvent.click(screen.getByRole('button', { name: 'Use pasted text' }));
    return { onClassified, alert: document.querySelector('[role="alert"]')?.textContent || '' };
}

afterEach(cleanup);

describe('scanned token names', () => {
    it.each([
        ['a BIP21 token with a space and a slash', `bitcoin:${BTC}?amount=1&tick=${encodeURIComponent('A B/C')}`],
        ['a coin-code token with a space', `xchain:BTC/send?to=${BTC}&tick=${encodeURIComponent('XC P')}`],
        ['a legacy path token with a space', `xchain://bitcoin-mainnet/A B?to=${BTC}`],
    ])('refuses %s', (_name, text) => {
        const { onClassified, alert } = scan(text);
        expect(onClassified).not.toHaveBeenCalled();
        expect(alert).toMatch(/payment request|XChain link/i);
    });

    it.each([
        ['a named token', `bitcoin:${BTC}?amount=1&tick=pepe`, 'PEPE'],
        ['a numbered token', `bitcoin:${BTC}?amount=1&tick=${encodeURIComponent('^123')}`, '^123'],
        ['a coin-code token', `xchain:BTC/send?to=${BTC}&tick=XCP`, 'XCP'],
    ])('keeps %s', (_name, text, tick) => {
        const { onClassified } = scan(text);
        expect(onClassified).toHaveBeenCalledWith(expect.objectContaining({ kind: 'send', tick }));
    });
});
