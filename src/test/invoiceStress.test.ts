// ============================================================
// INVOICE STRESS TEST
// Tests invoice generation under extreme load
// Run: npx vitest run src/test/invoiceStress.test.ts
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock crypto for Node environment
const mockRandomValues = (arr: Uint8Array) => {
  for (let i = 0; i < arr.length; i++) {
    arr[i] = Math.floor(Math.random() * 256);
  }
};

// Setup global crypto if missing
if (typeof crypto === 'undefined' || !crypto.getRandomValues) {
  (globalThis as any).crypto = {
    getRandomValues: mockRandomValues,
  };
}

// Import after mocking
import { generateInvoiceNumber } from '@/services/saleService';

describe('Invoice System Stress Tests', () => {
  beforeEach(() => {
    // Reset environment
    vi.restoreAllMocks();
  });

  // ─────────────────────────────────────────
  // TEST 1: Generate 10,000 invoices rapidly
  // ─────────────────────────────────────────
  it('should generate 10,000 invoices without collision', () => {
    const invoices = new Set<string>();
    const startTime = performance.now();

    for (let i = 0; i < 10000; i++) {
      const invoice = generateInvoiceNumber();
      invoices.add(invoice);
    }

    const duration = performance.now() - startTime;

    expect(invoices.size).toBe(10000); // No duplicates!
    
    console.log(`[Invoice Stress] 10,000 invoices in ${duration.toFixed(2)}ms`);
    console.log(`[Invoice Stress] Rate: ${(10000 / (duration / 1000)).toFixed(0)}/sec`);
  });

  // ─────────────────────────────────────────
  // TEST 2: Format validation
  // ─────────────────────────────────────────
  it('should generate valid invoice format', () => {
    const invoice = generateInvoiceNumber();
    
    // Format: INV-YYYY-MM-DD-HHMMSS-SSS-XXXXXXXX
    const regex = /^INV-\d{4}-\d{2}-\d{2}-\d{6}-\d{3}-[a-f0-9]{8}$/;
    expect(regex.test(invoice)).toBe(true);
    
    console.log(`[Invoice] Sample: ${invoice}`);
  });

  // ─────────────────────────────────────────
  // TEST 3: Timestamp uniqueness
  // ─────────────────────────────────────────
  it('should have unique timestamps within high-frequency generation', () => {
    const timestamps: string[] = [];
    
    // Generate in tight loop (same millisecond)
    for (let i = 0; i < 1000; i++) {
      const invoice = generateInvoiceNumber();
      // Extract timestamp part: INV-2024-01-15-143052-123
      const parts = invoice.split('-');
      const timestamp = parts.slice(1, 5).join('-'); // YYYY-MM-DD-HHMMSS
      timestamps.push(timestamp);
    }

    // In 1000 iterations, we should see multiple different timestamps
    // (since we're faster than milliseconds)
    const uniqueTimestamps = new Set(timestamps);
    expect(uniqueTimestamps.size).toBeGreaterThan(1);
    
    console.log(`[Invoice] Unique timestamps in 1000 calls: ${uniqueTimestamps.size}`);
  });

  // ─────────────────────────────────────────
  // TEST 4: Random suffix entropy
  // ─────────────────────────────────────────
  it('should have high-entropy random suffixes', () => {
    const suffixes = new Set<string>();
    
    for (let i = 0; i < 10000; i++) {
      const invoice = generateInvoiceNumber();
      const suffix = invoice.split('-').pop(); // Last part = random
      suffixes.add(suffix!);
    }

    // 8 hex chars = 4,294,967,296 possible values
    // With 10,000 samples, collision probability is negligible
    expect(suffixes.size).toBe(10000);
    
    console.log(`[Invoice] All 10,000 random suffixes unique: ✅`);
  });

  // ─────────────────────────────────────────
  // TEST 5: Ordering verification
  // ─────────────────────────────────────────
  it('should maintain ordering (later invoices > earlier)', () => {
    const invoices: string[] = [];
    
    // Generate batch with slight delays
    for (let i = 0; i < 100; i++) {
      invoices.push(generateInvoiceNumber());
    }

    // Each should be greater than previous (lexicographically)
    let ordered = true;
    for (let i = 1; i < invoices.length; i++) {
      if (invoices[i] <= invoices[i - 1]) {
        ordered = false;
        break;
      }
    }

    expect(ordered).toBe(true);
    console.log(`[Invoice] Ordering verified: ✅`);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST RESULTS INTERPRETATION
// ═══════════════════════════════════════════════════════════════
// 
// Expected outcomes:
// ✅ TEST 1: 10,000 unique invoices in <1000ms (fast!)
// ✅ TEST 2: Format matches regex exactly
// ✅ TEST 3: Multiple timestamps (millisecond precision + random suffix)
// ✅ TEST 4: No random suffix collisions
// ✅ TEST 5: All invoices ordered correctly
// 
// If any test fails:
// - Collision: Check random generation (crypto.getRandomValues)
// - Ordering: Check timestamp generation
// - Slow: Consider batch generation if needed
//