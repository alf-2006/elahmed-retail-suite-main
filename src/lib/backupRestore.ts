// ============================================================
// BACKUP & RESTORE SYSTEM
// Manual export/import with validation
// V1: Production-ready backup solution
// ============================================================

import { STORAGE_KEYS } from '@/config';

// ─── Types ────────────────────────────────────────────────────────────

export interface BackupManifest {
  version: string;           // "1.0.0"
  createdAt: string;          // ISO timestamp
  machineId: string;       // For compatibility
  appVersion: string;       // ELAHMED retail suite version
  checksum: string;         // SHA-256 of compressed data
  partial?: boolean;        // True if backup is incomplete
  note?: string;           // User note
}

export interface BackupData {
  manifest: BackupManifest;
  // Key-value storage data
  users?: unknown[];
  sales?: unknown[];
  inventory?: Record<string, unknown[]>;
  settings?: Record<string, unknown>;
  financials?: Record<string, unknown[]>;
  [key: string]: unknown;
}

export interface RestoreResult {
  success: boolean;
  imported: number;
  skipped: number;
  errors: string[];
  warnings: string[];
}

// ─── Constants ────────────────────────────────────────────────────────

const BACKUP_VERSION = '1.0.0';
const CURRENT_APP_VERSION = '3.1.1';

// Critical keys that MUST be backed up (for restore)
const CRITICAL_KEYS: (keyof typeof STORAGE_KEYS)[] = [
  'USERS',
  'SALES',
  'RETURNS',
  'INVOICE_COUNTER',
];

// Important keys (recommended)
const IMPORTANT_KEYS: (keyof typeof STORAGE_KEYS)[] = [
  'MOBILES', 'COMPUTERS', 'DEVICES', 'CARS',
  'WALLETS', 'CUSTOMERS', 'SUPPLIERS',
  'EXPENSES', 'INSTALLMENTS',
  'MAINTAINANCE', 'REPAIRS',
];

// Settings/lookup data
const SETTINGS_KEYS: (keyof typeof STORAGE_KEYS)[] = [
  'APP_SETTINGS', 'INVOICE_SETTINGS',
  'BACKUP_SETTINGS', 'THEME', 'LANGUAGE',
];

// ─── Compression (Simple RLE-like) ─────────────────────────────────

function compressString(str: string): string {
  // Simple compression - replace repeated sequences
  // For production, consider using pako or similar library
  let result = '';
  let i = 0;
  
  while (i < str.length) {
    let count = 1;
    while (i + count < str.length && str[i + count] === str[i]) {
      count++;
    }
    
    if (count > 3) {
      result += `${count}x${str[i]}`;
      i += count;
    } else {
      result += str[i].repeat(count);
      i += count;
    }
  }
  
  return result;
}

function decompressString(str: string): string {
  // Decompress - expand count sequences
  return str.replace(/(\d+)x(.)/g, (_, count, char) => {
    return char.repeat(parseInt(count, 10));
  });
}

// ─── Checksum Generation ─────────────────────────────────────────

async function generateChecksum(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Core Functions ────────────────────��──────────────────────────────

/**
 * Create a full backup of all application data.
 */
export async function createBackup(options?: {
  includeAllData?: boolean;
  note?: string;
  partial?: boolean;
}): Promise<BackupData> {
  const startTime = Date.now();
  
  const manifest: BackupManifest = {
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    machineId: localStorage.getItem(STORAGE_KEYS.MACHINE_ID) || 'unknown',
    appVersion: CURRENT_APP_VERSION,
    checksum: '', // Will be computed after data
    partial: options?.partial ?? false,
    note: options?.note,
  };

  const data: BackupData = { manifest };

  // Get critical data (users, sales, counters)
  for (const keyName of CRITICAL_KEYS) {
    const key = STORAGE_KEYS[keyName];
    if (key) {
      const raw = localStorage.getItem(key);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          data[keyName.toLowerCase()] = parsed;
        } catch {
          // Skip corrupted data
        }
      }
    }
  }

  // Get inventory data
  const inventory: Record<string, unknown[]> = {};
  for (const keyName of IMPORTANT_KEYS) {
    const key = STORAGE_KEYS[keyName];
    if (key) {
      const raw = localStorage.getItem(key);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          inventory[keyName] = parsed;
        } catch {
          // Skip
        }
      }
    }
  }
  data.inventory = inventory;

  // Get settings
  const settings: Record<string, unknown> = {};
  for (const keyName of SETTINGS_KEYS) {
    const key = STORAGE_KEYS[keyName];
    if (key) {
      const raw = localStorage.getItem(key);
      if (raw) {
        try {
          settings[keyName] = JSON.parse(raw);
        } catch {
          // Skip
        }
      }
    }
  }
  data.settings = settings;

  // Include ALL data if requested
  if (options?.includeAllData) {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && !key.startsWith('gx_')) {
        const raw = localStorage.getItem(key);
        if (raw) {
          try {
            data[key] = JSON.parse(raw);
          } catch {
            // Skip
          }
        }
      }
    }
  }

  // Compute checksum
  const jsonString = JSON.stringify(data);
  manifest.checksum = await generateChecksum(jsonString);

  const duration = Date.now() - startTime;
  console.log(`[Backup] Created in ${duration}ms, checksum: ${manifest.checksum.substring(0, 16)}...`);

  return data;
}

/**
 * Export backup to file (download).
 */
export function exportToFile(backup: BackupData, filename?: string): void {
  const jsonString = JSON.stringify(backup, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const finalFilename = filename || 
    `elahmed-backup-${backup.manifest.createdAt.split('T')[0]}.json`;
  
  const a = document.createElement('a');
  a.href = url;
  a.download = finalFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  console.log(`[Backup] Exported: ${finalFilename}`);
}

/**
 * Import backup from file.
 */
export async function importFromFile(file: File): Promise<BackupData> {
  const text = await file.text();
  const backup = JSON.parse(text) as BackupData;
  
  // Validate structure
  if (!backup.manifest) {
    throw new Error('ملف النسخ الاحتياطي غير صالح -头部_missing');
  }
  
  return backup;
}

/**
 * Validate backup before restore.
 */
export function validateBackup(backup: BackupData): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check manifest
  if (!backup.manifest?.version) {
    errors.push('ملف النسخ الاحتياطي تالف -头部_مفقود');
  }

  // Check version compatibility
  if (backup.manifest?.appVersion) {
    const [backupMajor] = backup.manifest.appVersion.split('.');
    const [currentMajor] = CURRENT_APP_VERSION.split('.');
    
    if (backupMajor !== currentMajor) {
      warnings.push(`نسخة_النسخ الاحتياطي (v${backup.manifest.appVersion}) قد لا تكون متوافقة مع الإصدار الحالي (v${CURRENT_APP_VERSION})`);
    }
  }

  // Check critical data exists
  const criticalCount = CRITICAL_KEYS.filter(k => 
    backup[k.toLowerCase() as keyof BackupData]
  ).length;
  
  if (criticalCount === 0) {
    warnings.push('لا توجد بيانات_حرجة في ملف النسخ الاحتياطي');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Restore backup to localStorage.
 */
export async function restoreBackup(
  backup: BackupData,
  options?: {
    dryRun?: boolean;
    skipExisting?: boolean;
  }
): Promise<RestoreResult> {
  const result: RestoreResult = {
    success: false,
    imported: 0,
    skipped: 0,
    errors: [],
    warnings: [],
  };

  // Validate first
  const validation = validateBackup(backup);
  if (!validation.valid) {
    result.errors.push(...validation.errors);
    return result;
  }
  
  result.warnings.push(...validation.warnings);

  // Dry run - just report what would happen
  if (options?.dryRun) {
    result.warnings.push('جافة التشغيل - لن يتم استيراد أي بيانات');
    result.success = true;
    return result;
  }

  // Restore critical data
  const criticalRestore = async (keyName: string, data: unknown) => {
    const storageKey = STORAGE_KEYS[keyName as keyof typeof STORAGE_KEYS];
    if (!storageKey) return false;
    
    const existing = localStorage.getItem(storageKey);
    
    if (existing && options?.skipExisting) {
      result.skipped++;
      return false;
    }
    
    try {
      localStorage.setItem(storageKey, JSON.stringify(data));
      result.imported++;
      return true;
    } catch (e) {
      result.errors.push(`فشل استيراد ${keyName}: ${e instanceof Error ? e.message : 'unknown'}`);
      return false;
    }
  };

  // Restore users
  if (backup.users) {
    await criticalRestore('USERS', backup.users);
  }

  // Restore sales
  if (backup.sales) {
    await criticalRestore('SALES', backup.sales);
  }

  // Restore returns
  if (backup.returns) {
    await criticalRestore('RETURNS', backup.returns);
  }

  // Restore invoice counter
  if (backup.invoice_counter) {
    localStorage.setItem(STORAGE_KEYS.INVOICE_COUNTER, String(backup.invoice_counter));
    result.imported++;
  }

  // Restore inventory (if not skipped)
  if (backup.inventory) {
    for (const [keyName, data] of Object.entries(backup.inventory)) {
      await criticalRestore(keyName, data);
    }
  }

  // Restore settings (if not skipped)
  if (backup.settings) {
    for (const [keyName, data] of Object.entries(backup.settings)) {
      await criticalRestore(keyName, data);
    }
  }

  result.success = result.errors.length === 0;
  
  console.log(`[Restore] Imported: ${result.imported}, Skipped: ${result.skipped}, Errors: ${result.errors.length}`);
  
  return result;
}

/**
 * Quick backup - critical data only.
 */
export async function quickBackup(): Promise<void> {
  const backup = await createBackup({ partial: true });
  exportToFile(backup);
}

/**
 * Full backup - all data.
 */
export async function fullBackup(): Promise<void> {
  const backup = await createBackup({ includeAllData: true });
  exportToFile(backup);
}