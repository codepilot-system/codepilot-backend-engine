import { jest } from '@jest/globals';
import { resetMockPrisma } from './mocks/prisma.mock';

// Apply Prisma mock for unit tests only
import './mocks/prisma-client.mock';

jest.mock('redis', () => ({
  createClient: jest.fn(() => ({
    on: jest.fn(),
    connect: jest.fn().mockImplementation(async () => undefined),
    mGet: jest.fn().mockImplementation(async () => [null, null]),
    multi: jest.fn(() => ({
      incr: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      incrBy: jest.fn().mockReturnThis(),
      exec: jest.fn().mockImplementation(async () => []),
    })),
    get: jest.fn().mockImplementation(async () => null),
    set: jest.fn().mockImplementation(async () => 'OK'),
    del: jest.fn().mockImplementation(async () => 1),
  })),
}));

(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

beforeEach(() => {
  resetMockPrisma();
});

global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
