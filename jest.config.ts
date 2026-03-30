/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: [
    '**/*.test.ts',
    '**/*.test.js',
  ],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: 'tsconfig.json',
      useESM: false,
      diagnostics: {
        ignoreDiagnostics: [151002],
      },
    }],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  // Only run actual test files, not old manual scripts
  testPathIgnorePatterns: [
    '/node_modules/',
    'test-config\\.js$',
    'test-eme\\.js$',
    'test-final-verification\\.js$',
    'test-full-handshake\\.js$',
    'test-http-ipfs\\.js$',
    'test-integration-workflow\\.js$',
    'test-ipfs-snapshot\\.js$',
    'test-nyx-compatibility\\.js$',
    'test-nyx-integration\\.js$',
    'test-practical-integration\\.js$',
    'test-ultimate-verification\\.js$',
  ],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  testTimeout: 30000,
  verbose: true,
};
