import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    test: {
        environment: 'jsdom',
        include: ['test/boundary/**/*.test.{js,jsx}'],
        setupFiles: ['./test/boundary/setup.js'],
        globals: false,
        testTimeout: 15_000,
    },
});
