import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { scheduleRequestAPI } from '../api/client';

// "My requests" status visibility. Lists the provider's schedule requests
// (WORK / DAY_OFF / PTO) across facilities with a status chip, and lets them
// cancel PENDING ones. Opened from MyScheduleScreen next to ＋ Request.

const TYPE_META = {
  PTO: { icon: '🌴', label: 'PTO' },
  DAY_OFF: { icon: '🛌', label: 'Day off' },
  WORK: { icon: '💼', label: 'Work' },
};

const STATUS_META = {
  PENDING: { label: 'Pending', bg: '#FFFBEB', border: '#FDE68A', color: '#B45309' },
  ACCEPTED: { label: 'Accepted', bg: '#ECFDF5', border: '#6EE7B7', color: '#047857' },
  DECLINED: { label: 'Declined', bg: '#FEF2F2', border: '#FCA5A5', color: '#B91C1C' },
};

function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

function dateLabel(r) {
  if (r.endDate && new Date(r.endDate) > new Date(r.date)) {
    return `${fmtDate(r.date)} – ${fmtDate(r.endDate)}`;
  }
  return fmtDate(r.date);
}

export default function MyRequestsModal({ visible, onClose }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [cancelingId, setCancelingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await scheduleRequestAPI.mine();
      setRequests(res.data?.requests || []);
    } catch (e) {
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  function confirmCancel(r) {
    const meta = TYPE_META[r.type] || TYPE_META.WORK;
    Alert.alert(
      'Cancel this request?',
      `${meta.label} request for ${dateLabel(r)} will be withdrawn.`,
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Cancel request',
          style: 'destructive',
          onPress: async () => {
            setCancelingId(r.id);
            try {
              await scheduleRequestAPI.cancel(r.id);
              setRequests((prev) => prev.filter((x) => x.id !== r.id));
            } catch (e) {
              Alert.alert('Could not cancel', e?.response?.data?.error || e.message || 'Try again.');
            } finally {
              setCancelingId(null);
            }
          },
        },
      ]
    );
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>My Requests</Text>
            <TouchableOpacity onPress={onClose}><Text style={styles.close}>✕</Text></TouchableOpacity>
          </View>

          {loading ? (
            <ActivityIndicator color="#2563EB" style={{ marginVertical: 32 }} />
          ) : requests.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No requests yet</Text>
              <Text style={styles.emptySub}>
                Use ＋ Request on your schedule to ask for a day off, PTO, or a specific shift.
              </Text>
            </View>
          ) : (
            <ScrollView style={{ maxHeight: 480 }}>
              {requests.map((r) => {
                const meta = TYPE_META[r.type] || TYPE_META.WORK;
                const status = STATUS_META[r.status] || STATUS_META.PENDING;
                return (
                  <View key={r.id} style={styles.row}>
                    <Text style={styles.icon}>{meta.icon}</Text>
                    <View style={{ flex: 1 }}>
                      <View style={styles.rowTop}>
                        <Text style={styles.rowType}>{meta.label}</Text>
                        <View style={[styles.chip, { backgroundColor: status.bg, borderColor: status.border }]}>
                          <Text style={[styles.chipText, { color: status.color }]}>{status.label}</Text>
                        </View>
                      </View>
                      <Text style={styles.rowDates}>{dateLabel(r)}</Text>
                      <Text style={styles.rowSub} numberOfLines={2}>
                        {r.facility?.name || 'Facility'}
                        {r.siteName ? ` · ${r.siteName}` : ''}
                        {r.note ? ` · “${r.note}”` : ''}
                      </Text>
                      {r.status === 'PENDING' && (
                        <TouchableOpacity
                          onPress={() => confirmCancel(r)}
                          disabled={cancelingId === r.id}
                          style={styles.cancelBtn}
                          activeOpacity={0.7}
                        >
                          <Text style={styles.cancelBtnText}>
                            {cancelingId === r.id ? 'Canceling…' : 'Cancel request'}
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', justifyContent: 'flex-end' },
  card: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 22, paddingBottom: 34, maxHeight: '85%' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 19, fontWeight: '800', color: '#0F172A' },
  close: { fontSize: 22, color: '#94A3B8', padding: 4 },
  empty: { alignItems: 'center', paddingVertical: 28 },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: '#0F172A', marginBottom: 6 },
  emptySub: { fontSize: 13, color: '#64748B', textAlign: 'center', lineHeight: 18, paddingHorizontal: 12 },
  row: { flexDirection: 'row', gap: 10, paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  icon: { fontSize: 20, marginTop: 1 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  rowType: { fontSize: 14, fontWeight: '800', color: '#0F172A' },
  chip: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 3 },
  chipText: { fontSize: 11, fontWeight: '800' },
  rowDates: { fontSize: 13, fontWeight: '600', color: '#2563EB', marginBottom: 2 },
  rowSub: { fontSize: 12, color: '#64748B', lineHeight: 17 },
  cancelBtn: { alignSelf: 'flex-start', marginTop: 8, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: '#FCA5A5', backgroundColor: '#FFF5F5' },
  cancelBtnText: { fontSize: 12, fontWeight: '700', color: '#DC2626' },
});
