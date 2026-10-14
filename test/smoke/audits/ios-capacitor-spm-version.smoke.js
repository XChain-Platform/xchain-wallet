// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Capacitor generates the Swift package pin from its installed iOS package.
// Keeping both generated copies aligned prevents cap sync ios from dirtying
// an otherwise unchanged checkout.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const readJson = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const capacitorVersion = readJson('node_modules/@capacitor/ios/package.json').version;
const packageSwift = readFileSync(join(root, 'packages/mobile/ios/App/CapApp-SPM/Package.swift'), 'utf8');
const packageResolved = readJson(
    'packages/mobile/ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved',
);

const swiftPin = packageSwift.match(
    /capacitor-swift-pm\.git",\s*exact:\s*"([^"]+)"/,
);
assert.ok(swiftPin, 'Package.swift must pin capacitor-swift-pm with an exact version');
assert.equal(
    swiftPin[1],
    capacitorVersion,
    `Package.swift pins capacitor-swift-pm ${swiftPin[1]}, but @capacitor/ios is ${capacitorVersion}`,
);

const resolvedPin = packageResolved.pins.find((pin) => pin.identity === 'capacitor-swift-pm');
assert.ok(resolvedPin, 'Package.resolved must contain the capacitor-swift-pm pin');
assert.equal(
    resolvedPin.state.version,
    capacitorVersion,
    `Package.resolved pins capacitor-swift-pm ${resolvedPin.state.version}, but @capacitor/ios is ${capacitorVersion}`,
);

console.log('OK - iOS Capacitor SPM version smoke (Swift package pins match installed @capacitor/ios)');
