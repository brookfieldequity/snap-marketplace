import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
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
  error: '#EF4444',
  white: '#FFFFFF',
  unavailable: '#EF4444',
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year, month) {
  return new Date(year, month, 1).getDay();
}

function toDateKey(year, month, day) {
  const m = String(month + 1).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${year}-${m}-${d}`;
}

function fmtWindowDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function isToday(year, month, day) {
  const now = new Date();
  return now.getFullYear() === year && now.getMonth() === month && now.getDate() === day;
}

function isPast(year, month, day) {
  const now = new Date();
  const target = new Date(year, month, day);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return target < today;
}

export default function AvailabilityScreen() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  // availability: { 'YYYY-MM-DD': true | false }  (absent key = unmarked/neutral)
  const [availability, setAvailability] = useState({});
  // Task #20: per-date free-text notes { 'YYYY-MM-DD': string }
  const [notes, setNotes] = useState({});
  // Note editor modal: { key, text } or null
  const [noteModal, setNoteModal] = useState(null);
  // Dates the user cycled back to neutral that previously had a server value —
  // sent to the backend on save so it can delete those rows.
  const [clearedDates, setClearedDates] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Availability window banner
  const [activeWindows, setActiveWindows] = useState([]);
  const [windowDismissed, setWindowDismissed] = useState(false);

  // Incentive shifts
  const [incentiveShifts, setIncentiveShifts] = useState([]);
  // incentiveDates: Set of 'YYYY-MM-DD' strings that have an incentive shift
  const [incentiveDates, setIncentiveDates] = useState(new Set());
  // Selected incentive shift card (when user taps a gold-badge date)
  const [selectedIncentiveShift, setSelectedIncentiveShift] = useState(null);
  const [incentiveResponding, setIncentiveResponding] = useState(false);

  useEffect(() => {
    loadAvailability();
  }, [month, year]);

  const loadAvailability = async () => {
    setLoading(true);
    try {
      const res = await providerAPI.getAvailability({ month: month + 1, year });
      // Backend returns the array directly; tolerate either shape.
      const rows = Array.isArray(res.data) ? res.data : (res.data?.availability || []);
      const map = {};
      const noteMap = {};
      rows.forEach((a) => {
        const key = String(a.date).slice(0, 10);
        map[key] = a.available;
        if (a.note) noteMap[key] = a.note;
      });
      setAvailability(map);
      setNotes(noteMap);
      setClearedDates(new Set());
      setDirty(false);
    } catch {
      // Use empty availability if API unavailable
      setAvailability({});
      setClearedDates(new Set());
      setDirty(false);
    } finally {
      setLoading(false);
    }
  };

  // Load active windows and incentive shifts on mount
  useEffect(() => {
    providerAPI.getActiveWindows()
      .then((res) => {
        const data = res.data || [];
        setActiveWindows(Array.isArray(data) ? data : []);
      })
      .catch(() => setActiveWindows([]));

    providerAPI.getActiveIncentiveShifts()
      .then((res) => {
        const data = res.data || [];
        const shifts = Array.isArray(data) ? data : [];
        setIncentiveShifts(shifts);
        const dateSet = new Set(
          shifts.map((s) => {
            const d = s.date || s.shiftDate;
            if (!d) return null;
            return new Date(d).toISOString().slice(0, 10);
          }).filter(Boolean)
        );
        setIncentiveDates(dateSet);
      })
      .catch(() => {
        setIncentiveShifts([]);
        setIncentiveDates(new Set());
      });
  }, []);

  // Most urgently closing active window (smallest closeDate)
  const urgentWindow = activeWindows.length > 0 ? activeWindows[0] : null;

  const daysUntilClose = (closeDateStr) => {
    if (!closeDateStr) return null;
    const diff = new Date(closeDateStr) - new Date();
    return Math.max(0, Math.ceil(diff / 86400000));
  };

  const handleIncentiveRespond = async (shiftId, accepted) => {
    setIncentiveResponding(true);
    try {
      await providerAPI.respondToIncentiveShift(shiftId, accepted);
      Alert.alert(
        accepted ? 'Shift Accepted' : 'Shift Declined',
        accepted
          ? 'You have accepted this incentive shift. The facility will be notified.'
          : 'You have declined this incentive shift.',
      );
      setSelectedIncentiveShift(null);
      // Remove the shift from the local list
      setIncentiveShifts((prev) => prev.filter((s) => s.id !== shiftId));
      setIncentiveDates((prev) => {
        const next = new Set(prev);
        const shift = incentiveShifts.find((s) => s.id === shiftId);
        if (shift) {
          const dk = (shift.date || shift.shiftDate || '').slice(0, 10);
          if (dk) next.delete(dk);
        }
        return next;
      });
    } catch (err) {
      Alert.alert('Error', err.response?.data?.message || 'Could not submit response.');
    } finally {
      setIncentiveResponding(false);
    }
  };

  // Task #20: long-press a (non-past) day to attach a note ("after 10am",
  // "Natick only", etc.). Doesn't disturb the tap-to-cycle availability state.
  const handleDayLongPress = (day) => {
    if (isPast(year, month, day)) return;
    const key = toDateKey(year, month, day);
    setNoteModal({ key, text: notes[key] || '' });
  };

  const saveNote = () => {
    if (!noteModal) return;
    const { key, text } = noteModal;
    const trimmed = text.trim();
    setNotes((prev) => {
      const next = { ...prev };
      if (trimmed) next[key] = trimmed;
      else delete next[key];
      return next;
    });
    // A note implies some availability intent — if the day is unmarked, mark
    // it available so the saved row is valid (backend requires `available`).
    if (trimmed && availability[key] === undefined) {
      setAvailability((prev) => ({ ...prev, [key]: true }));
    }
    setDirty(true);
    setNoteModal(null);
  };

  const handleDayPress = (day) => {
    const key = toDateKey(year, month, day);

    // If this date has an incentive shift, show the shift card instead of toggling availability
    if (incentiveDates.has(key)) {
      const shift = incentiveShifts.find((s) => {
        const dk = (s.date || s.shiftDate || '').slice(0, 10);
        return dk === key;
      });
      if (shift) {
        setSelectedIncentiveShift(shift);
        return;
      }
    }

    if (isPast(year, month, day)) return; // don't allow editing past days

    const current = availability[key]; // undefined = unmarked, true = available, false = unavailable
    if (current === undefined) {
      // unmarked → available
      setAvailability((prev) => ({ ...prev, [key]: true }));
      // If this date was queued for backend clearing, cancel that — it's set again now.
      if (clearedDates.has(key)) {
        setClearedDates((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    } else if (current === true) {
      // available → unavailable
      setAvailability((prev) => ({ ...prev, [key]: false }));
    } else {
      // unavailable → unmarked (neutral) — remove from state and queue for backend deletion
      setAvailability((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setClearedDates((prev) => {
        const next = new Set(prev);
        next.add(key);
        return next;
      });
    }
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = Object.entries(availability).map(([date, available]) => ({
        date,
        available,
        note: notes[date] || null, // Task #20
      }));
      const clearList = Array.from(clearedDates);
      await providerAPI.setAvailability({ dates: payload, clearDates: clearList });
      setClearedDates(new Set());
      setDirty(false);
      Alert.alert('Saved', 'Your availability has been updated.');
    } catch (err) {
      Alert.alert('Error', err.response?.data?.message || 'Could not save availability.');
    } finally {
      setSaving(false);
    }
  };

  const prevMonth = () => {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  };

  const nextMonth = () => {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  };

  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);

  // Build calendar grid: nulls for leading blanks + day numbers
  const grid = [];
  for (let i = 0; i < firstDay; i++) grid.push(null);
  for (let d = 1; d <= daysInMonth; d++) grid.push(d);

  const getDayStyle = (day) => {
    const key = toDateKey(year, month, day);
    const avail = availability[key];
    const past = isPast(year, month, day);
    const today = isToday(year, month, day);

    if (past) return { cell: styles.dayPast, text: styles.dayTextPast };
    if (today && avail === undefined) return { cell: styles.dayToday, text: styles.dayTextToday };
    if (avail === true) return { cell: styles.dayAvailable, text: styles.dayTextAvailable };
    if (avail === false) return { cell: styles.dayUnavailable, text: styles.dayTextUnavailable };
    return { cell: styles.dayNeutral, text: styles.dayText };
  };

  // Count available days in current view
  const availCount = Object.entries(availability).filter(([k, v]) => {
    const [y2, m2] = k.split('-').map(Number);
    return y2 === year && m2 === month + 1 && v === true;
  }).length;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Availability</Text>
          <Text style={styles.headerSub}>Tap days to mark availability</Text>
        </View>

        {/* Availability Window Banner */}
        {urgentWindow && !windowDismissed && (
          <View style={styles.windowBanner}>
            <View style={styles.windowBannerContent}>
              <View style={{ flex: 1 }}>
                <Text style={styles.windowBannerTitle}>
                  {urgentWindow.facility?.name || 'Your facility'} is collecting availability for{' '}
                  <Text style={{ fontWeight: '800' }}>{urgentWindow.name || 'an upcoming window'}</Text>
                </Text>
                <Text style={styles.windowBannerSub}>
                  Closes {fmtWindowDate(urgentWindow.closeDate)}
                  {daysUntilClose(urgentWindow.closeDate) !== null
                    ? ` · ${daysUntilClose(urgentWindow.closeDate)} days remaining`
                    : ''}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setWindowDismissed(true)}
                style={styles.windowDismiss}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.windowDismissText}>×</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Incentive Shift Detail Card */}
        {selectedIncentiveShift && (
          <View style={styles.incentiveCard}>
            <View style={styles.incentiveCardHeader}>
              <Text style={styles.incentiveCardBadge}>💰 INCENTIVE SHIFT</Text>
              <TouchableOpacity
                onPress={() => setSelectedIncentiveShift(null)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.windowDismissText}>×</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.incentiveFacility}>
              {selectedIncentiveShift.facility?.name || selectedIncentiveShift.facilityName || 'Facility'}
            </Text>
            <View style={styles.incentiveDetails}>
              {[
                { label: 'Date', value: fmtWindowDate(selectedIncentiveShift.date || selectedIncentiveShift.shiftDate) },
                { label: 'Time', value: selectedIncentiveShift.startTime || '—' },
                { label: 'Duration', value: selectedIncentiveShift.durationHours ? `${selectedIncentiveShift.durationHours} hrs` : '—' },
                { label: 'Location', value: selectedIncentiveShift.location || selectedIncentiveShift.facility?.address || '—' },
                { label: 'Incentive Rate', value: selectedIncentiveShift.incentiveRate ? `$${selectedIncentiveShift.incentiveRate}/hr` : '—' },
              ].map(({ label, value }) => (
                <View key={label} style={styles.incentiveDetailRow}>
                  <Text style={styles.incentiveDetailLabel}>{label}</Text>
                  <Text style={styles.incentiveDetailValue}>{value}</Text>
                </View>
              ))}
            </View>
            <View style={styles.incentiveActions}>
              <TouchableOpacity
                style={[styles.incentiveAccept, incentiveResponding && { opacity: 0.6 }]}
                onPress={() => handleIncentiveRespond(selectedIncentiveShift.id, true)}
                disabled={incentiveResponding}
              >
                <Text style={styles.incentiveAcceptText}>Accept Shift</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.incentiveDecline, incentiveResponding && { opacity: 0.6 }]}
                onPress={() => handleIncentiveRespond(selectedIncentiveShift.id, false)}
                disabled={incentiveResponding}
              >
                <Text style={styles.incentiveDeclineText}>Decline</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Legend */}
        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: COLORS.primary }]} />
            <Text style={styles.legendText}>Available</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: COLORS.unavailable }]} />
            <Text style={styles.legendText}>Unavailable</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: COLORS.border }]} />
            <Text style={styles.legendText}>Not set</Text>
          </View>
        </View>

        {/* Calendar card */}
        <View style={styles.calendarCard}>
          {/* Month navigation */}
          <View style={styles.monthNav}>
            <TouchableOpacity style={styles.navButton} onPress={prevMonth}>
              <Text style={styles.navArrow}>←</Text>
            </TouchableOpacity>
            <View style={styles.monthCenter}>
              <Text style={styles.monthLabel}>{MONTHS[month]}</Text>
              <Text style={styles.yearLabel}>{year}</Text>
            </View>
            <TouchableOpacity style={styles.navButton} onPress={nextMonth}>
              <Text style={styles.navArrow}>→</Text>
            </TouchableOpacity>
          </View>

          {/* Weekday headers */}
          <View style={styles.weekdayRow}>
            {WEEKDAYS.map((d) => (
              <Text key={d} style={styles.weekdayHeader}>{d}</Text>
            ))}
          </View>

          {/* Days grid */}
          {loading ? (
            <View style={styles.calendarLoader}>
              <ActivityIndicator size="small" color={COLORS.primary} />
            </View>
          ) : (
            <View style={styles.daysGrid}>
              {grid.map((day, idx) => {
                if (day === null) {
                  return <View key={`blank-${idx}`} style={styles.dayCell} />;
                }
                const { cell, text } = getDayStyle(day);
                const past = isPast(year, month, day);
                const dateKey = toDateKey(year, month, day);
                const hasIncentive = incentiveDates.has(dateKey);
                const hasNote = !!notes[dateKey];
                return (
                  <TouchableOpacity
                    key={day}
                    style={[styles.dayCell, cell]}
                    onPress={() => handleDayPress(day)}
                    onLongPress={() => handleDayLongPress(day)}
                    delayLongPress={300}
                    disabled={past && !hasIncentive}
                    activeOpacity={past && !hasIncentive ? 1 : 0.7}
                  >
                    <Text style={[styles.dayText, text]}>{day}</Text>
                    {hasIncentive && (
                      <Text style={styles.incentiveBadge}>💰</Text>
                    )}
                    {hasNote && !hasIncentive && (
                      <Text style={styles.noteBadge}>📝</Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>

        {/* Summary */}
        <View style={styles.summaryRow}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryNumber}>{availCount}</Text>
            <Text style={styles.summaryLabel}>Days Available</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={styles.summaryNumber}>{daysInMonth - availCount}</Text>
            <Text style={styles.summaryLabel}>Days Remaining</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={styles.summaryNumber}>{daysInMonth}</Text>
            <Text style={styles.summaryLabel}>Total Days</Text>
          </View>
        </View>

        {/* Tips */}
        <View style={styles.tipCard}>
          <Text style={styles.tipTitle}>Pro Tip</Text>
          <Text style={styles.tipText}>
            Providers who mark availability at least 2 weeks ahead receive 15% more shift invitations from facilities.
            VIP providers get early access to new shifts posted in their available windows.
          </Text>
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Save bar */}
      {dirty && (
        <View style={styles.saveBar}>
          <Text style={styles.saveBarText}>You have unsaved changes</Text>
          <TouchableOpacity
            style={[styles.saveButton, saving && { opacity: 0.7 }]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator size="small" color={COLORS.white} />
            ) : (
              <Text style={styles.saveButtonText}>Save Availability</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* Note editor (Task #20) */}
      <Modal visible={!!noteModal} animationType="fade" transparent onRequestClose={() => setNoteModal(null)}>
        <View style={styles.noteOverlay}>
          <View style={styles.noteCard}>
            <Text style={styles.noteTitle}>
              Note for {noteModal ? new Date(noteModal.key + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : ''}
            </Text>
            <Text style={styles.noteHint}>Visible to your coordinator (e.g. “can work after 10am”, “Natick only”).</Text>
            <TextInput
              style={styles.noteInput}
              value={noteModal?.text || ''}
              onChangeText={(t) => setNoteModal((m) => (m ? { ...m, text: t } : m))}
              placeholder="Add a note for this day"
              placeholderTextColor="#94A3B8"
              multiline
              autoFocus
            />
            <View style={styles.noteBtnRow}>
              <TouchableOpacity style={styles.noteCancel} onPress={() => setNoteModal(null)}>
                <Text style={styles.noteCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.noteSave} onPress={saveNote}>
                <Text style={styles.noteSaveText}>Save Note</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    paddingHorizontal: 20,
  },
  header: {
    paddingTop: 14,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    marginBottom: 16,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.textDark,
    letterSpacing: -0.3,
  },
  headerSub: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  legend: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 16,
    flexWrap: 'wrap',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  legendText: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  calendarCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  navButton: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navArrow: {
    fontSize: 18,
    color: COLORS.primary,
    fontWeight: '700',
  },
  monthCenter: {
    alignItems: 'center',
  },
  monthLabel: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.textDark,
    letterSpacing: -0.3,
  },
  yearLabel: {
    fontSize: 13,
    color: COLORS.textMuted,
    fontWeight: '500',
    marginTop: 1,
  },
  weekdayRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  weekdayHeader: {
    flex: 1,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  calendarLoader: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  daysGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    marginVertical: 2,
    position: 'relative',
  },
  dayText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textDark,
  },
  dayNeutral: {
    backgroundColor: '#F8FAFC',
  },
  dayAvailable: {
    backgroundColor: COLORS.primary,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 2,
  },
  dayTextAvailable: {
    color: COLORS.white,
    fontWeight: '700',
  },
  dayUnavailable: {
    backgroundColor: COLORS.unavailable + '15',
    borderWidth: 1,
    borderColor: COLORS.unavailable + '40',
  },
  dayTextUnavailable: {
    color: COLORS.unavailable,
    fontWeight: '700',
  },
  dayToday: {
    backgroundColor: COLORS.primary + '15',
    borderWidth: 2,
    borderColor: COLORS.primary,
  },
  dayTextToday: {
    color: COLORS.primary,
    fontWeight: '800',
  },
  dayPast: {
    backgroundColor: 'transparent',
  },
  dayTextPast: {
    color: '#CBD5E1',
    fontWeight: '400',
  },
  summaryRow: {
    flexDirection: 'row',
    backgroundColor: COLORS.card,
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 12,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  summaryNumber: {
    fontSize: 24,
    fontWeight: '800',
    color: COLORS.primary,
    letterSpacing: -0.5,
  },
  summaryLabel: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 3,
    fontWeight: '500',
    textAlign: 'center',
  },
  summaryDivider: {
    width: 1,
    backgroundColor: COLORS.border,
    marginVertical: 4,
  },
  tipCard: {
    backgroundColor: COLORS.primary + '10',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.primary + '25',
  },
  tipTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: COLORS.primary,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tipText: {
    fontSize: 13,
    color: COLORS.textDark,
    lineHeight: 19,
  },
  saveBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: COLORS.card,
    paddingHorizontal: 20,
    paddingVertical: 14,
    paddingBottom: 28,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 6,
  },
  saveBarText: {
    fontSize: 13,
    color: COLORS.textMuted,
    fontWeight: '500',
    flex: 1,
  },
  saveButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
  },
  saveButtonText: {
    color: COLORS.white,
    fontWeight: '700',
    fontSize: 14,
  },

  // Availability window banner
  windowBanner: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#A5B4FC',
    borderRadius: 12,
    marginBottom: 14,
    overflow: 'hidden',
  },
  windowBannerContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 14,
    gap: 8,
  },
  windowBannerTitle: {
    fontSize: 13,
    color: '#3730A3',
    fontWeight: '600',
    lineHeight: 18,
    marginBottom: 3,
  },
  windowBannerSub: {
    fontSize: 12,
    color: '#2563EB',
    fontWeight: '500',
  },
  windowDismiss: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  windowDismissText: {
    fontSize: 20,
    color: '#2563EB',
    fontWeight: '700',
    lineHeight: 24,
  },

  // Incentive shift card
  incentiveCard: {
    backgroundColor: '#FFFBEB',
    borderWidth: 1.5,
    borderColor: '#F59E0B',
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
  },
  incentiveCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  incentiveCardBadge: {
    fontSize: 12,
    fontWeight: '800',
    color: '#B45309',
    letterSpacing: 0.3,
  },
  incentiveFacility: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 12,
    letterSpacing: -0.2,
  },
  incentiveDetails: {
    borderTopWidth: 1,
    borderTopColor: '#FDE68A',
    paddingTop: 10,
    marginBottom: 14,
  },
  incentiveDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: '#FEF3C7',
  },
  incentiveDetailLabel: {
    fontSize: 12,
    color: '#92400E',
    fontWeight: '500',
  },
  incentiveDetailValue: {
    fontSize: 13,
    color: '#0F172A',
    fontWeight: '600',
  },
  incentiveActions: {
    flexDirection: 'row',
    gap: 10,
  },
  incentiveAccept: {
    flex: 1,
    backgroundColor: '#F59E0B',
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
    shadowColor: '#F59E0B',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  incentiveAcceptText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  incentiveDecline: {
    flex: 1,
    backgroundColor: 'transparent',
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#F59E0B',
  },
  incentiveDeclineText: {
    color: '#B45309',
    fontWeight: '700',
    fontSize: 14,
  },

  // Gold incentive badge on day cells
  incentiveBadge: {
    position: 'absolute',
    top: 1,
    right: 1,
    fontSize: 9,
    lineHeight: 12,
  },
  // Note badge (Task #20)
  noteBadge: {
    position: 'absolute',
    bottom: 1,
    right: 2,
    fontSize: 8,
    lineHeight: 10,
  },
  // Note editor modal (Task #20)
  noteOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', justifyContent: 'center', padding: 24 },
  noteCard: { backgroundColor: '#fff', borderRadius: 16, padding: 22 },
  noteTitle: { fontSize: 16, fontWeight: '800', color: '#0F172A' },
  noteHint: { fontSize: 12, color: '#64748B', marginTop: 4, marginBottom: 12, lineHeight: 16 },
  noteInput: { borderWidth: 1.5, borderColor: '#E2E8F0', borderRadius: 10, padding: 12, fontSize: 15, color: '#0F172A', height: 80, textAlignVertical: 'top' },
  noteBtnRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 16 },
  noteCancel: { paddingVertical: 10, paddingHorizontal: 18, borderRadius: 9, borderWidth: 1, borderColor: '#E2E8F0' },
  noteCancelText: { color: '#374151', fontWeight: '600', fontSize: 14 },
  noteSave: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 9, backgroundColor: '#2563EB' },
  noteSaveText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
