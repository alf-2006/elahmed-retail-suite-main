// ============================================================
// STORAGE CORRUPTION TEST
// Tests storage safety layer under failure conditions
// Run: npx vitest run src/test/storageCorruption.test.ts
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Setup mocks
const mockLocalStorage: Record<string, string> = {};

const storageMock = {
  getItem: vi.fn((key: string) => mockLocalStorage[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    mockLocalStorage[key] = value;
  }),
  removeItem: vi.fn((key: string) => {
    delete mockLocalStorage[key];
  }),
  length: Object.keys(mockLocalStorage).length,
  key: vi.fn((i: number) => Object.keys(mockLocalStorage)[i] ?? null),
  clear: vi.fn(() => {
    Object.keys(mockLocalStorage).forEach(k => delete mockLocalStorage[k]);
  }),
};

beforeEach(() => {
  // Clear mock storage
  Object.keys(mockLocalStorage).forEach(k => delete mockLocalStorage[k]);
  
  // Mock localStorage
  vi.stubGlobal('localStorage', storageMock);
});

import { safeGetItem, safeSetItem, verifyIntegrity, StorageCorruptedError } from '@/lib/storage';

describe('Storage Corruption Tests', () => {
  // ─────────────────────────────────────────
  // TEST 1: Valid JSON
  // ─────────────────────────────────────────
  it('should parse valid JSON correctly', () => {
    const data = { name: 'Test', value: 123 };
    mockLocalStorage['gx_test'] = JSON.stringify(data);
    
    const result = safeGetItem('gx_test', {});
    expect(result).toEqual(data);
  });

  // ─────────────────────────────────────────
  // TEST 2: Empty string
  // ─────────────────────────────────────────
  it('should handle empty string gracefully', () => {
    mockLocalStorage['gx_test'] = '';
    
    const result = safeGetItem('gx_test', { fallback: true });
    expect(result).toEqual({ fallback: true });
  });

  // ─────────────────────────────────────────
  // TEST 3: Truncated JSON
  // ─────────────────────────────────────────
  it('should detect truncated JSON and return fallback', () => {
    mockLocalStorage['gx_test'] = '{"incomplete":'; // Missing closing
    
    const result = safeGetItem('gx_test', { fallback: true });
    expect(result).toEqual({ fallback: true });
  });

  // ─────────────────────────────────────────
  // TEST 4: Invalid primitive in object position
  // ─────────────────────────────────────────
  it('should detect invalid type at root level', () => {
    mockLocalStorage['gx_test'] = '123'; // Number, not object
    
    // This should still parse (valid JSON)
    const result = safeGetItem('gx_test', 0);
    expect(result).toBe(123);
  });

  // ─────────────────────────────────────────
  // TEST 5: Binary/invalid data
  // ─────────────────────────────────────────
  it('should detect binary/invalid data', () => {
    // Write binary-like data (non-UTF8)
    mockLocalStorage['gx_test'] = '\x00\x01\x02';
    
    const result = safeGetItem('gx_test', null);
    expect(result).toBeNull();
  });

  // ─────────────────────────────────────────
  // TEST 6: Partial object corruption
  // ─────────────────────────────────────────
  it('should handle partial object corruption', () => {
    const partial = '{"name": "Test", "value":';
    mockLocalStorage['gx_test'] = partial;
    
    const result = safeGetItem('gx_test', null);
    expect(result).toBeNull();
  });

  // ─────────────────────────────────────────
  // TEST 7: Checkpoint backup creation
  // ─────────────────────────────────────────
  it('should create backup on corruption detection', () => {
    mockLocalStorage['gx_test'] = 'invalid{json';
    
    const result = safeGetItem('gx_test', null);
    expect(result).toBeNull();
    
    // Backup should be created
    expect(mockLocalStorage['gx_test_CORRUPTED_BACKUP']).toBe('invalid{json');
  });

  // ─────────────────────────────────────────
  // TEST 8: Backup should not overwrite existing
  // ─────────────────────────────────────────
  it('should not overwrite existing backup', () => {
    mockLocalStorage['gx_test'] = 'invalid1';
    mockLocalStorage['gx_test_CORRUPTED_BACKUP'] = 'original_backup';
    
    const result = safeGetItem('gx_test', null);
    expect(result).toBeNull();
    
    // Should keep original backup
    expect(mockLocalStorage['gx_test_CORRUPTED_BACKUP']).toBe('original_backup');
  });

  // ─────────────────────────────────────────
  // TEST 9: Escape sequence corruption
  // ─────────────────────────────────────────
  it('should handle unclosed escape sequences', () => {
    mockLocalStorage['gx_test'] = '{"name": "Test\\u'; // Incomplete
    
    const result = safeGetItem('gx_test', null);
    expect(result).toBeNull();
  });

  // ─────────────────────────────────────────
  // TEST 10: Very large data handling
  // ─────────────────────────────────────────
  it('should handle very large strings efficiently', () => {
    const largeData = 'x'.repeat(100000);
    mockLocalStorage['gx_large'] = largeData;
    
    const start = performance.now();
    const result = safeGetItem('gx_large', '');
    const duration = performance.now() - start;
    
    expect(duration).toBeLessThan(50); // Should be fast
    expect(result).toBe(largeData);
  });
});

// ═══════════════════════════════════════════════════════════════════
// EXPECTED RESULTS
// ═══════════════════════════════════════════════════════════════════
//
// ✅ TEST 1-2: Valid data parsed correctly
// ✅ TEST 3-6: Corruption detected, fallback returned
// ✅ TEST 7: Backup created automatically
// ✅ TEST 8: Existing backup preserved
// ✅ TEST 9: Escape sequence issues handled
// ✅ TEST 10: Large data performance OK
//
// If any test fails:
// - Check localStorage mock setup
// - Review safeGetItem error handling
//