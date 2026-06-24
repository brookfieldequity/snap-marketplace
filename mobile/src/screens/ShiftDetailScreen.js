import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Modal,
  Alert,
  ActivityIndicator,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { shiftAPI, authAPI, messageAPI } from '../api/client';

const COLORS = {
  primary: '#2563EB',
  background: '#FAFAFA',
  textDark: '#0F172A',
  textMuted: '#64748B',
  surge: '#F59E0B',
  vip: '#1E3A8A',
  success: '#10B981',
  card: '#FFFFFF',
  border: '#E2E8F0',
  error: '#EF4444',
  white: '#FFFFFF',
};

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
    facilityRating: s.facility?.rating ?? s.facilityRating ?? null,
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
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function formatTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function VipCountdown({ endTime }) {
  const [timeLeft, setTimeLeft] = useState('');

  useEffect(() => {
    const tick = () => {
      const diff = new Date(endTime) - new Date();
      if (diff <= 0) {
        setTimeLeft('VIP window closed');
        return;
      }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setTimeLeft(`${h}h ${m}m ${s}s remaining`);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [endTime]);

  return (
    <View style={styles.vipCountdownBox}>
      <Text style={styles.vipCountdownLabel}>★ VIP Early Access Window</Text>
      <Text style={styles.vipCountdownTime}>{timeLeft}</Text>
    </View>
  );
}

function PinModal({ visible, onClose, onConfirm, loading }) {
  const [pin, setPin] = useState('');
  const digits = (pin + '    ').slice(0, 4).split('');

  const handleKey = (key) => {
    if (key === '⌫') setPin((p) => p.slice(0, -1));
    else if (pin.length < 4) setPin((p) => p + key);
  };

  const handleConfirm = () => {
    if (pin.length < 4) {
      Alert.alert('PIN Required', 'Please enter your 4-digit PIN.');
      return;
    }
    onConfirm(pin);
  };

  const handleClose = () => {
    setPin('');
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>Confirm Booking</Text>
          <Text style={styles.modalSubtitle}>Enter your 4-digit booking PIN to continue</Text>

          {/* PIN dots */}
          <View style={styles.pinRow}>
            {digits.map((d, i) => (
              <View key={i} style={[styles.pinBox, pin.length > i && styles.pinBoxFilled]}>
                <Text style={styles.pinDot}>{pin.length > i ? '●' : ''}</Text>
              </View>
            ))}
          </View>

          {/* Numpad */}
          <View style={styles.numpad}>
            {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((key, idx) => (
              <TouchableOpacity
                key={idx}
                style={[styles.numKey, key === '' && styles.numKeyEmpty]}
                disabled={key === ''}
                onPress={() => handleKey(key)}
              >
                <Text style={styles.numKeyText}>{key}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity
            style={[styles.confirmButton, (loading || pin.length < 4) && styles.confirmButtonDisabled]}
            onPress={handleConfirm}
            disabled={loading || pin.length < 4}
          >
            {loading ? (
              <ActivityIndicator color={COLORS.white} />
            ) : (
              <Text style={styles.confirmButtonText}>Confirm Booking</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelButton} onPress={handleClose}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function MessageBubble({ message, isMine }) {
  return (
    <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
      {!isMine && (
        <Text style={styles.bubbleSender}>{message.senderName || 'Facility'}</Text>
      )}
      <Text style={[styles.bubbleText, isMine && styles.bubbleTextMine]}>{message.body}</Text>
      <Text style={[styles.bubbleTime, isMine && styles.bubbleTimeMine]}>
        {new Date(message.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
      </Text>
    </View>
  );
}

export default function ShiftDetailScreen({ route, navigation }) {
  const { shiftId, shift: initialShift } = route.params || {};

  const [shift, setShift] = useState(initialShift ? normalizeShift(initialShift) : null);
  const [loading, setLoading] = useState(!initialShift);
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [pinLoading, setPinLoading] = useState(false);
  const [booked, setBooked] = useState(false);
  const [messages, setMessages] = useState([]);
  const [msgText, setMsgText] = useState('');
  const [msgSending, setMsgSending] = useState(false);
  const [msgLoadError, setMsgLoadError] = useState(false);

  useEffect(() => {
    if (shiftId && !initialShift) {
      loadShift();
    }
    if (shiftId) {
      loadMessages();
    }
  }, [shiftId]);

  const loadShift = async () => {
    try {
      const res = await shiftAPI.getShift(shiftId);
      setShift(normalizeShift(res.data));
    } catch {
      Alert.alert('Error', 'Could not load shift details.');
    } finally {
      setLoading(false);
    }
  };

  const loadMessages = async () => {
    setMsgLoadError(false);
    try {
      const res = await messageAPI.getForShift(shiftId);
      setMessages(res.data || []);
    } catch (err) {
      console.error('Failed to load messages:', err?.response?.data?.error || err.message);
      setMsgLoadError(true);
    }
  };

  const handleBookPress = () => {
    setPinModalVisible(true);
  };

  const handleApplyPress = async () => {
    try {
      await shiftAPI.applyShift(shiftId);
      Alert.alert(
        'Application Submitted',
        'Your application has been submitted. A SNAP coordinator will reach out to begin credentialing.',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (err) {
      const msg = err.response?.data?.message || 'Could not submit application.';
      Alert.alert('Error', msg);
    }
  };

  const handlePinConfirm = async (pin) => {
    setPinLoading(true);
    try {
      const pinRes = await authAPI.verifyPin({ pin });
      if (!pinRes.data?.valid) {
        Alert.alert('Incorrect PIN', 'The PIN you entered is incorrect. Please try again.');
        setPinLoading(false);
        return;
      }
      await shiftAPI.bookShift(shiftId);
      setPinModalVisible(false);
      setBooked(true);
      Alert.alert(
        'Shift Booked!',
        `You have successfully booked the shift at ${shift?.facilityName}. Check your email for confirmation details.`,
        [{ text: 'Great!', onPress: () => navigation.goBack() }]
      );
    } catch (err) {
      const msg = err.response?.data?.message || 'Booking failed. Please try again.';
      Alert.alert('Booking Failed', msg);
    } finally {
      setPinLoading(false);
    }
  };

  const handleSendMessage = async () => {
    if (!msgText.trim()) return;
    setMsgSending(true);
    try {
      const res = await messageAPI.send({ shiftId, body: msgText.trim() });
      setMessages((prev) => [...prev, res.data]);
      setMsgText('');
    } catch (err) {
      const msg = err?.response?.data?.error || 'Could not send message. Please try again.';
      Alert.alert('Message Error', msg);
    } finally {
      setMsgSending(false);
    }
  };

  if (loading || !shift) {
    return (
      <View style={styles.centerLoader}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  const isSurge = shift.surgeMultiplier && shift.surgeMultiplier > 1;
  const isCredentialed = shift.providerIsCredentialed === true;
  const effectivePay = isSurge ? (shift.payRate * shift.surgeMultiplier) : shift.payRate;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Back button */}
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backArrow}>←</Text>
          <Text style={styles.backText}>Back to Shifts</Text>
        </TouchableOpacity>

        {/* Facility photo placeholder */}
        <View style={styles.facilityPhoto}>
          <View style={styles.facilityPhotoInner}>
            <Text style={styles.facilityPhotoLetter}>
              {(shift.facilityName || 'F').charAt(0).toUpperCase()}
            </Text>
          </View>
        </View>

        {/* Badge row */}
        <View style={styles.badgeRow}>
          {isSurge && (
            <View style={styles.surgeBadge}>
              <Text style={styles.surgeBadgeText}>⚡ SURGE {shift.surgeMultiplier}x</Text>
            </View>
          )}
          {shift.vipWindowActive && (
            <View style={styles.vipBadge}>
              <Text style={styles.vipBadgeText}>★ VIP EARLY ACCESS</Text>
            </View>
          )}
          {booked && (
            <View style={styles.bookedBadge}>
              <Text style={styles.bookedBadgeText}>✓ BOOKED</Text>
            </View>
          )}
        </View>

        {/* Facility name + specialty */}
        <Text style={styles.facilityName}>{shift.facilityName}</Text>
        <View style={styles.specialtyRow}>
          <Text style={styles.specialty}>{shift.specialty}</Text>
          {shift.facilityRating?.count > 0 && (
            <View style={styles.detailRating}>
              <Text style={styles.detailRatingStar}>★</Text>
              <Text style={styles.detailRatingValue}>{shift.facilityRating.avg?.toFixed(1)}</Text>
              <Text style={styles.detailRatingCount}>
                · {shift.facilityRating.count} rating{shift.facilityRating.count > 1 ? 's' : ''}
              </Text>
            </View>
          )}
        </View>

        {/* VIP countdown */}
        {shift.vipWindowActive && shift.vipWindowEnd && (
          <VipCountdown endTime={shift.vipWindowEnd} />
        )}

        {/* Pay rate card */}
        <View style={styles.payCard}>
          <View style={styles.payCardLeft}>
            <Text style={styles.payCardLabel}>Base Rate</Text>
            <Text style={styles.payCardRate}>${shift.payRate?.toFixed(0)}<Text style={styles.payCardPer}>/hr</Text></Text>
          </View>
          {isSurge && (
            <>
              <View style={styles.payCardDivider} />
              <View style={styles.payCardRight}>
                <Text style={styles.payCardLabel}>Surge Rate</Text>
                <Text style={[styles.payCardRate, styles.surgeRate]}>${effectivePay.toFixed(0)}<Text style={styles.payCardPer}>/hr</Text></Text>
              </View>
            </>
          )}
          {shift.durationHours && (
            <>
              <View style={styles.payCardDivider} />
              <View style={styles.payCardRight}>
                <Text style={styles.payCardLabel}>Est. Total</Text>
                <Text style={[styles.payCardRate, styles.totalRate]}>
                  ${(effectivePay * shift.durationHours).toFixed(0)}
                </Text>
              </View>
            </>
          )}
        </View>

        {/* Shift details */}
        <View style={styles.detailsCard}>
          <Text style={styles.sectionTitle}>Shift Details</Text>
          <DetailRow icon="📅" label="Date" value={formatDate(shift.startTime)} />
          <DetailRow icon="🕐" label="Start" value={formatTime(shift.startTime)} />
          <DetailRow icon="🕔" label="End" value={formatTime(shift.endTime)} />
          <DetailRow icon="⏱" label="Duration" value={`${shift.durationHours || '—'} hours`} />
          {shift.distanceMiles != null && (
            <DetailRow icon="📍" label="Distance" value={`${shift.distanceMiles.toFixed(1)} miles away`} />
          )}
          {shift.viewerCount > 0 && (
            <DetailRow icon="👀" label="Currently viewing" value={`${shift.viewerCount} providers`} />
          )}
          {shift.description && (
            <DetailRow icon="📝" label="Notes" value={shift.description} />
          )}
        </View>

        {/* Facility info */}
        {(shift.facilityAddress || shift.facilityPhone) && (
          <View style={styles.detailsCard}>
            <Text style={styles.sectionTitle}>Facility Info</Text>
            {shift.facilityAddress && (
              <DetailRow icon="🏥" label="Address" value={shift.facilityAddress} />
            )}
            {shift.facilityPhone && (
              <DetailRow icon="📞" label="Phone" value={shift.facilityPhone} />
            )}
          </View>
        )}

        {/* Messages */}
        <View style={styles.messagesCard}>
          <Text style={styles.sectionTitle}>Messages</Text>
          {msgLoadError ? (
            <View style={styles.msgErrorContainer}>
              <Text style={styles.msgErrorText}>Could not load messages.</Text>
              <TouchableOpacity onPress={loadMessages} style={styles.retryButton}>
                <Text style={styles.retryButtonText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : messages.length === 0 ? (
            <Text style={styles.noMessages}>No messages yet. Ask a question about this shift.</Text>
          ) : (
            messages.map((m, i) => (
              <MessageBubble key={m.id || i} message={m} isMine={m.senderRole === 'provider'} />
            ))
          )}
          <View style={styles.messageInputRow}>
            <TextInput
              style={styles.messageInput}
              value={msgText}
              onChangeText={setMsgText}
              placeholder="Ask a question..."
              placeholderTextColor="#94A3B8"
              multiline
            />
            <TouchableOpacity
              style={[styles.sendButton, (!msgText.trim() || msgSending) && styles.sendButtonDisabled]}
              onPress={handleSendMessage}
              disabled={!msgText.trim() || msgSending}
            >
              {msgSending ? (
                <ActivityIndicator size="small" color={COLORS.white} />
              ) : (
                <Text style={styles.sendButtonText}>Send</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Fixed bottom CTA */}
      {!booked && (
        <View style={styles.bottomCTA}>
          {isCredentialed ? (
            <TouchableOpacity style={styles.bookButton} onPress={handleBookPress} activeOpacity={0.85}>
              <Text style={styles.bookButtonText}>Book This Shift</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.applyButton} onPress={handleApplyPress} activeOpacity={0.85}>
              <Text style={styles.applyButtonText}>Apply & Get Credentialed</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {booked && (
        <View style={styles.bottomCTA}>
          <View style={styles.bookedConfirmBar}>
            <Text style={styles.bookedConfirmText}>✓ Shift Booked Successfully</Text>
          </View>
        </View>
      )}

      </KeyboardAvoidingView>

      <PinModal
        visible={pinModalVisible}
        onClose={() => setPinModalVisible(false)}
        onConfirm={handlePinConfirm}
        loading={pinLoading}
      />
    </SafeAreaView>
  );
}

function DetailRow({ icon, label, value }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailRowIcon}>{icon}</Text>
      <View style={styles.detailRowContent}>
        <Text style={styles.detailRowLabel}>{label}</Text>
        <Text style={styles.detailRowValue}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  centerLoader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    paddingVertical: 4,
  },
  backArrow: {
    fontSize: 20,
    color: COLORS.primary,
    marginRight: 6,
  },
  backText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
  },
  facilityPhoto: {
    width: '100%',
    height: 180,
    borderRadius: 16,
    backgroundColor: COLORS.primary + '15',
    marginBottom: 16,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  facilityPhotoInner: {
    width: 80,
    height: 80,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  facilityPhotoLetter: {
    fontSize: 40,
    fontWeight: '800',
    color: COLORS.white,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  surgeBadge: {
    backgroundColor: COLORS.surge + '20',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: COLORS.surge + '60',
  },
  surgeBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#B45309',
    letterSpacing: 0.5,
  },
  vipBadge: {
    backgroundColor: COLORS.vip + '18',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: COLORS.vip + '40',
  },
  vipBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: COLORS.vip,
    letterSpacing: 0.5,
  },
  bookedBadge: {
    backgroundColor: COLORS.success + '20',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: COLORS.success + '50',
  },
  bookedBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#065F46',
    letterSpacing: 0.5,
  },
  facilityName: {
    fontSize: 24,
    fontWeight: '800',
    color: COLORS.textDark,
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  specialtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
  },
  specialty: {
    fontSize: 15,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  detailRating: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  detailRatingStar: {
    fontSize: 14,
    color: '#F59E0B',
  },
  detailRatingValue: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textDark,
  },
  detailRatingCount: {
    fontSize: 13,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  vipCountdownBox: {
    backgroundColor: COLORS.vip + '12',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.vip + '30',
    alignItems: 'center',
  },
  vipCountdownLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.vip,
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  vipCountdownTime: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.vip,
    letterSpacing: -0.3,
  },
  payCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  payCardLeft: {
    flex: 1,
    alignItems: 'center',
  },
  payCardRight: {
    flex: 1,
    alignItems: 'center',
  },
  payCardDivider: {
    width: 1,
    height: 40,
    backgroundColor: COLORS.border,
    marginHorizontal: 4,
  },
  payCardLabel: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontWeight: '600',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  payCardRate: {
    fontSize: 26,
    fontWeight: '800',
    color: COLORS.primary,
    letterSpacing: -0.5,
  },
  payCardPer: {
    fontSize: 13,
    fontWeight: '400',
    color: COLORS.textMuted,
  },
  surgeRate: {
    color: COLORS.surge,
  },
  totalRate: {
    color: COLORS.success,
  },
  detailsCard: {
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
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.textDark,
    marginBottom: 14,
    letterSpacing: -0.2,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  detailRowIcon: {
    fontSize: 16,
    marginRight: 12,
    marginTop: 1,
  },
  detailRowContent: {
    flex: 1,
  },
  detailRowLabel: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  detailRowValue: {
    fontSize: 14,
    color: COLORS.textDark,
    fontWeight: '500',
    lineHeight: 20,
  },
  messagesCard: {
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
  noMessages: {
    fontSize: 13,
    color: COLORS.textMuted,
    fontStyle: 'italic',
    marginBottom: 12,
    lineHeight: 19,
  },
  msgErrorContainer: {
    alignItems: 'center',
    paddingVertical: 12,
    marginBottom: 8,
  },
  msgErrorText: {
    fontSize: 13,
    color: COLORS.error,
    marginBottom: 8,
  },
  retryButton: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
  },
  retryButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.primary,
  },
  bubble: {
    maxWidth: '80%',
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
  },
  bubbleMine: {
    alignSelf: 'flex-end',
    backgroundColor: COLORS.primary,
  },
  bubbleTheirs: {
    alignSelf: 'flex-start',
    backgroundColor: '#F1F5F9',
  },
  bubbleSender: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textMuted,
    marginBottom: 3,
  },
  bubbleText: {
    fontSize: 14,
    color: COLORS.textDark,
    lineHeight: 20,
  },
  bubbleTextMine: {
    color: COLORS.white,
  },
  bubbleTime: {
    fontSize: 10,
    color: COLORS.textMuted,
    marginTop: 4,
    textAlign: 'right',
  },
  bubbleTimeMine: {
    color: COLORS.white,
    opacity: 0.7,
  },
  messageInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    marginTop: 8,
  },
  messageInput: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: COLORS.textDark,
    backgroundColor: COLORS.background,
    maxHeight: 80,
  },
  sendButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  sendButtonText: {
    color: COLORS.white,
    fontWeight: '700',
    fontSize: 14,
  },
  bottomCTA: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: COLORS.card,
    paddingHorizontal: 20,
    paddingVertical: 16,
    paddingBottom: 28,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 6,
  },
  bookButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: 'center',
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  bookButtonText: {
    color: COLORS.white,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  applyButton: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.primary,
  },
  applyButtonText: {
    color: COLORS.primary,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  bookedConfirmBar: {
    backgroundColor: COLORS.success + '15',
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.success + '40',
  },
  bookedConfirmText: {
    color: '#065F46',
    fontSize: 16,
    fontWeight: '700',
  },
  // PIN Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 40,
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#CBD5E1',
    alignSelf: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.textDark,
    textAlign: 'center',
    marginBottom: 8,
  },
  modalSubtitle: {
    fontSize: 14,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginBottom: 24,
  },
  pinRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginBottom: 24,
  },
  pinBox: {
    width: 56,
    height: 56,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: COLORS.border,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinBoxFilled: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary + '10',
  },
  pinDot: {
    fontSize: 22,
    color: COLORS.primary,
  },
  numpad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 24,
  },
  numKey: {
    width: 76,
    height: 52,
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numKeyEmpty: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
  },
  numKeyText: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.textDark,
  },
  confirmButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: 'center',
    marginBottom: 10,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  confirmButtonDisabled: {
    opacity: 0.5,
  },
  confirmButtonText: {
    color: COLORS.white,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  cancelButton: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
});
