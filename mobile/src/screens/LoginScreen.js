import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import * as AppleAuthentication from 'expo-apple-authentication';
import { authAPI } from '../api/client';
import {
  GOOGLE_IOS_CLIENT_ID,
  GOOGLE_ANDROID_CLIENT_ID,
  GOOGLE_WEB_CLIENT_ID,
  GOOGLE_ENABLED,
  APPLE_ENABLED,
} from '../config/oauth';

// Required for the web-based Google auth flow to dismiss the browser session.
WebBrowser.maybeCompleteAuthSession();

const COLORS = {
  primary: '#2563EB',
  primaryDark: '#1D4ED8',
  background: '#FAFAFA',
  textDark: '#0F172A',
  textMuted: '#64748B',
  card: '#FFFFFF',
  white: '#FFFFFF',
  border: '#E2E8F0',
  error: '#EF4444',
};

// Google sign-in button. ISOLATED in its own component so the
// expo-auth-session hook (which throws on an empty client ID) only ever runs
// when real client IDs are configured — the parent renders this only when
// GOOGLE_ENABLED. Calls onToken(idToken) on success.
function GoogleSignInButton({ onToken, disabled }) {
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    iosClientId: GOOGLE_IOS_CLIENT_ID || undefined,
    androidClientId: GOOGLE_ANDROID_CLIENT_ID || undefined,
    webClientId: GOOGLE_WEB_CLIENT_ID || undefined,
  });

  useEffect(() => {
    if (response?.type === 'success') {
      const idToken = response.params?.id_token || response.authentication?.idToken;
      if (idToken) onToken(idToken);
      else Alert.alert('Sign In Failed', 'Google did not return an identity token. Please try again.');
    } else if (response?.type === 'error') {
      Alert.alert('Sign In Failed', 'Google sign-in could not be completed.');
    }
  }, [response]);

  return (
    <TouchableOpacity
      style={styles.socialButton}
      onPress={() => promptAsync()}
      disabled={disabled || !request}
      activeOpacity={0.75}
    >
      <Text style={styles.socialIcon}>G</Text>
      <Text style={styles.socialButtonText}>Continue with Google</Text>
    </TouchableOpacity>
  );
}

export default function LoginScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [errors, setErrors] = useState({});

  // NOTE: Google sign-in is intentionally NOT wired up here. expo-auth-session's
  // useIdTokenAuthRequest hook THROWS during render when no client ID is set,
  // which crashes the login screen on launch. So the hook lives in the
  // <GoogleSignInButton> child component below, which is only rendered when
  // GOOGLE_ENABLED (real client IDs configured). Until then we show a plain
  // "coming soon" button with no hook.

  const validate = () => {
    const newErrors = {};
    if (!email.trim()) newErrors.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(email)) newErrors.email = 'Enter a valid email';
    if (!password) newErrors.password = 'Password is required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleLogin = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      const response = await authAPI.providerLogin({ email: email.trim().toLowerCase(), password });
      const { token } = response.data;
      await AsyncStorage.setItem('snapToken', token);
      // Navigate to main tabs — replace auth stack
      navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
    } catch (err) {
      const msg =
        err.response?.data?.message ||
        err.response?.data?.error ||
        'Login failed. Please check your credentials.';
      Alert.alert('Sign In Failed', msg);
    } finally {
      setLoading(false);
    }
  };

  const handleSocialComingSoon = (provider) => {
    Alert.alert('Coming Soon', `${provider} sign-in will be available in a future update.`);
  };

  // Shared post-login handling — mirrors handleLogin: persist the token under
  // the same AsyncStorage key and reset to the Main stack.
  const completeOAuthLogin = async (token) => {
    await AsyncStorage.setItem('snapToken', token);
    navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
  };

  // Backend-error → user-facing message, with a graceful note when sign-in
  // isn't configured yet (503 from the scaffolded endpoints).
  const oauthErrorMessage = (err, provider) => {
    if (err.response?.status === 503) {
      return `${provider} sign-in isn't available yet. Please sign in with email.`;
    }
    return (
      err.response?.data?.error ||
      err.response?.data?.message ||
      `${provider} sign-in failed. Please try again or use email.`
    );
  };

  const exchangeGoogleToken = async (idToken) => {
    try {
      const response = await authAPI.oauthGoogle(idToken);
      await completeOAuthLogin(response.data.token);
    } catch (err) {
      Alert.alert('Sign In Failed', oauthErrorMessage(err, 'Google'));
    } finally {
      setOauthLoading(false);
    }
  };

  const handleAppleSignIn = async () => {
    if (!APPLE_ENABLED) {
      handleSocialComingSoon('Apple');
      return;
    }
    setOauthLoading(true);
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      const identityToken = credential.identityToken;
      if (!identityToken) {
        Alert.alert('Sign In Failed', 'Apple did not return an identity token. Please try again.');
        return;
      }

      // fullName is only present on the FIRST authorization. Pass Apple's shape
      // through so the backend can seed first/last name on account creation.
      const fullName = credential.fullName
        ? {
            givenName: credential.fullName.givenName || undefined,
            familyName: credential.fullName.familyName || undefined,
          }
        : undefined;

      const response = await authAPI.oauthApple(identityToken, fullName);
      await completeOAuthLogin(response.data.token);
    } catch (err) {
      // User-cancelled the native sheet — stay silent.
      if (err.code === 'ERR_REQUEST_CANCELED' || err.code === 'ERR_CANCELED') {
        return;
      }
      Alert.alert('Sign In Failed', oauthErrorMessage(err, 'Apple'));
    } finally {
      setOauthLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
            <Text style={styles.backArrow}>←</Text>
          </TouchableOpacity>

          <View style={styles.header}>
            <View style={styles.logoMini}>
              <Text style={styles.logoMiniText}>S</Text>
            </View>
            <Text style={styles.title}>Welcome back</Text>
            <Text style={styles.subtitle}>Sign in to your SNAP account</Text>
          </View>

          {/* Social Buttons */}
          <View style={styles.socialSection}>
            {GOOGLE_ENABLED ? (
              <GoogleSignInButton onToken={exchangeGoogleToken} disabled={oauthLoading} />
            ) : (
              <TouchableOpacity
                style={styles.socialButton}
                onPress={() => handleSocialComingSoon('Google')}
                disabled={oauthLoading}
                activeOpacity={0.75}
              >
                <Text style={styles.socialIcon}>G</Text>
                <Text style={styles.socialButtonText}>Continue with Google</Text>
                <View style={styles.comingSoonBadge}>
                  <Text style={styles.comingSoonText}>Soon</Text>
                </View>
              </TouchableOpacity>
            )}

            {Platform.OS === 'ios' && (
              <TouchableOpacity
                style={styles.socialButton}
                onPress={handleAppleSignIn}
                disabled={oauthLoading}
                activeOpacity={0.75}
              >
                <Text style={styles.socialIconApple}></Text>
                <Text style={styles.socialButtonText}>Continue with Apple</Text>
                {!APPLE_ENABLED && (
                  <View style={styles.comingSoonBadge}>
                    <Text style={styles.comingSoonText}>Soon</Text>
                  </View>
                )}
              </TouchableOpacity>
            )}
          </View>

          {/* Divider */}
          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or sign in with email</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* Form */}
          <View style={styles.form}>
            {/* Email */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Email address</Text>
              <TextInput
                style={[styles.input, errors.email && styles.inputError]}
                value={email}
                onChangeText={(v) => { setEmail(v); setErrors((e) => ({ ...e, email: null })); }}
                placeholder="you@example.com"
                placeholderTextColor="#94A3B8"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
              {errors.email && <Text style={styles.errorText}>{errors.email}</Text>}
            </View>

            {/* Password */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Password</Text>
              <View style={styles.passwordRow}>
                <TextInput
                  style={[styles.input, styles.passwordInput, errors.password && styles.inputError]}
                  value={password}
                  onChangeText={(v) => { setPassword(v); setErrors((e) => ({ ...e, password: null })); }}
                  placeholder="••••••••"
                  placeholderTextColor="#94A3B8"
                  secureTextEntry={!showPassword}
                />
                <TouchableOpacity
                  style={styles.showPasswordButton}
                  onPress={() => setShowPassword(!showPassword)}
                >
                  <Text style={styles.showPasswordText}>{showPassword ? 'Hide' : 'Show'}</Text>
                </TouchableOpacity>
              </View>
              {errors.password && <Text style={styles.errorText}>{errors.password}</Text>}
            </View>

            <TouchableOpacity
              style={styles.forgotLink}
              onPress={() => navigation.navigate('ForgotPassword')}
            >
              <Text style={styles.forgotText}>Forgot password?</Text>
            </TouchableOpacity>
          </View>

          {/* Submit */}
          <TouchableOpacity
            style={[styles.submitButton, loading && styles.submitButtonDisabled]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color={COLORS.white} />
            ) : (
              <Text style={styles.submitButtonText}>Sign In</Text>
            )}
          </TouchableOpacity>

          {/* Register link */}
          <View style={styles.registerRow}>
            <Text style={styles.registerText}>Don't have an account? </Text>
            <TouchableOpacity onPress={() => navigation.navigate('Register')}>
              <Text style={styles.registerLink}>Get Started</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  backButton: {
    marginTop: 8,
    marginBottom: 8,
    width: 40,
    height: 40,
    justifyContent: 'center',
  },
  backArrow: {
    fontSize: 24,
    color: COLORS.textDark,
  },
  header: {
    alignItems: 'center',
    marginBottom: 28,
  },
  logoMini: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  logoMiniText: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.white,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: COLORS.textDark,
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textMuted,
  },
  socialSection: {
    gap: 10,
    marginBottom: 24,
  },
  socialButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  socialIcon: {
    fontSize: 16,
    fontWeight: '700',
    color: '#EA4335',
    marginRight: 12,
    width: 20,
    textAlign: 'center',
  },
  socialIconApple: {
    fontSize: 16,
    color: COLORS.textDark,
    marginRight: 12,
    width: 20,
    textAlign: 'center',
  },
  socialButtonText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.textDark,
  },
  comingSoonBadge: {
    backgroundColor: '#F1F5F9',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  comingSoonText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: 0.3,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: COLORS.border,
  },
  dividerText: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginHorizontal: 12,
  },
  form: {
    marginBottom: 8,
  },
  fieldGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textDark,
    marginBottom: 8,
  },
  input: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    color: COLORS.textDark,
  },
  inputError: {
    borderColor: COLORS.error,
  },
  passwordRow: {
    position: 'relative',
  },
  passwordInput: {
    paddingRight: 60,
  },
  showPasswordButton: {
    position: 'absolute',
    right: 14,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  showPasswordText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.primary,
  },
  errorText: {
    fontSize: 12,
    color: COLORS.error,
    marginTop: 6,
  },
  forgotLink: {
    alignSelf: 'flex-end',
    marginTop: 4,
  },
  forgotText: {
    fontSize: 13,
    color: COLORS.primary,
    fontWeight: '600',
  },
  submitButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 20,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  submitButtonDisabled: {
    opacity: 0.7,
  },
  submitButtonText: {
    color: COLORS.white,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  registerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  registerText: {
    fontSize: 14,
    color: COLORS.textMuted,
  },
  registerLink: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.primary,
  },
});
