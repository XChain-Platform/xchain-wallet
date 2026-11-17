// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AppHeader } from '../../../packages/core/src/shared/components/AppHeader.jsx';
import { CreateWallet } from '../../../packages/core/src/shared/routes/CreateWallet.jsx';
import { ImportWallet } from '../../../packages/core/src/shared/routes/ImportWallet.jsx';
import { PairSignerForm } from '../../../packages/core/src/shared/routes/PairSignerForm.jsx';

const forms = [
    {
        name: 'Create New Wallet',
        heading: /Create(?: a)?(?: New)? Wallet/,
        fresh: <CreateWallet mode="fresh" onBack={() => {}} onCreated={() => {}} />,
        unlocked: <CreateWallet mode="add" onBack={() => {}} onCreated={() => {}} />,
    },
    {
        name: 'Import Wallet',
        heading: 'Import Wallet',
        fresh: <ImportWallet mode="fresh" onBack={() => {}} onImported={() => {}} />,
        unlocked: <ImportWallet mode="add" onBack={() => {}} onImported={() => {}} />,
    },
    {
        name: 'Hardware Wallet',
        heading: 'Hardware Wallet',
        fresh: <PairSignerForm mode="first" onBack={() => {}} pairTrezor={null} pairLedger={null} />,
        unlocked: <PairSignerForm mode="add" onBack={() => {}} pairTrezor={null} pairLedger={null} />,
    },
];

function draw(children, { unlocked = false } = {}) {
    return render(
        <MessagingProvider shell="web" messaging={{}}>
            {unlocked ? <AppHeader /> : null}
            {children}
        </MessagingProvider>,
    );
}

afterEach(() => cleanup());

describe('G109 onboarding form headers', () => {
    it.each(forms)('$name has a page header but no app bar before a wallet exists', ({ heading, fresh }) => {
        draw(fresh);

        expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
        expect(screen.queryByRole('region', { name: 'App header' })).toBeNull();
    });

    it.each(forms)('$name keeps the unlocked shell app bar when adding a wallet', ({ heading, unlocked }) => {
        draw(unlocked, { unlocked: true });

        expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
        expect(screen.getByRole('region', { name: 'App header' })).toBeInTheDocument();
    });

    it('keeps the first-run hardware password page on the page header alone', () => {
        const source = readFileSync('packages/core/src/shared/components/HardwareFirstRun.jsx', 'utf8');
        expect(source).not.toContain('BootFrame');
        expect(source).toMatch(/<PageHeader[\s\S]*?title=\{SET_PASSWORD_TITLE\}/);
    });
});
