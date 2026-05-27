import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  TextInput,
  Modal,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as Notifications from 'expo-notifications';
import { providerAPI } from '../api/client';

const COLORS = {
  primary: '#6366F1',
  background: '#FAFAFA',
  textDark: '#0F172A',
  textMuted: '#64748B',
  vip: '#7C3AED',
  success: '#10B981',
  card: '#FFFFFF',
  border: '#E2E8F0',
  error: '#EF4444',
  white: '#FFFFFF',
};

const VIP_THRESHOLD = 100;

function ProgressBar({ value, max, color }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: color }]} />
    </View>
  );
}

function InfoRow({ label, value }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value || '—'}</Text>
    </View>
  );
}

function EditProfileModal({ visible, provider, onClose, onSave }) {
  const [firstName, setFirstName] = useState(provider?.firstName || '');
  const [lastName, setLastName] = useState(provider?.lastName || '');
  const [city, setCity] = useState(provider?.city || '');
  const [personalStatement, setPersonalStatement] = useState(provider?.personalStatement || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible && provider) {
      setFirstName(provider.firstName || '');
      setLastName(provider.lastName || '');
      setCity(provider.city || '');
      setPersonalStatement(provider.personalStatement || '');
    }
  }, [visible, provider]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await providerAPI.updateMe({ firstName, lastName, city, personalStatement });
      onSave({ firstName, lastName, city, personalStatement });
      onClose();
    } catch (err) {
      Alert.alert('Error', err.response?.data?.message || 'Could not save changes.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>Edit Profile</Text>

          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={styles.rowFields}>
              <View style={[styles.fieldGroup, { flex: 1, marginRight: 8 }]}>
                <Text style={styles.fieldLabel}>First name</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={firstName}
                  onChangeText={setFirstName}
                  placeholder="First"
                  placeholderTextColor="#94A3B8"
                />
              </View>
              <View style={[styles.fieldGroup, { flex: 1 }]}>
                <Text style={styles.fieldLabel}>Last name</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={lastName}
                  onChangeText={setLastName}
                  placeholder="Last"
                  placeholderTextColor="#94A3B8"
                />
              </View>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>City / Town</Text>
              <TextInput
                style={styles.fieldInput}
                value={city}
                onChangeText={setCity}
                placeholder="Boston"
                placeholderTextColor="#94A3B8"
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Personal statement</Text>
              <TextInput
                style={[styles.fieldInput, styles.textArea]}
                value={personalStatement}
                onChangeText={setPersonalStatement}
                placeholder="Tell facilities about your experience and approach..."
                placeholderTextColor="#94A3B8"
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />
            </View>
          </ScrollView>

          <TouchableOpacity
            style={[styles.saveButton, saving && { opacity: 0.7 }]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving ? <ActivityIndicator color={COLORS.white} /> : (
              <Text style={styles.saveButtonText}>Save Changes</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// Placeholder provider for when API is unavailable
const PLACEHOLDER_PROVIDER = {
  firstName: 'Jane',
  lastName: 'Smith',
  specialty: 'CRNA',
  yearsExperience: 8,
  city: 'Boston',
  maLicenseNumber: 'RN-102345',
  maLicenseExpiry: '06/2026',
  personalStatement: 'Experienced CRNA with 8 years in high-volume ORs. Specializing in pediatric and cardiac cases. Reliable, team-oriented, and committed to patient safety.',
  profileCompletion: 85,
  vipStatus: true,
  vipPoints: 72,
  vipLog: [
    { description: 'Completed shift on time', points: 10, date: new Date(Date.now() - 86400000 * 3).toISOString() },
    { description: '5-star facility rating', points: 15, date: new Date(Date.now() - 86400000 * 7).toISOString() },
    { description: 'Booked within VIP window', points: 20, date: new Date(Date.now() - 86400000 * 10).toISOString() },
    { description: 'Profile completion bonus', points: 25, date: new Date(Date.now() - 86400000 * 14).toISOString() },
    { description: 'First shift booked', points: 2, date: new Date(Date.now() - 86400000 * 21).toISOString() },
  ],
};

export default function ProfileScreen({ navigation }) {
  const [provider, setProvider] = useState(null);
  const [vipData, setVipData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);

  useEffect(() => {
    loadProfile();
    registerPushToken();
  }, []);

  const loadProfile = async () => {
    try {
      const [profileRes, vipRes] = await Promise.all([
        providerAPI.getMe(),
        providerAPI.getVip(),
      ]);
      setProvider(profileRes.data);
      setVipData(vipRes.data);
    } catch {
      setProvider(PLACEHOLDER_PROVIDER);
      setVipData({
        vipStatus: PLACEHOLDER_PROVIDER.vipStatus,
        vipPoints: PLACEHOLDER_PROVIDER.vipPoints,
        vipLog: PLACEHOLDER_PROVIDER.vipLog,
      });
    } finally {
      setLoading(false);
    }
  };

  const registerPushToken = async () => {
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== 'granted') return;
      const tokenData = await Notifications.getExpoPushTokenAsync();
      const token = tokenData?.data;
      if (token) {
        await providerAPI.updateMe({ expoPushToken: token });
      }
    } catch {
      // push notifications not critical — silently skip if unavailable
    }
  };

  const handlePhotoPress = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Please allow photo access to upload a profile photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return;

    setPhotoUploading(true);
    try {
      const res = await providerAPI.uploadPhoto(result.assets[0].uri);
      setProvider((prev) => ({ ...prev, photoUrl: res.data.url }));
    } catch (err) {
      Alert.alert('Upload Failed', err?.response?.data?.error || 'Could not upload photo. Try again.');
    } finally {
      setPhotoUploading(false);
    }
  };

  const handleLogout = async () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await AsyncStorage.removeItem('snapToken');
          navigation.reset({ index: 0, routes: [{ name: 'Welcome' }] });
        },
      },
    ]);
  };

  const handleProfileSaved = (updates) => {
    setProvider((prev) => ({ ...prev, ...updates }));
  };

  if (loading) {
    return (
      <View style={styles.centerLoader}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  const displayVip = vipData || provider;
  const points = displayVip?.vipPoints || 0;
  const isVip = displayVip?.vipStatus || false;
  const completion = provider?.profileCompletion || 0;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>My Profile</Text>
          <TouchableOpacity onPress={handleLogout}>
            <Text style={styles.logoutText}>Sign Out</Text>
          </TouchableOpacity>
        </View>

        {/* Avatar + name card */}
        <View style={styles.heroCard}>
          <TouchableOpacity style={styles.avatarRing} onPress={handlePhotoPress} disabled={photoUploading}>
            {photoUploading ? (
              <View style={styles.avatar}>
                <ActivityIndicator color={COLORS.white} />
              </View>
            ) : provider?.photoUrl ? (
              <Image source={{ uri: provider.photoUrl }} style={styles.avatarImage} />
            ) : (
              <View style={styles.avatar}>
                <Text style={styles.avatarInitials}>
                  {(provider?.firstName || 'J').charAt(0).toUpperCase()}
                  {(provider?.lastName || 'S').charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
            <View style={styles.cameraOverlay}>
              <Text style={styles.cameraIcon}>📷</Text>
            </View>
          </TouchableOpacity>
          <View style={styles.heroInfo}>
            <View style={styles.nameRow}>
              <Text style={styles.providerName}>
                {provider?.firstName} {provider?.lastName}
              </Text>
              {isVip && (
                <View style={styles.vipBadge}>
                  <Text style={styles.vipBadgeText}>★ VIP</Text>
                </View>
              )}
            </View>
            <Text style={styles.specialty}>{provider?.specialty}</Text>
            <Text style={styles.subInfo}>
              {provider?.city} · {provider?.yearsExperience} yrs experience
            </Text>
          </View>
          <TouchableOpacity
            style={styles.editButton}
            onPress={() => setEditModalVisible(true)}
          >
            <Text style={styles.editButtonText}>Edit</Text>
          </TouchableOpacity>
        </View>

        {/* Profile completion */}
        <View style={styles.sectionCard}>
          <View style={styles.completionHeader}>
            <Text style={styles.sectionTitle}>Profile Completion</Text>
            <Text style={styles.completionPct}>{completion}%</Text>
          </View>
          <ProgressBar value={completion} max={100} color={COLORS.primary} />
          {completion < 100 && (
            <Text style={styles.completionHint}>
              Complete your profile to unlock more opportunities from facilities.
            </Text>
          )}
        </View>

        {/* License info */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Massachusetts License</Text>
          <InfoRow label="License / Cert #" value={provider?.maLicenseNumber} />
          <InfoRow label="Expiry" value={provider?.maLicenseExpiry} />
          <View style={styles.verifiedRow}>
            <View style={styles.verifiedDot} />
            <Text style={styles.verifiedText}>MA License Acknowledged</Text>
          </View>
        </View>

        {/* Personal statement */}
        {provider?.personalStatement ? (
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Personal Statement</Text>
            <Text style={styles.statementText}>{provider.personalStatement}</Text>
          </View>
        ) : null}

        {/* VIP section */}
        <View style={[styles.sectionCard, styles.vipCard]}>
          <View style={styles.vipHeader}>
            <View>
              <Text style={styles.vipTitle}>★ VIP Status</Text>
              <Text style={styles.vipSubtitle}>
                {isVip ? 'You have VIP status — enjoy early shift access!' : `Earn ${VIP_THRESHOLD - points} more points to unlock VIP`}
              </Text>
            </View>
            <View style={styles.vipPointsBadge}>
              <Text style={styles.vipPointsNumber}>{points}</Text>
              <Text style={styles.vipPointsLabel}>pts</Text>
            </View>
          </View>

          <View style={styles.vipProgressRow}>
            <ProgressBar value={points} max={VIP_THRESHOLD} color={COLORS.vip} />
            <Text style={styles.vipProgressLabel}>{points} / {VIP_THRESHOLD} pts to VIP</Text>
          </View>

          {/* VIP point log */}
          {(displayVip?.vipLog || []).length > 0 && (
            <View style={styles.vipLog}>
              <Text style={styles.vipLogTitle}>Recent Points</Text>
              {(displayVip.vipLog || []).slice(0, 5).map((entry, idx) => (
                <View key={idx} style={styles.vipLogRow}>
                  <Text style={styles.vipLogDesc}>{entry.description}</Text>
                  <Text style={styles.vipLogPoints}>+{entry.points}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>

      <EditProfileModal
        visible={editModalVisible}
        provider={provider}
        onClose={() => setEditModalVisible(false)}
        onSave={handleProfileSaved}
      />
    </SafeAreaView>
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
    paddingTop: 0,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
  logoutText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.error,
  },
  heroCard: {
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
  avatarRing: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    borderColor: COLORS.primary + '40',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
    position: 'relative',
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  avatarInitials: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.white,
    letterSpacing: 0.5,
  },
  cameraOverlay: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: COLORS.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cameraIcon: {
    fontSize: 10,
  },
  heroInfo: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 3,
  },
  providerName: {
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.textDark,
    letterSpacing: -0.2,
  },
  vipBadge: {
    backgroundColor: COLORS.vip + '18',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: COLORS.vip + '40',
  },
  vipBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.vip,
    letterSpacing: 0.3,
  },
  specialty: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.primary,
    marginBottom: 2,
  },
  subInfo: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  editButton: {
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  editButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.primary,
  },
  sectionCard: {
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
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textDark,
    marginBottom: 12,
    letterSpacing: -0.2,
  },
  completionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  completionPct: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.primary,
    letterSpacing: -0.5,
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#F1F5F9',
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  completionHint: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 4,
    lineHeight: 17,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F8FAFC',
  },
  infoLabel: {
    fontSize: 13,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  infoValue: {
    fontSize: 13,
    color: COLORS.textDark,
    fontWeight: '600',
  },
  verifiedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
  },
  verifiedDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.success,
    marginRight: 8,
  },
  verifiedText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.success,
  },
  statementText: {
    fontSize: 14,
    color: COLORS.textDark,
    lineHeight: 21,
  },
  vipCard: {
    borderColor: COLORS.vip + '30',
    borderWidth: 1.5,
  },
  vipHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  vipTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.vip,
    marginBottom: 4,
    letterSpacing: -0.2,
  },
  vipSubtitle: {
    fontSize: 12,
    color: COLORS.textMuted,
    lineHeight: 17,
    maxWidth: 220,
  },
  vipPointsBadge: {
    backgroundColor: COLORS.vip + '15',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.vip + '30',
  },
  vipPointsNumber: {
    fontSize: 24,
    fontWeight: '800',
    color: COLORS.vip,
    letterSpacing: -0.5,
  },
  vipPointsLabel: {
    fontSize: 10,
    color: COLORS.vip,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  vipProgressRow: {
    marginBottom: 16,
  },
  vipProgressLabel: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 6,
    fontWeight: '500',
  },
  vipLog: {
    borderTopWidth: 1,
    borderTopColor: COLORS.vip + '20',
    paddingTop: 12,
  },
  vipLogTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textMuted,
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  vipLogRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: '#F8FAFC',
  },
  vipLogDesc: {
    fontSize: 13,
    color: COLORS.textDark,
    flex: 1,
  },
  vipLogPoints: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.vip,
    marginLeft: 8,
  },
  // Modal
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
    maxHeight: '85%',
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
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.textDark,
    marginBottom: 20,
  },
  rowFields: {
    flexDirection: 'row',
  },
  fieldGroup: {
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textDark,
    marginBottom: 8,
  },
  fieldInput: {
    backgroundColor: COLORS.background,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 14,
    color: COLORS.textDark,
  },
  textArea: {
    height: 100,
    paddingTop: 13,
  },
  saveButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 10,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  saveButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '700',
  },
  cancelButton: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 15,
    color: COLORS.textMuted,
    fontWeight: '600',
  },
});
