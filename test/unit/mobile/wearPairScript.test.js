// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { spawn, spawnSync } from 'node:child_process';
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const root = resolve(process.cwd());
const scriptSource = readFileSync(join(root, 'packages/mobile/scripts/wear-pair.sh'), 'utf8');
const uiDumpSource = readFileSync(join(root, 'packages/mobile/scripts/ui-dump.js'), 'utf8');
const androidTest = readFileSync(
    join(root, 'packages/mobile/android/app/src/androidTest/java/io/xchain/wallet/android/watch/WatchPairedTest.java'),
    'utf8',
);
const fixtureRoot = join(root, 'tmp');
const fixtures = [];
const javaFixtures = [];

afterEach(async () => {
    for (const fixture of fixtures.splice(0)) {
        const startedAvds = ['xc-phone-play', 'xc-wear-large-round'].filter((avd) => {
            const path = join(fixture.root, `tmp/watch-sim/wear-pair-${avd}.pid`);
            return existsSync(path);
        });
        run(fixture, ['--stop']);
        await expect.poll(() => startedAvds.every(
            (avd) => lines(fixture.log).some((line) => line.includes(`emulator-stopped -avd ${avd} `)),
        )).toBe(true);
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
        rmSync(fixture.root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    }
    for (const fixture of javaFixtures.splice(0)) {
        rmSync(fixture, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    }
});

describe('wear-pair.sh', () => {
    it('drives attached-device forwarding and companion UI pairing before instrumentation', () => {
        const fixture = makeFixture();
        const result = run(fixture, ['--device']);
        const commands = lines(fixture.log);

        expect(result.status).toBe(0);
        expect(result.stdout + result.stderr).not.toContain('signed-in@example.test');
        expect(commands).toContain('adb -d get-serialno');
        expect(commands).toContain('adb -s LGK500 shell getprop ro.product.model');
        expect(commands).toContain('adb -s LGK500 forward tcp:5601 tcp:5601');
        expect(commands.filter((line) => line.includes('uiautomator dump'))).toHaveLength(2);
        expect(commands.filter((line) => line.includes('xchain-wear-pair.xml'))).toHaveLength(4);
        expect(commands).toContain('adb -s LGK500 shell input tap 60 70');
        expect(commands).toContain('adb -s LGK500 shell input tap 300 400');
        expect(commands).toContain('watch-test gradle :app:assembleDebug :app:assembleDebugAndroidTest :wear:assembleDebug');
        expect(commands.some((line) => line.includes('WatchPairedTest'))).toBe(true);
        expect(commands.some((line) => line.includes('-avd xc-phone-play'))).toBe(false);
        expect(commands.some((line) => line.includes('-avd xc-wear-large-round -port 5570')
            && line.includes('-no-snapshot'))).toBe(true);
    });

    it('creates and boots the fallback phone AVD, then forwards through it', () => {
        const fixture = makeFixture();
        const result = run(fixture);
        const commands = lines(fixture.log);

        expect(result.status).toBe(0);
        expect(commands).toContain('sdkmanager --install system-images;android-36;google_apis_playstore;arm64-v8a');
        expect(commands).toContain('avdmanager create avd -n xc-phone-play -k system-images;android-36;google_apis_playstore;arm64-v8a -d pixel_6');
        expect(commands.some((line) => line.includes('-avd xc-phone-play -port 5560'))).toBe(true);
        expect(commands.some((line) => line.includes('-avd xc-phone-play')
            && line.includes('-no-snapshot'))).toBe(false);
        expect(commands).toContain('adb -s emulator-5560 forward tcp:5601 tcp:5601');
    });

    it('records every emulator pid and --stop terminates only those processes', async () => {
        const fixture = makeFixture();
        expect(run(fixture).status).toBe(0);
        const pidPaths = ['xc-phone-play', 'xc-wear-large-round'].map(
            (avd) => join(fixture.root, `tmp/watch-sim/wear-pair-${avd}.pid`),
        );
        const pids = pidPaths.map((path) => Number(readFileSync(path, 'utf8')));
        const unrelated = spawn('/bin/sleep', ['30'], { stdio: 'ignore' });

        expect(pids.every(alive)).toBe(true);
        expect(run(fixture, ['--stop']).status).toBe(0);
        await expect.poll(() => {
            const commands = lines(fixture.log);
            return ['xc-phone-play', 'xc-wear-large-round'].every(
                (avd) => commands.some((line) => line.includes(`emulator-stopped -avd ${avd} `)),
            );
        }).toBe(true);
        expect(pidPaths.every((path) => !existsSync(path))).toBe(true);
        expect(alive(unrelated.pid)).toBe(true);
        unrelated.kill();
    });

    it.each([
        [{ companion: false }, 'missing Wear OS companion app'],
        [{ model: 'Pixel 9' }, 'attached device is not the LG K500'],
    ])('names an unavailable device prerequisite', (options, message) => {
        const fixture = makeFixture(options);
        const result = run(fixture, ['--device']);

        expect(result.status).toBe(1);
        expect(result.stderr).toContain(message);
    });

    it('rejects Google authenticator services when the Accounts section is empty', () => {
        const fixture = makeFixture({ signIn: false });
        const result = run(fixture, ['--device']);

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('missing Google sign-in on LGK500');
    });

    it('rejects broad process termination', () => {
        expect(scriptSource).not.toMatch(/pkill|killall|adb kill-server/);
    });

    it('executes the Android capability predicate against connected node states', () => {
        const fixture = makeJavaFixture();
        const javaHome = process.env.JAVA_HOME || '/opt/homebrew/opt/openjdk@21';
        const javac = join(javaHome, 'bin/javac');
        const java = join(javaHome, 'bin/java');
        const compile = spawnSync(javac, ['-d', fixture.classes, ...fixture.sources], {
            encoding: 'utf8',
            timeout: 10_000,
        });

        expect(compile.status, compile.stderr).toBe(0);
        const execute = spawnSync(java, ['-cp', fixture.classes, 'WatchPairedHarness'], {
            encoding: 'utf8',
            timeout: 10_000,
        });
        expect(execute.status, execute.stderr).toBe(0);
        expect(execute.stdout.trim()).toBe('capability predicate scenarios passed');
    });
});

function makeJavaFixture() {
    mkdirSync(fixtureRoot, { recursive: true });
    const root = mkdtempSync(join(fixtureRoot, 'watch-paired-java-'));
    javaFixtures.push(root);
    const classes = join(root, 'classes');
    const sources = [];
    mkdirSync(classes, { recursive: true });
    const source = (name, contents) => {
        const path = join(root, 'src', name);
        put(path, contents);
        sources.push(path);
    };
    source('android/content/Context.java', 'package android.content; public class Context {}');
    source('androidx/test/ext/junit/runners/AndroidJUnit4.java',
        'package androidx.test.ext.junit.runners; public class AndroidJUnit4 {}');
    source('androidx/test/platform/app/InstrumentationRegistry.java', `package androidx.test.platform.app;
import android.content.Context;
public final class InstrumentationRegistry {
  public static Instrumentation getInstrumentation() { return new Instrumentation(); }
  public static final class Instrumentation { public Context getTargetContext() { return new Context(); } }
}`);
    source('org/junit/Test.java', 'package org.junit; public @interface Test {}');
    source('org/junit/runner/RunWith.java',
        'package org.junit.runner; public @interface RunWith { Class<?> value(); }');
    source('org/junit/Assert.java', `package org.junit;
public final class Assert {
  public static void assertTrue(String message, boolean value) {
    if (!value) throw new AssertionError(message);
  }
}`);
    source('com/google/android/gms/tasks/Task.java', `package com.google.android.gms.tasks;
public final class Task<T> {
  private final T value;
  public Task(T value) { this.value = value; }
  public T value() { return value; }
}`);
    source('com/google/android/gms/tasks/Tasks.java', `package com.google.android.gms.tasks;
import java.util.concurrent.TimeUnit;
public final class Tasks {
  public static <T> T await(Task<T> task, long timeout, TimeUnit unit) { return task.value(); }
}`);
    source('com/google/android/gms/wearable/Node.java', `package com.google.android.gms.wearable;
public final class Node {
  private final String id; private final boolean nearby;
  public Node(String id, boolean nearby) { this.id = id; this.nearby = nearby; }
  public String getId() { return id; }
  public boolean isNearby() { return nearby; }
}`);
    source('com/google/android/gms/wearable/CapabilityClient.java', `package com.google.android.gms.wearable;
import com.google.android.gms.tasks.Task;
public final class CapabilityClient {
  public static final int FILTER_REACHABLE = 1;
  public Task<CapabilityInfo> getCapability(String name, int filter) {
    if (!"xchain_wear".equals(name) || filter != FILTER_REACHABLE) return new Task<>(new CapabilityInfo(java.util.Set.of()));
    return new Task<>(new CapabilityInfo(Wearable.capable));
  }
}`);
    source('com/google/android/gms/wearable/CapabilityInfo.java', `package com.google.android.gms.wearable;
import java.util.Set;
public final class CapabilityInfo {
  private final Set<Node> nodes;
  public CapabilityInfo(Set<Node> nodes) { this.nodes = nodes; }
  public Set<Node> getNodes() { return nodes; }
}`);
    source('com/google/android/gms/wearable/NodeClient.java', `package com.google.android.gms.wearable;
import com.google.android.gms.tasks.Task; import java.util.List;
public final class NodeClient { public Task<List<Node>> getConnectedNodes() { return new Task<>(Wearable.connected); } }
`);
    source('com/google/android/gms/wearable/Wearable.java', `package com.google.android.gms.wearable;
import android.content.Context; import java.util.List; import java.util.Set;
public final class Wearable {
  static List<Node> connected = List.of(); static Set<Node> capable = Set.of();
  public static void configure(List<Node> nodes, Set<Node> capabilityNodes) { connected = nodes; capable = capabilityNodes; }
  public static NodeClient getNodeClient(Context context) { return new NodeClient(); }
  public static CapabilityClient getCapabilityClient(Context context) { return new CapabilityClient(); }
}`);
    source('io/xchain/wallet/android/watch/WatchPairedTest.java', androidTest);
    source('WatchPairedHarness.java', `import com.google.android.gms.wearable.Node;
import com.google.android.gms.wearable.Wearable;
import io.xchain.wallet.android.watch.WatchPairedTest;
import java.util.List; import java.util.Set;
public final class WatchPairedHarness {
  public static void main(String[] args) throws Exception {
    verify(true, List.of(new Node("watch", true)), Set.of(new Node("watch", false)));
    verify(false, List.of(new Node("watch", false)), Set.of(new Node("watch", false)));
    verify(false, List.of(new Node("watch", true)), Set.of(new Node("other", false)));
    verify(false, List.of(), Set.of(new Node("watch", false)));
    verify(false, List.of(new Node("watch", true)), Set.of());
    System.out.println("capability predicate scenarios passed");
  }
  private static void verify(boolean expected, List<Node> connected, Set<Node> capable) throws Exception {
    Wearable.configure(connected, capable);
    boolean passed = true;
    try {
      new WatchPairedTest().nearbyConnectedNodeAdvertisesWearCapability();
    } catch (AssertionError error) {
      passed = false;
    }
    if (passed != expected) throw new AssertionError("unexpected capability predicate result");
  }
}`);
    return { classes, sources };
}

function makeFixture(options = {}) {
    mkdirSync(fixtureRoot, { recursive: true });
    const fixture = {
        root: mkdtempSync(join(fixtureRoot, 'wear-pair-')),
        companion: options.companion ?? true,
        signIn: options.signIn ?? true,
        model: options.model ?? 'LG K500',
    };
    fixtures.push(fixture);
    fixture.sdk = join(fixture.root, 'android-sdk');
    fixture.bin = join(fixture.root, 'bin');
    fixture.log = join(fixture.root, 'tmp/commands.log');
    fixture.script = join(fixture.root, 'packages/mobile/scripts/wear-pair.sh');

    put(fixture.script, scriptSource, 0o755);
    put(join(fixture.root, 'packages/mobile/scripts/ui-dump.js'), uiDumpSource);
    put(join(fixture.root, 'package.json'), '{"type":"module"}\n');
    put(fixture.log, '');
    put(join(fixture.root, 'packages/mobile/scripts/watch-test.sh'), `#!/usr/bin/env bash
printf 'watch-test %s\\n' "$*" >> "$COMMAND_LOG"
`, 0o755);
    put(join(fixture.sdk, 'emulator/emulator'), `#!/usr/bin/env bash
printf 'emulator %s\\n' "$*" >> "$COMMAND_LOG"
trap 'printf "emulator-stopped %s\\n" "$*" >> "$COMMAND_LOG"; exit 0' TERM INT
while :; do sleep 1 & wait $!; done
`, 0o755);
    put(join(fixture.bin, 'ps'), `#!/usr/bin/env bash
pid="$2"
for avd in xc-phone-play xc-wear-large-round; do
  file="$FIXTURE_ROOT/tmp/watch-sim/wear-pair-$avd.pid"
  if [ -f "$file" ] && [ "$(tr -dc '0-9' < "$file")" = "$pid" ]; then
    printf '%s -avd %s\\n' "$XCHAIN_ANDROID_SDK/emulator/emulator" "$avd"
  fi
done
`, 0o755);
    put(join(fixture.sdk, 'cmdline-tools/latest/bin/sdkmanager'), `#!/usr/bin/env bash
printf 'sdkmanager %s\\n' "$*" >> "$COMMAND_LOG"
`, 0o755);
    put(join(fixture.sdk, 'cmdline-tools/latest/bin/avdmanager'), `#!/usr/bin/env bash
printf 'avdmanager %s\\n' "$*" >> "$COMMAND_LOG"
`, 0o755);
    put(join(fixture.sdk, 'platform-tools/adb'), `#!/usr/bin/env bash
printf 'adb %s\\n' "$*" >> "$COMMAND_LOG"
if [ "$1 $2" = '-d get-serialno' ]; then printf 'LGK500\\n'; exit 0; fi
case "$*" in
  *' emu avd name') exit 1 ;;
  *'-s emulator-5560 wait-for-device')
    until grep -Fq -- '-avd xc-phone-play ' "$COMMAND_LOG"; do sleep 0.01; done
    ;;
  *'-s emulator-5570 wait-for-device')
    until grep -Fq -- '-avd xc-wear-large-round ' "$COMMAND_LOG"; do sleep 0.01; done
    ;;
  *' shell getprop sys.boot_completed') printf '1\\n' ;;
  *' shell getprop ro.product.model') printf '%s\\n' "$DEVICE_MODEL" ;;
  *' shell pm path com.google.android.wearable.app')
    [ "$HAS_COMPANION" = 1 ] || exit 1
    printf 'package:wear.apk\\n'
    ;;
  *' shell dumpsys account')
    if [ "$HAS_SIGN_IN" = 1 ]; then
      printf '%s\\n' 'Accounts: 1' '  Account {name=signed-in@example.test, type=com.google}'
    else
      printf '%s\\n' 'Accounts: 0' 'AuthenticatorDescription {type=com.google}' 'ServiceInfo: type=com.google'
    fi
    ;;
  *' shell cat /sdcard/xchain-wear-pair.xml')
    printf '%s\\n' '<hierarchy><node text="Pair with emulator" bounds="[10,20][110,120]"/><node text="Pair" bounds="[200,300][400,500]"/></hierarchy>'
    ;;
  *' shell am instrument '*) printf 'OK (1 test)\\n' ;;
esac
`, 0o755);
    return fixture;
}

function run(fixture, args = []) {
    return spawnSync('/bin/bash', [fixture.script, ...args], {
        cwd: fixture.root,
        encoding: 'utf8',
        timeout: 10_000,
        env: {
            ...process.env,
            COMMAND_LOG: fixture.log,
            DEVICE_MODEL: fixture.model,
            HAS_COMPANION: fixture.companion ? '1' : '0',
            HAS_SIGN_IN: fixture.signIn ? '1' : '0',
            FIXTURE_ROOT: fixture.root,
            PATH: `${fixture.bin}:${process.env.PATH}`,
            XCHAIN_ANDROID_SDK: fixture.sdk,
        },
    });
}

function alive(pid) {
    try { process.kill(pid, 0); return true; } catch { return false; }
}

function lines(path) {
    return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean);
}

function put(path, contents, mode) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
    if (mode) chmodSync(path, mode);
}
