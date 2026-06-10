import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const { width, height } = Dimensions.get('window');

const COLORS = {
  primary: '#2563EB',
  primaryDark: '#1D4ED8',
  background: '#FAFAFA',
  textDark: '#0F172A',
  textMuted: '#64748B',
  card: '#FFFFFF',
  white: '#FFFFFF',
};

export default function WelcomeScreen({ navigation }) {
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />

      {/* Background accent circles */}
      <View style={styles.circleTopRight} />
      <View style={styles.circleBottomLeft} />

      {/* Logo / Brand area */}
      <View style={styles.heroSection}>
        <View style={styles.logoContainer}>
          <View style={styles.logoBox}>
            <Text style={styles.logoLetter}>S</Text>
          </View>
          <Text style={styles.logoText}>SNAP</Text>
        </View>

        <Text style={styles.tagline}>Find your next shift{'\n'}in a SNAP</Text>

        <Text style={styles.subTagline}>
          The fastest way for anesthesia providers{'\n'}to find and book shifts in Massachusetts
        </Text>

        {/* Feature pills */}
        <View style={styles.pillRow}>
          <View style={styles.pill}>
            <Text style={styles.pillText}>CRNAs</Text>
          </View>
          <View style={styles.pill}>
            <Text style={styles.pillText}>Anesthesiologists</Text>
          </View>
          <View style={styles.pill}>
            <Text style={styles.pillText}>AAs</Text>
          </View>
        </View>
      </View>

      {/* Stats row */}
      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <Text style={styles.statNumber}>500+</Text>
          <Text style={styles.statLabel}>Shifts Posted</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statNumber}>$185</Text>
          <Text style={styles.statLabel}>Avg. Hourly Rate</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statNumber}>48h</Text>
          <Text style={styles.statLabel}>Avg. Booking Time</Text>
        </View>
      </View>

      {/* CTA Buttons */}
      <View style={styles.buttonSection}>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => navigation.navigate('Register')}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryButtonText}>Get Started</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => navigation.navigate('Login')}
          activeOpacity={0.85}
        >
          <Text style={styles.secondaryButtonText}>Sign In</Text>
        </TouchableOpacity>

        <Text style={styles.legalText}>
          By continuing, you agree to SNAP's{' '}
          <Text style={styles.linkText}>Terms of Service</Text> and{' '}
          <Text style={styles.linkText}>Privacy Policy</Text>
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    paddingHorizontal: 24,
  },
  circleTopRight: {
    position: 'absolute',
    top: -80,
    right: -80,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: COLORS.primary,
    opacity: 0.08,
  },
  circleBottomLeft: {
    position: 'absolute',
    bottom: -60,
    left: -60,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: COLORS.primary,
    opacity: 0.06,
  },
  heroSection: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 40,
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 32,
  },
  logoBox: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  logoLetter: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.white,
    letterSpacing: -1,
  },
  logoText: {
    fontSize: 36,
    fontWeight: '800',
    color: COLORS.textDark,
    letterSpacing: 2,
  },
  tagline: {
    fontSize: 32,
    fontWeight: '800',
    color: COLORS.textDark,
    textAlign: 'center',
    lineHeight: 40,
    marginBottom: 16,
    letterSpacing: -0.5,
  },
  subTagline: {
    fontSize: 15,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },
  pillRow: {
    flexDirection: 'row',
    gap: 10,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: COLORS.primary + '15',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.primary + '30',
  },
  pillText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.primary,
  },
  statsRow: {
    flexDirection: 'row',
    backgroundColor: COLORS.card,
    borderRadius: 16,
    paddingVertical: 20,
    paddingHorizontal: 12,
    marginBottom: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.primary,
    letterSpacing: -0.5,
  },
  statLabel: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 3,
    fontWeight: '500',
    textAlign: 'center',
  },
  statDivider: {
    width: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: 4,
  },
  buttonSection: {
    paddingBottom: 16,
  },
  primaryButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: 'center',
    marginBottom: 12,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  primaryButtonText: {
    color: COLORS.white,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
  },
  secondaryButtonText: {
    color: COLORS.primary,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  legalText: {
    textAlign: 'center',
    fontSize: 12,
    color: COLORS.textMuted,
    lineHeight: 18,
  },
  linkText: {
    color: COLORS.primary,
    fontWeight: '600',
  },
});
