import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Image,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';

const COLORS = {
  // Dawn gradient stops (top → bottom)
  dawnTop: '#123B6B',
  dawnMid: '#2E6DA8',
  dawnLow: '#7FB4D8',
  dawnBottom: '#F4E4C8',
  // Brand + UI
  primary: '#2563EB',
  navy: '#12325B',
  white: '#FFFFFF',
  softBlueWhite: '#DCEAF7',
  legalMuted: '#3E5570',
};

// Time-of-day aware greeting from the device clock. No fake name.
function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning ☀️';
  if (hour < 17) return 'Good afternoon ☀️';
  return 'Good evening 🌙';
}

// The actual current weekday + date, e.g. "Tuesday, July 21".
function getTodayLabel() {
  const now = new Date();
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
  const monthDay = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  return `${weekday}, ${monthDay}`;
}

export default function WelcomeScreen({ navigation }) {
  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.dawnTop} />

      {/* Full-screen dawn gradient */}
      <LinearGradient
        colors={[COLORS.dawnTop, COLORS.dawnMid, COLORS.dawnLow, COLORS.dawnBottom]}
        locations={[0, 0.46, 0.78, 1]}
        style={StyleSheet.absoluteFill}
      />

      <SafeAreaView style={styles.safeArea}>
        {/* Brand row */}
        <View style={styles.brandRow}>
          <Image
            source={require('../../assets/snappy-mascot.png')}
            style={styles.logoMascot}
          />
          <Text style={styles.logoText}>SNAP</Text>
        </View>

        {/* Headline */}
        <View style={styles.headlineSection}>
          <Text style={styles.headline}>Work, without{'\n'}the busywork.</Text>
          <Text style={styles.subTagline}>
            Check your day, set your month, log your hours — done in a SNAP.
          </Text>
        </View>

        {/* Frosted-glass preview card */}
        <View style={styles.heroSection}>
          <View style={styles.previewCard}>
            <Text style={styles.previewGreeting}>{getGreeting()}</Text>
            <Text style={styles.previewDate}>{getTodayLabel()}</Text>
            <Text style={styles.previewShift}>Weymouth · Room 3 · 7:00 – 3:00</Text>

            <View style={styles.previewChip}>
              <Text style={styles.previewChipLabel}>Log yesterday's hours</Text>
              <Text style={styles.previewChipAction}>2 taps →</Text>
            </View>
          </View>
        </View>

        {/* CTAs */}
        <View style={styles.buttonSection}>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => navigation.navigate('Register')}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryButtonText}>Get started</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.ghostButton}
            onPress={() => navigation.navigate('Login')}
            activeOpacity={0.85}
          >
            <Text style={styles.ghostButtonText}>Sign in</Text>
          </TouchableOpacity>

          <Text style={styles.legalText}>
            By continuing you agree to SNAP's{' '}
            <Text
              style={styles.legalLink}
              onPress={() => Linking.openURL('https://api.snapmedical.app/terms')}
            >
              Terms
            </Text>
            {' '}&{' '}
            <Text
              style={styles.legalLink}
              onPress={() => Linking.openURL('https://api.snapmedical.app/privacy')}
            >
              Privacy Policy
            </Text>
          </Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.dawnTop,
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: 24,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
  },
  logoMascot: {
    width: 42,
    height: 48,
    resizeMode: 'contain',
    marginRight: 10,
  },
  logoText: {
    fontSize: 26,
    fontFamily: 'Nunito_800ExtraBold',
    color: COLORS.white,
    letterSpacing: 2,
  },
  headlineSection: {
    marginTop: 36,
  },
  headline: {
    fontSize: 30,
    fontFamily: 'Nunito_800ExtraBold',
    color: COLORS.white,
    letterSpacing: -0.5,
    lineHeight: 38,
    marginBottom: 12,
  },
  subTagline: {
    fontSize: 15,
    color: COLORS.softBlueWhite,
    lineHeight: 22,
  },
  heroSection: {
    flex: 1,
    justifyContent: 'center',
  },
  previewCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.4)',
    borderRadius: 18,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 14,
    elevation: 5,
  },
  previewGreeting: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.softBlueWhite,
    marginBottom: 6,
  },
  previewDate: {
    fontSize: 20,
    fontFamily: 'Nunito_700Bold',
    color: COLORS.white,
    letterSpacing: -0.3,
    marginBottom: 6,
  },
  previewShift: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.white,
    opacity: 0.9,
    marginBottom: 16,
  },
  previewChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.white,
    borderRadius: 999,
    paddingVertical: 11,
    paddingHorizontal: 16,
  },
  previewChipLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.navy,
  },
  previewChipAction: {
    fontSize: 13,
    fontWeight: '600',
    color: '#5B7CA6',
  },
  buttonSection: {
    paddingBottom: 16,
  },
  primaryButton: {
    backgroundColor: COLORS.navy,
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: 'center',
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 5,
  },
  primaryButtonText: {
    color: COLORS.white,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  ghostButton: {
    backgroundColor: 'transparent',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 18,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.75)',
  },
  ghostButtonText: {
    color: COLORS.white,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  legalText: {
    textAlign: 'center',
    fontSize: 12,
    color: COLORS.legalMuted,
    lineHeight: 18,
    fontWeight: '500',
  },
  legalLink: {
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
});
