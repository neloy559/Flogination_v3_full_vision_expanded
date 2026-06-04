/** @type {import('jest').Config} */
const path = require('path');

const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/__tests__'],
  moduleNameMapper: {
    // Mock React hooks — tests only exercise pure helper functions
    '^react$': '<rootDir>/__mocks__/react.js',
    // Mock Next.js
    '^next/(.*)$': '<rootDir>/__mocks__/next.js',
    // Mock the Zustand store
    '^\\.\\./\\.\\./\\.\\./\\.\\./\\.\\./src/store$': '<rootDir>/__mocks__/store.js',
    '^\\.\\./\\.\\./\\.\\./\\.\\./\\.\\./src/store/(.*)$': '<rootDir>/__mocks__/store.js',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          moduleResolution: 'node',
          jsx: 'react',
          esModuleInterop: true,
          strict: true,
          skipLibCheck: true,
          // Allow importing from outside rootDir (for src/types)
          rootDir: path.resolve(__dirname, '../..'),
        },
      },
    ],
  },
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
};

module.exports = config;
