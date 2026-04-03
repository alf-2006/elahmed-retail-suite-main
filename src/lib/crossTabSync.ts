// ============================================================
// Cross-Tab Synchronization Utility
// V1: Real-time sync for multi-tab POS environments
// Handles: sales, inventory, settings synchronization
// ============================================================

// ─── Types ────────────────────────────────────────────────────────────

export type SyncEvent = {
  key: string;
  action: 'set' | 'delete';
  timestamp: number;
  tabId: string;
  source?: string;
};

type SyncListener = (event: SyncEvent) => void;

// ─── Constants ─────────────────────────────────────────────────────

const TAB_ID_KEY = 'gx_tab_id';
const LAST_MODIFIER_KEY = 'gx_last_modifier';
const SYNC_CHANNEL = 'gx-cross-tab-sync';

// Generate unique tab ID on load
function getTabId(): string {
  let id = sessionStorage.getItem(TAB_ID_KEY);
  if (id) return id;
  
  // Generate new ID
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  id = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  sessionStorage.setItem(TAB_ID_KEY, id);
  return id;
}

export const TAB_ID = getTabId();

// ─── State ─────────────────────────────────────────────────────

const listeners = new Set<SyncListener>();
let isInitialized = false;

// ─── Initialization ───────────────────────────────────────────

/**
 * Initialize cross-tab sync.
 * Call once on app startup.
 */
export function initCrossTabSync(): void {
  if (isInitialized) return;
  
  // Listen for storage events from other tabs
  window.addEventListener('storage', handleStorageEvent);
  
  // Also listen for custom sync events (same-tab)
  window.addEventListener(SYNC_CHANNEL, handleCustomEvent as EventListener);
  
  isInitialized = true;
  
  if (import.meta.env.DEV) {
    console.log(`[CrossTab] Initialized: tab=${TAB_ID}`);
  }
}

/**
 * Cleanup on unmount.
 */
export function destroyCrossTabSync(): void {
  window.removeEventListener('storage', handleStorageEvent);
  window.removeEventListener(SYNC_CHANNEL, handleCustomEvent as EventListener);
  listeners.clear();
  isInitialized = false;
}

// ─── Event Handlers ────────────────────────────────────────

function handleStorageEvent(e: StorageEvent): void {
  // Skip our own events
  if (e.key && e.key.startsWith(TAB_ID)) return;
  if (e.newValue?.includes(TAB_ID)) return;
  
  const event: SyncEvent = {
    key: e.key || '',
    action: e.newValue ? 'set' : 'delete',
    timestamp: Date.now(),
    tabId: 'unknown',
    source: 'storage',
  };
  
  dispatchEvent(event);
}

function handleCustomEvent(e: Event): void {
  const custom = e as CustomEvent<SyncEvent>;
  if (custom.detail?.tabId === TAB_ID) return; // Skip our own
  
  dispatchEvent(custom.detail);
}

// ─── Event Dispatch ─────────────────────────────────────────

function dispatchEvent(event: SyncEvent): void {
  listeners.forEach(listener => {
    try {
      listener(event);
    } catch (e) {
      console.error('[CrossTab] Listener error:', e);
    }
  });
}

// ─── Public API ────────────────────────────────────────

/**
 * Set a value and notify other tabs.
 */
export function syncSetItem(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
  
  // Record this tab as last modifier
  localStorage.setItem(LAST_MODIFIER_KEY, JSON.stringify({
    tabId: TAB_ID,
    timestamp: Date.now(),
  }));
  
  // Dispatch custom event for same-tab listeners
  const event: SyncEvent = {
    key,
    action: 'set',
    timestamp: Date.now(),
    tabId: TAB_ID,
  };
  window.dispatchEvent(new CustomEvent(SYNC_CHANNEL, { detail: event }));
}

/**
 * Delete a value and notify other tabs.
 */
export function syncRemoveItem(key: string): void {
  localStorage.removeItem(key);
  
  const event: SyncEvent = {
    key,
    action: 'delete',
    timestamp: Date.now(),
    tabId: TAB_ID,
  };
  window.dispatchEvent(new CustomEvent(SYNC_CHANNEL, { detail: event }));
}

/**
 * Check if another tab recently modified data.
 */
export function isStale(key: string, maxAgeMs = 5000): boolean {
  try {
    const modifier = localStorage.getItem(LAST_MODIFIER_KEY);
    if (!modifier) return false;
    
    const parsed = JSON.parse(modifier);
    if (parsed.tabId === TAB_ID) return false;
    
    return Date.now() - parsed.timestamp > maxAgeMs;
  } catch {
    return false;
  }
}

/**
 * Subscribe to cross-tab sync events.
 * Returns unsubscribe function.
 */
export function subscribeSync(listener: SyncListener): () => void {
  listeners.add(listener);
  
  // Auto-init if not already
  if (!isInitialized) {
    initCrossTabSync();
  }
  
  return () => listeners.delete(listener);
}

/**
 * Force refresh local cache from storage.
 * Use when detecting stale data from other tabs.
 */
export function forceRefresh(): void {
  // This is a signal - actual refresh is handled by repositories
  // listening to sync events
  window.dispatchEvent(new CustomEvent('gx-force-refresh', { 
    detail: { timestamp: Date.now(), tabId: TAB_ID } 
  }));
}

// ─── Helpers ──────────────────────────────────────────────

/**
 * Check if another tab is actively modifying.
 */
export function isAnotherTabActive(): boolean {
  try {
    const modifier = localStorage.getItem(LAST_MODIFIER_KEY);
    if (!modifier) return false;
    
    const parsed = JSON.parse(modifier);
    if (parsed.tabId === TAB_ID) return false;
    
    // Consider "active" if modified in last 2 seconds
    return Date.now() - parsed.timestamp < 2000;
  } catch {
    return false;
  }
}

/**
 * Get last modifier info.
 */
export function getLastModifier(): { tabId: string; timestamp: number } | null {
  try {
    const modifier = localStorage.getItem(LAST_MODIFIER_KEY);
    if (!modifier) return null;
    
    return JSON.parse(modifier);
  } catch {
    return null;
  }
}