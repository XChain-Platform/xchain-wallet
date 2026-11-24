// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    DUO_STATES,
    checkMeasuredWidths,
} from '../../../packages/mobile/scripts/duo-fixture.js';

const path = resolve(process.cwd(), 'test/fixtures/duo/measured-widths.json');
const scriptPath = resolve(process.cwd(), 'packages/mobile/scripts/duo-measure.sh');

describe('Duo measured widths fixture', () => {
    it('generates the web and iOS inputs before measuring', () => {
        const source = readFileSync(scriptPath, 'utf8');

        expect(source).toContain('pnpm --filter @xchain-wallet/web build');
        expect(source).toContain('pnpm --filter @xchain-wallet/mobile sync:ios');
        expect(source.indexOf('sync:ios')).toBeLessThan(source.indexOf('xcodebuild -project'));
        expect(source).toContain('xcrun simctl install "$udid" "$app"');
    });

    it('lets embedded watch targets select their own simulator SDK', () => {
        const source = readFileSync(scriptPath, 'utf8');

        expect(source).toContain('[ "$1" = "-sdk" ]');
        expect(source).toContain('[ "${2:-}" = "iphonesimulator" ]');
        expect(source).toContain('PATH="$shim_dir:$PATH"');
        expect(source).toContain('DUO_XCODEBUILD="$real_xcodebuild"');
    });

    it('starts the fold publisher in the scratch measurement build', () => {
        const source = readFileSync(scriptPath, 'utf8');

        expect(source).toContain('probe_app="$scratch/App"');
        expect(source).toContain('ditto "$repo/packages/mobile/ios/App" "$probe_app"');
        expect(source).toContain('cp "$repo/packages/mobile/ios/debug.xcconfig" "$scratch/debug.xcconfig"');
        expect(source).toContain("grep -q 'var onIntent:' \"$watch_host\"");
        expect(source).toContain("! grep -q 'extension WatchSessionHost {' \"$watch_plugin\"");
        expect(source).toContain('FoldPublisher(webView: webView)');
        expect(source).toContain('DUO_SOURCE_PROJECT="$source_project"');
        expect(source).toContain('DUO_PROBE_PROJECT="$probe_project"');
    });

    it('measures only the posture from a clean stable boot', () => {
        const source = readFileSync(scriptPath, 'utf8');

        expect(source).toContain('xcrun simctl shutdown "$udid"');
        expect(source).toContain('xcrun simctl boot "$udid"');
        expect(source).toContain('xcrun simctl bootstatus "$udid" -b');
        expect(source).toContain('wait_for_springboard');
        expect(source).toContain('$2 == 0');
        expect(source).toContain('[ "$stable" -ge 3 ]');
        expect(source).toContain('SIMCTL_CHILD_NSUnbufferedIO=YES');
        expect(source.match(/xcrun simctl launch --console --terminate-running-process/g)).toHaveLength(1);
        expect(source).toContain('deadline=$((SECONDS + 90))');
        expect(source).toContain("grep -Fq 'fold: ' \"$log\"");
        expect(source).toContain("state = `${fold.posture}-${orientation}`");
        expect(source).not.toContain('screenConfig --display');
        expect(source).not.toContain('configure_display');
        expect(source).not.toContain('recover_springboard');
        expect(source).not.toContain('warm_at=');
        expect(source).not.toContain('DURATION=');
    });

    it('diagnoses capture failures before stopping the console', () => {
        const source = readFileSync(scriptPath, 'utf8');
        const failure = source.indexOf('first fold line did not arrive');

        expect(source).toContain('console log is empty');
        expect(source).toContain('xcrun simctl get_app_container');
        expect(source).toContain('launchctl list before stopping console');
        expect(source).toContain('app running: yes');
        expect(source).toContain('app running: no');
        expect(source.indexOf('diagnose_capture', failure)).toBeLessThan(
            source.indexOf('stop_launch', failure),
        );
    });

    it('records every state as measured or unreachable', () => {
        const fixture = JSON.parse(readFileSync(path, 'utf8'));

        expect(fixture.device).toBe('XC iPhone Duo');
        expect(checkMeasuredWidths(fixture)).toEqual([]);
        expect(Object.keys(fixture.states)).toEqual(DUO_STATES);
        expect(Object.values(fixture.states).filter((state) => !state.unreachable)).toHaveLength(1);
        for (const name of DUO_STATES) {
            const state = fixture.states[name];
            if (Object.hasOwn(state, 'unreachable')) {
                expect(state).toEqual({
                    unreachable: 'simctl io screenConfig crashes SpringBoard on this simulator runtime',
                });
            } else {
                expect(state).toEqual({
                    width: expect.any(Number),
                    height: expect.any(Number),
                    division: expect.objectContaining({ orientation: expect.any(String) }),
                });
            }
        }
    });
});
