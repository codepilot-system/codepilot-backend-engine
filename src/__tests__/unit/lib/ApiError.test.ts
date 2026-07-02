import { ApiError } from '../../../lib/ApiError';

describe('ApiError', () => {
  describe('constructor', () => {
    it('should create error with message and status code', () => {
      const error = new ApiError('Not found', 404);
      expect(error.message).toBe('Not found');
      expect(error.statusCode).toBe(404);
      expect(error.name).toBe('Error');
    });

    it('should mark error as operational', () => {
      const error = new ApiError('Test error', 400);
      expect(error.isOperational).toBe(true);
    });

    it('should be instanceof Error', () => {
      const error = new ApiError('Test error', 400);
      expect(error instanceof Error).toBe(true);
    });

    it('should have stack trace', () => {
      const error = new ApiError('Test error', 400);
      expect(error.stack).toBeDefined();
    });
  });
});
