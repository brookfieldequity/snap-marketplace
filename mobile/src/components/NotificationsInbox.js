import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { notificationAPI } from '../api/client';

// Task #16: notification inbox shown at the top of the provider's home
// (My Schedule) screen so they see what happened the moment they open the app.
// Collapsed by default to a one-line summary with an unread badge; expands to
// the recent list. Tapping a row marks it read.

const ICON = {
  SCHEDULE_PUBLISHED: '🗓️',
  SHIFT_OFFERED: '💰',
  REQUEST_ANSWERED: '✋',
  GENERAL: '🔔',
};

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function NotificationsInbox({ refreshKey }) {
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await notificationAPI.list({ limit: 20 });
      setItems(res.data?.notifications || []);
      setUnread(res.data?.unreadCount || 0);
    } catch (e) {
      setItems([]);
      setUnread(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  async function markRead(n) {
    if (n.readAt) return;
    // Optimistic
    setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
    setUnread((u) => Math.max(0, u - 1));
    try { await notificationAPI.markRead(n.id); } catch {}
  }

  async function markAll() {
    setItems((prev) => prev.map((x) => ({ ...x, readAt: x.readAt || new Date().toISOString() })));
    setUnread(0);
    try { await notificationAPI.markAllRead(); } catch {}
  }

  // Nothing to show and nothing loading → render nothing (keeps the home
  // screen clean for brand-new providers).
  if (!loading && items.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <TouchableOpacity style={styles.header} onPress={() => setExpanded((v) => !v)} activeOpacity={0.7}>
        <View style={styles.headerLeft}>
          <Text style={styles.bell}>🔔</Text>
          <Text style={styles.headerTitle}>Inbox</Text>
          {unread > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{unread}</Text>
            </View>
          )}
        </View>
        <View style={styles.headerRight}>
          {unread > 0 && (
            <TouchableOpacity onPress={markAll} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.markAll}>Mark all read</Text>
            </TouchableOpacity>
          )}
          <Text style={styles.chevron}>{expanded ? '▴' : '▾'}</Text>
        </View>
      </TouchableOpacity>

      {loading && <ActivityIndicator color="#6366F1" style={{ paddingVertical: 14 }} />}

      {!loading && (
        // Collapsed: show only the most recent unread (or most recent) row.
        // Expanded: show the full list.
        (expanded ? items : items.slice(0, 1)).map((n) => (
          <TouchableOpacity
            key={n.id}
            style={[styles.row, !n.readAt && styles.rowUnread]}
            onPress={() => markRead(n)}
            activeOpacity={0.7}
          >
            <Text style={styles.rowIcon}>{ICON[n.type] || ICON.GENERAL}</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, !n.readAt && styles.rowTitleUnread]} numberOfLines={1}>{n.title}</Text>
              <Text style={styles.rowBody} numberOfLines={2}>{n.body}</Text>
              <Text style={styles.rowTime}>{timeAgo(n.createdAt)}</Text>
            </View>
            {!n.readAt && <View style={styles.unreadDot} />}
          </TouchableOpacity>
        ))
      )}

      {!loading && !expanded && items.length > 1 && (
        <TouchableOpacity onPress={() => setExpanded(true)} style={styles.viewAll}>
          <Text style={styles.viewAllText}>View all {items.length} notifications</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginHorizontal: 16,
    marginTop: 12,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bell: { fontSize: 16 },
  headerTitle: { fontSize: 15, fontWeight: '800', color: '#0F172A' },
  badge: { backgroundColor: '#EF4444', borderRadius: 10, minWidth: 20, paddingHorizontal: 6, paddingVertical: 1, alignItems: 'center' },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  markAll: { color: '#6366F1', fontSize: 12, fontWeight: '700' },
  chevron: { color: '#94A3B8', fontSize: 14 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  rowUnread: { backgroundColor: '#F5F7FF' },
  rowIcon: { fontSize: 18, marginTop: 1 },
  rowTitle: { fontSize: 13, fontWeight: '600', color: '#0F172A' },
  rowTitleUnread: { fontWeight: '800' },
  rowBody: { fontSize: 12, color: '#64748B', marginTop: 2, lineHeight: 16 },
  rowTime: { fontSize: 11, color: '#94A3B8', marginTop: 4 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#6366F1', marginTop: 4 },
  viewAll: { paddingVertical: 11, alignItems: 'center', borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  viewAllText: { color: '#6366F1', fontSize: 12, fontWeight: '700' },
});
