/** @type {import('jest').Config} */
const config = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          // Relax settings for test environment
          module: 'commonjs',
          moduleResolution: 'node',
          jsx: 'react',
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          strict: true,
          skipLibCheck: true,
        },
      },
    ],
  },
  testMatch: [
    '**/Flogination/flogination-web/__tests__/**/*.test.ts',
    '**/Flogination/flogination-web/__tests__/**/*.test.tsx',
  ],
  moduleNameMapper: {
    // Mock 'use client' React components' external dependencies
    '^react$': '<rootDir>/node_modules/react',
    '^react/jsx-runtime$': '<rootDir>/node_modules/react/jsx-runtime',
    // Mock the store and startPolling — not needed for pure function tests
    '^../../../../../src/store$': '<rootDir>/Flogination/flogination-web/__tests__/__mocks__/store.ts',
    '^../../../../../src/types$': '<rootDir>/src/types/index.ts',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
};

module.exports = config;
