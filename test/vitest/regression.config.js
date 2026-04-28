import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
    root: '../..',
    plugins: [react()],
    test: {
        environment: 'jsdom',
        include: ['test/regression/**/*.regression.test.{js,jsx}'],
        setupFiles: ['./test/regression/setup.js'],
        globals: false,
        testTimeout: 15_000,
    },
});
