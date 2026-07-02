import { jest } from '@jest/globals';
import { mockPrisma } from './prisma.mock';

jest.mock('../../lib/prisma', () => ({
  __esModule: true,
  default: mockPrisma,
}));
