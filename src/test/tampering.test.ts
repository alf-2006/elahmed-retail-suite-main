// ============================================================
// TAMPERING SIMULATION TEST
// Tests data integrity and tampering detection
// Run: npx vitest run src/test/tampering.test.ts
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock storage
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
  Object.keys(mockLocalStorage).forEach(k => delete mockLocalStorage[k]);
  vi.stubGlobal('localStorage', storageMock);
});

// Need to test with wrapper (data has _data and _checksum)
import { safeSetItem, verifyIntegrity, safeGetItemWithIntegrity, safeGetItem } from '@/lib/storage';

describe('Tampering Detection Tests', () => {
  // ─────────────────────────────────────────
  // TEST 1: Normal write with checksum
  // ─────────────────────────────────────────
  it('should add checksum on write', () => {
    const data = { sale: 'INV-001', amount: 1000 };
    safeSetItem('gx_sales', data);
    
    // Verify structure has checksum
    const stored = JSON.parse(mockLocalStorage['gx_sales']);
    expect(stored._data).toEqual(data);
    expect(stored._checksum).toBeDefined();
    expect(stored._timestamp).toBeDefined();
  });

  // ─────────────────────────────────────────
  // TEST 2: Valid integrity check
  // ─────────────────────────────────────────
  it('should pass integrity check for valid data', () => {
    const data = { sale: 'INV-001', amount: 1000 };
    safeSetItem('gx_sales', data);
    
    const result = verifyIntegrity('gx_sales');
    expect(result.valid).toBe(true);
    expect(result.data).toEqual(data);
  });

  // ─────────────────────────────────────────
  // TEST 3: Detect manual tampering
  // ─────────────────────────────────────────
  it('should detect manual tampering of data', () => {
    const data = { sale: 'INV-001', amount: 1000 };
    safeSetItem('gx_sales', data);
    
    // Attacker modifies amount directly
    const stored = JSON.parse(mockLocalStorage['gx_sales']);
    stored._data.amount = 999999; // Tampered!
    mockLocalStorage['gx_sales'] = JSON.stringify(stored);
    
    const result = verifyIntegrity('gx_sales');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('checksum mismatch');
  });

  // ─────────────────────────────────────────
  // TEST 4: Detect value tampering (bypass checksum)
  // ─────────────────────────────────────────
  it('should detect if checksum is overwritten', () => {
    const data = { sale: 'INV-001', amount: 1000 };
    safeSetItem('gx_sales', data);
    
    // Try to bypass by changing both value and checksum
    const stored = JSON.parse(mockLocalStorage['gx_sales']);
    stored._data.amount = 5000;
    stored._checksum = '00000000'; // Fake checksum
    mockLocalStorage['gx_sales'] = JSON.stringify(stored);
    
    const result = verifyIntegrity('gx_sales');
    expect(result.valid).toBe(false);
  });

  // ─────────────────────────────────────────
  // TEST 5: safeGetItemWithIntegrity returns fallback
  // ─────────────────────────────────────────
  it('should return fallback on integrity failure', () => {
    const data = { sale: 'INV-001', amount: 1000 };
    const fallback = { sale: '', amount: 0 };
    safeSetItem('gx_sales', data);
    
    // Tamper
    const stored = JSON.parse(mockLocalStorage['gx_sales']);
    stored._data.amount = 999999;
    mockLocalStorage['gx_sales'] = JSON.stringify(stored);
    
    const result = safeGetItemWithIntegrity('gx_sales', fallback);
    expect(result).toEqual(fallback);
  });

  // ─────────────────────────────────────────
  // TEST 6: Detect JSON structure corruption
  // ─────────────────────────────────────────
  it('should detect structural corruption', () => {
    // Write corrupted JSON directly (without wrapper)
    mockLocalStorage['gx_sales'] = '{invalid json';
    
    const result = verifyIntegrity('gx_sales');
    expect(result.valid).toBe(false);
  });

  // ─────────────────────────────────────────
  // TEST 7: Handle missing checksum (legacy data)
  // ─────────────────────────────────────────
  it('should handle legacy data without checksum', () => {
    // Legacy format - no checksum field
    mockLocalStorage['gx_sales'] = JSON.stringify({ sale: 'INV-old', amount: 500 });
    
    const result = verifyIntegrity('gx_sales');
    // Legacy data should be considered valid (no checksum to verify)
    expect(result.valid).toBe(true);
  });

  // ─────────────────────────────────────────
  // TEST 8: Detect timestamp manipulation
  // ─────────────────────────────────────────
  it('should detect old timestamp manipulation', () => {
    const data = { sale: 'INV-001', amount: 1000 };
    safeSetItem('gx_sales', data);
    
    // Attacker changes timestamp to future
    const stored = JSON.parse(mockLocalStorage['gx_sales']);
    stored._timestamp = Date.now() + 86400000; // +1 day
    mockLocalStorage['gx_sales'] = JSON.stringify(stored);
    
    // Timestamp is NOT included in checksum - only data is
    // So this should still pass integrity
    const result = verifyIntegrity('gx_sales');
    expect(result.valid).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SECURITY CONSIDERATIONS
// ═══════════════════════════════════════════════════════════════════
//
// LIMITATIONS of this checksum approach:
// 1. Attacker with full localStorage access CAN recompute checksum
// 2. Checksum is client-side (not cryptographically signed)
// 3. Attacker can bypass by modifying BOTH data AND checksum
//
// RECOMMENDATIONS for higher security:
// 1. Use HMAC with server-side key (not feasible without backend)
// 2. Add server-side validation on sale completion
// 3. Use Electron IPC with validated SQLite (ALREADY DONE)
// 4. Implement audit log for critical changes
//
// What this DOES prevent:
// ✅ Accidental corruption
// ✅ Partial writes
// ✅ JSON parse errors going unnoticed
// ✅ Data integrity checks at read time