// ============================================================
// Top Header Bar — ELOS-style
// Live HH:MM:SS clock | date | back | dark mode toggle
// ============================================================

import { useLocation, useNavigate, Link } from 'react-router-dom';
import { Moon, Sun, ChevronRight, ChevronLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { NotificationBell } from '@/components/NotificationBell';
import { STORAGE_KEYS } from '@/config';
import { getAiNotifications, getAiNotificationsMeta, markAiNotificationRead, markAllAiNotificationsRead } from '@/data/aiNotificationsData';
import ConnectionIndicator from '@/components/ConnectionIndicator';

const ROUTE_TITLES: Record<string, string> = {
    '/': 'الرئيسية',
    '/pos': 'نقطة البيع',
    '/sales': 'المبيعات',
    '/returns': 'المرتجعات',
    '/mobiles': 'الموبيلات وإكسسوارات',
    '/mobiles/accessories': 'إكسسوارات الموبيلات',
    '/mobiles/spare-parts': 'قطع غيار الموبيلات',
    '/computers': 'الكمبيوترات وإكسسوارات',
    '/computers/accessories': 'إكسسوارات الكمبيوترات',
    '/computers/spare-parts': 'قطع غيار الكمبيوترات',
    '/devices': 'الأجهزة وإكسسوارات',
    '/devices/accessories': 'إكسسوارات الأجهزة',
    '/devices/spare-parts': 'قطع غيار الأجهزة',
    '/cars': 'السيارات',
    '/cars/spare-parts': 'قطع غيار السيارات',
    '/cars/oils': 'زيوت السيارات',
    '/warehouse': 'المستودع',

    '/barcodes': 'طباعة الباركود',
    '/maintenance': 'الصيانة',
    '/installments': 'التقسيط',
    '/expenses': 'المصروفات',
    '/damaged': 'الهالك',
    '/other-revenue': 'أرباح أخرى',
    '/settings': 'الإعدادات',
    '/users': 'إدارة المستخدمين',
    '/customers': 'إدارة العملاء',
    '/wallets': 'المحافظ والخزنة',
    '/employees': 'الموظفين والرواتب',
    '/help': 'المساعدة والدليل',
    '/suppliers': 'الموردون',
    '/blacklist': 'القائمة السوداء',
    '/reminders': 'التذكيرات',
    '/shift-closing': 'إقفال الوردية',
    '/purchase-invoices': 'فواتير الشراء',
    '/reports': 'التقارير والإحصاءات',
    '/diagnostics': 'تشخيص النظام',
    '/partners': 'الشركاء والموزعون',
};

ROUTE_TITLES['/used-inventory'] = 'الأجهزة المستعملة';
ROUTE_TITLES['/maintenance/parts'] = 'قطع الصيانة';
ROUTE_TITLES['/stocktake'] = 'الجرد';

function getBreadcrumbs(pathname: string) {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length === 0) return [{ path: '/', title: ROUTE_TITLES['/'] }];
    
    const crumbs = [{ path: '/', title: ROUTE_TITLES['/'] }];
    let currentPath = '';
    
    for (const part of parts) {
        currentPath += `/${part}`;
        if (ROUTE_TITLES[currentPath] && currentPath !== '/') {
            crumbs.push({ path: currentPath, title: ROUTE_TITLES[currentPath] });
        }
    }
    
    // Fallback if no matching routes found except root
    if (crumbs.length === 1 && ROUTE_TITLES[pathname]) {
        crumbs.push({ path: pathname, title: ROUTE_TITLES[pathname] });
    } else if (crumbs.length === 1 && !ROUTE_TITLES[pathname]) {
        crumbs.push({ path: pathname, title: 'صفحة فرعية' });
    }
    
    return crumbs;
}

function useLiveClock() {
    const [now, setNow] = useState(new Date());
    useEffect(() => {
        const t = setInterval(() => setNow(new Date()), 1_000);
        return () => clearInterval(t);
    }, []);
    return now;
}

export default function TopHeader() {
    const location = useLocation();
    const navigate = useNavigate();
    const { theme, toggleTheme } = useTheme();
    const now = useLiveClock();
    const [notifications, setNotifications] = useState(() => getAiNotifications());
    const [lastRunAt, setLastRunAt] = useState(() => getAiNotificationsMeta().lastRunAt);

    const breadcrumbs = getBreadcrumbs(location.pathname);
    const isRoot = location.pathname === '/';
    const unreadCount = notifications.filter((item) => !item.read).length;

    useEffect(() => {
        const refreshNotifications = () => {
            setNotifications(getAiNotifications());
            setLastRunAt(getAiNotificationsMeta().lastRunAt);
        };

        const handleStorageEvent = (event: Event) => {
            const key = (event as CustomEvent<{ key?: string }>).detail?.key;
            if (!key || key === STORAGE_KEYS.AI_NOTIFICATIONS || key === STORAGE_KEYS.AI_NOTIFICATIONS_META) {
                refreshNotifications();
            }
        };

        refreshNotifications();
        window.addEventListener('local-storage', handleStorageEvent as EventListener);
        return () => window.removeEventListener('local-storage', handleStorageEvent as EventListener);
    }, []);

    const timeStr = now.toLocaleTimeString('ar-EG', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
    });
    const dateStr = now.toLocaleDateString('ar-EG', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
    });

    return (
        <header className="hidden md:flex items-center gap-3 px-6 py-3 bg-background/80 backdrop-blur-md border border-border/40 shadow-sm shrink-0 z-10 rounded-b-2xl mx-4 mt-2">

            {/* Breadcrumbs */}
            <nav className="flex items-center text-sm font-extrabold text-foreground tracking-tight flex-1 truncate" aria-label="Breadcrumb">
                {breadcrumbs.map((crumb, idx) => (
                    <div key={crumb.path} className="flex items-center">
                        {idx > 0 && <ChevronLeft className="h-4 w-4 text-muted-foreground/50 mx-1.5" />}
                        <Link 
                            to={crumb.path}
                            className={crumb.path === location.pathname 
                                ? "text-foreground cursor-default" 
                                : "text-muted-foreground hover:text-primary transition-colors"
                            }
                        >
                            {crumb.title}
                        </Link>
                    </div>
                ))}
            </nav>

            {/* Right side */}
            <div className="flex items-center gap-2 shrink-0">

                {/* ELOS-style live clock card */}
                <div
                    className="flex flex-col items-center px-4 py-1.5 rounded-xl border transition-all hover:-translate-y-0.5 cursor-default bg-gradient-to-br from-primary/10 to-primary/5 border-primary/20"
                >
                    <span
                        className="font-black text-sm tracking-widest leading-none"
                        style={{ fontFamily: "'Courier New', monospace", color: 'hsl(var(--primary))' }}
                    >
                        {timeStr}
                    </span>
                    <span className="text-[10px] text-muted-foreground font-medium leading-tight mt-0.5">
                        {dateStr}
                    </span>
                </div>

                {/* Connection Status Indicator */}
                <ConnectionIndicator />

                <NotificationBell
                    notifications={notifications}
                    unreadCount={unreadCount}
                    lastRunAt={lastRunAt}
                    onMarkAsRead={(id) => {
                        markAiNotificationRead(id);
                        setNotifications(getAiNotifications());
                    }}
                    onMarkAllAsRead={() => {
                        markAllAiNotificationsRead();
                        setNotifications(getAiNotifications());
                    }}
                />

                {/* Back button */}
                {!isRoot && (
                    <button
                        onClick={() => navigate(-1)}
                        title="رجوع"
                        className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-muted-foreground border border-border/40 bg-muted/60 hover:bg-muted hover:text-foreground transition-colors"
                    >
                        <ChevronRight className="h-3.5 w-3.5" />
                        <span>رجوع</span>
                    </button>
                )}

                {/* Theme toggle */}
                <button
                    onClick={toggleTheme}
                    title={theme === 'light' ? 'الوضع الداكن' : 'الوضع الفاتح'}
                    className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/40 bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground transition-all hover:scale-110"
                >
                    {theme === 'light'
                        ? <Moon className="h-4 w-4" />
                        : <Sun className="h-4 w-4 text-amber-400" />
                    }
                </button>
            </div>
        </header>
    );
}
