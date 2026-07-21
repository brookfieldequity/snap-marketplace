import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { hoursAPI } from '../api/client';

// "My Hours" — provider one-tap hours entry (Phase 3). Each worked day shows
// as a card pre-filled with the site's default shift window; one tap on
// Confirm submits it straight into the facility's payroll pipeline
// (SUBMITTED ProviderHourEntry rows are what the Payroll Builder consumes).
// "Adjust" expands inline ±15-minute steppers — no native picker deps.

const COLORS = {
  primary: '#2563EB',
  background: '#FAFAFA',
  textDark: '#0F172A',
  textMuted: '#64748B',
  card: '#FFFFFF',
  border: '#E2E8F0',
  accent: '#10B981',
};

function fmtTime(hhmm) {
  if (!hhmm) return '—';
  const [h, m] = hhmm.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function fmtDay(dateStr) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

function stepTime(hhmm, deltaMin) {
  const [h, m] = (hhmm || '07:00').split(':').map(Number);
  let mins = ((h * 60 + m + deltaMin) % (24 * 60) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

function hoursBetween(start, end) {
  const [sh, sm] = (start || '0:0').split(':').map(Number);
  const [eh, em] = (end || '0:0').split(':').map(Number);
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60; // overnight
  return Math.round((mins / 60) * 100) / 100;
}

const dayKey = (d) => `${d.rosterEntryId}::${d.date}::${d.location || ''}`;

// One ±15-minute stepper row ("Start  −  7:00 AM  +").
function TimeStepperRow({ label, value, onChange }) {
  return (
    <View style={styles.stepperRow}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <TouchableOpacity style={styles.stepBtn} onPress={() => onChange(stepTime(value, -15))} activeOpacity={0.7}>
        <Text style={styles.stepBtnText}>−</Text>
      </TouchableOpacity>
      <Text style={styles.stepperValue}>{fmtTime(value)}</Text>
      <TouchableOpacity style={styles.stepBtn} onPress={() => onChange(stepTime(value, 15))} activeOpacity={0.7}>
        <Text style={styles.stepBtnText}>＋</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function HoursScreen({ navigation }) {
  const [days, setDays] = useState([]);
  const [facilities, setFacilities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [confirming, setConfirming] = useState(''); // dayKey | 'ALL'
  const [adjusting, setAdjusting] = useState(null); // dayKey being edited
  const [times, setTimes] = useState({}); // dayKey → { startTime, endTime }

  const load = useCallback(async () => {
    try {
      const res = await hoursAPI.get();
      setDays(res.data?.days || []);
      setFacilities(res.data?.facilities || []);
    } catch {
      // Silent — the empty/not-enabled state renders.
      setDays([]);
      setFacilities([]);
    }
  }, []);

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

  // Unconfirmed first (most recent on top — yesterday before last week), then
  // submitted (also newest first). Server already sorts newest-first.
  const unconfirmed = useMemo(() => days.filter((d) => d.status === 'unconfirmed'), [days]);
  const submitted = useMemo(() => days.filter((d) => d.status === 'submitted'), [days]);
  const multiFacility = facilities.length > 1;

  const timesFor = (d) => {
    const t = times[dayKey(d)];
    return {
      startTime: t?.startTime || d.startTime || d.defaultStartTime,
      endTime: t?.endTime || d.endTime || d.defaultEndTime,
    };
  };

  async function confirmDays(list, busyKey) {
    setConfirming(busyKey);
    try {
      const entries = list.map((d) => {
        const t = timesFor(d);
        return {
          date: d.date,
          rosterEntryId: d.rosterEntryId,
          location: d.location,
          startTime: t.startTime,
          endTime: t.endTime,
        };
      });
      const res = await hoursAPI.confirm(entries);
      const rejected = res.data?.rejected || [];
      if (rejected.length > 0) {
        Alert.alert(
          'Some days could not be updated',
          rejected.map((r) => `${fmtDay(r.date)} — ${r.reason}`).join('\n')
        );
      }
      setAdjusting(null);
      await load();
    } catch (e) {
      Alert.alert('Could not submit hours', e?.response?.data?.error || e.message || 'Try again.');
    } finally {
      setConfirming('');
    }
  }

  function renderCard(d, isSubmitted) {
    const key = dayKey(d);
    const t = timesFor(d);
    const isAdjusting = adjusting === key;
    const busy = confirming === key || confirming === 'ALL';
    return (
      <View key={key} style={[styles.dayCard, isSubmitted && styles.dayCardDone]}>
        <View style={styles.dayCardTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.dayTitle}>
              {fmtDay(d.date)}
              {d.location ? ` · ${d.location}` : ''}
            </Text>
            {multiFacility && d.facilityName ? (
              <Text style={styles.daySub}>{d.facilityName}</Text>
            ) : null}
          </View>
          {isSubmitted && <Text style={styles.doneCheck}>✓</Text>}
        </View>

        {!isAdjusting ? (
          <Text style={[styles.timeRange, isSubmitted && styles.timeRangeDone]}>
            {fmtTime(t.startTime)} – {fmtTime(t.endTime)}
            <Text style={styles.timeHours}>  · {hoursBetween(t.startTime, t.endTime)} hrs</Text>
          </Text>
        ) : (
          <View style={styles.adjustBox}>
            <TimeStepperRow
              label="Start"
              value={t.startTime}
              onChange={(v) => setTimes((prev) => ({ ...prev, [key]: { ...timesFor(d), startTime: v } }))}
            />
            <TimeStepperRow
              label="End"
              value={t.endTime}
              onChange={(v) => setTimes((prev) => ({ ...prev, [key]: { ...timesFor(d), endTime: v } }))}
            />
          </View>
        )}

        <View style={styles.cardBtnRow}>
          {isAdjusting ? (
            <TouchableOpacity
              style={styles.confirmBtn}
              onPress={() => confirmDays([d], key)}
              disabled={!!confirming}
              activeOpacity={0.85}
            >
              <Text style={styles.confirmBtnText}>{busy ? 'Saving…' : 'Save'}</Text>
            </TouchableOpacity>
          ) : !isSubmitted ? (
            <TouchableOpacity
              style={styles.confirmBtn}
              onPress={() => confirmDays([d], key)}
              disabled={!!confirming}
              activeOpacity={0.85}
            >
              <Text style={styles.confirmBtnText}>{busy ? 'Confirming…' : 'Confirm'}</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            onPress={() => setAdjusting(isAdjusting ? null : key)}
            disabled={!!confirming}
            activeOpacity={0.7}
            style={styles.adjustLink}
          >
            <Text style={styles.adjustLinkText}>{isAdjusting ? 'Cancel' : 'Adjust'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 48 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
      >
        <View style={styles.header}>
          <Text style={styles.title}>My Hours</Text>
          <TouchableOpacity
            onPress={() => navigation && navigation.navigate('Earnings')}
            style={styles.earningsBtn}
            activeOpacity={0.8}
          >
            <Text style={styles.earningsBtnText}>💰 Earnings</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <ActivityIndicator color={COLORS.primary} style={{ marginTop: 40 }} />
        ) : facilities.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Hours entry isn't enabled for your practice yet</Text>
            <Text style={styles.emptySub}>
              Once your practice turns on SNAP hours entry, the days you work will
              show up here to confirm with one tap.
            </Text>
          </View>
        ) : (
          <>
            {unconfirmed.length > 1 && (
              <TouchableOpacity
                style={styles.confirmAllBtn}
                onPress={() => confirmDays(unconfirmed, 'ALL')}
                disabled={!!confirming}
                activeOpacity={0.85}
              >
                <Text style={styles.confirmAllText}>
                  {confirming === 'ALL' ? 'Confirming…' : `Confirm all ${unconfirmed.length} days`}
                </Text>
              </TouchableOpacity>
            )}

            {unconfirmed.map((d) => renderCard(d, false))}

            {unconfirmed.length === 0 && (
              <View style={styles.caughtUp}>
                <Text style={styles.caughtUpText}>No hours to confirm — you're all caught up ✓</Text>
              </View>
            )}

            {submitted.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>Submitted</Text>
                {submitted.map((d) => renderCard(d, true))}
              </>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 },
  title: { fontSize: 26, fontWeight: '800', color: COLORS.textDark, letterSpacing: -0.5 },
  earningsBtn: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: COLORS.primary, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10 },
  earningsBtnText: { color: COLORS.primary, fontSize: 13, fontWeight: '700' },
  confirmAllBtn: { backgroundColor: COLORS.primary, marginHorizontal: 16, marginBottom: 12, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  confirmAllText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  dayCard: { backgroundColor: COLORS.card, marginHorizontal: 16, marginBottom: 12, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: COLORS.border },
  dayCardDone: { borderColor: '#A7F3D0', backgroundColor: '#F8FFFB' },
  dayCardTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  dayTitle: { fontSize: 15, fontWeight: '700', color: COLORS.textDark },
  daySub: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  doneCheck: { fontSize: 18, color: COLORS.accent, fontWeight: '800' },
  timeRange: { fontSize: 22, fontWeight: '800', color: COLORS.textDark, marginVertical: 6, letterSpacing: -0.3 },
  timeRangeDone: { fontSize: 16, color: COLORS.textMuted, fontWeight: '700' },
  timeHours: { fontSize: 13, fontWeight: '600', color: COLORS.textMuted },
  cardBtnRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 8 },
  confirmBtn: { flex: 1, backgroundColor: COLORS.primary, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  confirmBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  adjustLink: { paddingVertical: 12, paddingHorizontal: 6 },
  adjustLinkText: { color: COLORS.textMuted, fontSize: 13, fontWeight: '600' },
  adjustBox: { marginVertical: 8, gap: 8 },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepperLabel: { width: 44, fontSize: 13, fontWeight: '600', color: COLORS.textMuted },
  stepBtn: { width: 38, height: 38, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  stepBtnText: { fontSize: 18, color: COLORS.textDark, fontWeight: '700' },
  stepperValue: { minWidth: 90, textAlign: 'center', fontSize: 16, fontWeight: '800', color: COLORS.textDark },
  sectionLabel: { paddingHorizontal: 20, marginTop: 8, marginBottom: 8, fontSize: 12, fontWeight: '700', color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 },
  caughtUp: { marginHorizontal: 16, marginBottom: 12, backgroundColor: '#ECFDF5', borderWidth: 1, borderColor: '#A7F3D0', borderRadius: 12, padding: 16, alignItems: 'center' },
  caughtUpText: { color: '#065F46', fontSize: 14, fontWeight: '700' },
  empty: { padding: 40, alignItems: 'center' },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: COLORS.textDark, marginBottom: 6, textAlign: 'center' },
  emptySub: { fontSize: 13, color: COLORS.textMuted, textAlign: 'center', lineHeight: 18 },
});
