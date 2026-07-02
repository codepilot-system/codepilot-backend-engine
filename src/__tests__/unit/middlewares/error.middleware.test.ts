import { Request, Response, NextFunction } from 'express';
import { errorHandler } from '../../../middlewares/error.middleware';
import { ApiError } from '../../../lib/ApiError';

describe('Error Middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();

    mockReq = {
      method: 'GET',
      url: '/api/test',
    };

    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    mockNext = jest.fn();
  });

  describe('errorHandler', () => {
    it('should handle ApiError with correct status code and message', () => {
      const error = new ApiError('Not found', 404);

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        status: 'error',
        message: 'Not found',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should handle generic errors with 500 status', () => {
      const error = new Error('Something went wrong');

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        status: 'error',
        message: 'Internal server error',
      });
    });

    it('should handle Prisma P2025 error (record not found)', () => {
      const error = { code: 'P2025', message: 'Record not found' };

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        status: 'error',
        message: 'Record not found',
      });
    });

    it('should log error message', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      const error = new Error('Test error');

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(consoleSpy).toHaveBeenCalledWith('Error:', 'Test error');
      consoleSpy.mockRestore();
    });

    it('should handle error with no message', () => {
      const error = {};

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        status: 'error',
        message: 'Internal server error',
      });
    });

    it('should handle ApiError with default 500 status if not specified', () => {
      const error = new ApiError('Server error', 500);

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        status: 'error',
        message: 'Server error',
      });
    });
  });
});
