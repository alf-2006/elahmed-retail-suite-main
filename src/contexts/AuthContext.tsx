import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import {
  AppUser, Permission, getUsers, updateUser, changePassword, findUserByUsername,
  getUserById, isPasswordHashed, verifyPassword, migratePasswordToHash,
} from '@/data/usersData';
import { STORAGE_KEYS } from '@/config';

export type { AppUser, Permission };
export { ALL_PERMISSIONS, PERMISSION_LABELS } from '@/data/usersData';

// ---------- types ----------
export interface AuthUser {
  id: string;
  username: string;
  role: AppUser['role'];
  fullName: string;
  permissions: Permission[];
  lastLogin?: string;
}

interface LoginResult {
  success: boolean;
  error?: string;
  requiresPasswordChange?: boolean;
}

interface AuthContextType {
  user: AuthUser | null;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<LoginResult>;
  logout: () => void;
  hasPermission: (page: Permission) => boolean;
  isOwner: () => boolean;
  // User management (owner only)
  allUsers: AppUser[];
  refreshUsers: () => void;
  updateAppUser: (id: string, updates: Partial<Omit<AppUser, 'id' | 'createdAt'>>) => void;
  resetUserPassword: (username: string, newPassword: string) => Promise<boolean>;
}

const SESSION_KEY = STORAGE_KEYS.AUTH_USER;
const SESSION_TIMEOUT_MS = 8 * 60 * 60 * 1000; // #22: 8 hours
const SESSION_TS_KEY = 'gx_session_ts';
const SESSION_VERSION_KEY = 'gx_session_version';
const SESSION_REFRESH_DEBOUNCE_MS = 30 * 1000;
const AuthContext = createContext<AuthContextType | undefined>(undefined);

function getSessionStore(): Storage {
  return window.sessionStorage;
}

/**
 * Get or create session version.
 * This binds the session to a specific login event.
 * If localStorage is tampered, session is invalidated.
 */
function getOrCreateSessionVersion(): string {
  try {
    const stored = localStorage.getItem(SESSION_VERSION_KEY);
    if (stored) return stored;
    
    // Generate new version for each browser restart
    const version = crypto.randomUUID();
    localStorage.setItem(SESSION_VERSION_KEY, version);
    return version;
  } catch {
    return 'unknown';
  }
}

function clearLegacyAuthStorage(): void {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(SESSION_TS_KEY);
  localStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
  localStorage.removeItem(STORAGE_KEYS.AUTH_USER);
  // Don't clear SESSION_VERSION_KEY - it's for machine binding
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {

    // Fallback to sessionStorage so every new app launch requires login
    try {
      const store = getSessionStore();
      const stored = store.getItem(SESSION_KEY);
      if (!stored) return null;

      // #22 FIX: Check session timeout
      const sessionTs = store.getItem(SESSION_TS_KEY);
      if (sessionTs) {
        const elapsed = Date.now() - Number(sessionTs);
        if (elapsed > SESSION_TIMEOUT_MS) {
          store.removeItem(SESSION_KEY);
          store.removeItem(SESSION_TS_KEY);
          clearLegacyAuthStorage();
          return null;
        }
      }

      // Session version check - prevents tampering
      const storedVersion = store.getItem('sessionVersion');
      const expectedVersion = getOrCreateSessionVersion();
      if (storedVersion !== expectedVersion) {
        // Session was tampered or browser restarted - force re-login
        store.removeItem(SESSION_KEY);
        store.removeItem(SESSION_TS_KEY);
        clearLegacyAuthStorage();
        return null;
      }

      const parsed = JSON.parse(stored) as AuthUser;
      const live = getUserById(parsed.id);
      if (!live || !live.active) {
        store.removeItem(SESSION_KEY);
        store.removeItem(SESSION_TS_KEY);
        clearLegacyAuthStorage();
        return null;
      }
      return {
        id: live.id,
        username: live.username,
        role: live.role,
        fullName: live.fullName,
        permissions: live.permissions,
        lastLogin: parsed.lastLogin,
      };
    } catch {
      getSessionStore().removeItem(SESSION_KEY);
      getSessionStore().removeItem(SESSION_TS_KEY);
      clearLegacyAuthStorage();
      return null;
    }
  });

  const [allUsers, setAllUsers] = useState<AppUser[]>(() => getUsers());

  // Clear old persistent auth so it only uses sessionStorage
  useEffect(() => {
    clearLegacyAuthStorage();
  }, []);

  useEffect(() => {
    const store = getSessionStore();
    if (user) {
      store.setItem(SESSION_KEY, JSON.stringify(user));
      store.setItem(SESSION_TS_KEY, String(Date.now()));
    } else {
      store.removeItem(SESSION_KEY);
      store.removeItem(SESSION_TS_KEY);
    }
  }, [user]);

  const refreshSessionTimestamp = useCallback(() => {
    if (!user) return;

    const store = getSessionStore();
    const now = Date.now();
    const lastSeen = Number(store.getItem(SESSION_TS_KEY) ?? 0);

    if (lastSeen && now - lastSeen < SESSION_REFRESH_DEBOUNCE_MS) {
      return;
    }

    store.setItem(SESSION_TS_KEY, String(now));
  }, [user]);

  useEffect(() => {
    if (!user) return;

    const touchSession = () => {
      const store = getSessionStore();
      const lastSeen = Number(store.getItem(SESSION_TS_KEY) ?? 0);

      if (lastSeen && Date.now() - lastSeen > SESSION_TIMEOUT_MS) {
        setUser(null);
        store.removeItem(SESSION_KEY);
        store.removeItem(SESSION_TS_KEY);
        clearLegacyAuthStorage();
        return;
      }

      refreshSessionTimestamp();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        touchSession();
      }
    };

    const events: Array<keyof WindowEventMap> = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'focus'];
    events.forEach((eventName) => window.addEventListener(eventName, touchSession, { passive: true }));
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      events.forEach((eventName) => window.removeEventListener(eventName, touchSession));
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refreshSessionTimestamp, user]);

  const login = useCallback(async (username: string, password: string) => {
    const found = findUserByUsername(username);
    if (!found || !found.active) {
      return { success: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة' };
    }

    // #01 FIX: PBKDF2 password verification with auto-migration
    let passwordValid = false;
    if (isPasswordHashed(found)) {
      // Already hashed — verify with PBKDF2
      passwordValid = await verifyPassword(password, found.salt!, found.password);
    } else {
      // Still plaintext — compare directly, then migrate
      passwordValid = found.password === password;
      if (passwordValid) {
        // Auto-migrate plaintext password to PBKDF2 hash
        await migratePasswordToHash(found.id, password);
      }
    }

    if (!passwordValid) {
      return { success: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة' };
    }

    if (found.mustChangePassword) {
      return {
        success: false,
        requiresPasswordChange: true,
        error: 'يجب تغيير كلمة المرور قبل الدخول لأول مرة',
      };
    }

    // Generate session version - binds this session to current browser instance
    const sessionVersion = getOrCreateSessionVersion();
    const store = getSessionStore();
    store.setItem('sessionVersion', sessionVersion);

    const authUser: AuthUser = {
      id: found.id,
      username: found.username,
      role: found.role,
      fullName: found.fullName,
      permissions: found.permissions,
      lastLogin: new Date().toISOString(),
    };
    setUser(authUser);

    // Refresh users list
    setAllUsers(getUsers());

    return { success: true };
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    clearLegacyAuthStorage();
  }, []);

  const hasPermission = useCallback((page: Permission) => {
    if (!user) return false;
    if (user.role === 'owner') return true;
    return user.permissions.includes(page);
  }, [user]);

  const isOwner = useCallback(() => {
    return user?.role === 'owner';
  }, [user]);

  const refreshUsers = useCallback(() => {
    const freshUsers = getUsers();
    setAllUsers(freshUsers);
    
    // Sync current user if their permissions or data was modified
    setUser(prev => {
      if (!prev) return prev;
      const updatedUser = freshUsers.find(u => u.id === prev.id);
      if (!updatedUser) return prev;
      
      // Only merge safe auth properties to maintain current session validity
      return {
        ...prev,
        role: updatedUser.role,
        fullName: updatedUser.fullName,
        username: updatedUser.username,
        permissions: updatedUser.permissions,
      };
    });
  }, []);

  const updateAppUser = useCallback((id: string, updates: Partial<Omit<AppUser, 'id' | 'createdAt'>>) => {
    updateUser(id, updates);
    // emitDataChange('users') is called inside updateUser, so we don't strictly need refreshUsers() here 
    // if we add the event listener, but calling it right away is safer for the active tab.
    refreshUsers();
  }, [refreshUsers]);

  const resetUserPassword = useCallback(async (username: string, newPassword: string) => {
    const changed = await changePassword(username, newPassword);
    if (!changed) {
      return false;
    }
    refreshUsers();
    return true;
  }, [refreshUsers]);

  // Synchronize users and current session when users data changes across tabs/IPC
  useEffect(() => {
    const handleStorage = (e: Event | StorageEvent) => {
      // Handle native cross-tab storage event
      if (e.type === 'storage') {
        const se = e as StorageEvent;
        if (se.key === STORAGE_KEYS.USERS) refreshUsers();
      }
      // Handle same-tab/IPC custom event
      else if (e.type === 'local-storage') {
        const ce = e as CustomEvent;
        if (ce.detail?.key === STORAGE_KEYS.USERS) refreshUsers();
      }
    };
    window.addEventListener('storage', handleStorage);
    window.addEventListener('local-storage', handleStorage as EventListener);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('local-storage', handleStorage as EventListener);
    };
  }, [refreshUsers]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        login,
        logout,
        hasPermission,
        isOwner,
        allUsers,
        refreshUsers,
        updateAppUser,
        resetUserPassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
