import { encrypt, decrypt } from '../../../lib/encryption';
import { ENV } from '../../../config/env.config';

jest.mock('../../../config/env.config', () => ({
  ENV: {
    ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  },
}));

describe('encryption', () => {
  beforeEach(() => {
    // Reset key before each test
    ENV.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  });

  describe('encrypt', () => {
    it('should encrypt text successfully', () => {
      const plaintext = 'Hello, World!';
      const encrypted = encrypt(plaintext);
      
      expect(encrypted).toBeDefined();
      expect(encrypted).not.toBe(plaintext);
      expect(encrypted).toContain(':');
    });

    it('should produce different encrypted values for same input', () => {
      const plaintext = 'Hello, World!';
      const encrypted1 = encrypt(plaintext);
      const encrypted2 = encrypt(plaintext);
      
      expect(encrypted1).not.toBe(encrypted2);
    });

    it('should throw error if ENCRYPTION_KEY is not set', () => {
      ENV.ENCRYPTION_KEY = '';       
      expect(() => encrypt('test')).toThrow('ENCRYPTION_KEY is not defined');
    });

    it('should handle empty string', () => {
      const encrypted = encrypt('');
      expect(encrypted).toBeDefined();
    });

    it('should handle special characters', () => {
      const plaintext = 'Special chars: !@#$%^&*()_+-=[]{}|;:,.<>?';
      const encrypted = encrypt(plaintext);
      expect(encrypted).toBeDefined();
    });
  });

  describe('decrypt', () => {
    it('should decrypt encrypted text successfully', () => {
      const plaintext = 'Hello, World!';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);
      
      expect(decrypted).toBe(plaintext);
    });

    it('should throw error if ENCRYPTION_KEY is not set', () => {
      ENV.ENCRYPTION_KEY = ''; // Simulate missing key
      
      expect(() => decrypt('test')).toThrow('ENCRYPTION_KEY is not defined');
    });

    it('should throw error for malformed encrypted text', () => {
      expect(() => decrypt('invalid:format')).toThrow();
    });

    it('should handle empty string encryption/decryption', () => {
      const encrypted = encrypt('');
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe('');
    });

    it('should handle special characters', () => {
      const plaintext = 'Special chars: !@#$%^&*()_+-=[]{}|;:,.<>?';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });
  });

  describe('encrypt/decrypt round-trip', () => {
    it('should maintain data integrity through round-trip', () => {
      const testCases = [
        'simple text',
        'Text with numbers 12345',
        'Text with symbols !@#$%',
        'Multi\nline\ntext',
        'Text with unicode: café, 日本語, 🎉',
        'a'.repeat(1000), // Long text
      ];

      testCases.forEach((text) => {
        const encrypted = encrypt(text);
        const decrypted = decrypt(encrypted);
        expect(decrypted).toBe(text);
      });
    });
  });
});

