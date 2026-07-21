import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { providerAPI } from '../api/client';

const COLORS = {
  primary: '#2563EB',
  background: '#FAFAFA',
  textDark: '#0F172A',
  textMuted: '#64748B',
  success: '#10B981',
  card: '#FFFFFF',
  border: '#E2E8F0',
  white: '#FFFFFF',
  pending: '#F59E0B',
  processing: '#3B82F6',
};

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const STATUS_CONFIG = {
  'Pending Confirmation': {
    color: '#B45309',
    bg: '#FEF3C7',
    border: '#FCD34D',
    label: 'Pending',
  },
  'Processing': {
    color: '#1D4ED8',
    bg: '#DBEAFE',
    border: '#93C5FD',
    label: 'Processing',
  },
  'Paid': {
    color: '#065F46',
    bg: '#D1FAE5',
    border: '#6EE7B7',
    label: 'Paid',
  },
};

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatCurrency(amount) {
  if (amount == null) return '$0';
  return `$${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG['Pending Confirmation'];
  return (
    <View style={[styles.statusBadge, { backgroundColor: cfg.bg, borderColor: cfg.border }]}>
      <Text style={[styles.statusText, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
}

function EarningsItem({ item }) {
  return (
    <View style={styles.earningsItem}>
      <View style={styles.earningsItemLeft}>
        <View style={styles.facilityDot}>
          <Text style={styles.facilityDotText}>
            {(item.facilityName || 'F').charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={styles.earningsItemInfo}>
          <Text style={styles.itemFacility} numberOfLines={1}>{item.facilityName || 'Facility'}</Text>
          <Text style={styles.itemDate}>{formatDate(item.shiftDate)}</Text>
          <Text style={styles.itemHours}>{item.hours || '—'} hours · {item.specialty}</Text>
        </View>
      </View>
      <View style={styles.earningsItemRight}>
        <Text style={styles.itemAmount}>{formatCurrency(item.amount)}</Text>
        <StatusBadge status={item.paymentStatus} />
      </View>
    </View>
  );
}

// Placeholder data
const PLACEHOLDER_EARNINGS = {
  totalThisMonth: 4875,
  totalAllTime: 38240,
  month: new Date().getMonth(),
  year: new Date().getFullYear(),
  shifts: [
    {
      id: '1',
      facilityName: 'Massachusetts General Hospital',
      specialty: 'CRNA',
      shiftDate: new Date(Date.now() - 86400000 * 2).toISOString(),
      hours: 8,
      amount: 1560,
      paymentStatus: 'Processing',
    },
    {
      id: '2',
      facilityName: 'Brigham and Women\'s Hospital',
      specialty: 'CRNA',
      shiftDate: new Date(Date.now() - 86400000 * 5).toISOString(),
      hours: 10,
      amount: 1950,
      paymentStatus: 'Paid',
    },
    {
      id: '3',
      facilityName: 'Boston Children\'s Hospital',
      specialty: 'CRNA',
      shiftDate: new Date(Date.now() - 86400000 * 8).toISOString(),
      hours: 6,
      amount: 1365,
      paymentStatus: 'Pending Confirmation',
    },
    {
      id: '4',
      facilityName: 'Beth Israel Deaconess Medical Center',
      specialty: 'CRNA',
      shiftDate: new Date(Date.now() - 86400000 * 20).toISOString(),
      hours: 12,
      amount: 2340,
      paymentStatus: 'Paid',
    },
    {
      id: '5',
      facilityName: 'Tufts Medical Center',
      specialty: 'CRNA',
      shiftDate: new Date(Date.now() - 86400000 * 25).toISOString(),
      hours: 8,
      amount: 1560,
      paymentStatus: 'Paid',
    },
  ],
};

export default function EarningsScreen({ navigation }) {
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth());
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadEarnings();
  }, [selectedMonth, selectedYear]);

  const loadEarnings = async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const res = await providerAPI.getEarnings({ month: selectedMonth + 1, year: selectedYear });
      setData(res.data);
    } catch {
      setData(PLACEHOLDER_EARNINGS);
    } finally {
      setLoading(false);
      if (isRefresh) setRefreshing(false);
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    loadEarnings(true);
  };

  const prevMonth = () => {
    if (selectedMonth === 0) {
      setSelectedMonth(11);
      setSelectedYear((y) => y - 1);
    } else {
      setSelectedMonth((m) => m - 1);
    }
  };

  const nextMonth = () => {
    const isCurrentMonth =
      selectedMonth === now.getMonth() && selectedYear === now.getFullYear();
    if (isCurrentMonth) return; // Don't go into the future
    if (selectedMonth === 11) {
      setSelectedMonth(0);
      setSelectedYear((y) => y + 1);
    } else {
      setSelectedMonth((m) => m + 1);
    }
  };

  const isCurrentMonth = selectedMonth === now.getMonth() && selectedYear === now.getFullYear();

  const shifts = data?.shifts || [];
  const totalMonth = data?.totalThisMonth ?? 0;
  const totalAllTime = data?.totalAllTime ?? 0;

  // Payment status breakdown
  const paidCount = shifts.filter((s) => s.paymentStatus === 'Paid').length;
  const processingCount = shifts.filter((s) => s.paymentStatus === 'Processing').length;
  const pendingCount = shifts.filter((s) => s.paymentStatus === 'Pending Confirmation').length;

  const ListHeader = () => (
    <>
      {/* Month navigator */}
      <View style={styles.monthNav}>
        <TouchableOpacity style={styles.navButton} onPress={prevMonth}>
          <Text style={styles.navArrow}>←</Text>
        </TouchableOpacity>
        <View style={styles.monthCenter}>
          <Text style={styles.monthLabel}>{MONTHS[selectedMonth]}</Text>
          <Text style={styles.yearLabel}>{selectedYear}</Text>
        </View>
        <TouchableOpacity
          style={[styles.navButton, isCurrentMonth && styles.navButtonDisabled]}
          onPress={nextMonth}
          disabled={isCurrentMonth}
        >
          <Text style={[styles.navArrow, isCurrentMonth && styles.navArrowDisabled]}>→</Text>
        </TouchableOpacity>
      </View>

      {/* Summary cards */}
      <View style={styles.summaryCards}>
        <View style={[styles.summaryCard, styles.primarySummary]}>
          <Text style={styles.summaryCardLabel}>This Month</Text>
          <Text style={styles.summaryCardAmount}>{formatCurrency(totalMonth)}</Text>
          <Text style={styles.summaryCardSub}>{shifts.length} shift{shifts.length !== 1 ? 's' : ''}</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryCardLabel}>All Time</Text>
          <Text style={[styles.summaryCardAmount, { color: COLORS.textDark }]}>
            {formatCurrency(totalAllTime)}
          </Text>
          <Text style={styles.summaryCardSub}>career total</Text>
        </View>
      </View>

      {/* Status breakdown */}
      <View style={styles.statusRow}>
        <View style={styles.statusBlock}>
          <Text style={styles.statusBlockNum}>{paidCount}</Text>
          <Text style={styles.statusBlockLabel}>Paid</Text>
        </View>
        <View style={styles.statusDivider} />
        <View style={styles.statusBlock}>
          <Text style={[styles.statusBlockNum, { color: COLORS.processing }]}>{processingCount}</Text>
          <Text style={styles.statusBlockLabel}>Processing</Text>
        </View>
        <View style={styles.statusDivider} />
        <View style={styles.statusBlock}>
          <Text style={[styles.statusBlockNum, { color: COLORS.pending }]}>{pendingCount}</Text>
          <Text style={styles.statusBlockLabel}>Pending</Text>
        </View>
      </View>

      {/* Section heading */}
      <Text style={styles.shiftsHeading}>Shift Payments</Text>
    </>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header — back chevron appears when pushed onto the root stack
          (e.g. from the Hours tab; the app hides native headers). */}
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {navigation?.canGoBack?.() && (
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
              <Text style={styles.backBtnText}>‹</Text>
            </TouchableOpacity>
          )}
          <Text style={styles.headerTitle}>My Earnings</Text>
        </View>
        <Text style={styles.headerSub}>Massachusetts · Anesthesia</Text>
      </View>

      {loading ? (
        <View style={styles.centerLoader}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading earnings...</Text>
        </View>
      ) : (
        <FlatList
          data={shifts}
          keyExtractor={(item, index) => item._id || item.id || String(index)}
          renderItem={({ item }) => <EarningsItem item={item} />}
          ListHeaderComponent={ListHeader}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={COLORS.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>💰</Text>
              <Text style={styles.emptyTitle}>No earnings this month</Text>
              <Text style={styles.emptySubtitle}>
                Completed shifts will appear here once confirmed by the facility.
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

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
  backBtn: {
    marginRight: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  backBtnText: {
    fontSize: 28,
    lineHeight: 30,
    color: COLORS.primary,
    fontWeight: '700',
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
    fontWeight: '500',
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
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
  },
  navButton: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navButtonDisabled: {
    opacity: 0.3,
  },
  navArrow: {
    fontSize: 18,
    color: COLORS.primary,
    fontWeight: '700',
  },
  navArrowDisabled: {
    color: COLORS.textMuted,
  },
  monthCenter: {
    alignItems: 'center',
  },
  monthLabel: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.textDark,
    letterSpacing: -0.3,
  },
  yearLabel: {
    fontSize: 13,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  summaryCards: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  primarySummary: {
    backgroundColor: COLORS.success,
    borderColor: COLORS.success,
  },
  summaryCardLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.white,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
    opacity: 0.85,
  },
  summaryCardAmount: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.white,
    letterSpacing: -1,
    marginBottom: 4,
  },
  summaryCardSub: {
    fontSize: 12,
    color: COLORS.white,
    fontWeight: '500',
    opacity: 0.75,
  },
  statusRow: {
    flexDirection: 'row',
    backgroundColor: COLORS.card,
    borderRadius: 14,
    paddingVertical: 16,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  statusBlock: {
    flex: 1,
    alignItems: 'center',
  },
  statusBlockNum: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.success,
    letterSpacing: -0.5,
  },
  statusBlockLabel: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontWeight: '600',
    marginTop: 3,
  },
  statusDivider: {
    width: 1,
    backgroundColor: COLORS.border,
    marginVertical: 4,
  },
  shiftsHeading: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.textDark,
    marginBottom: 12,
    letterSpacing: -0.2,
  },
  earningsItem: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  earningsItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 12,
  },
  facilityDot: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: COLORS.primary + '18',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  facilityDotText: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.primary,
  },
  earningsItemInfo: {
    flex: 1,
  },
  itemFacility: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textDark,
    marginBottom: 2,
  },
  itemDate: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginBottom: 2,
    fontWeight: '500',
  },
  itemHours: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '400',
  },
  earningsItemRight: {
    alignItems: 'flex-end',
    gap: 6,
  },
  itemAmount: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.textDark,
    letterSpacing: -0.5,
  },
  statusBadge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: 40,
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
