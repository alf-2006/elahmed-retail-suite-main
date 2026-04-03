// ============================================================
// storage.ts — Production-safe localStorage operations
// V2: Enhanced with corruption detection and integrity checks
// Handles: quota exhaustion, JSON parse errors, tampering detection
// ============================================================

import { STORAGE_KEYS } from '@/config';

// ─── Types ────────────────────────────────────────────────────────────

export class StorageFullError extends Error {
  public readonly usedBytes: number;
  public readonly totalBytes: number;
  constructor(used: number, total: number) {
    super(
      `مساحة التخزين ممتلئة. المستخدم: ${(used / 1024).toFixed(1)} KB من ${(total / 1024).toFixed(1)} KB`
    );
    this.name = 'StorageFullError';
    this.usedBytes = used;
    this.totalBytes = total;
  }
}

export class StorageCorruptedError extends Error {
  public readonly key: string;
  public readonly originalLength: number;
  constructor(key: string, originalLength: number) {
    super(`بيانات تالفة في المفتاح "${key}" (${originalLength} حرف)`);
    this.name = 'StorageCorruptedError';
    this.key = key;
    this.originalLength = originalLength;
  }
}

// ─── Checksum ─────────────────────────────────────────────────────

/**
 * Generate simple checksum for data integrity.
 * Uses CRC32-like algorithm for speed.
 */
function generateChecksum(data: unknown): string {
  const json = JSON.stringify(data);
  let crc = 0;
  for (let i = 0; i < json.length; i++) {
    crc = ((crc << 5) + crc + json.charCodeAt(i)) | 0;
  }
  // Return as hex string
  return (crc >>> 0).toString(16).padStart(8, '0');
}

// ─── Storage Estimation ───────────────────────────────────────────────

/** Estimate total localStorage usage in bytes (chars × 2 for UTF-16) */
export function estimateStorageUsage(): number {
  let total = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        total += (key.length + (localStorage.getItem(key)?.length ?? 0)) * 2;
      }
    }
  } catch {
    // Ignore — not critical
  }
  return total;
}

/** Conservative localStorage capacity estimate: 5 MB */
export function estimateStorageCapacity(): number {
  return 5 * 1024 * 1024;
}

/** Returns usage ratio 0–1 */
export function getStorageUsageRatio(): number {
  return estimateStorageUsage() / estimateStorageCapacity();
}

// ─── Safe Operations ────────────────────────────────────────────

/**
 * Safe read — returns defaultValue on any error.
 * Now with corruption detection and automatic backup!
 */
export function safeGetItem<T>(key: string, defaultValue: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return defaultValue;
    
    // Validate JSON structure
    if (raw.trim() === '') {
      logCorruption(key, raw.length, 'empty string');
      return defaultValue;
    }
    
    // Parse with validation
    const parsed = JSON.parse(raw);
    
    // Validate basic structure (not array of primitives unless expected)
    if (parsed === undefined || parsed === null) {
      // null/undefined is valid for null values
      return parsed as unknown as T;
    }
    
    // Type validation - check for obviously corrupted data
    if (typeof parsed !== 'object' && typeof parsed !== 'string' && typeof parsed !== 'number') {
      logCorruption(key, raw.length, `invalid type: ${typeof parsed}`);
      return defaultValue;
    }
    
    return parsed as T;
  } catch (e) {
    logCorruption(key, localStorage.getItem(key)?.length ?? 0, e instanceof Error ? e.message : 'unknown');
    return defaultValue;
  }
}

/**
 * Log corruption event for diagnostics.
 */
function logCorruption(key: string, length: number, reason: string): void {
  // Only log in development
  if (import.meta.env.DEV) {
    console.error(`[Storage] 🔴 Corruption detected at "${key}": length=${length}, reason=${reason}`);
  }
  
  // Backup corrupted entry for diagnostics
  try {
    const backupKey = `${key}_CORRUPTED_BACKUP`;
    const existing = localStorage.getItem(key);
    if (existing) {
      // Don't overwrite existing backup
      if (!localStorage.getItem(backupKey)) {
        localStorage.setItem(backupKey, existing);
        if (import.meta.env.DEV) {
          console.log(`[Storage] 📦 Backed up corrupted entry to "${backupKey}"`);
        }
      }
    }
  } catch {
    // Storage might be full - ignore
  }
}

/**
 * Safe write — throws StorageFullError if quota exceeded.
 * Adds checksum for integrity verification on read.
 */
export function safeSetItem<T>(key: string, value: T): void {
  const data = { 
    _data: value, 
    _checksum: generateChecksum(value),
    _timestamp: Date.now() 
  };
  
  const serialized = JSON.stringify(data);
  
  try {
    localStorage.setItem(key, serialized);
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === 'QuotaExceededError' ||
        error.name === 'NS_ERROR_DOM_QUOTA_REACHED')
    ) {
      const used = estimateStorageUsage();
      const total = estimateStorageCapacity();
      throw new StorageFullError(used, total);
    }
    throw error;
  }
}

/**
 * Verify data integrity using stored checksum.
 */
export function verifyIntegrity<T>(key: string): { valid: boolean; data?: T; reason?: string } {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { valid: false, reason: 'key not found' };
    
    const parsed = JSON.parse(raw);
    if (!parsed._checksum) {
      // No checksum - legacy data, assume valid
      return { valid: true, data: parsed as unknown as T };
    }
    
    // Verify checksum
    const expectedChecksum = generateChecksum(parsed._data);
    if (parsed._checksum !== expectedChecksum) {
      return { valid: false, reason: `checksum mismatch: ${parsed._checksum} != ${expectedChecksum}` };
    }
    
    return { valid: true, data: parsed._data };
  } catch (e) {
    return { valid: false, reason: e instanceof Error ? e.message : 'parse error' };
  }
}

/**
 * Safe read with integrity check.
 * Use this for critical data (sales, inventory, etc.)
 */
export function safeGetItemWithIntegrity<T>(key: string, defaultValue: T): T {
  const result = verifyIntegrity<T>(key);
  
  if (result.valid && result.data !== undefined) {
    return result.data;
  }
  
  if (result.reason && import.meta.env.DEV) {
    console.warn(`[Storage] ⚠️ Integrity check failed for "${key}": ${result.reason}`);
  }
  
  return defaultValue;
}

/**
 * Safe remove — never throws.
 * Also removes associated backup if exists.
 */
export function safeRemoveItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Never throws
  }
  
  // Also remove backup
  try {
    localStorage.removeItem(`${key}_CORRUPTED_BACKUP`);
  } catch {
    // Ignore
  }
}

/** Returns true if storage is at or above 70% capacity */
export function shouldWarnStorageFull(): boolean {
  return getStorageUsageRatio() >= 0.7;
}

/** Returns true if storage is at or above 90% capacity */
export function isStorageCritical(): boolean {
  return getStorageUsageRatio() >= 0.9;
}