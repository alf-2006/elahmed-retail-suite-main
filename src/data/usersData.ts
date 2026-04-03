import { STORAGE_KEYS } from '@/config';
import { callElectronSync, emitDataChange, hasElectronIpc, readElectronSync } from '@/lib/electronDataBridge';
import { getStorageItem, setStorageItem } from '@/lib/localStorageHelper';

const STORAGE_KEY = STORAGE_KEYS.USERS;
const RECOVERY_CODE_KEY = STORAGE_KEYS.RECOVERY_CODE;

export function generateSalt(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr));
}

export async function hashPassword(password: string, salt: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' },
    key,
    256,
  );
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

export async function verifyPassword(password: string, salt: string, storedHash: string): Promise<boolean> {
  const hash = await hashPassword(password, salt);
  return hash === storedHash;
}

export type UserRole = 'owner' | 'user' | 'super_admin' | 'admin' | 'employee';

export const ALL_PERMISSIONS = [
  'dashboard',
  'pos',
  'sales',
  'inventory',
  'used',
  'stocktake',
  'mobiles',
  'computers',
  'devices',

  'cars',
  'warehouse',
  'maintenance',
  'installments',
  'expenses',
  'damaged',
  'otherRevenue',
  'returns',
  'settings',
  'users',
  'customers',
  'wallets',
  'employees',
  'suppliers',
  'blacklist',
  'reminders',
  'shiftClosing',
  'purchaseInvoices',
  'partners',

] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, string> = {
  used: 'الأجهزة المستعملة',
  stocktake: 'الجرد',
  dashboard: 'لوحة التحكم',
  pos: 'نقطة البيع',
  sales: 'المبيعات',
  inventory: 'المخزون العام',
  mobiles: 'الموبيلات وإكسسوارات',
  computers: 'الكمبيوتر وإكسسوارات',
  devices: 'الأجهزة وإكسسوارات',

  cars: 'السيارات',
  warehouse: 'المستودع',
  maintenance: 'الصيانة',
  installments: 'التقسيط',
  expenses: 'المصروفات',
  damaged: 'الهالك',
  otherRevenue: 'أرباح أخرى',
  returns: 'المرتجعات',
  settings: 'الإعدادات',
  users: 'إدارة المستخدمين',
  customers: 'إدارة العملاء',
  wallets: 'المحافظ والخزنة',
  employees: 'الموظفين والرواتب',
  suppliers: 'الموردون',
  blacklist: 'القائمة السوداء',
  reminders: 'التذكيرات',
  shiftClosing: 'إقفال الوردية',
  purchaseInvoices: 'فواتير الشراء',
  partners: 'الشركاء والموزعون',

};

export interface AppUser {
  id: string;
  username: string;
  password: string;
  salt?: string;
  fullName: string;
  role: UserRole;
  permissions: Permission[];
  active: boolean;
  createdAt: string;
  mustChangePassword?: boolean;
  updatedAt?: string;
}

interface UserRow {
  id: string;
  username: string;
  fullName?: string | null;
  role?: string | null;
  permissions?: string | Permission[] | null;
  active?: number | boolean | null;
  passwordHash?: string | null;
  salt?: string | null;
  mustChangePassword?: number | boolean | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

const DEFAULT_OWNER: AppUser = {
  id: 'owner-1',
  username: 'admin',
  password: '', // Set on first run - see getOrCreateDefaultPassword below
  fullName: 'صاحب النظام',
  role: 'owner',
  permissions: [...ALL_PERMISSIONS],
  active: true,
  createdAt: new Date().toISOString(),
  mustChangePassword: true,
};

function getOrCreateDefaultPassword(): string {
  const key = STORAGE_KEYS.DEFAULT_OWNER_PASSWORD;
  const stored = localStorage.getItem(key);
  if (stored) return stored;
  
  // Generate secure random password
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  const password = Array.from(arr, b => chars[b % chars.length]).join('');
  
  localStorage.setItem(key, password);
  return password;
}

let usersCache: AppUser[] | null = null;
let recoveryCodeCache: string | null = null;

// Apply default password if empty (first run migration)
const ensureDefaultOwner = () => {
  const users = getUsers();
  const owner = users.find(u => u.role === 'owner');
  if (owner && !owner.password) {
    const defaultPassword = getOrCreateDefaultPassword();
    // Legacy migration: set password to hashed default
    const salt = generateSalt();
    hashPassword(defaultPassword, salt).then(hash => {
      saveUsers(users.map(u => u.id === owner.id ? { ...u, password: hash, salt } : u));
    });
  }
};
ensureDefaultOwner();

function parsePermissions(value: unknown, role: UserRole): Permission[] {
  const fallback = role === 'owner' ? [...ALL_PERMISSIONS] : [];
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string' && value.trim()
      ? (() => {
        try {
          const parsed = JSON.parse(value);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return value.split(',').map((item) => item.trim()).filter(Boolean);
        }
      })()
      : [];

  const normalized = source.filter((permission): permission is Permission => (
    ALL_PERMISSIONS.includes(permission as Permission)
  ));

  return normalized.length > 0 ? normalized : fallback;
}

function normalizeUser(row: Partial<UserRow> | Partial<AppUser>): AppUser {
  const role = (String((row as UserRow).role ?? 'user') as UserRole);
  const createdAt = String((row as UserRow).createdAt ?? new Date().toISOString());
  return {
    id: String(row.id ?? crypto.randomUUID()),
    username: String(row.username ?? '').trim(),
    password: String((row as UserRow).passwordHash ?? (row as AppUser).password ?? ''),
    salt: (row as UserRow).salt ? String((row as UserRow).salt) : undefined,
    fullName: String((row as UserRow).fullName ?? (row as AppUser).fullName ?? '').trim(),
    role,
    permissions: parsePermissions((row as UserRow).permissions ?? (row as AppUser).permissions, role),
    active: Boolean((row as UserRow).active ?? (row as AppUser).active ?? true),
    createdAt,
    mustChangePassword: Boolean((row as UserRow).mustChangePassword ?? (row as AppUser).mustChangePassword ?? false),
    updatedAt: String((row as UserRow).updatedAt ?? (row as AppUser).updatedAt ?? createdAt),
  };
}

function toUserRow(user: AppUser): UserRow {
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    role: user.role,
    permissions: JSON.stringify(user.permissions),
    active: user.active,
    passwordHash: user.password,
    salt: user.salt ?? null,
    mustChangePassword: user.mustChangePassword ?? false,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt ?? user.createdAt,
  };
}

function setUsersState(users: AppUser[]): void {
  usersCache = [...users.map(normalizeUser)].sort((left, right) => (
    left.createdAt.localeCompare(right.createdAt) || left.username.localeCompare(right.username)
  ));
}

function loadLocalUsers(): AppUser[] {
  const saved = getStorageItem<AppUser[]>(STORAGE_KEY, []);
  return (Array.isArray(saved) ? saved : []).map(normalizeUser);
}

function refreshElectronUsers(): AppUser[] {
  const rows = readElectronSync<UserRow[]>('db-sync:users:get', []);
  const rowsArray = Array.isArray(rows) ? rows : [];
  setUsersState(rowsArray.map(normalizeUser));
  return usersCache ?? [];
}

function getStoredRecoveryCode(): string | null {
  if (recoveryCodeCache) return recoveryCodeCache;

  if (hasElectronIpc()) {
    const value = readElectronSync<unknown>('db-sync:settings:get-json', null, RECOVERY_CODE_KEY);
    if (typeof value === 'string' && value.trim()) {
      recoveryCodeCache = value;
      return recoveryCodeCache;
    }
    return null;
  }

  try {
    const value = localStorage.getItem(RECOVERY_CODE_KEY);
    if (value && value.trim()) {
      recoveryCodeCache = value;
      return recoveryCodeCache;
    }
  } catch {
    return null;
  }

  return null;
}

function persistRecoveryCode(code: string): string {
  recoveryCodeCache = code;

  if (hasElectronIpc()) {
    callElectronSync('db-sync:settings:set-json', RECOVERY_CODE_KEY, code);
    return code;
  }

  try {
    localStorage.setItem(RECOVERY_CODE_KEY, code);
  } catch (error) {
    console.error('Failed to persist recovery code:', error);
  }

  return code;
}

function getOrCreateRecoveryCode(): string {
  const existing = getStoredRecoveryCode();
  if (existing) return existing;

  const newCode = `GX-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
  return persistRecoveryCode(newCode);
}

export const MASTER_RECOVERY_CODE = getOrCreateRecoveryCode();

export function isPasswordHashed(user: AppUser): boolean {
  return Boolean(user.salt);
}

export function getUsers(): AppUser[] {
  if (usersCache) return usersCache;

  if (hasElectronIpc()) {
    const users = refreshElectronUsers();
    if (users.length > 0) return users;

    saveUsers([DEFAULT_OWNER]);
    return usersCache ?? [DEFAULT_OWNER];
  }

  const stored = loadLocalUsers();
  if (stored.length > 0) {
    setUsersState(stored);
    return usersCache ?? [];
  }

  saveUsers([DEFAULT_OWNER]);
  return usersCache ?? [DEFAULT_OWNER];
}

export function saveUsers(users: AppUser[]): void {
  const normalized = users.map(normalizeUser);

  if (hasElectronIpc()) {
    const rows = callElectronSync<UserRow[]>('db-sync:users:replaceAll', normalized.map(toUserRow));
    const persistedUsers = Array.isArray(rows) && (rows.length > 0 || normalized.length === 0)
      ? rows.map(normalizeUser)
      : normalized;
    setUsersState(persistedUsers);
    emitDataChange(STORAGE_KEY);
    return;
  }

  setStorageItem(STORAGE_KEY, normalized);
  setUsersState(normalized);
  emitDataChange(STORAGE_KEY);
}

export function getUserById(id: string): AppUser | undefined {
  return getUsers().find((user) => user.id === id);
}

export function findUserByUsername(username: string): AppUser | undefined {
  const normalizedUsername = username.trim().toLowerCase();
  return getUsers().find((user) => user.username.toLowerCase() === normalizedUsername);
}

export async function addUser(data: Omit<AppUser, 'id' | 'createdAt'>): Promise<AppUser> {
  const salt = generateSalt();
  const passwordHash = data.password ? await hashPassword(data.password, salt) : '';
  
  const newUser = normalizeUser({
    ...data,
    password: passwordHash,
    salt,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  saveUsers([...getUsers(), newUser]);
  return newUser;
}

export async function updateUser(id: string, updates: Partial<Omit<AppUser, 'id' | 'createdAt'>>): Promise<void> {
  const users = getUsers();
  let finalUpdates = { ...updates };
  
  if (updates.password && updates.password.trim() !== '') {
    const salt = generateSalt();
    const passwordHash = await hashPassword(updates.password, salt);
    finalUpdates.password = passwordHash;
    finalUpdates.salt = salt;
  } else {
    // DO NOT overwrite existing password with empty if omitted or blank
    delete finalUpdates.password;
  }

  saveUsers(users.map((user) => (
    user.id === id
      ? normalizeUser({ ...user, ...finalUpdates, updatedAt: new Date().toISOString() })
      : user
  )));
}

export function deleteUser(id: string): void {
  const users = getUsers();
  const owners = users.filter((user) => user.role === 'owner');
  const target = users.find((user) => user.id === id);
  if (target?.role === 'owner' && owners.length <= 1) return;
  saveUsers(users.filter((user) => user.id !== id));
}

export async function changePassword(username: string, newPassword: string): Promise<boolean> {
  const users = getUsers();
  const user = users.find((entry) => entry.username.toLowerCase() === username.toLowerCase());
  if (!user) return false;

  const salt = generateSalt();
  const hashed = await hashPassword(newPassword, salt);
  saveUsers(users.map((entry) => (
    entry.id === user.id
      ? normalizeUser({
        ...entry,
        password: hashed,
        salt,
        mustChangePassword: false,
        updatedAt: new Date().toISOString(),
      })
      : entry
  )));
  return true;
}

export async function migratePasswordToHash(userId: string, plaintextPassword: string): Promise<void> {
  const users = getUsers();
  const user = users.find((entry) => entry.id === userId);
  if (!user || user.salt) return;

  const salt = generateSalt();
  const hashed = await hashPassword(plaintextPassword, salt);
  saveUsers(users.map((entry) => (
    entry.id === userId
      ? normalizeUser({
        ...entry,
        password: hashed,
        salt,
        updatedAt: new Date().toISOString(),
      })
      : entry
  )));
}

export function verifyRecoveryCode(code: string): boolean {
  return code.trim().toUpperCase() === MASTER_RECOVERY_CODE.toUpperCase();
}

export async function migratePasswordsToHashed() {
  const migrationKey = STORAGE_KEYS.PASSWORDS_MIGRATED;
  if (localStorage.getItem(migrationKey)) return;

  const users = getUsers();
  const migrated = await Promise.all(
    users.map(async (user) => {
      if (user.password && !user.salt && user.password.length < 64) {
        const salt = generateSalt();
        const hashed = await hashPassword(user.password, salt);
        return { ...user, password: hashed, salt };
      }
      return user;
    })
  );

  saveUsers(migrated);
  localStorage.setItem(migrationKey, 'done');
  console.log('✅ تم تشفير جميع كلمات المرور');
}
