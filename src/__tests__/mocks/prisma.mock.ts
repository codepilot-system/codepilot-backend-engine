import { jest } from '@jest/globals';

type MockFn = jest.Mock;

function createModelMock() {
  return {
    findUnique: jest.fn() as MockFn,
    findFirst: jest.fn() as MockFn,
    findMany: jest.fn() as MockFn,
    create: jest.fn() as MockFn,
    createMany: jest.fn() as MockFn,
    update: jest.fn() as MockFn,
    updateMany: jest.fn() as MockFn,
    upsert: jest.fn() as MockFn,
    delete: jest.fn() as MockFn,
    deleteMany: jest.fn() as MockFn,
    count: jest.fn() as MockFn,
  };
}

export const mockPrisma = {
  user: createModelMock(),
  session: createModelMock(),
  project: createModelMock(),
  projectMember: createModelMock(),
  scan: createModelMock(),
  issue: createModelMock(),
  suggestion: createModelMock(),
  suggestionsApply: createModelMock(),
  suggestionsApplyItem: createModelMock(),
  analytics: createModelMock(),
  $transaction: jest.fn() as MockFn,
  $disconnect: jest.fn() as MockFn,
  $connect: jest.fn() as MockFn,
};

function setDefaultModelReturns(model: ReturnType<typeof createModelMock>) {
  model.update.mockImplementation(async () => ({}));
  model.updateMany.mockImplementation(async () => ({ count: 0 }));
  model.create.mockImplementation(async () => ({}));
  model.createMany.mockImplementation(async () => ({ count: 0 }));
  model.delete.mockImplementation(async () => ({}));
  model.deleteMany.mockImplementation(async () => ({ count: 0 }));
  model.upsert.mockImplementation(async () => ({}));
}

for (const model of Object.values(mockPrisma)) {
  if (model && typeof model === 'object' && 'update' in model) {
    setDefaultModelReturns(model as ReturnType<typeof createModelMock>);
  }
}

mockPrisma.$transaction.mockImplementation(async (arg: unknown) => {
  if (typeof arg === 'function') {
    return (arg as (tx: typeof mockPrisma) => Promise<unknown>)(mockPrisma);
  }
  return Promise.all(arg as Promise<unknown>[]);
});

export function resetMockPrisma() {
  for (const [key, model] of Object.entries(mockPrisma)) {
    if (key.startsWith('$')) {
      (model as MockFn).mockClear();
      continue;
    }
    if (model && typeof model === 'object') {
      for (const fn of Object.values(model)) {
        (fn as MockFn).mockClear();
      }
      setDefaultModelReturns(model as ReturnType<typeof createModelMock>);
    }
  }

  mockPrisma.$transaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (tx: typeof mockPrisma) => Promise<unknown>)(mockPrisma);
    }
    return Promise.all(arg as Promise<unknown>[]);
  });
}

export default mockPrisma;
