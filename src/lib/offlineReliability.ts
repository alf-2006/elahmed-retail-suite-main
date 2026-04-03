// ============================================================
// OFFLINE-FIRST ENHANCEMENT
// Write durability and crash recovery
// V1: Production reliability for POS
// ============================================================

import { STORAGE_KEYS } from '@/config';

// ─── Types ────────────────────────────────────────────────────────────

export interface Write transaction {
  id: string;
  key: string;
  data: unknown;
  timestamp: number;
  status: 'pending' | 'committed' | 'failed';
  retries: number;
}

export interface CrashRecoveryState {
  lastCleanShutdown: string;
  pendingTransactions: WriteTransaction[];
  lastKnown-good key: string;
  recoveryAttempted: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────

const TRANSACTION_LOG_KEY = 'gx_transaction_log';
const CRASH_RECOVERY_KEY = 'gx_crash_recovery';
const MAX_RETRIES = 3;
const TRANSACTION_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

// In-memory transaction log for performance
let transactionLog: WriteTransaction[] = [];
let isInitialized = false;

// ─── Initialization ────────────────────────────────────────────

/**
 * Initialize offline reliability system.
 * Call on app startup.
 */
export function initOfflineReliability(): void {
  if (isInitialized) return;
  
  // Load pending transactions from storage
  try {
    const stored = localStorage.getItem(TRANSACTION_LOG_KEY);
    if (stored) {
      transactionLog = JSON.parse(stored);
      
      // Clean old transactions
      const now = Date.now();
      transactionLog = transactionLog.filter(
        t => t.status === 'pending' && now - t.timestamp < TRANSACTION_EXPIRY_MS
      );
    }
  } catch {
    transactionLog = [];
  }
  
  // Register shutdown handler
  window.addEventListener('beforeunload', handleShutdown);
  
  isInitialized = true;
  
  // Attempt recovery if needed
  attemptRecoveryIfNeeded();
  
  console.log(`[Offline] Reliability system initialized, ${transactionLog.length} pending transactions`);
}

/**
 * Cleanup on app unload.
 */
function handleShutdown(): void {
  // Mark clean shutdown
  saveCrashRecoveryState({
    lastCleanShutdown: new Date().toISOString(),
    pendingTransactions: transactionLog.filter(t => t.status === 'pending'),
    lastKnownKey: '',
    recoveryAttempted: false,
  });
  
  // Persist pending transactions
  persistTransactions();
}

// ─── Transaction Logging ────────────────────────────────────────

/**
 * Log a write transaction for durability.
 */
export function logTransaction(key: string, data: unknown): WriteTransaction {
  const transaction: WriteTransaction = {
    id: crypto.randomUUID(),
    key,
    data,
    timestamp: Date.now(),
    status: 'pending',
    retries: 0,
  };
  
  transactionLog.push(transaction);
  persistTransactions();
  
  return transaction;
}

/**
 * Mark transaction as committed.
 */
export function commitTransaction(transactionId: string): void {
  const transaction = transactionLog.find(t => t.id === transactionId);
  if (transaction) {
    transaction.status = 'committed';
    persistTransactions();
  }
}

/**
 * Mark transaction as failed.
 */
export function failTransaction(transactionId: string, retry: boolean = false): void {
  const transaction = transactionLog.find(t => t.id === transactionId);
  if (transaction) {
    if (retry && transaction.retries < MAX_RETRIES) {
      transaction.retries++;
      transaction.status = 'pending';
    } else {
      transaction.status = 'failed';
    }
    persistTransactions();
  }
}

/**
 * Persist transaction log to storage.
 */
function persistTransactions(): void {
  try {
    // Keep only recent/failed transactions
    const toSave = transactionLog.filter(
      t => t.status !== 'committed' || Date.now() - t.timestamp < 3600000
    );
    localStorage.setItem(TRANSACTION_LOG_KEY, JSON.stringify(toSave));
  } catch {
    // Storage might be full - log error
    console.error('[Offline] Failed to persist transactions');
  }
}

// ─── Crash Recovery ────────────────────────────────────────────

/**
 * Get crash recovery state.
 */
function getCrashRecoveryState(): CrashRecoveryState | null {
  try {
    const stored = localStorage.getItem(CRASH_RECOVERY_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // Ignore
  }
  return null;
}

/**
 * Save crash recovery state.
 */
function saveCrashRecoveryState(state: CrashRecoveryState): void {
  try {
    localStorage.setItem(CRASH_RECOVERY_KEY, JSON.stringify(state));
  } catch {
    // Ignore
  }
}

/**
 * Attempt recovery after crash.
 */
function attemptRecoveryIfNeeded(): void {
  const state = getCrashRecoveryState();
  if (!state) return;
  
  // Check if clean shutdown happened
  if (state.lastCleanShutdown) {
    const lastShutdown = new Date(state.lastCleanShutdown).getTime();
    const now = Date.now();
    
    // If last shutdown was within last minute, likely clean
    if (now - lastShutdown < 60000) {
      return; // Clean shutdown
    }
  }
  
  // Try to recover pending transactions
  if (state.pendingTransactions?.length > 0) {
    console.log(`[Offline] Crash detected, attempting to recover ${state.pendingTransactions.length} transactions`);
    
    for (const transaction of state.pendingTransactions) {
      try {
        localStorage.setItem(transaction.key, JSON.stringify(transaction.data));
        console.log(`[Offline] Recovered: ${transaction.key}`);
      } catch (e) {
        console.error(`[Offline] Failed to recover ${transaction.key}:`, e);
      }
    }
  }
  
  // Mark recovery attempted
  state.recoveryAttempted = true;
  saveCrashRecoveryState(state);
}

// ─── Durable Write ───────────────────────────────────────────

/**
 * Perform durable write with transaction logging.
 * Ensures data survives crashes.
 */
export function durableWrite<T>(
  key: string, 
  data: T,
  options?: {
    skipLog?: boolean;
    immediate?: boolean;
  }
): boolean {
  const transaction = options?.skipSkipLog ? null : logTransaction(key, data);
  
  try {
    if (options?.immediate) {
      // Synchronous write
      localStorage.setItem(key, JSON.stringify(data));
    } else {
      // Async write (next tick)
      queueMicrotask(() => {
        localStorage.setItem(key, JSON.stringify(data));
      });
    }
    
    if (transaction) {
      commitTransaction(transaction.id);
    }
    
    return true;
  } catch (e) {
    console.error(`[Offline] Durable write failed for ${key}:`, e);
    
    if (transaction) {
      failTransaction(transaction.id, true); // Retry once
    }
    
    return false;
  }
}

/**
 * Write with dual-write for critical data.
 * Writes to both localStorage and backup key.
 */
export function dualWrite<T>(primaryKey: string, backupKey: string, data: T): boolean {
  let success = false;
  
  // Write to primary
  try {
    localStorage.setItem(primaryKey, JSON.stringify(data));
    success = true;
  } catch (e) {
    console.error(`[Offline] Primary write failed:`, e);
  }
  
  // Write to backup (even if primary failed)
  try {
    localStorage.setItem(backupKey, JSON.stringify(data));
  } catch (e) {
    console.error(`[Offline] Backup write failed:`, e);
  }
  
  return success;
}

/**
 * Read with fallback to backup.
 */
export function readWithFallback<T>(primaryKey: string, backupKey: string, fallback: T): T {
  try {
    const primary = localStorage.getItem(primaryKey);
    if (primary) {
      return JSON.parse(primary) as T;
    }
  } catch {
    // Ignore
  }
  
  // Try backup
  try {
    const backup = localStorage.getItem(backupKey);
    if (backup) {
      return JSON.parse(backup) as T;
    }
  } catch {
    // Ignore
  }
  
  return fallback;
}

// ─── Write Queue (for batching) ─────────────────────────────────

interface QueuedWrite {
  key: string;
  data: unknown;
  resolve: (success: boolean) => void;
}

let writeQueue: QueuedWrite[] = [];
let flushScheduled = false;

/**
 * Queue write for batched execution.
 * Improves performance for rapid writes.
 */
export function queueWrite(key: string, data: unknown): Promise<boolean> {
  return new Promise((resolve) => {
    writeQueue.push({ key, data, resolve });
    
    if (!flushScheduled) {
      flushScheduled = true;
      queueMicrotask(flushWriteQueue);
    }
  });
}

/**
 * Flush queued writes.
 */
function flushWriteQueue(): void {
  const queue = writeQueue;
  writeQueue = [];
  flushScheduled = false;
  
  for (const write of queue) {
    try {
      localStorage.setItem(write.key, JSON.stringify(write.data));
      write.resolve(true);
    } catch (e) {
      console.error(`[Offline] Queued write failed:`, e);
      write.resolve(false);
    }
  }
}

// ─── Status ─────────────────────────────────────────────

/**
 * Get system health status.
 */
export function getOfflineStatus(): {
  transactionCount: number;
  pendingCount: number;
  lastShutdown: string | null;
  healthy: boolean;
} {
  const recoveryState = getCrashRecoveryState();
  const pending = transactionLog.filter(t => t.status === 'pending');
  
  return {
    transactionCount: transactionLog.length,
    pendingCount: pending.length,
    lastShutdown: recoveryState?.lastCleanShutdown || null,
    healthy: pending.length === 0 && !!recoveryState?.lastCleanShutdown,
  };
}

/**
 * Cleanup old transactions (run periodically).
 */
export function cleanupOldTransactions(): void {
  const now = Date.now();
  const cutoff = now - (7 * 24 * 60 * 60 * 1000); // 7 days
  
  transactionLog = transactionLog.filter(
    t => t.status === 'pending' || (t.timestamp > cutoff)
  );
  
  persistTransactions();
  console.log(`[Offline] Cleaned up transactions, ${transactionLog.length} remaining`);
}

// Export initialization
export default initOfflineReliability;