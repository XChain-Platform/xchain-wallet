// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MobileAutopayNotice } from '../../../packages/core/src/shared/components/MobileAutopayNotice.jsx';

const copy = 'Auto pay runs only while XChain Wallet is open on this phone. To keep auto pay running when you are away, leave the XChain Wallet desktop app or browser extension running.';

function setShell(platform, native = true) {
    vi.stubGlobal('Capacitor', {
        isNativePlatform: () => native,
        getPlatform: () => platform,
    });
}

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('MobileAutopayNotice', () => {
    it.each(['ios', 'android'])('renders the notice on the %s shell', (platform) => {
        setShell(platform);
        render(<MobileAutopayNotice />);

        expect(screen.getByTestId('mobile-autopay-notice')).toHaveAttribute('data-tone', 'info');
        expect(screen.getByTestId('mobile-autopay-notice')).toHaveTextContent(copy);
    });

    it.each([
        ['web', 'web', false],
        ['extension', 'web', false],
        ['desktop', 'electron', false],
    ])('renders nothing on %s', (_shell, platform, native) => {
        setShell(platform, native);
        const { container } = render(<MobileAutopayNotice />);

        expect(container).toBeEmptyDOMElement();
    });
});
