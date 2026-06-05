import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Linking,
  Modal,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { scheduleAPI } from '../api/client';

// "My Schedule" — read-only monthly calendar of the provider's own SNAP
// Shifts assignments. Doubles as the entry point for the Apple/Google
// Calendar subscription URL so coordinator-side schedule edits propagate
// to the provider's local calendar without app pushes.

const COLORS = {
  primary: '#6366F1',
  background: '#FAFAFA',
  textDark: '#0F172A',
  textMuted: '#64748B',
  card: '#FFFFFF',
  border: '#E2E8F0',
  accent: '#10B981',
  warn: '#F59E0B',
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function getDaysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
function getFirstDayOfMonth(y, m) { return new Date(y, m, 1).getDay(); }
function toDateKey(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function dateKeyFromIso(iso) { return iso.slice(0, 10); }

export default function MyScheduleScreen() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [assignments, setAssignments] = useState([]); // [{date, location, roomNumber, role, facility}]
  const [memberships, setMemberships] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedDay, setSelectedDay] = useState(null); // 'YYYY-MM-DD'
  // iCal subscribe sheet
  const [showSubscribe, setShowSubscribe] = useState(false);
  const [subs, setSubs] = useState([]);
  const [subLoading, setSubLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await scheduleAPI.getMyMonth(year, month + 1);
      setAssignments(res.data?.assignments || []);
      setMemberships(res.data?.memberships || []);
    } catch (e) {
      // Silent — empty state will render. Errors here usually mean the
      // provider has no roster memberships yet, which is a valid state.
      setAssignments([]);
      setMemberships([]);
    }
  }, [year, month]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load().finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  // Group assignments by YYYY-MM-DD for fast lookup.
  const byDate = useMemo(() => {
    const m = {};
    for (const a of assignments) {
      const key = dateKeyFromIso(a.date);
      (m[key] = m[key] || []).push(a);
    }
    return m;
  }, [assignments]);

  function prevMonth() {
    if (month === 0) { setYear(year - 1); setMonth(11); } else setMonth(month - 1);
    setSelectedDay(null);
  }
  function nextMonth() {
    if (month === 11) { setYear(year + 1); setMonth(0); } else setMonth(month + 1);
    setSelectedDay(null);
  }

  async function openSubscribe() {
    setShowSubscribe(true);
    if (subs.length > 0) return;
    setSubLoading(true);
    try {
      const res = await scheduleAPI.getIcalSubscriptions();
      setSubs(res.data?.subscriptions || []);
    } catch (e) {
      Alert.alert('Could not load subscription URL', e.message || 'Try again in a moment.');
    } finally {
      setSubLoading(false);
    }
  }

  async function rotate() {
    Alert.alert(
      'Rotate subscription URL?',
      'The current URL stops working. Existing calendar subscriptions need to be re-added.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Rotate',
          style: 'destructive',
          onPress: async () => {
            setSubLoading(true);
            try {
              const res = await scheduleAPI.rotateIcalSubscriptions();
              setSubs(res.data?.subscriptions || []);
            } catch (e) {
              Alert.alert('Rotate failed', e.message || 'Unknown error');
            } finally {
              setSubLoading(false);
            }
          },
        },
      ]
    );
  }

  async function openInCalendar(url) {
    // Apple Calendar's add-subscription scheme. iOS Calendar.app handles
    // webcal:// natively; the OS shows a "Subscribe" sheet on open.
    const webcalUrl = url.replace(/^https?:\/\//i, 'webcal://');
    try {
      const supported = await Linking.canOpenURL(webcalUrl);
      if (supported) await Linking.openURL(webcalUrl);
      else await Linking.openURL(url);
    } catch (e) {
      Alert.alert('Could not open Calendar', 'Tap "Copy URL" instead and paste into your calendar app.');
    }
  }

  async function copyUrl(url) {
    // Use the system share sheet — iOS includes Copy by default and lets
    // the user send the URL to any calendar app or messages. Works without
    // adding expo-clipboard as a dep.
    try {
      await Share.share({ message: url, url });
    } catch (e) {
      Alert.alert('Share failed', url);
    }
  }

  const days = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const today = new Date();
  const isTodayCell = (d) =>
    d != null &&
    today.getFullYear() === year &&
    today.getMonth() === month &&
    today.getDate() === d;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 48 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
      >
        <View style={styles.header}>
          <Text style={styles.title}>My Schedule</Text>
          <TouchableOpacity onPress={openSubscribe} style={styles.subscribeBtn} activeOpacity={0.8}>
            <Text style={styles.subscribeBtnText}>📅 Subscribe</Text>
          </TouchableOpacity>
        </View>

        {memberships.length > 0 && (
          <Text style={styles.sub}>
            {memberships.length === 1
              ? `${memberships[0].facility?.name || 'Facility'}`
              : `${memberships.length} facility memberships`}
          </Text>
        )}

        <View style={styles.monthNav}>
          <TouchableOpacity onPress={prevMonth} style={styles.navBtn}><Text style={styles.navBtnText}>‹</Text></TouchableOpacity>
          <Text style={styles.monthLabel}>{MONTHS[month]} {year}</Text>
          <TouchableOpacity onPress={nextMonth} style={styles.navBtn}><Text style={styles.navBtnText}>›</Text></TouchableOpacity>
        </View>

        {loading ? (
          <ActivityIndicator color={COLORS.primary} style={{ marginTop: 40 }} />
        ) : (
          <>
            <View style={styles.weekdayRow}>
              {WEEKDAYS.map((w) => (
                <Text key={w} style={styles.weekday}>{w}</Text>
              ))}
            </View>
            <View style={styles.grid}>
              {cells.map((d, i) => {
                if (d == null) return <View key={`pad-${i}`} style={styles.cell} />;
                const key = toDateKey(year, month, d);
                const list = byDate[key] || [];
                const has = list.length > 0;
                const isSel = selectedDay === key;
                return (
                  <TouchableOpacity
                    key={key}
                    style={[
                      styles.cell,
                      has && styles.cellHasShift,
                      isTodayCell(d) && styles.cellToday,
                      isSel && styles.cellSelected,
                    ]}
                    disabled={!has}
                    onPress={() => setSelectedDay(isSel ? null : key)}
                    activeOpacity={0.7}
                  >
                    <Text style={[
                      styles.cellNum,
                      has && styles.cellNumActive,
                      isTodayCell(d) && styles.cellNumToday,
                    ]}>{d}</Text>
                    {has && <View style={styles.dot} />}
                  </TouchableOpacity>
                );
              })}
            </View>

            {selectedDay && (byDate[selectedDay] || []).length > 0 && (
              <View style={styles.detailCard}>
                <Text style={styles.detailDate}>
                  {new Date(selectedDay).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                </Text>
                {(byDate[selectedDay] || []).map((a, idx) => (
                  <View key={idx} style={styles.assignmentRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.assignmentTitle}>{a.location}</Text>
                      <Text style={styles.assignmentSub}>
                        {a.roomNumber >= 900 ? 'Supervisor' : `Room ${a.roomNumber}`}
                        {a.role ? ` · ${prettyRole(a.role)}` : ''}
                        {memberships.length > 1 && a.facility?.name ? ` · ${a.facility.name}` : ''}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {assignments.length === 0 && !loading && (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>No shifts this month</Text>
                <Text style={styles.emptySub}>Once you're on a facility's SNAP roster and they publish a schedule, your shifts appear here.</Text>
              </View>
            )}
          </>
        )}
      </ScrollView>

      <Modal visible={showSubscribe} animationType="slide" transparent onRequestClose={() => setShowSubscribe(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Subscribe in Calendar</Text>
              <TouchableOpacity onPress={() => setShowSubscribe(false)}><Text style={styles.modalClose}>✕</Text></TouchableOpacity>
            </View>
            <Text style={styles.modalBody}>
              Add this URL once and Apple Calendar (or any other calendar app) will keep
              your shifts in sync — including any schedule changes your coordinator makes.
            </Text>
            {subLoading ? (
              <ActivityIndicator color={COLORS.primary} style={{ marginVertical: 20 }} />
            ) : subs.length === 0 ? (
              <Text style={styles.muted}>You're not on any facility roster yet, so there's nothing to subscribe to.</Text>
            ) : (
              subs.map((s) => (
                <View key={s.rosterEntryId} style={styles.subRow}>
                  <Text style={styles.subFacility}>{s.facility?.name || 'Facility'}</Text>
                  <Text style={styles.subUrl} numberOfLines={2}>{s.url}</Text>
                  <View style={styles.subBtnRow}>
                    <TouchableOpacity onPress={() => openInCalendar(s.url)} style={styles.subBtnPrimary} activeOpacity={0.85}>
                      <Text style={styles.subBtnPrimaryText}>Open in Calendar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => copyUrl(s.url)} style={styles.subBtnGhost} activeOpacity={0.85}>
                      <Text style={styles.subBtnGhostText}>Share URL</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
            {subs.length > 0 && (
              <TouchableOpacity onPress={rotate} style={styles.rotateBtn} activeOpacity={0.7}>
                <Text style={styles.rotateText}>↻ Rotate URL (invalidate current subscription)</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function prettyRole(r) {
  if (r === 'CRNA_ROOM') return 'CRNA room';
  if (r === 'SOLO_MD_ROOM') return 'MD solo';
  if (r === 'SUPERVISING_MD') return 'Supervisor';
  return r;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 4 },
  title: { fontSize: 26, fontWeight: '800', color: COLORS.textDark, letterSpacing: -0.5 },
  sub: { paddingHorizontal: 20, fontSize: 13, color: COLORS.textMuted, marginBottom: 12 },
  subscribeBtn: { backgroundColor: COLORS.primary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  subscribeBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, marginTop: 8, marginBottom: 12 },
  navBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border },
  navBtnText: { fontSize: 18, color: COLORS.textDark },
  monthLabel: { fontSize: 17, fontWeight: '700', color: COLORS.textDark, minWidth: 160, textAlign: 'center' },
  weekdayRow: { flexDirection: 'row', paddingHorizontal: 12 },
  weekday: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '600', color: COLORS.textMuted, paddingVertical: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12 },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', padding: 2 },
  cellNum: { fontSize: 14, color: COLORS.textDark, fontWeight: '500' },
  cellHasShift: { /* container only — dot indicates */ },
  cellNumActive: { fontWeight: '800', color: COLORS.primary },
  cellToday: { borderWidth: 2, borderColor: COLORS.primary, borderRadius: 12 },
  cellNumToday: { color: COLORS.primary },
  cellSelected: { backgroundColor: '#EEF2FF', borderRadius: 12 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.primary, marginTop: 2 },
  detailCard: { backgroundColor: COLORS.card, marginHorizontal: 16, marginTop: 18, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: COLORS.border },
  detailDate: { fontSize: 15, fontWeight: '700', color: COLORS.textDark, marginBottom: 10 },
  assignmentRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  assignmentTitle: { fontSize: 14, fontWeight: '700', color: COLORS.textDark },
  assignmentSub: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  empty: { padding: 40, alignItems: 'center' },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: COLORS.textDark, marginBottom: 6 },
  emptySub: { fontSize: 13, color: COLORS.textMuted, textAlign: 'center', lineHeight: 18 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 22, paddingBottom: 36, maxHeight: '85%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: COLORS.textDark },
  modalClose: { fontSize: 22, color: COLORS.textMuted, padding: 4 },
  modalBody: { fontSize: 13, color: COLORS.textMuted, lineHeight: 19, marginBottom: 16 },
  muted: { fontSize: 13, color: COLORS.textMuted },
  subRow: { borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 14, marginTop: 10 },
  subFacility: { fontSize: 14, fontWeight: '700', color: COLORS.textDark },
  subUrl: { fontSize: 11, color: COLORS.textMuted, marginTop: 4, marginBottom: 10 },
  subBtnRow: { flexDirection: 'row', gap: 8 },
  subBtnPrimary: { flex: 1, backgroundColor: COLORS.primary, paddingVertical: 11, borderRadius: 9, alignItems: 'center' },
  subBtnPrimaryText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  subBtnGhost: { paddingVertical: 11, paddingHorizontal: 16, borderRadius: 9, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center' },
  subBtnGhostText: { color: COLORS.textDark, fontSize: 13, fontWeight: '600' },
  rotateBtn: { marginTop: 16, paddingVertical: 10, alignItems: 'center' },
  rotateText: { color: COLORS.textMuted, fontSize: 12, fontWeight: '600' },
});
