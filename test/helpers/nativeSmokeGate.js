// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

export function nativeSmokeGate({ env = process.env, platform = process.platform } = {}) {
    const enabled = typeof env.XCHAIN_NATIVE_SMOKES === 'string'
        && env.XCHAIN_NATIVE_SMOKES.length > 0;

    if (!enabled) {
        return {
            run: false,
            exitCode: 0,
            line: 'SKIP XCHAIN_NATIVE_SMOKES is unset or empty',
        };
    }

    if (platform !== 'darwin') {
        return {
            run: false,
            exitCode: 1,
            line: `Native smokes require darwin; current platform is ${platform}`,
        };
    }

    return { run: true };
}

export function applyNativeSmokeGate(name, options) {
    const gate = nativeSmokeGate(options);
    if (gate.run) return;

    const line = gate.exitCode === 0
        ? `SKIP ${name}: ${gate.line.replace(/^SKIP\s+/, '')}`
        : gate.line;
    console.log(line);
    process.exit(gate.exitCode);
}
