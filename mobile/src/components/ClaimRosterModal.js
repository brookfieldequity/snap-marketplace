import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, TextInput, ActivityIndicator, Alert,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { providerAPI } from '../api/client';

// Invite → claim roster linking. The coordinator hands/texts the provider an
// 8-character invite code (minted on the facility portal roster page); the
// provider enters it here to link their app account to that roster spot.
// Opened from ProfileScreen ("Link your practice") and from the MySchedule
// empty-state banner.

export default function ClaimRosterModal({ visible, onClose, onLinked }) {
  const [code, setCode] = useState('');
  const [saving, setSaving] = useState(false);

  function reset() {
    setCode('');
  }

  async function submit() {
    const cleaned = code.replace(/[\s-]/g, '').toUpperCase();
    if (!cleaned) {
      Alert.alert('Enter your code', 'Type the invite code your coordinator gave you.');
      return;
    }
    setSaving(true);
    try {
      const res = await providerAPI.claimRoster(cleaned);
      const facilityName = res.data?.facility?.name || 'your practice';
      Alert.alert(
        res.data?.alreadyLinked ? 'Already linked' : 'You’re linked!',
        res.data?.alreadyLinked
          ? `Your account is already connected to ${facilityName}.`
          : `Your account is now connected to ${facilityName}. Your schedule and availability windows will show up here.`
      );
      reset();
      onLinked && onLinked(res.data);
      onClose();
    } catch (e) {
      Alert.alert('Could not link', e?.response?.data?.error || e.message || 'Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>Link Your Practice</Text>
            <TouchableOpacity onPress={onClose}><Text style={styles.close}>✕</Text></TouchableOpacity>
          </View>

          <Text style={styles.body}>
            On a practice roster? Enter the invite code from your coordinator to connect
            your schedule, availability windows, and requests.
          </Text>

          <Text style={styles.label}>Invite code</Text>
          <TextInput
            style={styles.codeInput}
            value={code}
            onChangeText={(t) => setCode(t.toUpperCase())}
            placeholder="e.g. XK7RPM2W"
            placeholderTextColor="#94A3B8"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={12}
          />

          <TouchableOpacity style={[styles.submit, saving && { opacity: 0.6 }]} onPress={submit} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Link Account</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', justifyContent: 'flex-end' },
  card: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 22, paddingBottom: 34 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  title: { fontSize: 19, fontWeight: '800', color: '#0F172A' },
  close: { fontSize: 22, color: '#94A3B8', padding: 4 },
  body: { fontSize: 13, color: '#64748B', lineHeight: 19, marginBottom: 14 },
  label: { fontSize: 12, fontWeight: '700', color: '#374151', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 },
  codeInput: {
    borderWidth: 1.5, borderColor: '#E2E8F0', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14,
    fontSize: 22, fontWeight: '800', letterSpacing: 4, color: '#0F172A', textAlign: 'center',
  },
  submit: { backgroundColor: '#2563EB', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 18 },
  submitText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
