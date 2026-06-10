import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, TextInput, ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { scheduleRequestAPI } from '../api/client';

// Task #21: provider creates a schedule request — a day off, or to work a
// specific date/site — for one of the facilities they're on. The coordinator
// approves/declines; accepted requests shape the next schedule build.

export default function RequestModal({ visible, onClose, memberships = [], onSubmitted }) {
  const facilities = memberships
    .map((m) => ({ id: m.facility?.id || m.facilityId, name: m.facility?.name || 'Facility' }))
    .filter((f) => f.id);

  const [facilityId, setFacilityId] = useState(facilities[0]?.id || null);
  const [type, setType] = useState('DAY_OFF');
  const [date, setDate] = useState('');
  const [siteName, setSiteName] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  function reset() {
    setType('DAY_OFF'); setDate(''); setSiteName(''); setNote('');
    setFacilityId(facilities[0]?.id || null);
  }

  async function submit() {
    if (!facilityId) return Alert.alert('Pick a facility', 'Choose which facility this request is for.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
      return Alert.alert('Check the date', 'Enter the date as YYYY-MM-DD (e.g. 2026-08-12).');
    }
    setSaving(true);
    try {
      await scheduleRequestAPI.create({
        facilityId,
        type,
        date: date.trim(),
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

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>New Request</Text>
            <TouchableOpacity onPress={onClose}><Text style={styles.close}>✕</Text></TouchableOpacity>
          </View>

          <ScrollView style={{ maxHeight: 460 }}>
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

            {/* Date */}
            <Text style={styles.label}>Date</Text>
            <TextInput
              style={styles.input}
              value={date}
              onChangeText={setDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#94A3B8"
              autoCapitalize="none"
              keyboardType="numbers-and-punctuation"
            />

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
  toggleActive: { borderColor: '#6366F1', backgroundColor: '#EEF2FF' },
  toggleText: { fontSize: 14, fontWeight: '700', color: '#64748B' },
  toggleTextActive: { color: '#4F46E5' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1.5, borderColor: '#E2E8F0', backgroundColor: '#fff' },
  chipActive: { borderColor: '#6366F1', backgroundColor: '#EEF2FF' },
  chipText: { fontSize: 13, fontWeight: '600', color: '#64748B' },
  chipTextActive: { color: '#4F46E5' },
  input: { borderWidth: 1.5, borderColor: '#E2E8F0', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, color: '#0F172A' },
  submit: { backgroundColor: '#6366F1', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 18 },
  submitText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
