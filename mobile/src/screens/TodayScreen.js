import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Modal,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { scheduleAPI } from '../api/client';

// "Today" — read-only window into the facility's full daily schedule for
// any provider on that facility's roster. CAPA's coordinator builds the
// month; every staff member can see "where is everyone today" without
// asking. Date arrows let them peek ahead/behind. Facility picker only
// renders if the provider is on multiple rosters (locums case).

const COLORS = {
  primary: '#2563EB',
  background: '#FAFAFA',
  textDark: '#0F172A',
  textMuted: '#64748B',
  card: '#FFFFFF',
  border: '#E2E8F0',
  empty: '#94A3B8',
};

function ymd(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
function addDays(dateStr, n) {
  const dt = new Date(dateStr + 'T00:00:00');
  dt.setDate(dt.getDate() + n);
  return ymd(dt);
}
function prettyDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });
}
// Build a 6x7 day grid for a given year/month (0-based month). Leading/trailing
// cells are null. Used by the dep-free date-picker modal.
function monthGrid(year, month) {
  const first = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < first; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}
function monthLabel(year, month) {
  return new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function prettyRole(r) {
  if (r === 'CRNA_ROOM') return 'CRNA';
  if (r === 'SOLO_MD_ROOM') return 'MD';
  if (r === 'SUPERVISING_MD') return 'Supervisor';
  return r || '';
}
function typeBadge(t) {
  if (t === 'CRNA') return { label: 'CRNA', bg: '#DBEAFE', color: '#1D4ED8' };
  if (t === 'ANESTHESIOLOGIST') return { label: 'MD', bg: '#FCE7F3', color: '#9D174D' };
  if (t === 'ANESTHESIA_ASSISTANT') return { label: 'AA', bg: '#DBEAFE', color: '#3730A3' };
  return { label: 'Staff', bg: '#F1F5F9', color: '#475569' };
}

export default function TodayScreen() {
  const [date, setDate] = useState(ymd(new Date()));
  const [memberships, setMemberships] = useState([]);
  const [facilityId, setFacilityId] = useState(null);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerMonth, setPickerMonth] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [requested, setRequested] = useState({}); // facilityId → true after request
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  // Bootstrap: hit the my-month endpoint cheaply to discover which
  // facilities the provider is on. (We could add a dedicated
  // /memberships endpoint later; for now, my-month doubles as the
  // membership list.)
  useEffect(() => {
    let cancelled = false;
    const now = new Date();
    scheduleAPI.getMyMonth(now.getFullYear(), now.getMonth() + 1)
      .then((res) => {
        if (cancelled) return;
        // Keep all credentialed facilities; revoked ones show a "Request access"
        // chip instead of loading the board. Default to the first OPEN facility.
        const m = res.data?.memberships || [];
        setMemberships(m);
        const firstOpen = m.find((x) => x.scheduleAccessRevoked !== true);
        if (firstOpen && !facilityId) setFacilityId(firstOpen.facilityId);
        if (m.length === 0 || !firstOpen) setLoading(false);
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadDay = useCallback(async () => {
    if (!facilityId) return;
    setError(null);
    try {
      const res = await scheduleAPI.getDailyAtFacility(facilityId, date);
      setSites(res.data?.sites || []);
    } catch (e) {
      setSites([]);
      setError(e.response?.data?.error || e.message || 'Unable to load schedule.');
    }
  }, [facilityId, date]);

  useEffect(() => {
    let cancelled = false;
    if (!facilityId) return;
    setLoading(true);
    loadDay().finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [loadDay, facilityId]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadDay();
    setRefreshing(false);
  };

  const isToday = date === ymd(new Date());
  const activeFacility = memberships.find((m) => m.facilityId === facilityId);
  const myRosterId = activeFacility?.id || null; // to highlight my own row on the board

  async function handleRequestAccess(fid, name) {
    try {
      await scheduleAPI.requestAccess(fid);
      setRequested((r) => ({ ...r, [fid]: true }));
      Alert.alert('Request sent', `Asked ${name || 'the facility'} for schedule access. They'll grant it on their end.`);
    } catch (e) {
      Alert.alert('Could not send request', e.response?.data?.error || e.message || 'Try again later.');
    }
  }

  function pickDate(day) {
    if (!day) return;
    setDate(ymd(new Date(pickerMonth.y, pickerMonth.m, day)));
    setShowPicker(false);
  }
  const totalAssignments = sites.reduce((s, site) => s + site.assignments.filter((a) => a.provider).length, 0);
  const totalRooms = sites.reduce((s, site) => s + (site.roomsRequired || 0), 0);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 48 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Facility Daily Schedule</Text>
          {totalRooms > 0 && (
            <Text style={styles.fill}>{totalAssignments}/{totalRooms} rooms staffed</Text>
          )}
        </View>

        {memberships.length > 0 && (
          <View style={styles.facilityPicker}>
            {memberships.map((m) => {
              const name = m.facility?.name || 'Facility';
              if (m.scheduleAccessRevoked) {
                const asked = requested[m.facilityId];
                return (
                  <TouchableOpacity
                    key={m.facilityId}
                    onPress={() => !asked && handleRequestAccess(m.facilityId, name)}
                    style={[styles.facilityChip, styles.facilityChipLocked]}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.facilityChipLockedText} numberOfLines={1}>
                      {asked ? `${name} · requested` : `🔒 ${name} · request access`}
                    </Text>
                  </TouchableOpacity>
                );
              }
              const active = m.facilityId === facilityId;
              return (
                <TouchableOpacity
                  key={m.facilityId}
                  onPress={() => setFacilityId(m.facilityId)}
                  style={[styles.facilityChip, active && styles.facilityChipActive]}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.facilityChipText, active && styles.facilityChipTextActive]} numberOfLines={1}>
                    {name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        <View style={styles.dateNav}>
          <TouchableOpacity onPress={() => setDate(addDays(date, -1))} style={styles.dateBtn}><Text style={styles.dateBtnText}>‹</Text></TouchableOpacity>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <TouchableOpacity
              onPress={() => { const d = new Date(date + 'T00:00:00'); setPickerMonth({ y: d.getFullYear(), m: d.getMonth() }); setShowPicker(true); }}
              activeOpacity={0.7}
            >
              <Text style={styles.dateLabel}>{prettyDate(date)} ▾</Text>
            </TouchableOpacity>
            {!isToday && (
              <TouchableOpacity onPress={() => setDate(ymd(new Date()))}>
                <Text style={styles.jumpToday}>Jump to today</Text>
              </TouchableOpacity>
            )}
          </View>
          <TouchableOpacity onPress={() => setDate(addDays(date, 1))} style={styles.dateBtn}><Text style={styles.dateBtnText}>›</Text></TouchableOpacity>
        </View>

        {loading ? (
          <ActivityIndicator color={COLORS.primary} style={{ marginTop: 40 }} />
        ) : error ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Can't load this day</Text>
            <Text style={styles.emptySub}>{error}</Text>
          </View>
        ) : memberships.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Not on a SNAP roster yet</Text>
            <Text style={styles.emptySub}>Once your coordinator adds you to the SNAP Shifts roster, the daily schedule shows up here.</Text>
          </View>
        ) : sites.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Nothing scheduled</Text>
            <Text style={styles.emptySub}>No rooms staffed at {activeFacility?.facility?.name || 'this facility'} on this date.</Text>
          </View>
        ) : (
          sites.map((site) => (
            <View key={site.location} style={styles.siteCard}>
              <View style={styles.siteHeader}>
                <Text style={styles.siteName}>{site.location}</Text>
                <Text style={styles.siteCount}>
                  {site.assignments.filter((a) => a.provider).length}/{site.roomsRequired} staffed
                </Text>
              </View>
              {site.assignments.length === 0 ? (
                <Text style={styles.siteEmpty}>No assignments yet</Text>
              ) : (
                site.assignments.map((a) => {
                  const badge = typeBadge(a.provider?.type);
                  const isMe = a.provider?.id && a.provider.id === myRosterId;
                  return (
                    <View key={`${site.location}-${a.roomNumber}`} style={[styles.assignmentRow, isMe && styles.assignmentRowMe]}>
                      <Text style={styles.roomLabel}>
                        {a.roomNumber >= 900 ? '' : `Room ${a.roomNumber}`}
                      </Text>
                      {a.provider ? (
                        <View style={styles.providerRow}>
                          <View style={[styles.typePill, { backgroundColor: badge.bg }]}>
                            <Text style={[styles.typePillText, { color: badge.color }]}>{badge.label}</Text>
                          </View>
                          <Text style={styles.providerName} numberOfLines={1}>{a.provider.name}</Text>
                          {isMe && <Text style={styles.youTag}>You</Text>}
                        </View>
                      ) : (
                        <Text style={styles.unstaffed}>Open</Text>
                      )}
                    </View>
                  );
                })
              )}
            </View>
          ))
        )}
      </ScrollView>

      <Modal visible={showPicker} transparent animationType="fade" onRequestClose={() => setShowPicker(false)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setShowPicker(false)}>
          <View style={styles.pickerCard} onStartShouldSetResponder={() => true}>
            <View style={styles.pickerHeader}>
              <TouchableOpacity onPress={() => setPickerMonth((p) => { const d = new Date(p.y, p.m - 1, 1); return { y: d.getFullYear(), m: d.getMonth() }; })} style={styles.pickerNavBtn}><Text style={styles.pickerNavText}>‹</Text></TouchableOpacity>
              <Text style={styles.pickerMonthLabel}>{monthLabel(pickerMonth.y, pickerMonth.m)}</Text>
              <TouchableOpacity onPress={() => setPickerMonth((p) => { const d = new Date(p.y, p.m + 1, 1); return { y: d.getFullYear(), m: d.getMonth() }; })} style={styles.pickerNavBtn}><Text style={styles.pickerNavText}>›</Text></TouchableOpacity>
            </View>
            <View style={styles.pickerDow}>
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <Text key={i} style={styles.pickerDowText}>{d}</Text>)}
            </View>
            <View style={styles.pickerGrid}>
              {monthGrid(pickerMonth.y, pickerMonth.m).map((day, i) => {
                const cellYmd = day ? ymd(new Date(pickerMonth.y, pickerMonth.m, day)) : null;
                const selected = cellYmd === date;
                return (
                  <TouchableOpacity key={i} disabled={!day} onPress={() => pickDate(day)} style={styles.pickerCell}>
                    <View style={[styles.pickerCellInner, selected && styles.pickerCellSelected]}>
                      <Text style={[styles.pickerCellText, selected && styles.pickerCellTextSelected]}>{day || ''}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 4 },
  title: { fontSize: 26, fontWeight: '800', color: COLORS.textDark, letterSpacing: -0.5 },
  fill: { fontSize: 13, color: COLORS.textMuted, fontWeight: '600' },
  subFacility: { paddingHorizontal: 20, fontSize: 13, color: COLORS.textMuted, marginBottom: 4 },
  facilityPicker: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginVertical: 8, flexWrap: 'wrap' },
  facilityChip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: COLORS.border, backgroundColor: '#fff' },
  facilityChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  facilityChipText: { fontSize: 12, color: COLORS.textDark, fontWeight: '600' },
  facilityChipTextActive: { color: '#fff' },
  facilityChipLocked: { backgroundColor: '#F8FAFC', borderStyle: 'dashed', borderColor: '#CBD5E1' },
  facilityChipLockedText: { fontSize: 12, color: '#64748B', fontWeight: '600' },
  dateNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginTop: 8, marginBottom: 14 },
  dateBtn: { padding: 10, borderRadius: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border, minWidth: 44, alignItems: 'center' },
  dateBtnText: { fontSize: 18, color: COLORS.textDark },
  dateLabel: { fontSize: 15, fontWeight: '700', color: COLORS.textDark, textAlign: 'center' },
  jumpToday: { fontSize: 11, color: COLORS.primary, marginTop: 2, fontWeight: '600' },
  siteCard: { backgroundColor: COLORS.card, marginHorizontal: 16, marginBottom: 12, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: COLORS.border },
  siteHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  siteName: { fontSize: 15, fontWeight: '800', color: COLORS.textDark, flex: 1 },
  siteCount: { fontSize: 11, color: COLORS.textMuted, fontWeight: '600' },
  siteEmpty: { fontSize: 12, color: COLORS.empty, fontStyle: 'italic' },
  assignmentRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, gap: 10 },
  roomLabel: { fontSize: 12, color: COLORS.textMuted, fontWeight: '700', width: 88 },
  providerRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  typePill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  typePillText: { fontSize: 10, fontWeight: '800' },
  providerName: { fontSize: 13, color: COLORS.textDark, fontWeight: '600', flexShrink: 1 },
  roleHint: { fontSize: 11, color: COLORS.textMuted },
  unstaffed: { fontSize: 12, color: COLORS.empty, fontStyle: 'italic' },
  empty: { padding: 40, alignItems: 'center' },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: COLORS.textDark, marginBottom: 6 },
  emptySub: { fontSize: 13, color: COLORS.textMuted, textAlign: 'center', lineHeight: 18 },
});
