// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import * as shim from '../../../packages/web/src/style-guide/sections/WalletPartsSections.jsx';
import { FileFieldSection } from '../../../packages/web/src/style-guide/sections/FileFieldSection.jsx';
import { UploadMethodFieldSection } from '../../../packages/web/src/style-guide/sections/UploadMethodFieldSection.jsx';
import { WarningCardSection } from '../../../packages/web/src/style-guide/sections/WarningCardSection.jsx';
import { WalletModeFieldSection } from '../../../packages/web/src/style-guide/sections/WalletModeFieldSection.jsx';
import { ListFilterMenuSection } from '../../../packages/web/src/style-guide/sections/ListFilterMenuSection.jsx';
import { PortfolioChartSection } from '../../../packages/web/src/style-guide/sections/PortfolioChartSection.jsx';
import { SparklineSection } from '../../../packages/web/src/style-guide/sections/SparklineSection.jsx';
import { MnemonicGridSection } from '../../../packages/web/src/style-guide/sections/MnemonicGridSection.jsx';
import { WalletIdentitySection } from '../../../packages/web/src/style-guide/sections/WalletIdentitySection.jsx';
import { MarketTradePartsSection } from '../../../packages/web/src/style-guide/sections/MarketTradePartsSection.jsx';
import { RouteErrorBoundarySection } from '../../../packages/web/src/style-guide/sections/RouteErrorBoundarySection.jsx';

const SECTIONS = [
    ['FileFieldSection', FileFieldSection, 'File field'],
    ['UploadMethodFieldSection', UploadMethodFieldSection, 'Upload method field'],
    ['WarningCardSection', WarningCardSection, 'Warning card'],
    ['WalletModeFieldSection', WalletModeFieldSection, 'Wallet mode field'],
    ['ListFilterMenuSection', ListFilterMenuSection, 'List filter menu'],
    ['PortfolioChartSection', PortfolioChartSection, 'Portfolio chart'],
    ['SparklineSection', SparklineSection, 'Sparkline'],
    ['MnemonicGridSection', MnemonicGridSection, 'Mnemonic grid'],
    ['WalletIdentitySection', WalletIdentitySection, 'Wallet identity'],
    ['MarketTradePartsSection', MarketTradePartsSection, 'Market trade parts'],
    ['RouteErrorBoundarySection', RouteErrorBoundarySection, 'Route error boundary'],
];

describe.each(SECTIONS)('%s split module', (name, Component, heading) => {
    it('is re-exported unchanged by the compatibility shim', () => {
        expect(shim[name]).toBe(Component);
    });

    it('renders its h2', () => {
        const { container } = render(<Component />);
        expect(container.querySelector('h2')).toHaveTextContent(heading);
    });
});
