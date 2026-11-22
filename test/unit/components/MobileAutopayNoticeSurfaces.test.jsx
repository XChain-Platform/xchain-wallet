// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MobileAutopayNotice } from '../../../packages/core/src/shared/components/MobileAutopayNotice.jsx';
import { PlaceOrderPanel } from '../../../packages/core/src/shared/components/PlaceOrderPanel.jsx';
import { OpenOrdersPanel } from '../../../packages/core/src/shared/components/OpenOrdersPanel.jsx';
import { CreateOrderForm } from '../../../packages/core/src/shared/routes/CreateOrderForm.jsx';
import { OrderDetail } from '../../../packages/core/src/shared/routes/OrderDetail.jsx';

const surfaces = {
    PlaceOrderPanel: { component: PlaceOrderPanel, count: 2, file: 'components/PlaceOrderPanel' },
    OpenOrdersPanel: { component: OpenOrdersPanel, count: 1, file: 'components/OpenOrdersPanel' },
    CreateOrderForm: { component: CreateOrderForm, count: 1, file: 'routes/CreateOrderForm' },
    OrderDetail: { component: OrderDetail, count: 1, file: 'routes/OrderDetail' },
};

const noticeCount = (file) => fs.readFileSync(
    path.join(process.cwd(), 'packages/core/src/shared', `${file}.jsx`),
    'utf8',
).match(/<MobileAutopayNotice \/>/g)?.length ?? 0;

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('MobileAutopayNotice auto-pay surfaces', () => {
    it('keeps a notice beside every auto-pay surface', () => {
        for (const { component, count, file } of Object.values(surfaces)) {
            expect(component).toBeTypeOf('function');
            expect(noticeCount(file)).toBe(count);
        }
    });

    it.each(['ios', 'android'])('renders every surface on %s', (platform) => {
        vi.stubGlobal('Capacitor', { isNativePlatform: () => true, getPlatform: () => platform });
        for (const { count, file } of Object.values(surfaces)) {
            const { container } = render(<div>{Array.from({ length: noticeCount(file) }, (_, i) => <MobileAutopayNotice key={i} />)}</div>);
            expect(container.querySelectorAll('[data-testid="mobile-autopay-notice"]')).toHaveLength(count);
            cleanup();
        }
    });

    it('renders no surface notice on web', () => {
        vi.stubGlobal('Capacitor', { isNativePlatform: () => false, getPlatform: () => 'web' });
        for (const { file } of Object.values(surfaces)) {
            const { container } = render(<div>{Array.from({ length: noticeCount(file) }, (_, i) => <MobileAutopayNotice key={i} />)}</div>);
            expect(container.firstChild).toBeEmptyDOMElement();
            cleanup();
        }
    });
});
