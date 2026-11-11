// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FeeSelector, FeesCard } from '../../../packages/core/src/ui/FeeSelector.jsx';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings: { fiatCurrency: 'USD' } }),
}));

vi.mock('../../../packages/core/src/shared/hooks/useFeeFiat.js', () => ({
    useFeeFiat: ({ chainId }) => ({
        formatNativeFee: () => (chainId === 'bitcoin-mainnet' ? '~$0.42' : null),
    }),
}));

const TIERS = {
    unit: 'sat/vB',
    low: { rateValue: 1, coinAmount: '0.00000100', etaMinutes: 30, vsize: 100 },
    normal: { rateValue: 2, coinAmount: '0.00000200', etaMinutes: 10, vsize: 100 },
    fast: { rateValue: 3, coinAmount: '0.00000300', etaMinutes: 2, vsize: 100 },
};

function InShell({ children }) {
    return <MessagingContext.Provider value={{ messaging: {} }}>{children}</MessagingContext.Provider>;
}

describe('FeesCard with its own fee selector', () => {
    it('keeps the selector chain and fiat when the card is given no chain', () => {
        render(
            <FeesCard
                coinTicker="BTC"
                feeSelector={(
                    <FeeSelector
                        chainId="bitcoin-mainnet"
                        coinTicker="BTC"
                        tiers={TIERS}
                        value={{ mode: 'normal' }}
                        onChange={() => {}}
                    />
                )}
            />,
            { wrapper: InShell },
        );
        expect(screen.getByRole('status')).toHaveTextContent('~$0.42');
    });
});
