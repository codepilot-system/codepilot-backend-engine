import { Request, Response, NextFunction } from 'express';
import { authenticate, AuthRequest } from '../../../middlewares/auth.middleware';
import { ApiError } from '../../../lib/ApiError';
import { ENV } from '../../../config/env.config';
import jwt from 'jsonwebtoken';

jest.mock('jsonwebtoken');

jest.mock('../../../config/env.config', () => ({
  ENV: {
    JWT_ACCESS_SECRET: 'test-secret',
  }
}));

describe('Auth Middleware', () => {
  let mockReq: Partial<AuthRequest>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();

    mockReq = {
      headers: {},
    };

    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    mockNext = jest.fn();
  });

  describe('authenticate', () => {
    it('should call next() with valid Bearer token', () => {
      mockReq.headers = { authorization: 'Bearer valid-token' };
      (jwt.verify as jest.Mock).mockReturnValue({ userId: 1 });

      authenticate(mockReq as AuthRequest, mockRes as Response, mockNext);

      expect(jwt.verify).toHaveBeenCalledWith('valid-token', 'test-secret');
      expect(mockReq.user).toEqual({ userId: 1 });
      expect(mockNext).toHaveBeenCalled();
    });

    it('should throw ApiError if authorization header is missing', () => {
      mockReq.headers = {};

      expect(() => authenticate(mockReq as AuthRequest, mockRes as Response, mockNext)).toThrow(
        ApiError,
      );
    });

    it('should throw ApiError if authorization header does not start with Bearer', () => {
      mockReq.headers = { authorization: 'Basic invalid-token' };

      expect(() => authenticate(mockReq as AuthRequest, mockRes as Response, mockNext)).toThrow(
        ApiError,
      );
    });

    it('should throw ApiError if token is invalid', () => {
      mockReq.headers = { authorization: 'Bearer invalid-token' };
      (jwt.verify as jest.Mock).mockImplementation(() => {
        throw new Error('Invalid token');
      });

      expect(() => authenticate(mockReq as AuthRequest, mockRes as Response, mockNext)).toThrow(
        ApiError,
      );
    });

    it('should throw ApiError if token is expired', () => {
      mockReq.headers = { authorization: 'Bearer expired-token' };
      (jwt.verify as jest.Mock).mockImplementation(() => {
        throw new Error('Token expired');
      });

      expect(() => authenticate(mockReq as AuthRequest, mockRes as Response, mockNext)).toThrow(
        ApiError,
      );
    });

    it('should extract token from Bearer header correctly', () => {
      mockReq.headers = { authorization: 'Bearer my-token' };
      (jwt.verify as jest.Mock).mockReturnValue({ userId: 42 });

      authenticate(mockReq as AuthRequest, mockRes as Response, mockNext);

      expect(jwt.verify).toHaveBeenCalledWith('my-token', 'test-secret');
    });

    it('should handle malformed authorization header', () => {
      mockReq.headers = { authorization: 'Bearer' };

      expect(() => authenticate(mockReq as AuthRequest, mockRes as Response, mockNext)).toThrow(
        ApiError,
      );
    });
  });
});
