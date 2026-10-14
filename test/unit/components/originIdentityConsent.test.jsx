// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
    OriginIdentity,
    registrableDomainForHostname,
} from '../../../packages/core/src/shared/components/OriginIdentity.jsx';
import { ContractConsentPanel } from '../../../packages/core/src/shared/components/ContractConsentPanel.jsx';
import { WatcherResultPanel } from '../../../packages/core/src/shared/components/WatcherResultPanel.jsx';

describe('<OriginIdentity>', () => {
    it('emphasizes the registrable domain instead of an attacker-controlled prefix', () => {
        render(
            <OriginIdentity origin="https://login.wallet.example.co.uk:8443/request" />,
        );

        expect(screen.getByTestId('request-origin-registrable-domain').textContent)
            .toBe('example.co.uk');
        expect(screen.getByTestId('request-origin-full').textContent)
            .toBe('https://login.wallet.example.co.uk:8443/request');
        expect(registrableDomainForHostname('login.wallet.example.com')).toBe('example.com');
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('flags a domain-shaped prefix as a possible lookalike', () => {
        render(<OriginIdentity origin="https://login.paypal.com.attacker.test" />);

        expect(screen.getByText(/Possible lookalike domain/)).toBeTruthy();
        expect(screen.getByTestId('request-origin-registrable-domain').textContent)
            .toBe('attacker.test');
    });

    it('flags punycode as both encoded and a possible lookalike', () => {
        render(<OriginIdentity origin="https://xn--pypal-4ve.example" />);

        expect(screen.getByText(/Punycode domain/)).toBeTruthy();
        expect(screen.getByText(/Possible lookalike domain/)).toBeTruthy();
    });
});

describe('grant wording', () => {
    it('names the exact contract permissions the user grants', () => {
        const { container } = render(
            <dl>
                <ContractConsentPanel
                    manifest={{ permissions: ['SEND'], maxTakeBps: 100, status: 'declared' }}
                    labelClassName="label"
                    valueClassName="value"
                />
            </dl>,
        );

        expect(container.textContent).toContain('Permission you grant');
        expect(container.textContent).toContain('grant this contract permission to:');
        expect(container.textContent).toContain('It can send your tokens.');
    });

    it('states that watcher signing authorizes only the displayed transaction', () => {
        render(
            <WatcherResultPanel result={{ psbtHex: 'deadbeef' }} onDone={() => {}} />,
        );

        expect(screen.getByText(/Signing authorizes this transaction only/)).toBeTruthy();
    });
});
