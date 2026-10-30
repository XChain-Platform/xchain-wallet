// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// An xchain: payment request carries the payee's message and label. Opened as
// a link, the message is shown above the Send form; scanned, the same request
// must hand Send the same message rather than dropping it.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ScanRoute } from '../../../packages/core/src/shared/routes/ScanRoute.jsx';
import { deepLinkRoute } from '../../../packages/desktop/renderer/deepLinkRoute.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';

vi.mock('@xchain-wallet/core/ui', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, QrScanner: () => null };
});

const BTC = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const DOGE = 'DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L';

function scan(input) {
    const onClassified = vi.fn();
    render(<ScanRoute onClassified={onClassified} onBack={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Or paste it here'), { target: { value: input } });
    fireEvent.click(screen.getByRole('button', { name: 'Use pasted text' }));
    return onClassified;
}

afterEach(cleanup);

describe('scanned payment request message', () => {
    it.each([
        [`xchain:BTC/send?to=${BTC}&amount=1&message=Order%2042&label=Shop`, 'Order 42'],
        [`xchain:BTC/send?to=${BTC}&amount=1&label=Shop`, 'Shop'],
        [`xchain:${DOGE}?amount=3&message=hello`, 'hello'],
    ])('hands Send the message of %s, as the opened link does', (input, message) => {
        const onClassified = scan(input);
        expect(onClassified).toHaveBeenCalledWith(expect.objectContaining({ kind: 'send', requestMessage: message }));
        expect(deepLinkRoute(input, defaultRegistry()).sendPrefill.requestMessage).toBe(message);
    });

    it('neutralizes control characters in the message', () => {
        const onClassified = scan(`xchain:BTC/send?to=${BTC}&amount=1&message=pay%E2%80%AEme`);
        const { requestMessage } = onClassified.mock.calls[0][0];
        expect(requestMessage).not.toContain('‮');
    });
});
