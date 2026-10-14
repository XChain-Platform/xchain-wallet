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
import { describe, expect, it } from 'vitest';

import {
    findWeakerLifecycleOverrides,
    parseLifecycleOverrides,
} from '../smoke/mobile/android-lifecycle-access.smoke.js';

const read = (path) => readFileSync(path, 'utf8');

describe('mobile Android compile gates', () => {
    it('runs for develop pushes and every pull request into develop or master', () => {
        const workflow = read('.github/workflows/mobile.yml');
        const triggers = workflow.slice(workflow.indexOf('\non:\n'), workflow.indexOf('\nconcurrency:\n'));

        expect(triggers).toMatch(/\n  push:\n    branches: \[develop\]\n    tags: \['v\*'\]/);
        expect(triggers).toMatch(/\n  pull_request:\n    branches: \[develop, master\]/);
        expect(triggers).not.toMatch(/^\s+paths:/m);
    });

    it('derives public lifecycle access from Capacitor and rejects weaker overrides', () => {
        const bridge = read(
            'node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/BridgeActivity.java',
        );
        const publicMethods = new Set(parseLifecycleOverrides(bridge, '.java')
            .filter(({ access }) => access === 'public')
            .map(({ method }) => method));

        expect([...publicMethods]).toEqual([
            'onStart',
            'onResume',
            'onPause',
            'onStop',
            'onDestroy',
            'onRequestPermissionsResult',
        ]);

        expect(findWeakerLifecycleOverrides(`
            @Override
            protected void onStart() {}
            @Override
            protected void onActivityResult(int requestCode, int resultCode, Intent data) {}
        `, '.java', publicMethods)).toMatchObject([
            { method: 'onStart', access: 'protected' },
        ]);

        expect(findWeakerLifecycleOverrides(`
            private override fun onResume() {}
            protected override fun onNewIntent(intent: Intent) {}
            override fun onStop() {}
        `, '.kt', publicMethods)).toMatchObject([
            { method: 'onResume', access: 'private' },
        ]);
    });
});
