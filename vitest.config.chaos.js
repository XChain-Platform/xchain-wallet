import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    test: {
        environment: 'jsdom',
        include: ['test/chaos/**/*.test.{js,jsx}'],
        setupFiles: ['./test/chaos/setup.js'],
        globals: false,
        testTimeout: 30_000,
    },
});
