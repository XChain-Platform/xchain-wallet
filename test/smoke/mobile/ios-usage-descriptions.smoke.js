// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

const infoPlist = read('packages/mobile/ios/App/App/Info.plist');
const cameraSource = read(
    'packages/mobile/ios/App/App/vault/VaultQrScannerViewController.swift',
);
const biometricSource = read(
    'packages/mobile/ios/App/App/vault/VaultBiometricSidecar.swift',
);
const attachmentSource = read('packages/core/src/shared/routes/ComposeMessage.jsx');
const endpointSource = read(
    'packages/core/src/shared/components/settings/NetworkEndpointsSection.jsx',
);

function plistString(key) {
    const match = new RegExp(
        `<key>${key}</key>\\s*<string>([^<]*)</string>`,
    ).exec(infoPlist);
    return match?.[1];
}

const usedCapabilities = [
    {
        name: 'camera QR scanning',
        key: 'NSCameraUsageDescription',
        used: /AVCaptureSession/.test(cameraSource)
            && /metadataObjectTypes\s*=\s*\[\.qr\]/.test(cameraSource),
        purpose: /camera.*scan QR codes/i,
    },
    {
        name: 'Face ID wallet unlock',
        key: 'NSFaceIDUsageDescription',
        used: /LAContext\(\)/.test(biometricSource) && /biometryCurrentSet/.test(biometricSource),
        purpose: /Face ID.*unlock/i,
    },
    {
        name: 'photo library image selection',
        key: 'NSPhotoLibraryUsageDescription',
        used: /type="file"/.test(attachmentSource) && /PNG, JPEG/.test(attachmentSource),
        purpose: /photo library.*(?:attachment|import)/i,
    },
    {
        name: 'local network endpoints',
        key: 'NSLocalNetworkUsageDescription',
        used: /localhost/.test(endpointSource) && /local hosts/.test(endpointSource),
        purpose: /(?:node|service).*local network/i,
    },
];

for (const capability of usedCapabilities) {
    assert.ok(
        capability.used,
        `${capability.name} evidence moved; update this usage-description audit`,
    );
    const description = plistString(capability.key);
    assert.equal(
        typeof description,
        'string',
        `${capability.key} is required because the app uses ${capability.name}`,
    );
    assert.equal(
        description,
        description.trim(),
        `${capability.key} must not contain leading or trailing whitespace`,
    );
    assert.doesNotMatch(
        description,
        /[<$>&]|\$\(/,
        `${capability.key} must be plain literal wording`,
    );
    assert.match(
        description,
        capability.purpose,
        `${capability.key} must explain why the wallet needs ${capability.name}`,
    );
}

console.log(`ios usage descriptions smoke: ${usedCapabilities.length} capabilities covered`);
