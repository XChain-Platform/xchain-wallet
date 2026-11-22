// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';

import { isSmokeSkipOutput } from '../../smoke/_run-smokes.js';
import {
    applyNativeSmokeGate,
    nativeSmokeGate,
} from '../../helpers/nativeSmokeGate.js';

describe('native smoke gate', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('skips when XCHAIN_NATIVE_SMOKES is unset', () => {
        expect(nativeSmokeGate({ env: {}, platform: 'darwin' })).toEqual({
            run: false,
            exitCode: 0,
            line: 'SKIP XCHAIN_NATIVE_SMOKES is unset or empty',
        });
    });

    it('skips when XCHAIN_NATIVE_SMOKES is empty', () => {
        expect(nativeSmokeGate({
            env: { XCHAIN_NATIVE_SMOKES: '' },
            platform: 'darwin',
        })).toEqual({
            run: false,
            exitCode: 0,
            line: 'SKIP XCHAIN_NATIVE_SMOKES is unset or empty',
        });
    });

    it('runs when XCHAIN_NATIVE_SMOKES is set on darwin', () => {
        expect(nativeSmokeGate({
            env: { XCHAIN_NATIVE_SMOKES: '1' },
            platform: 'darwin',
        })).toEqual({ run: true });
    });

    it.each(['linux', 'win32'])('fails when XCHAIN_NATIVE_SMOKES is set on %s', (platform) => {
        expect(nativeSmokeGate({
            env: { XCHAIN_NATIVE_SMOKES: '1' },
            platform,
        })).toEqual({
            run: false,
            exitCode: 1,
            line: `Native smokes require darwin; current platform is ${platform}`,
        });
    });

    it('prints a runner-compatible skip and exits successfully', () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        const exit = vi.spyOn(process, 'exit').mockImplementation(() => {});

        applyNativeSmokeGate('ios-build.smoke.js', {
            env: {},
            platform: 'darwin',
        });

        const line = 'SKIP ios-build.smoke.js: XCHAIN_NATIVE_SMOKES is unset or empty';
        expect(log).toHaveBeenCalledOnce();
        expect(log).toHaveBeenCalledWith(line);
        expect(isSmokeSkipOutput(line)).toBe(true);
        expect(exit).toHaveBeenCalledOnce();
        expect(exit).toHaveBeenCalledWith(0);
    });

    it('prints a non-skip failure and exits unsuccessfully off darwin', () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        const exit = vi.spyOn(process, 'exit').mockImplementation(() => {});

        applyNativeSmokeGate('ios-build.smoke.js', {
            env: { XCHAIN_NATIVE_SMOKES: '1' },
            platform: 'linux',
        });

        const line = 'Native smokes require darwin; current platform is linux';
        expect(log).toHaveBeenCalledOnce();
        expect(log).toHaveBeenCalledWith(line);
        expect(isSmokeSkipOutput(line)).toBe(false);
        expect(exit).toHaveBeenCalledOnce();
        expect(exit).toHaveBeenCalledWith(1);
    });

    it('returns without logging or exiting when the gate allows a run', () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        const exit = vi.spyOn(process, 'exit').mockImplementation(() => {});

        expect(applyNativeSmokeGate('ios-build.smoke.js', {
            env: { XCHAIN_NATIVE_SMOKES: '1' },
            platform: 'darwin',
        })).toBeUndefined();
        expect(log).not.toHaveBeenCalled();
        expect(exit).not.toHaveBeenCalled();
    });
});
