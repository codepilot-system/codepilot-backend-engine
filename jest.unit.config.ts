import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testTimeout: 30000,
  verbose: true,
  transformIgnorePatterns: [
    'node_modules/(?!(octokit|@octokit)/)',
  ],
  displayName: 'unit',
  testMatch: ['**/__tests__/unit/**/*.test.ts'],
  setupFiles: ['<rootDir>/src/__tests__/jest.unit-env.ts'],
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.unit.ts'],
};

export default config;
