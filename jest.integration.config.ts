import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testTimeout: 60000,
  verbose: true,
  transformIgnorePatterns: [
    'node_modules/(?!(octokit|@octokit)/)',
  ],
  displayName: 'integration',
  testMatch: ['**/__tests__/integration/**/*.test.ts'],
  setupFiles: ['<rootDir>/src/__tests__/jest.unit-env.ts'],
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.integration.ts'],
  globalSetup: '<rootDir>/src/__tests__/jest.global-setup.ts',
  maxWorkers: 1,
};

export default config;
