// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    BackgroundConnectionState,
} from '../../../packages/extension/src/popup/backgroundConnection.jsx';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('popup background connection defaults', () => {
    it('provides the browser reload fallback when no callback is supplied', () => {
        const reload = vi.fn();
        vi.stubGlobal('window', { location: { reload } });

        const section = BackgroundConnectionState({ failed: true });
        const reloadButton = section.props.children[2];
        reloadButton.props.onClick();

        expect(reload).toHaveBeenCalledOnce();
    });
});
