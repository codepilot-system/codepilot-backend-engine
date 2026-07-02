import { jest } from '@jest/globals';

// Mock Octokit
const mockOctokit = {
  request: jest.fn(),
  rest: {
    repos: {
      get: jest.fn(),
      listForAuthenticatedUser: jest.fn(),
      createWebhook: jest.fn(),
      deleteWebhook: jest.fn(),
    },
    pulls: {
      create: jest.fn(),
      list: jest.fn(),
      get: jest.fn(),
      update: jest.fn(),
    },
    git: {
      createRef: jest.fn(),
      deleteRef: jest.fn(),
      getRef: jest.fn(),
      createTree: jest.fn(),
      createCommit: jest.fn(),
    },
  },
};

// Mock GitHub App
const mockGithubApp = {
  getInstallationOctokit: jest.fn(),
  getUserOctokit: jest.fn(),
  webhooks: {
    on: jest.fn(),
    verifyAndReceive: jest.fn(),
  },
};

export { mockOctokit, mockGithubApp };
