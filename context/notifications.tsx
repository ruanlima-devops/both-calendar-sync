import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'expo-router';
import { useSession } from '@/context/session';
import { dayKey } from '@/lib/dates';
import {
  NOTIFICATION_PAGE_SIZE,
  type AppNotification,
} from '@/lib/notifications';
import { supabase } from '@/lib/supabase';

type Filter = 'all' | 'unread';
type LoadState = 'loading' | 'ready' | 'error';

type NotificationsValue = {
  items: AppNotification[];
  unreadCount: number;
  loadState: LoadState;
  filter: Filter;
  centerOpen: boolean;
  toast: AppNotification | null;
  hasMore: boolean;
  loadingMore: boolean;
  setFilter: (filter: Filter) => void;
  openCenter: () => void;
  closeCenter: () => void;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  openNotification: (item: AppNotification) => Promise<void>;
  dismissToast: () => void;
};

const Ctx = createContext<NotificationsValue | null>(null);

function asNotification(row: Record<string, unknown>): AppNotification {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    type: String(row.type),
    provider: (row.provider as AppNotification['provider']) ?? null,
    connection_id: (row.connection_id as string | null) ?? null,
    entity_type: String(row.entity_type ?? 'calendar_event'),
    entity_id: (row.entity_id as string | null) ?? null,
    title: String(row.title ?? ''),
    body: String(row.body ?? ''),
    metadata: (row.metadata as AppNotification['metadata']) ?? {},
    dedupe_key: String(row.dedupe_key ?? ''),
    read_at: (row.read_at as string | null) ?? null,
    created_at: String(row.created_at),
  };
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { session, profile } = useSession();
  const router = useRouter();
  const userId = session?.user.id;
  const tz = profile?.timezone ?? 'UTC';
  const liveRef = useRef(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [filter, setFilter] = useState<Filter>('all');
  const [centerOpen, setCenterOpen] = useState(false);
  const [toast, setToast] = useState<AppNotification | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchUnread = useCallback(async () => {
    if (!userId) return 0;
    const { count } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('read_at', null);
    return count ?? 0;
  }, [userId]);

  const fetchPage = useCallback(async (offset: number) => {
    if (!userId) return [];
    let query = supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + NOTIFICATION_PAGE_SIZE - 1);
    if (filter === 'unread') query = query.is('read_at', null);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map((row) => asNotification(row as Record<string, unknown>));
  }, [filter, userId]);

  const refresh = useCallback(async () => {
    if (!userId) {
      setItems([]);
      setUnreadCount(0);
      setLoadState('ready');
      return;
    }
    setLoadState((current) => (current === 'ready' ? 'ready' : 'loading'));
    try {
      const [page, unread] = await Promise.all([fetchPage(0), fetchUnread()]);
      setItems(page);
      setHasMore(page.length === NOTIFICATION_PAGE_SIZE);
      setUnreadCount(unread);
      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  }, [fetchPage, fetchUnread, userId]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchPage(items.length);
      setItems((prev) => [...prev, ...page]);
      setHasMore(page.length === NOTIFICATION_PAGE_SIZE);
    } catch {
      /* keep existing list */
    } finally {
      setLoadingMore(false);
    }
  }, [fetchPage, hasMore, items.length, loadingMore]);

  useEffect(() => {
    liveRef.current = false;
    void refresh().finally(() => {
      liveRef.current = true;
    });
  }, [refresh]);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = asNotification(payload.new as Record<string, unknown>);
          setItems((prev) => [row, ...prev.filter((item) => item.id !== row.id)]);
          if (!row.read_at) setUnreadCount((n) => n + 1);
          if (liveRef.current) setToast(row);
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = asNotification(payload.new as Record<string, unknown>);
          const prev = payload.old as { read_at?: string | null };
          setItems((list) => list.map((item) => (item.id === row.id ? row : item)));
          if (!prev.read_at && row.read_at) setUnreadCount((n) => Math.max(0, n - 1));
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  const markRead = useCallback(async (id: string) => {
    const current = items.find((item) => item.id === id);
    if (current?.read_at) return;
    const now = new Date().toISOString();
    setItems((list) => list.map((item) => (item.id === id ? { ...item, read_at: now } : item)));
    setUnreadCount((n) => Math.max(0, n - 1));
    const { error } = await supabase.rpc('mark_notifications_read', { target_ids: [id] });
    if (error) await refresh();
  }, [items, refresh]);

  const markAllRead = useCallback(async () => {
    setItems((list) => list.map((item) => ({ ...item, read_at: item.read_at ?? new Date().toISOString() })));
    setUnreadCount(0);
    const { error } = await supabase.rpc('mark_notifications_read', { target_ids: null });
    if (error) await refresh();
  }, [refresh]);

  const openNotification = useCallback(async (item: AppNotification) => {
    await markRead(item.id);
    setCenterOpen(false);
    setToast(null);
    const startAt = item.metadata?.startAt;
    if (item.type === 'calendar_event_deleted') {
      if (startAt) router.push({ pathname: '/(app)/(tabs)', params: { day: dayKey(startAt, tz) } });
      else router.push('/(app)/(tabs)');
      return;
    }
    if (item.entity_id) {
      router.push(`/(app)/event/${item.entity_id}`);
      return;
    }
    if (startAt) router.push({ pathname: '/(app)/(tabs)', params: { day: dayKey(startAt, tz) } });
  }, [markRead, router, tz]);

  const value = useMemo<NotificationsValue>(
    () => ({
      items,
      unreadCount,
      loadState,
      filter,
      centerOpen,
      toast,
      hasMore,
      loadingMore,
      setFilter,
      openCenter: () => setCenterOpen(true),
      closeCenter: () => setCenterOpen(false),
      refresh,
      loadMore,
      markRead,
      markAllRead,
      openNotification,
      dismissToast: () => setToast(null),
    }),
    [centerOpen, filter, hasMore, items, loadMore, loadState, loadingMore, markAllRead, markRead, openNotification, refresh, toast, unreadCount],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNotifications(): NotificationsValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useNotifications outside provider');
  return ctx;
}
