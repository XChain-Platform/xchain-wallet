import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    test: {
        environment: 'jsdom',
        include: ['test/a11y/**/*.a11y.test.{js,jsx}'],
        setupFiles: ['./test/a11y/setup.js'],
        globals: false,
        testTimeout: 30_000,
    },
});
