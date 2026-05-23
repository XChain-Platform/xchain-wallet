import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
    root: fileURLToPath(new URL('../..', import.meta.url)),
    plugins: [react()],
    test: {
        environment: 'jsdom',
        include: ['test/chaos/**/*.test.{js,jsx}'],
        setupFiles: ['./test/chaos/setup.js'],
        globals: false,
        testTimeout: 30_000,
    },
});
