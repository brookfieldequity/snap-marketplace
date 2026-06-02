import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { shiftAPI } from '../api/client';
import FilterSheet from '../components/FilterSheet';
import ShiftMap from '../components/ShiftMap';

const COLORS = {
  primary: '#6366F1',
  background: '#FAFAFA',
  textDark: '#0F172A',
  textMuted: '#64748B',
  surge: '#F59E0B',
  vip: '#7C3AED',
  success: '#10B981',
  card: '#FFFFFF',
  border: '#E2E8F0',
  white: '#FFFFFF',
};

// "Location" sort is implicit when the user opens the Map view, so it's been
// removed from the sort chips and replaced by the List/Map header toggle.
const SORT_OPTIONS = [
  { key: 'featured', label: 'Featured' },
  { key: 'newest', label: 'Newest' },
  { key: 'pay', label: 'Pay Rate' },
  { key: 'surge', label: 'Surge' },
];

function countActiveFilters(f) {
  let n = 0;
  if (f.minRate != null) n++;
  if (f.maxRate != null) n++;
  if (f.dateRange) n++;
  if (f.shiftType) n++;
  if (f.facilityType?.length) n++;
  return n;
}

function normalizeShift(s) {
  const rawStart = s.startTime;
  const isTimeStr = rawStart && /^\d{1,2}:\d{2}/.test(rawStart);
  let startIso = rawStart;
  let endIso = s.endTime;
  if (isTimeStr && s.date) {
    const [h, m] = rawStart.split(':').map(Number);
    const d = new Date(s.date);
    d.setHours(h, m, 0, 0);
    startIso = d.toISOString();
    const endD = new Date(d.getTime() + (s.durationHours || 0) * 3600000);
    endIso = endD.toISOString();
  }
  return {
    ...s,
    facilityName: s.facility?.name ?? s.facilityName,
    facilityAddress: s.facility?.address ?? s.facilityAddress,
    payRate: s.currentRate ?? s.baseRate ?? s.payRate,
    viewerCount: s.currentViewers ?? s.viewerCount,
    startTime: startIso,
    endTime: endIso,
    vipWindowEnd: s.preferredWindowEnds ?? s.vipWindowEnd,
  };
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function hoursUntil(expiryStr) {
  if (!expiryStr) return null;
  const diff = new Date(expiryStr) - new Date();
  const hours = Math.round(diff / (1000 * 60 * 60));
  return hours > 0 ? hours : 0;
}

function ShiftCard({ shift, onPress }) {
  const isSurge = shift.surgeMultiplier && shift.surgeMultiplier > 1;
  const isVipWindow = shift.vipWindowActive;
  const expHours = hoursUntil(shift.expiresAt);
  const isUrgent = expHours !== null && expHours <= 24;

  return (
    <TouchableOpacity style={styles.card} onPress={() => onPress(shift)} activeOpacity={0.88}>
      {/* Top badges row */}
      <View style={styles.cardBadgeRow}>
        {isSurge && (
          <View style={styles.surgeBadge}>
            <Text style={styles.surgeBadgeText}>
              ⚡ SURGE {shift.surgeMultiplier}x
            </Text>
          </View>
        )}
        {isVipWindow && (
          <View style={styles.vipBadge}>
            <Text style={styles.vipBadgeText}>★ VIP EARLY ACCESS</Text>
          </View>
        )}
        {shift.workedHereBefore && (
          <View style={styles.workedBadge}>
            <Text style={styles.workedBadgeText}>Worked Here Before</Text>
          </View>
        )}
      </View>

      {/* Facility + specialty */}
      <View style={styles.cardHeader}>
        <View style={styles.facilityIcon}>
          <Text style={styles.facilityIconText}>
            {(shift.facilityName || 'F').charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={styles.cardHeaderText}>
          <Text style={styles.facilityName} numberOfLines={1}>
            {shift.facilityName || 'Facility'}
          </Text>
          <Text style={styles.specialtyText}>{shift.specialty}</Text>
        </View>
        <View style={styles.payBlock}>
          <Text style={styles.payRate}>
            ${shift.payRate?.toFixed(0)}
            <Text style={styles.perHour}>/hr</Text>
          </Text>
          {isSurge && (
            <Text style={styles.surgeCalc}>
              ≈ ${(shift.payRate * shift.surgeMultiplier).toFixed(0)}/hr effective
            </Text>
          )}
        </View>
      </View>

      {/* Divider */}
      <View style={styles.divider} />

      {/* Details row */}
      <View style={styles.detailsRow}>
        <View style={styles.detailItem}>
          <Text style={styles.detailIcon}>📅</Text>
          <Text style={styles.detailText}>{formatDate(shift.startTime)}</Text>
        </View>
        <View style={styles.detailItem}>
          <Text style={styles.detailIcon}>🕐</Text>
          <Text style={styles.detailText}>
            {formatTime(shift.startTime)} – {formatTime(shift.endTime)}
          </Text>
        </View>
        <View style={styles.detailItem}>
          <Text style={styles.detailIcon}>⏱</Text>
          <Text style={styles.detailText}>{shift.durationHours || '—'} hrs</Text>
        </View>
      </View>

      {/* Footer row */}
      <View style={styles.cardFooter}>
        <View style={styles.footerLeft}>
          {shift.distanceMiles != null && (
            <Text style={styles.footerMeta}>📍 {shift.distanceMiles.toFixed(1)} mi</Text>
          )}
          {shift.viewerCount > 0 && (
            <Text style={styles.footerMeta}>👀 {shift.viewerCount} viewing</Text>
          )}
        </View>
        {expHours !== null && (
          <View style={[styles.expiryBadge, isUrgent && styles.expiryBadgeUrgent]}>
            <Text style={[styles.expiryText, isUrgent && styles.expiryTextUrgent]}>
              {expHours === 0 ? 'Expiring now' : `Expires in ${expHours}h`}
            </Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

export default function FeedScreen({ navigation }) {
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [activeSort, setActiveSort] = useState('featured');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'map'
  const [filterVisible, setFilterVisible] = useState(false);
  const [filters, setFilters] = useState({});

  const fetchShifts = useCallback(
    async ({ sort = activeSort, pageNum = 1, append = false, currentFilters = filters, mode = viewMode } = {}) => {
      try {
        const params = {
          sort: mode === 'map' ? 'location' : sort,
          page: pageNum,
          // Map view loads everything that fits (no pagination on a map).
          limit: mode === 'map' ? 200 : 15,
          minRate: currentFilters.minRate,
          maxRate: currentFilters.maxRate,
          dateRange: currentFilters.dateRange,
          shiftType: currentFilters.shiftType,
          facilityType: currentFilters.facilityType?.length
            ? currentFilters.facilityType.join(',')
            : undefined,
        };
        const res = await shiftAPI.getFeed(params);
        const raw = res.data?.shifts || res.data || [];
        const data = raw.map(normalizeShift);
        const total = res.data?.total || data.length;

        if (append) {
          setShifts((prev) => [...prev, ...data]);
        } else {
          setShifts(data);
        }
        setHasMore(mode === 'list' && pageNum * 15 < total);
        setPage(pageNum);
      } catch (err) {
        if (!append) {
          // Show placeholder data if API not yet available
          setShifts(PLACEHOLDER_SHIFTS);
        }
      }
    },
    [activeSort, filters, viewMode]
  );

  useEffect(() => {
    setLoading(true);
    fetchShifts({ sort: activeSort, pageNum: 1, currentFilters: filters, mode: viewMode })
      .finally(() => setLoading(false));
  }, [activeSort, filters, viewMode]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchShifts({ sort: activeSort, pageNum: 1, currentFilters: filters, mode: viewMode });
    setRefreshing(false);
  };

  const handleLoadMore = async () => {
    if (viewMode !== 'list' || loadingMore || !hasMore) return;
    setLoadingMore(true);
    await fetchShifts({ sort: activeSort, pageNum: page + 1, append: true, currentFilters: filters, mode: 'list' });
    setLoadingMore(false);
  };

  const handleSortChange = (key) => {
    setActiveSort(key);
    setPage(1);
    setHasMore(true);
  };

  const handleApplyFilters = (next) => {
    setFilters(next);
    setPage(1);
    setHasMore(true);
  };

  const activeFilterCount = countActiveFilters(filters);

  const renderFooter = () => {
    if (!loadingMore) return null;
    return (
      <View style={styles.loadMoreIndicator}>
        <ActivityIndicator size="small" color={COLORS.primary} />
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Available Shifts</Text>
          <Text style={styles.headerSub}>Massachusetts · Anesthesia</Text>
        </View>

        {/* List / Map toggle */}
        <View style={styles.viewToggle}>
          <TouchableOpacity
            style={[styles.viewToggleBtn, viewMode === 'list' && styles.viewToggleBtnActive]}
            onPress={() => setViewMode('list')}
          >
            <Text style={[styles.viewToggleText, viewMode === 'list' && styles.viewToggleTextActive]}>
              List
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.viewToggleBtn, viewMode === 'map' && styles.viewToggleBtnActive]}
            onPress={() => setViewMode('map')}
          >
            <Text style={[styles.viewToggleText, viewMode === 'map' && styles.viewToggleTextActive]}>
              Map
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Sort bar + filter button */}
      <View style={styles.sortRow}>
        <View style={styles.sortBarWrapper}>
          <FlatList
            horizontal
            data={SORT_OPTIONS}
            keyExtractor={(item) => item.key}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.sortBar}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.sortChip, activeSort === item.key && styles.sortChipActive]}
                onPress={() => handleSortChange(item.key)}
                disabled={viewMode === 'map'}
              >
                <Text
                  style={[styles.sortChipText, activeSort === item.key && styles.sortChipTextActive]}
                >
                  {item.label}
                </Text>
              </TouchableOpacity>
            )}
          />
        </View>
        <TouchableOpacity
          style={[styles.filterButton, activeFilterCount > 0 && styles.filterButtonActive]}
          onPress={() => setFilterVisible(true)}
        >
          <Text style={[styles.filterButtonText, activeFilterCount > 0 && styles.filterButtonTextActive]}>
            Filters{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ''}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Feed */}
      {loading ? (
        <View style={styles.centerLoader}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading shifts...</Text>
        </View>
      ) : viewMode === 'map' ? (
        <ShiftMap
          shifts={shifts}
          onShiftPress={(s) => navigation.navigate('ShiftDetail', { shiftId: s._id || s.id, shift: s })}
        />
      ) : (
        <FlatList
          data={shifts}
          keyExtractor={(item, index) => item._id || item.id || String(index)}
          renderItem={({ item }) => (
            <ShiftCard
              shift={item}
              onPress={(s) => navigation.navigate('ShiftDetail', { shiftId: s._id || s.id, shift: s })}
            />
          )}
          contentContainerStyle={styles.feedList}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={COLORS.primary}
            />
          }
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.4}
          ListFooterComponent={renderFooter}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>🔍</Text>
              <Text style={styles.emptyTitle}>No shifts available</Text>
              <Text style={styles.emptySubtitle}>
                Check back soon — new shifts are posted daily. Pull down to refresh.
              </Text>
            </View>
          }
        />
      )}

      <FilterSheet
        visible={filterVisible}
        initial={filters}
        onApply={handleApplyFilters}
        onClose={() => setFilterVisible(false)}
      />
    </SafeAreaView>
  );
}

// Placeholder data for when the API is unavailable during development
const PLACEHOLDER_SHIFTS = [
  {
    id: '1',
    facilityName: 'Massachusetts General Hospital',
    specialty: 'CRNA',
    payRate: 195,
    surgeMultiplier: 1.25,
    startTime: new Date(Date.now() + 86400000 * 2).toISOString(),
    endTime: new Date(Date.now() + 86400000 * 2 + 28800000).toISOString(),
    durationHours: 8,
    distanceMiles: 2.4,
    viewerCount: 7,
    expiresAt: new Date(Date.now() + 3600000 * 18).toISOString(),
    vipWindowActive: true,
    workedHereBefore: false,
  },
  {
    id: '2',
    facilityName: 'Brigham and Women\'s Hospital',
    specialty: 'Anesthesiologist',
    payRate: 280,
    surgeMultiplier: 1,
    startTime: new Date(Date.now() + 86400000 * 3).toISOString(),
    endTime: new Date(Date.now() + 86400000 * 3 + 43200000).toISOString(),
    durationHours: 12,
    distanceMiles: 3.1,
    viewerCount: 3,
    expiresAt: new Date(Date.now() + 3600000 * 36).toISOString(),
    vipWindowActive: false,
    workedHereBefore: true,
  },
  {
    id: '3',
    facilityName: 'Boston Children\'s Hospital',
    specialty: 'CRNA',
    payRate: 210,
    surgeMultiplier: 1.5,
    startTime: new Date(Date.now() + 86400000).toISOString(),
    endTime: new Date(Date.now() + 86400000 + 28800000).toISOString(),
    durationHours: 8,
    distanceMiles: 4.7,
    viewerCount: 12,
    expiresAt: new Date(Date.now() + 3600000 * 8).toISOString(),
    vipWindowActive: false,
    workedHereBefore: false,
  },
];

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.textDark,
    letterSpacing: -0.3,
  },
  headerSub: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
    fontWeight: '500',
  },
  headerLogoBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerLogoText: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.white,
  },
  viewToggle: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 10,
    padding: 3,
  },
  viewToggleBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
  },
  viewToggleBtnActive: {
    backgroundColor: COLORS.white,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  viewToggleText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textMuted,
  },
  viewToggleTextActive: {
    color: COLORS.textDark,
  },
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingRight: 12,
  },
  filterButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    backgroundColor: COLORS.white,
    marginLeft: 8,
  },
  filterButtonActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  filterButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textDark,
  },
  filterButtonTextActive: {
    color: COLORS.white,
  },
  sortBarWrapper: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  sortBar: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  sortChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  sortChipActive: {
    backgroundColor: COLORS.primary + '15',
    borderColor: COLORS.primary,
  },
  sortChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  sortChipTextActive: {
    color: COLORS.primary,
  },
  feedList: {
    padding: 16,
    gap: 12,
    paddingBottom: 32,
  },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  cardBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 10,
  },
  surgeBadge: {
    backgroundColor: COLORS.surge + '20',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: COLORS.surge + '50',
  },
  surgeBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#B45309',
    letterSpacing: 0.3,
  },
  vipBadge: {
    backgroundColor: COLORS.vip + '18',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: COLORS.vip + '40',
  },
  vipBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.vip,
    letterSpacing: 0.3,
  },
  workedBadge: {
    backgroundColor: COLORS.success + '18',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: COLORS.success + '40',
  },
  workedBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#065F46',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  facilityIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: COLORS.primary + '18',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  facilityIconText: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.primary,
  },
  cardHeaderText: {
    flex: 1,
    paddingRight: 8,
  },
  facilityName: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textDark,
    marginBottom: 3,
  },
  specialtyText: {
    fontSize: 13,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  payBlock: {
    alignItems: 'flex-end',
  },
  payRate: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.primary,
    letterSpacing: -0.5,
  },
  perHour: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.textMuted,
  },
  surgeCalc: {
    fontSize: 10,
    color: '#B45309',
    fontWeight: '600',
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginBottom: 12,
  },
  detailsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  detailIcon: {
    fontSize: 12,
  },
  detailText: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  footerLeft: {
    flexDirection: 'row',
    gap: 12,
  },
  footerMeta: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  expiryBadge: {
    backgroundColor: '#F1F5F9',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  expiryBadgeUrgent: {
    backgroundColor: '#FEF2F2',
  },
  expiryText: {
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  expiryTextUrgent: {
    color: '#DC2626',
  },
  centerLoader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: COLORS.textMuted,
  },
  loadMoreIndicator: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 32,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.textDark,
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 21,
  },
});
