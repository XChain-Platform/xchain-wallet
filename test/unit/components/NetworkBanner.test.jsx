// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { NetworkBanner } from '../../../packages/core/src/shared/components/NetworkBanner.jsx';

afterEach(cleanup);

describe('NetworkBanner', () => {
    it.each([
        ['testnet', 'Testnet'],
        ['regtest', 'Regtest'],
    ])('marks %s and identifies displayed amounts', (activeNetwork, label) => {
        render(<NetworkBanner activeNetwork={activeNetwork} />);

        expect(screen.getByRole('status', {
            name: `Active network: ${label}. Amounts shown are on ${label}.`,
        })).toHaveTextContent(`${label} · Not mainnet`);
    });

    it.each([undefined, 'mainnet'])('stays absent for %s', (activeNetwork) => {
        render(<NetworkBanner activeNetwork={activeNetwork} />);
        expect(screen.queryByRole('status')).toBeNull();
    });

    it('is mounted in every application shell persistent header', () => {
        const expectedWiring = new Map([
            ['packages/web/src/App.jsx', '<NetworkBanner activeNetwork={activeNetwork} />'],
            ['packages/desktop/renderer/App.jsx', '<NetworkBanner activeNetwork={settings?.activeNetwork} />'],
            ['packages/extension/src/popup/App.jsx', 'header={<NetworkBanner activeNetwork={settings?.activeNetwork} />}'],
        ]);

        for (const [file, wiring] of expectedWiring) {
            expect(readFileSync(join(process.cwd(), file), 'utf8'), file).toContain(wiring);
        }
    });
});
