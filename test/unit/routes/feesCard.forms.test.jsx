// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FeesCard } from '../../../packages/core/src/shared/components/FeesCard.jsx';
import feesCardStyles from '../../../packages/core/src/shared/components/FeesCard.module.css';
import { FeeSelector } from '../../../packages/core/src/ui/FeeSelector.jsx';

const useFeeFiatMock = vi.hoisted(() => vi.fn());

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings: { fiatCurrency: 'USD' } }),
}));

vi.mock('../../../packages/core/src/shared/hooks/useFeeFiat.js', () => ({
    useFeeFiat: (...args) => useFeeFiatMock(...args),
}));

const ROOT = join(import.meta.dirname, '../../..');
// Surfaces that still mount the shared FeesCard directly.
const FORMS = [
    'routes/BatchComposerForm.jsx',
    'routes/BetFeedDetail.jsx',
    'routes/DispenserDetail.jsx',
    'routes/ListCreateForm.jsx',
    'routes/ListForkForm.jsx',
    'routes/ListShareForm.jsx',
    'components/PlaceOrderPanel.jsx',
];

// Forms that show their fees through the Form Standard's Network fee section.
const FEE_SECTION_FORMS = [
    'routes/AdvancedActionsForm.jsx',
    'routes/AirdropForm.jsx',
    'routes/BridgeMoveForm.jsx',
    'routes/CallbackForm.jsx',
    'routes/CreateBetFeedForm.jsx',
    'routes/CreateOrderForm.jsx',
    'routes/CrossChainOrderForm.jsx',
    'routes/CrossChainSwapForm.jsx',
    'routes/DeployContractForm.jsx',
    'routes/DispenserForm.jsx',
    'routes/DividendForm.jsx',
    'routes/ExecuteContractForm.jsx',
    'routes/IssueTokenForm.jsx',
    'routes/ListRenameForm.jsx',
    'routes/SellOwnershipForm.jsx',
    'routes/SwapForm.jsx',
    'routes/SweepForm.jsx',
];

const TIERS = {
    low: { coinAmount: '0.00001', rateValue: 1 },
    normal: { coinAmount: '0.000015', rateValue: 2 },
    fast: { coinAmount: '0.00002', rateValue: 3 },
    unit: 'sat/vB',
};
const QUOTE = { xchainFee: '0.064', requiredFeeSats: 197 };
const FIAT = {
    formatNativeFee: (amount) => amount === '0.000015' ? '~$0.98' : '~$0.13',
    formatProtocolFee: () => '~$0.13',
    formatFeeTotal: () => '~$1.11',
};
useFeeFiatMock.mockReturnValue(FIAT);

function BitcoinCard() {
    const [checked, setChecked] = useState(false);
    return (
        <FeesCard
            feeSelector={<div>Fee selector</div>}
            tiers={TIERS}
            value={{ mode: 'normal' }}
            coinTicker="BTC"
            quote={QUOTE}
            nativeFeeProps={{ checked, onChange: setChecked }}
            fiat={FIAT}
        />
    );
}

describe('Fees card route adoption', () => {
    it.each(FORMS)('%s mounts exactly one shared FeesCard', (relative) => {
        const source = readFileSync(join(ROOT, 'packages/core/src/shared', relative), 'utf8');
        expect(source.match(/<FeesCard\b/g) || []).toHaveLength(1);
        expect(source).toMatch(/import \{ FeesCard \}/);
        expect(source).toMatch(/<FeesCard\b(?:(?!>).)*\bchainId=/s);
    });

    // A Form Standard form shows its fees in one Network fee section, which
    // mounts the shared FeesCard itself when the form passes `fees`.
    it.each(FEE_SECTION_FORMS)('%s mounts exactly one Network fee section', (relative) => {
        const source = readFileSync(join(ROOT, 'packages/core/src/shared', relative), 'utf8');
        expect(source.match(/<FeeSection\b/g) || []).toHaveLength(1);
        expect(source).toMatch(/import \{[^}]*\bFeeSection\b[^}]*\} from/);
        expect(source).toMatch(/<FeeSection\b(?:(?!>).)*\bchainId=/s);
        expect(source).not.toMatch(/<FeesCard\b/);
    });

    it('keeps the advanced form conditional on the selected fee-bearing action', () => {
        const source = readFileSync(
            join(ROOT, 'packages/core/src/shared/routes/AdvancedActionsForm.jsx'),
            'utf8',
        );
        expect(source).toContain('isFeeBearingAction');
    });

    it('keeps the raw Bridge quote available for native-coin totals', () => {
        const source = readFileSync(
            join(ROOT, 'packages/core/src/shared/routes/BridgeMoveForm.jsx'),
            'utf8',
        );
        expect(source).toContain('useProtocolFeeQuote({');
        // The Network fee section hands the raw quote to the shared card.
        expect(source).toMatch(/fees=\{\{\s*quote: protocolFeeQuote,/);
    });
});

describe('FeesCard', () => {
    it('shares one fiat lookup with its selector and network fee row', () => {
        useFeeFiatMock.mockClear();
        render(
            <FeesCard
                chainId="bitcoin-mainnet"
                feeSelector={(
                    <FeeSelector
                        tiers={TIERS}
                        value={{ mode: 'normal' }}
                        onChange={() => {}}
                        coinTicker="BTC"
                    />
                )}
                quote={QUOTE}
                nativeFeeProps={{ checked: false, onChange: vi.fn() }}
            />,
        );

        expect(useFeeFiatMock).toHaveBeenCalledTimes(1);
        expect(screen.getAllByText('~$0.98')).toHaveLength(2);
    });

    it('resolves fiat rows from chainId when no formatter prop is supplied', () => {
        render(
            <FeesCard
                chainId="bitcoin-mainnet"
                feeSelector={<div>Fee selector</div>}
                tiers={TIERS}
                value={{ mode: 'normal' }}
                coinTicker="BTC"
                quote={QUOTE}
                nativeFeeProps={{ checked: false, onChange: vi.fn() }}
            />,
        );

        expect(screen.getByText('~$0.98')).toBeInTheDocument();
        expect(screen.getByText('~$0.13')).toBeInTheDocument();
        expect(screen.getByText('0.000015 BTC + 0.064 XCHAIN ~$1.11')).toBeInTheDocument();
    });

    it('renders one protocol row and one total row with both ruled totals', () => {
        const { container } = render(<BitcoinCard />);
        expect(container.querySelectorAll('[data-fees-card]')).toHaveLength(1);
        expect(container.querySelectorAll('[data-fees-row="protocol"]')).toHaveLength(1);
        expect(container.querySelectorAll('[data-fees-row="total"]')).toHaveLength(1);
        expect(screen.getByText('0.000015 BTC + 0.064 XCHAIN ~$1.11')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('switch', { name: 'Pay protocol fee in BTC' }));
        expect(screen.getByText('0.00001697 BTC ~$1.11')).toBeInTheDocument();
    });

    it('keeps the native switch inside the protocol fee row', () => {
        const { container } = render(<BitcoinCard />);
        const protocolRow = container.querySelector('[data-fees-row="protocol"]');
        const help = screen.getByRole('button', { name: 'Protocol fee help' });
        const toggle = screen.getByRole('switch', { name: 'Pay protocol fee in BTC' });

        expect(toggle.closest('[data-fees-row]')).toBe(protocolRow);
        expect(protocolRow.children).toHaveLength(1);
        expect(protocolRow.firstElementChild).toContainElement(toggle);
        expect(protocolRow.firstElementChild).toHaveClass(feesCardStyles.rowMainWithControl);
        expect(help.parentElement).toHaveClass(feesCardStyles.protocolHelp);
        expect(help.closest(`.${feesCardStyles.labelWithHelp}`)).toContainElement(help);
    });

    it('wraps protocol figures under the label without moving the switch to another row', () => {
        const css = readFileSync(
            join(ROOT, 'packages/core/src/shared/components/FeesCard.module.css'),
            'utf8',
        );

        expect(css).toMatch(/\.rowMainWithControl\s*\{[^}]*grid-template-areas:\s*'label figures control';[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, auto\) auto;/s);
        expect(css).toMatch(/@media \(max-width: 400px\)[\s\S]*?\.rowMainWithControl\s*\{[^}]*'label control'\s*'figures control';[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;/s);
    });

    it('locks native payment on Litecoin', () => {
        render(
            <FeesCard
                feeSelector={<div>Fee selector</div>}
                tiers={TIERS}
                value={{ mode: 'normal' }}
                coinTicker="LTC"
                quote={QUOTE}
                nativeFeeProps={{ checked: true, mandatory: true, onChange: vi.fn() }}
                fiat={FIAT}
            />,
        );
        const toggle = screen.getByRole('switch', { name: 'Pay protocol fee in LTC' });
        expect(toggle).toBeChecked();
        expect(toggle).toBeDisabled();
    });

    it('omits the native switch for Batch', () => {
        render(
            <FeesCard
                feeSelector={<div>Fee selector</div>}
                tiers={TIERS}
                value={{ mode: 'normal' }}
                coinTicker="BTC"
                quote={QUOTE}
                nativeFeeProps={{ checked: false, onChange: vi.fn() }}
                nativeSwitch={false}
                fiat={FIAT}
            />,
        );
        expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    });

    it('replaces calculating with review pricing after a quote fails', () => {
        const onChange = vi.fn();
        const { rerender } = render(
            <FeesCard
                feeSelector={<div>Fee selector</div>}
                tiers={TIERS}
                value={{ mode: 'normal' }}
                coinTicker="BTC"
                quote={null}
                pending
                nativeFeeProps={{ checked: false, onChange }}
                fiat={FIAT}
            />,
        );
        expect(screen.getAllByText('Calculating')).toHaveLength(2);

        rerender(
            <FeesCard
                feeSelector={<div>Fee selector</div>}
                tiers={TIERS}
                value={{ mode: 'normal' }}
                coinTicker="BTC"
                quote={null}
                pending={false}
                nativeFeeProps={{ checked: false, onChange }}
                fiat={FIAT}
            />,
        );
        expect(screen.queryByText('Calculating')).not.toBeInTheDocument();
        expect(screen.getAllByText('Priced at review')).toHaveLength(2);
        fireEvent.click(screen.getByRole('switch', { name: 'Pay protocol fee in BTC' }));
        expect(onChange).toHaveBeenCalledWith(true);
    });
});
