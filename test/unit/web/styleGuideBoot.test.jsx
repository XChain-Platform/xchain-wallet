// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

const boot = vi.hoisted(() => ({
    createRoot: vi.fn(),
    render: vi.fn(),
}));

vi.mock('react-dom/client', () => ({ createRoot: boot.createRoot }));
vi.mock('../../../packages/web/src/style-guide/StyleGuidePage.jsx', () => ({
    StyleGuidePage: () => null,
}));

async function runBoot() {
    return import('../../../packages/web/src/style-guide/main.jsx');
}

beforeEach(() => {
    vi.resetModules();
    boot.createRoot.mockReset().mockReturnValue({ render: boot.render });
    boot.render.mockReset();
    document.body.innerHTML = '';
});

describe('style guide boot', () => {
    it('mounts the catalog into its browser root', async () => {
        document.body.innerHTML = '<div id="xchain-styleguide-root"></div>';
        const container = document.getElementById('xchain-styleguide-root');

        await runBoot();

        expect(boot.createRoot).toHaveBeenCalledWith(container);
        expect(boot.render).toHaveBeenCalledTimes(1);
    });

    it('does nothing when opened outside the style-guide HTML shell', async () => {
        await runBoot();
        expect(boot.createRoot).not.toHaveBeenCalled();
        expect(boot.render).not.toHaveBeenCalled();
    });
});
