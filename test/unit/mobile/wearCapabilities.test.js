import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP_RES = resolve('packages/mobile/android/app/src/main/res');
const APP_WEAR = join(APP_RES, 'values', 'wear.xml');
const WATCH_WEAR = resolve('packages/mobile/android/wear/src/main/res/values/wear.xml');

function parseResource(file) {
    const document = new DOMParser().parseFromString(readFileSync(file, 'utf8'), 'application/xml');
    const error = document.querySelector('parsererror');
    if (error) throw new Error(`${file}: ${error.textContent}`);
    return document;
}

function capabilities(document) {
    return [...document.querySelectorAll('string-array[name="android_wear_capabilities"]')];
}

function items(array) {
    return [...array.children]
        .filter((item) => item.localName === 'item')
        .map((item) => item.textContent.trim());
}

function xmlFiles(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return xmlFiles(path);
        return entry.isFile() && entry.name.endsWith('.xml') ? [path] : [];
    });
}

describe('Wear Data Layer capability resources', () => {
    it('declares the phone capability as the only non-translatable item', () => {
        const arrays = capabilities(parseResource(APP_WEAR));
        expect(arrays).toHaveLength(1);
        const [array] = arrays;
        expect(array.getAttribute('translatable')).toBe('false');
        expect(array.children).toHaveLength(1);
        expect(items(array)).toEqual(['xchain_phone']);
    });

    it('declares the watch capability and app name', () => {
        const document = parseResource(WATCH_WEAR);
        const arrays = capabilities(document);
        expect(arrays).toHaveLength(1);
        const [array] = arrays;
        expect(array.getAttribute('translatable')).toBe('false');
        expect(array.children).toHaveLength(1);
        expect(items(array)).toEqual(['xchain_wear']);
        const appNames = [...document.querySelectorAll('string[name="app_name"]')];
        expect(appNames).toHaveLength(1);
        expect(appNames[0].textContent).toBe('XChain');
    });

    it('has no duplicate phone capability declaration in another values file', () => {
        const declarations = readdirSync(APP_RES, { withFileTypes: true })
            .filter((entry) => entry.isDirectory() && entry.name.startsWith('values'))
            .flatMap((entry) => xmlFiles(join(APP_RES, entry.name)))
            .filter((file) => capabilities(parseResource(file)).length > 0)
            .sort();

        expect(declarations).toEqual([APP_WEAR]);
    });
});
