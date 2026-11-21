// SPDX-License-Identifier: AGPL-3.0-or-later

export function watchIconPlan() {
    const source = 'packages/mobile/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png';

    return [
        {
            source,
            dest: 'packages/mobile/ios/App/WatchApp/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png',
            px: 1024,
        },
        {
            source,
            dest: 'packages/mobile/android/wear/src/main/res/mipmap-mdpi/ic_launcher.png',
            px: 48,
        },
        {
            source,
            dest: 'packages/mobile/android/wear/src/main/res/mipmap-hdpi/ic_launcher.png',
            px: 72,
        },
        {
            source,
            dest: 'packages/mobile/android/wear/src/main/res/mipmap-xhdpi/ic_launcher.png',
            px: 96,
        },
        {
            source,
            dest: 'packages/mobile/android/wear/src/main/res/mipmap-xxhdpi/ic_launcher.png',
            px: 144,
        },
        {
            source,
            dest: 'packages/mobile/android/wear/src/main/res/mipmap-xxxhdpi/ic_launcher.png',
            px: 192,
        },
    ];
}

export function watchAppIconContents() {
    return {
        images: [
            {
                filename: 'AppIcon-1024.png',
                idiom: 'universal',
                platform: 'watchos',
                size: '1024x1024',
            },
        ],
        info: { author: 'xcode', version: 1 },
    };
}
