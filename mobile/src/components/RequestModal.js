import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, TextInput, ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { scheduleRequestAPI } from '../api/client';

// Task #21: provider creates a schedule request — a day off, or to work a
// specific date/site — for one of the facilities they're on. The coordinator
// approves/declines; accepted requests shape the next schedule build.

// ── Calendar helpers (no native dependency — matches AvailabilityScreen) ───────
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
function firstWeekday(y, m) { return new Date(y, m, 1).getDay(); }
function toDateKey(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function prettyDate(key) {
  if (!key) return '';
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

export default function RequestModal({ visible, onClose, memberships = [], onSubmitted }) {
  const facilities = memberships
    .map((m) => ({ id: m.facility?.id || m.facilityId, name: m.facility?.name || 'Facility' }))
    .filter((f) => f.id);

  const today = new Date();
  const [facilityId, setFacilityId] = useState(facilities[0]?.id || null);
  const [type, setType] = useState('DAY_OFF');
  const [date, setDate] = useState(''); // selected date as 'YYYY-MM-DD'
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [siteName, setSiteName] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  function reset() {
    setType('DAY_OFF'); setDate(''); setSiteName(''); setNote('');
    setViewYear(today.getFullYear()); setViewMonth(today.getMonth());
    setFacilityId(facilities[0]?.id || null);
  }

  // Don't let providers request dates in the past, or navigate before this month.
  const todayKey = toDateKey(today.getFullYear(), today.getMonth(), today.getDate());
  const atCurrentMonth = viewYear === today.getFullYear() && viewMonth === today.getMonth();
  function prevMonth() {
    if (atCurrentMonth) return;
    if (viewMonth === 0) { setViewYear((y) => y - 1); setViewMonth(11); }
    else setViewMonth((m) => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear((y) => y + 1); setViewMonth(0); }
    else setViewMonth((m) => m + 1);
  }

  async function submit() {
    if (!facilityId) return Alert.alert('Pick a facility', 'Choose which facility this request is for.');
    if (!date) return Alert.alert('Pick a date', 'Tap the date you want to request.');
    setSaving(true);
    try {
      await scheduleRequestAPI.create({
        facilityId,
        type,
        date,
        siteName: type === 'WORK' && siteName.trim() ? siteName.trim() : undefined,
        note: note.trim() || undefined,
      });
      Alert.alert('Request sent', 'Your coordinator will review it.');
      reset();
      onSubmitted && onSubmitted();
      onClose();
    } catch (e) {
      Alert.alert('Could not send', e?.response?.data?.error || e.message || 'Try again.');
    } finally {
      setSaving(false);
    }
  }

  // Build the day grid (leading blanks + day cells).
  const cells = [];
  const lead = firstWeekday(viewYear, viewMonth);
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth(viewYear, viewMonth); d++) cells.push(d);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>New Request</Text>
            <TouchableOpacity onPress={onClose}><Text style={styles.close}>✕</Text></TouchableOpacity>
          </View>

          <ScrollView style={{ maxHeight: 500 }}>
            {/* Type toggle */}
            <Text style={styles.label}>What are you requesting?</Text>
            <View style={styles.toggleRow}>
              {[
                { v: 'DAY_OFF', label: 'Day off' },
                { v: 'WORK', label: 'To work' },
              ].map(({ v, label }) => {
                const active = type === v;
                return (
                  <TouchableOpacity
                    key={v}
                    style={[styles.toggle, active && styles.toggleActive]}
                    onPress={() => setType(v)}
                  >
                    <Text style={[styles.toggleText, active && styles.toggleTextActive]}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Facility picker (only if more than one) */}
            {facilities.length > 1 && (
              <>
                <Text style={styles.label}>Facility</Text>
                <View style={styles.chipWrap}>
                  {facilities.map((f) => {
                    const active = facilityId === f.id;
                    return (
                      <TouchableOpacity
                        key={f.id}
                        style={[styles.chip, active && styles.chipActive]}
                        onPress={() => setFacilityId(f.id)}
                      >
                        <Text style={[styles.chipText, active && styles.chipTextActive]}>{f.name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            )}

            {/* Date — tap-to-pick calendar */}
            <Text style={styles.label}>Date</Text>
            <View style={styles.calendar}>
              <View style={styles.calHeader}>
                <TouchableOpacity onPress={prevMonth} disabled={atCurrentMonth} style={styles.calNav}>
                  <Text style={[styles.calNavText, atCurrentMonth && styles.calNavDisabled]}>‹</Text>
                </TouchableOpacity>
                <Text style={styles.calMonth}>{MONTHS[viewMonth]} {viewYear}</Text>
                <TouchableOpacity onPress={nextMonth} style={styles.calNav}>
                  <Text style={styles.calNavText}>›</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.weekRow}>
                {WEEKDAYS.map((w, i) => <Text key={i} style={styles.weekday}>{w}</Text>)}
              </View>
              <View style={styles.grid}>
                {cells.map((d, i) => {
                  if (d === null) return <View key={`b${i}`} style={styles.cell} />;
                  const key = toDateKey(viewYear, viewMonth, d);
                  const isPast = key < todayKey;
                  const isSelected = key === date;
                  return (
                    <TouchableOpacity
                      key={key}
                      style={[styles.cell, styles.dayCell, isSelected && styles.daySelected]}
                      disabled={isPast}
                      onPress={() => setDate(key)}
                      activeOpacity={0.7}
                    >
                      <Text style={[
                        styles.dayText,
                        isPast && styles.dayPast,
                        isSelected && styles.daySelectedText,
                      ]}>{d}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
            {date ? <Text style={styles.selectedLabel}>Selected: {prettyDate(date)}</Text> : null}

            {/* Site (WORK only) */}
            {type === 'WORK' && (
              <>
                <Text style={styles.label}>Preferred site (optional)</Text>
                <TextInput
                  style={styles.input}
                  value={siteName}
                  onChangeText={setSiteName}
                  placeholder="e.g. Shields Natick"
                  placeholderTextColor="#94A3B8"
                />
              </>
            )}

            {/* Note */}
            <Text style={styles.label}>Note (optional)</Text>
            <TextInput
              style={[styles.input, { height: 72, textAlignVertical: 'top' }]}
              value={note}
              onChangeText={setNote}
              placeholder="Anything your coordinator should know"
              placeholderTextColor="#94A3B8"
              multiline
            />
          </ScrollView>

          <TouchableOpacity style={[styles.submit, saving && { opacity: 0.6 }]} onPress={submit} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Send Request</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', justifyContent: 'flex-end' },
  card: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 22, paddingBottom: 34 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  title: { fontSize: 19, fontWeight: '800', color: '#0F172A' },
  close: { fontSize: 22, color: '#94A3B8', padding: 4 },
  label: { fontSize: 12, fontWeight: '700', color: '#374151', textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 14, marginBottom: 8 },
  toggleRow: { flexDirection: 'row', gap: 8 },
  toggle: { flex: 1, paddingVertical: 11, borderRadius: 10, borderWidth: 1.5, borderColor: '#E2E8F0', alignItems: 'center', backgroundColor: '#fff' },
  toggleActive: { borderColor: '#2563EB', backgroundColor: '#EFF6FF' },
  toggleText: { fontSize: 14, fontWeight: '700', color: '#64748B' },
  toggleTextActive: { color: '#1D4ED8' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1.5, borderColor: '#E2E8F0', backgroundColor: '#fff' },
  chipActive: { borderColor: '#2563EB', backgroundColor: '#EFF6FF' },
  chipText: { fontSize: 13, fontWeight: '600', color: '#64748B' },
  chipTextActive: { color: '#1D4ED8' },
  input: { borderWidth: 1.5, borderColor: '#E2E8F0', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, color: '#0F172A' },
  // Calendar
  calendar: { borderWidth: 1.5, borderColor: '#E2E8F0', borderRadius: 12, padding: 10 },
  calHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  calNav: { padding: 6, minWidth: 36, alignItems: 'center' },
  calNavText: { fontSize: 24, fontWeight: '800', color: '#2563EB' },
  calNavDisabled: { color: '#CBD5E1' },
  calMonth: { fontSize: 15, fontWeight: '800', color: '#0F172A' },
  weekRow: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '700', color: '#94A3B8', paddingVertical: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  dayCell: { borderRadius: 8 },
  daySelected: { backgroundColor: '#2563EB' },
  dayText: { fontSize: 15, fontWeight: '600', color: '#0F172A' },
  dayPast: { color: '#CBD5E1' },
  daySelectedText: { color: '#fff', fontWeight: '800' },
  selectedLabel: { marginTop: 8, fontSize: 13, fontWeight: '600', color: '#2563EB' },
  submit: { backgroundColor: '#2563EB', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 18 },
  submitText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
