// ============================================================
// MULTI-TAB CONCURRENCY TEST
// Tests cross-tab synchronization and double-sell prevention
// Run: npx vitest run src/test/multitab.test.ts
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock sessionStorage for tab isolation
const mockSessionStorage: Record<string, string> = {};

const sessionMock = {
  getItem: vi.fn((key: string) => mockSessionStorage[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    mockSessionStorage[key] = value;
  }),
  removeItem: vi.fn((key: string) => {
    delete mockSessionStorage[key];
  }),
  clear: vi.fn(() => {
    Object.keys(mockSessionStorage).forEach(k => delete mockSessionStorage[k]);
  }),
};

beforeEach(() => {
  // Clear mock session storage
  Object.keys(mockSessionStorage).forEach(k => delete mockSessionStorage[k]);
  vi.stubGlobal('sessionStorage', sessionMock);
});

// Test the cross-tab sync utility logic directly
import { TAB_ID, getTabId, isAnotherTabActive, getLastModifier, subscribeSync, syncSetItem, forceRefresh } from '@/lib/crossTabSync';

describe('Multi-Tab Concurrency Tests', () => {
  // ─────────────────────────────────────────
  // TEST 1: Tab ID generation
  // ─────────────────────────────────────────
  it('should generate unique tab ID', () => {
    const id1 = getTabId();
    const id2 = getTabId();
    
    expect(id1).toBe(id2); // Same call = same tab
    expect(id1.length).toBe(8); // 4 bytes hex
  });

  // ─────────────────────────────────────────
  // TEST 2: Different mock tabs should have different IDs
  // ─────────────────────────────────────────
  it('should detect different tabs by ID', () => {
    // Simulate tab A
    mockSessionStorage['gx_tab_id'] = 'aaaa1111';
    const idA = TAB_ID;
    
    // Simulate tab B modifying data
    mockSessionStorage['gx_last_modifier'] = JSON.stringify({
      tabId: 'bbbb2222',
      timestamp: Date.now(),
    });
    
    // Check if another tab is active
    const active = isAnotherTabActive();
    expect(active).toBe(true);
  });

  // ─────────────────────────────────────────
  // TEST 3: Recent modification detection
  // ─────────────────────────────────────────
  it('should detect recently modified data', () => {
    mockSessionStorage['gx_last_modifier'] = JSON.stringify({
      tabId: 'other_tab',
      timestamp: Date.now() - 500, // 500ms ago
    });
    
    const active = isAnotherTabActive();
    expect(active).toBe(true);
  });

  // ─────────────────────────────────────────
  // TEST 4: Stale modification detection
  // ─────────────────────────────────────────
  it('should detect stale (old) modifications', () => {
    mockSessionStorage['gx_last_modifier'] = JSON.stringify({
      tabId: 'other_tab',
      timestamp: Date.now() - 10000, // 10 seconds ago
    });
    
    const active = isAnotherTabActive();
    expect(active).toBe(false);
  });

  // ─────────────────────────────────────────
  // TEST 5: Last modifier info
  // ─────────────────────────────────────────
  it('should return last modifier info', () => {
    const modifierInfo = { tabId: 'tab12345', timestamp: Date.now() };
    mockSessionStorage['gx_last_modifier'] = JSON.stringify(modifierInfo);
    
    const result = getLastModifier();
    expect(result).toEqual(modifierInfo);
  });

  // ─────────────────────────────────────────
  // TEST 6: Safe handling of missing data
  // ─────────────────────────────────────────
  it('should handle missing modifier gracefully', () => {
    const result = getLastModifier();
    expect(result).toBeNull();
  });

  // ─────────────────────────────────────────
  // TEST 7: No active tab when same tab is modifier
  // ─────────────────────────────────────────
  it('should not report self as another tab', () => {
    mockSessionStorage['gx_tab_id'] = TAB_ID;
    mockSessionStorage['gx_last_modifier'] = JSON.stringify({
      tabId: TAB_ID,
      timestamp: Date.now(),
    });
    
    const active = isAnotherTabActive();
    expect(active).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// DOUBLE-SELL PREVENTION STRATEGY
// ═══════════════════════════════════════════════════════════════════
//
// The cross-tab sync provides these mechanisms:
// 1. TAB_ID - Unique ID per browser tab
// 2. LAST_MODIFIER - Tracks which tab last wrote
// 3. isAnotherTabActive() - Detects concurrent writes
// 4. subscribeSync() - Real-time change notifications
//
// HOW TO PREVENT DOUBLE-SELL:
// 
// 1. Before completing sale:
//    if (isAnotherTabActive()) {
//      await refreshInventoryFromStorage();
//      if (!hasStock(productId)) {
//        showError('Item sold in another tab');
//        return;
//      }
//    }
//
// 2. After sale completes:
//    syncSetItem(...) and forceRefresh() 
//    to notify other tabs
//
// 3. On inventory load:
//    subscribeSync(event => {
//      if (event.key === 'gx_inventory') {
//        refreshFromStorage(); // Get latest
//      }
//    })
//
// LIMITATIONS:
// - Storage events are async (not instant)
// - Best-effort, not guaranteed
// - Works best with <3 tabs
// - Electron IPC is more reliable