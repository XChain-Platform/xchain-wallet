// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL(
    '../../mobile/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png',
    import.meta.url,
));
const destination = fileURLToPath(new URL('../public/icons/apple-touch-icon-180.png', import.meta.url));

await sharp(source)
    .resize(180, 180)
    .png()
    .toFile(destination);
