// ============================================================
// REPOSITORY ABSTRACTION LAYER
// Abstract data access for future backend integration
// V1: Keep localStorage as default, prepare for API
// ============================================================

// ─── Types ────────────────────────────────────────────────────────────

export type DataSource = 'localStorage' | 'electron' | 'api';

export interface RepositoryConfig {
  source: DataSource;
  storageKey: string;
  enableCache?: boolean;
  cacheExpiry?: number;
}

export interface QueryOptions {
  source?: DataSource;
  bypassCache?: boolean;
  useFallback?: boolean;
}

export interface WriteOptions {
  source?: DataSource;
  dualWrite?: boolean;
  validate?: boolean;
}

// ─── Configuration ────────────────────────────────────────────────

// Current default source - can be changed to 'api' when backend is ready
let DEFAULT_SOURCE: DataSource = 'localStorage';

// Check if running in Electron
const isElectron = typeof window !== 'undefined' && 
  !!(window as any).electron?.ipcRenderer;

if (isElectron) {
  DEFAULT_SOURCE = 'electron';
}

// ─── Source Management ──────────────────────────────────────────

/**
 * Get current data source.
 */
export function getDataSource(): DataSource {
  return DEFAULT_SOURCE;
}

/**
 * Set default data source.
 * Use 'electron' for best performance, 'api' when backend ready.
 */
export function setDataSource(source: DataSource): void {
  DEFAULT_SOURCE = source;
  console.log(`[Repo] Default source set to: ${source}`);
}

/**
 * Check if a data source is available.
 */
export function isSourceAvailable(source: DataSource): boolean {
  switch (source) {
    case 'localStorage':
      try {
        localStorage.setItem('test', '1');
        localStorage.removeItem('test');
        return true;
      } catch {
        return false;
      }
    
    case 'electron':
      return isElectron;
    
    case 'api':
      // Check connectivity when API is ready
      return false;
    
    default:
      return false;
  }
}

/**
 * Get best available source.
 */
export function getBestSource(): DataSource {
  if (isElectron && isSourceAvailable('electron')) {
    return 'electron';
  }
  if (isSourceAvailable('localStorage')) {
    return 'localStorage';
  }
  return 'localStorage';
}

// ─── Generic Read/Write ────────────────────────────────────────────

/**
 * Read data with fallback chain.
 * Tries preferred source first, falls back to alternatives.
 */
export async function readData<T>(
  config: RepositoryConfig,
  fallback: T,
  options?: QueryOptions
): Promise<T> {
  const source = options?.source || DEFAULT_SOURCE;
  
  // Try preferred source
  if (isSourceAvailable(source)) {
    try {
      const data = await readFromSource<T>(config.storageKey, source);
      if (data !== null && data !== undefined) {
        return data;
      }
    } catch (e) {
      console.warn(`[Repo] Read failed from ${source}:`, e);
    }
  }
  
  // Try fallback if enabled
  if (options?.useFallback) {
    const fallbackSource = source === 'electron' ? 'localStorage' : 'electron';
    if (fallbackSource !== source && isSourceAvailable(fallbackSource)) {
      try {
        const data = await readFromSource<T>(config.storageKey, fallbackSource);
        if (data !== null && data !== undefined) {
          console.log(`[Repo] Used fallback source: ${fallbackSource}`);
          return data;
        }
      } catch (e) {
        console.warn(`[Repo] Fallback read failed:`, e);
      }
    }
  }
  
  return fallback;
}

/**
 * Write data with dual-write support.
 */
export async function writeData<T>(
  config: RepositoryConfig,
  data: T,
  options?: WriteOptions
): Promise<boolean> {
  const source = options?.source || DEFAULT_SOURCE;
  
  // Write to primary source
  if (isSourceAvailable(source)) {
    try {
      await writeToSource(config.storageKey, data, source);
      
      // Dual write if enabled (for critical data)
      if (options?.dualWrite) {
        const backupKey = config.storageKey + '_backup';
        await writeToSource(backupKey, data, source);
      }
      
      return true;
    } catch (e) {
      console.error(`[Repo] Write failed to ${source}:`, e);
    }
  }
  
  return false;
}

// ─── Source Implementation ────────────────────────────────────────

async function readFromSource<T>(key: string, source: DataSource): Promise<T | null> {
  switch (source) {
    case 'localStorage': {
      const raw = localStorage.getItem(key);
      if (raw === null) return null;
      return JSON.parse(raw) as T;
    }
    
    case 'electron': {
      const data = (window as any).electron?.ipcRenderer?.sendSync('store-get', key);
      return data as T | null;
    }
    
    case 'api': {
      const response = await fetch(`/api/${key}`);
      if (!response.ok) return null;
      return response.json() as Promise<T>;
    }
    
    default:
      return null;
  }
}

async function writeToSource<T>(key: string, data: T, source: DataSource): Promise<void> {
  const serialized = JSON.stringify(data);
  
  switch (source) {
    case 'localStorage':
      localStorage.setItem(key, serialized);
      break;
    
    case 'electron':
      (window as any).electron?.ipcRenderer?.sendSync('store-set', key, data);
      break;
    
    case 'api':
      await fetch(`/api/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: serialized,
      });
      break;
  }
}

// ─── Cache Management ────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiry: number;
}

const cache = new Map<string, CacheEntry<any>>();

/**
 * Get cached data if available and not expired.
 */
export function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  
  if (Date.now() > entry.expiry) {
    cache.delete(key);
    return null;
  }
  
  return entry.data;
}

/**
 * Set cached data.
 */
export function setCached<T>(key: string, data: T, expiryMs: number = 60000): void {
  cache.set(key, {
    data,
    timestamp: Date.now(),
    expiry: Date.now() + expiryMs,
  });
}

/**
 * Invalidate cache.
 */
export function invalidateCache(key?: string): void {
  if (key) {
    cache.delete(key);
  } else {
    cache.clear();
  }
}

/**
 * Clear expired cache entries.
 */
export function cleanupCache(): void {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now > entry.expiry) {
      cache.delete(key);
    }
  }
}

// ─── Event Infrastructure ──────────────────────────────────────────

type DataChangeListener = (key: string, action: 'set' | 'delete') => void;
const listeners = new Set<DataChangeListener>();

/**
 * Subscribe to data changes.
 */
export function subscribeToDataChanges(listener: DataChangeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Notify data change.
 */
export function notifyDataChange(key: string, action: 'set' | 'delete'): void {
  listeners.forEach(listener => {
    try {
      listener(key, action);
    } catch (e) {
      console.error('[Repo] Listener error:', e);
    }
  });
}

// ─── Export ──────────────────────────────────────────────────

export {
  DEFAULT_SOURCE,
  isElectron,
  getDataSource,
  setDataSource,
  isSourceAvailable,
  getBestSource,
  readData,
  writeData,
  getCached,
  setCached,
  invalidateCache,
  cleanupCache,
  subscribeToDataChanges,
  notifyDataChange,
};