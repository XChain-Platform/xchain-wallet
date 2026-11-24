// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
    javaPluginSurface,
    swiftPluginSurface,
} from '../../helpers/nativePluginSurface.js';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('native plugin surface readers', () => {
    it('reads the current Swift plugins', () => {
        expect(swiftPluginSurface(read(
            'packages/mobile/ios/App/App/links/XChainLinksPlugin.swift',
        ))).toEqual({
            identifier: 'XChainLinksPlugin',
            jsName: 'XChainLinks',
            methods: ['takePendingLink'],
        });
        expect(swiftPluginSurface(read(
            'packages/mobile/ios/App/App/clipboard/XChainClipboardPlugin.swift',
        ))).toEqual({
            identifier: 'XChainClipboardPlugin',
            jsName: 'XChainClipboard',
            methods: ['write', 'clear'],
        });
    });

    it('reads the current Java plugins', () => {
        expect(javaPluginSurface(read(
            'packages/mobile/android/app/src/main/java/io/xchain/wallet/android/links/'
            + 'XChainLinksPlugin.java',
        ))).toEqual({
            name: 'XChainLinks',
            methods: ['takePendingLink', 'post', 'resolveHost'],
        });
        expect(javaPluginSurface(read(
            'packages/mobile/android/app/src/main/java/io/xchain/wallet/android/clipboard/'
            + 'XChainClipboardPlugin.java',
        ))).toEqual({
            name: 'XChainClipboard',
            methods: ['write', 'clear'],
        });
    });

    it('ignores commented-out Swift methods', () => {
        const source = `
            public let identifier = "InlinePlugin"
            public let jsName = "Inline"
            // CAPPluginMethod(name: "lineComment", returnType: CAPPluginReturnPromise)
            public let pluginMethods: [CAPPluginMethod] = [
                CAPPluginMethod(name: "active", returnType: CAPPluginReturnPromise),
                /* CAPPluginMethod(name: "blockComment", returnType: CAPPluginReturnPromise) */
            ]
        `;

        expect(swiftPluginSurface(source)).toEqual({
            identifier: 'InlinePlugin',
            jsName: 'Inline',
            methods: ['active'],
        });
    });

    it('reads annotated Java methods and ignores commented-out ones', () => {
        const source = `
            @CapacitorPlugin(name = "Inline")
            public class InlinePlugin {
                // @PluginMethod
                // public void lineComment(PluginCall call) {}
                @PluginMethod
                public void first(PluginCall call) {}
                @PluginMethod(returnType = PluginMethod.RETURN_NONE)
                public void second(PluginCall call) {}
                /*
                @PluginMethod
                public void blockComment(PluginCall call) {}
                */
            }
        `;

        expect(javaPluginSurface(source)).toEqual({
            name: 'Inline',
            methods: ['first', 'second'],
        });
    });

    it('returns null names and no methods when plugin declarations are absent', () => {
        expect(swiftPluginSurface('// no plugin here')).toEqual({
            identifier: null,
            jsName: null,
            methods: [],
        });
        expect(javaPluginSurface('/* no plugin here */')).toEqual({
            name: null,
            methods: [],
        });
    });
});
