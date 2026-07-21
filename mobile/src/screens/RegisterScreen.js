import React, { useState } from 'react';
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
import { authAPI, providerAPI } from '../api/client';

const COLORS = {
  primary: '#2563EB',
  navy: '#12325B',
  background: '#FAFAFA',
  textDark: '#0F172A',
  textMuted: '#64748B',
  card: '#FFFFFF',
  white: '#FFFFFF',
  border: '#E2E8F0',
  error: '#EF4444',
  success: '#10B981',
};

const SPECIALTIES = [
  { label: 'CRNA', value: 'CRNA' },
  { label: 'Anesthesiologist', value: 'ANESTHESIOLOGIST' },
  { label: 'Anesthesia Assistant (AA)', value: 'ANESTHESIA_ASSISTANT' },
];

const STEPS = ['Account', 'Personal', 'License', 'PIN'];

function StepIndicator({ currentStep }) {
  return (
    <View style={styles.stepRow}>
      {STEPS.map((label, index) => {
        const done = index < currentStep;
        const active = index === currentStep;
        return (
          <React.Fragment key={label}>
            <View style={styles.stepItem}>
              <View
                style={[
                  styles.stepCircle,
                  active && styles.stepCircleActive,
                  done && styles.stepCircleDone,
                ]}
              >
                {done ? (
                  <Text style={styles.stepCheckmark}>✓</Text>
                ) : (
                  <Text style={[styles.stepNumber, active && styles.stepNumberActive]}>
                    {index + 1}
                  </Text>
                )}
              </View>
              <Text style={[styles.stepLabel, active && styles.stepLabelActive]}>{label}</Text>
            </View>
            {index < STEPS.length - 1 && (
              <View style={[styles.stepConnector, done && styles.stepConnectorDone]} />
            )}
          </React.Fragment>
        );
      })}
    </View>
  );
}

function PinInput({ value, onChange, label }) {
  const digits = (value + '    ').slice(0, 4).split('');
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.pinRow}>
        {digits.map((d, i) => (
          <View key={i} style={[styles.pinBox, value.length > i && styles.pinBoxFilled]}>
            <Text style={styles.pinDot}>{value.length > i ? '●' : ''}</Text>
          </View>
        ))}
      </View>
      <View style={styles.numpad}>
        {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((key, idx) => (
          <TouchableOpacity
            key={idx}
            style={[styles.numKey, key === '' && styles.numKeyEmpty]}
            disabled={key === ''}
            onPress={() => {
              if (key === '⌫') {
                onChange(value.slice(0, -1));
              } else if (value.length < 4) {
                onChange(value + key);
              }
            }}
          >
            <Text style={styles.numKeyText}>{key}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

export default function RegisterScreen({ navigation }) {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});

  // Step 0 — Account
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Step 1 — Personal
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [yearsExperience, setYearsExperience] = useState('');
  const [zipCode, setZipCode] = useState('');

  // Step 2 — License
  const [maLicenseNumber, setMaLicenseNumber] = useState('');
  const [maLicenseExpiry, setMaLicenseExpiry] = useState('');
  const [maLicenseAcknowledged, setMaLicenseAcknowledged] = useState(false);
  const [npiNumber, setNpiNumber] = useState('');
  const [npiMatches, setNpiMatches] = useState(null);
  const [npiLoading, setNpiLoading] = useState(false);

  // NPI is the key that links this account to practice rosters and the
  // credentialing passport — look it up in the public NPPES registry using
  // the name entered on the previous step.
  const findMyNpi = async () => {
    setNpiLoading(true);
    setNpiMatches(null);
    try {
      const res = await providerAPI.npiLookup({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        state: 'MA',
      });
      setNpiMatches(res.data?.matches || []);
    } catch {
      setNpiMatches([]);
    } finally {
      setNpiLoading(false);
    }
  };

  // Step 3 — PIN
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [pinStage, setPinStage] = useState('create'); // 'create' | 'confirm'

  const setError = (field, msg) => setErrors((e) => ({ ...e, [field]: msg }));
  const clearError = (field) => setErrors((e) => ({ ...e, [field]: null }));

  const validateStep0 = () => {
    const e = {};
    if (!email.trim()) e.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(email)) e.email = 'Enter a valid email';
    if (!password) e.password = 'Password is required';
    else if (password.length < 8) e.password = 'Password must be at least 8 characters';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const validateStep1 = () => {
    const e = {};
    if (!firstName.trim()) e.firstName = 'First name is required';
    if (!lastName.trim()) e.lastName = 'Last name is required';
    if (!specialty) e.specialty = 'Please select a specialty';
    if (!yearsExperience || isNaN(Number(yearsExperience))) e.yearsExperience = 'Enter valid years';
    if (!zipCode.trim()) e.zipCode = 'Zip code is required';
    else if (!/^\d{5}$/.test(zipCode.trim())) e.zipCode = 'Enter a 5-digit zip code';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const validateStep2 = () => {
    const e = {};
    // License number + expiry are optional at signup — providers can add them
    // later in their profile / when credentialing. Only validate expiry format
    // if they chose to enter it. The MA-license acknowledgment is still required.
    if (maLicenseExpiry.trim() && !/^\d{2}\/\d{4}$/.test(maLicenseExpiry)) e.maLicenseExpiry = 'Format: MM/YYYY';
    if (!maLicenseAcknowledged) e.maLicenseAcknowledged = 'You must confirm your license';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleNext = () => {
    if (step === 0 && !validateStep0()) return;
    if (step === 1 && !validateStep1()) return;
    if (step === 2 && !validateStep2()) return;
    setStep((s) => s + 1);
  };

  const handleRegister = async () => {
    if (pin.length < 4) {
      Alert.alert('PIN Required', 'Please enter a 4-digit PIN.');
      return;
    }
    if (pinStage === 'create') {
      setPinStage('confirm');
      setPinConfirm('');
      return;
    }
    if (pin !== pinConfirm) {
      Alert.alert('PIN Mismatch', 'Your PINs do not match. Please try again.');
      setPinStage('create');
      setPin('');
      setPinConfirm('');
      return;
    }

    setLoading(true);
    try {
      const payload = {
        email: email.trim().toLowerCase(),
        password,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        specialty,
        yearsExperience: Number(yearsExperience),
        zipCode: zipCode.trim(),
        maLicenseNumber: maLicenseNumber.trim(),
        maLicenseExpiry,
        maLicenseAcknowledged,
        pin,
        npiNumber: npiNumber.trim() || undefined,
      };
      const response = await authAPI.providerRegister(payload);
      const { token } = response.data;
      await AsyncStorage.setItem('snapToken', token);
      navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
    } catch (err) {
      const msg =
        err.response?.data?.message ||
        err.response?.data?.error ||
        'Registration failed. Please try again.';
      Alert.alert('Registration Failed', msg);
    } finally {
      setLoading(false);
    }
  };

  const renderStep0 = () => (
    <View>
      <Text style={styles.stepTitle}>Create your account</Text>
      <Text style={styles.stepSubtitle}>Enter your email and choose a secure password</Text>

      <View style={styles.fieldGroup}>
        <Text style={styles.label}>Email address</Text>
        <TextInput
          style={[styles.input, errors.email && styles.inputError]}
          value={email}
          onChangeText={(v) => { setEmail(v); clearError('email'); }}
          placeholder="you@example.com"
          placeholderTextColor="#94A3B8"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
        />
        {errors.email && <Text style={styles.errorText}>{errors.email}</Text>}
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.label}>Password</Text>
        <View style={styles.passwordRow}>
          <TextInput
            style={[styles.input, styles.passwordInput, errors.password && styles.inputError]}
            value={password}
            onChangeText={(v) => { setPassword(v); clearError('password'); }}
            placeholder="Min. 8 characters"
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
    </View>
  );

  const renderStep1 = () => (
    <View>
      <Text style={styles.stepTitle}>Your professional profile</Text>
      <Text style={styles.stepSubtitle}>Tell facilities who you are</Text>

      <View style={styles.rowFields}>
        <View style={[styles.fieldGroup, { flex: 1, marginRight: 8 }]}>
          <Text style={styles.label}>First name</Text>
          <TextInput
            style={[styles.input, errors.firstName && styles.inputError]}
            value={firstName}
            onChangeText={(v) => { setFirstName(v); clearError('firstName'); }}
            placeholder="Jane"
            placeholderTextColor="#94A3B8"
            autoCapitalize="words"
          />
          {errors.firstName && <Text style={styles.errorText}>{errors.firstName}</Text>}
        </View>
        <View style={[styles.fieldGroup, { flex: 1 }]}>
          <Text style={styles.label}>Last name</Text>
          <TextInput
            style={[styles.input, errors.lastName && styles.inputError]}
            value={lastName}
            onChangeText={(v) => { setLastName(v); clearError('lastName'); }}
            placeholder="Smith"
            placeholderTextColor="#94A3B8"
            autoCapitalize="words"
          />
          {errors.lastName && <Text style={styles.errorText}>{errors.lastName}</Text>}
        </View>
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.label}>Specialty</Text>
        <View style={styles.pickerContainer}>
          {SPECIALTIES.map((s) => (
            <TouchableOpacity
              key={s.value}
              style={[styles.pickerOption, specialty === s.value && styles.pickerOptionSelected]}
              onPress={() => { setSpecialty(s.value); clearError('specialty'); }}
            >
              <Text
                style={[
                  styles.pickerOptionText,
                  specialty === s.value && styles.pickerOptionTextSelected,
                ]}
              >
                {s.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        {errors.specialty && <Text style={styles.errorText}>{errors.specialty}</Text>}
      </View>

      <View style={styles.rowFields}>
        <View style={[styles.fieldGroup, { flex: 1, marginRight: 8 }]}>
          <Text style={styles.label}>Years of experience</Text>
          <TextInput
            style={[styles.input, errors.yearsExperience && styles.inputError]}
            value={yearsExperience}
            onChangeText={(v) => { setYearsExperience(v); clearError('yearsExperience'); }}
            placeholder="5"
            placeholderTextColor="#94A3B8"
            keyboardType="number-pad"
          />
          {errors.yearsExperience && (
            <Text style={styles.errorText}>{errors.yearsExperience}</Text>
          )}
        </View>
        <View style={[styles.fieldGroup, { flex: 1 }]}>
          <Text style={styles.label}>Zip code</Text>
          <TextInput
            style={[styles.input, errors.zipCode && styles.inputError]}
            value={zipCode}
            onChangeText={(v) => { setZipCode(v.replace(/\D/g, '').slice(0, 5)); clearError('zipCode'); }}
            placeholder="02101"
            placeholderTextColor="#94A3B8"
            keyboardType="number-pad"
            maxLength={5}
          />
          {errors.zipCode && <Text style={styles.errorText}>{errors.zipCode}</Text>}
        </View>
      </View>
    </View>
  );

  const renderStep2 = () => (
    <View>
      <Text style={styles.stepTitle}>Massachusetts license</Text>
      <Text style={styles.stepSubtitle}>All providers must hold a valid MA license</Text>

      <View style={styles.fieldGroup}>
        <Text style={styles.label}>MA License / CRNA Cert Number (optional)</Text>
        <TextInput
          style={[styles.input, errors.maLicenseNumber && styles.inputError]}
          value={maLicenseNumber}
          onChangeText={(v) => { setMaLicenseNumber(v); clearError('maLicenseNumber'); }}
          placeholder="e.g. RN-123456 or MD-789012"
          placeholderTextColor="#94A3B8"
          autoCapitalize="characters"
        />
        {errors.maLicenseNumber && (
          <Text style={styles.errorText}>{errors.maLicenseNumber}</Text>
        )}
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.label}>Expiration date (optional)</Text>
        <TextInput
          style={[styles.input, errors.maLicenseExpiry && styles.inputError]}
          value={maLicenseExpiry}
          onChangeText={(v) => {
            const digits = v.replace(/\D/g, '').slice(0, 6);
            const formatted = digits.length > 2 ? digits.slice(0, 2) + '/' + digits.slice(2) : digits;
            setMaLicenseExpiry(formatted);
            clearError('maLicenseExpiry');
          }}
          placeholder="MM/YYYY"
          placeholderTextColor="#94A3B8"
          keyboardType="number-pad"
          maxLength={7}
        />
        {errors.maLicenseExpiry && (
          <Text style={styles.errorText}>{errors.maLicenseExpiry}</Text>
        )}
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.label}>NPI number (optional)</Text>
        <Text style={styles.npiHint}>
          Your NPI links your account to practice schedules and your credentialing passport automatically.
        </Text>
        <TextInput
          style={styles.input}
          value={npiNumber}
          onChangeText={(v) => setNpiNumber(v.replace(/\D/g, '').slice(0, 10))}
          placeholder="10-digit NPI"
          placeholderTextColor="#94A3B8"
          keyboardType="number-pad"
          maxLength={10}
        />
        <TouchableOpacity
          style={styles.npiFindButton}
          onPress={findMyNpi}
          disabled={npiLoading || !firstName.trim() || !lastName.trim()}
          activeOpacity={0.8}
        >
          <Text style={styles.npiFindButtonText}>
            {npiLoading ? 'Searching the NPI registry…' : '🔎 Find my NPI'}
          </Text>
        </TouchableOpacity>
        {npiMatches !== null && npiMatches.length === 0 && (
          <Text style={styles.npiHint}>No matches found — you can enter your NPI manually or skip this.</Text>
        )}
        {npiMatches?.map((m) => (
          <TouchableOpacity
            key={m.npi}
            style={[styles.npiMatchRow, npiNumber === m.npi && styles.npiMatchRowSelected]}
            onPress={() => { setNpiNumber(m.npi); setNpiMatches(null); }}
            activeOpacity={0.8}
          >
            <Text style={styles.npiMatchName}>
              {m.firstName} {m.lastName}{m.credential ? `, ${m.credential}` : ''}
            </Text>
            <Text style={styles.npiMatchMeta}>
              {m.npi}{m.primaryTaxonomy ? ` · ${m.primaryTaxonomy}` : ''}{m.primaryAddress ? ` · ${m.primaryAddress.city}, ${m.primaryAddress.state}` : ''}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity
        style={styles.checkboxRow}
        onPress={() => { setMaLicenseAcknowledged(!maLicenseAcknowledged); clearError('maLicenseAcknowledged'); }}
        activeOpacity={0.8}
      >
        <View style={[styles.checkbox, maLicenseAcknowledged && styles.checkboxChecked]}>
          {maLicenseAcknowledged && <Text style={styles.checkmark}>✓</Text>}
        </View>
        <Text style={styles.checkboxLabel}>
          I confirm I hold a valid Massachusetts medical license or CRNA certification and understand
          that providing false information may result in account termination.
        </Text>
      </TouchableOpacity>
      {errors.maLicenseAcknowledged && (
        <Text style={styles.errorText}>{errors.maLicenseAcknowledged}</Text>
      )}
    </View>
  );

  const renderStep3 = () => (
    <View>
      <Text style={styles.stepTitle}>
        {pinStage === 'create' ? 'Create your booking PIN' : 'Confirm your PIN'}
      </Text>
      <Text style={styles.stepSubtitle}>
        {pinStage === 'create'
          ? 'This 4-digit PIN is required to confirm shift bookings'
          : 'Enter the same PIN again to confirm'}
      </Text>
      <PinInput
        value={pinStage === 'create' ? pin : pinConfirm}
        onChange={pinStage === 'create' ? setPin : setPinConfirm}
        label={pinStage === 'create' ? 'Enter PIN' : 'Re-enter PIN'}
      />
    </View>
  );

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
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => (step > 0 ? setStep(step - 1) : navigation.goBack())}
          >
            <Text style={styles.backArrow}>←</Text>
          </TouchableOpacity>

          <StepIndicator currentStep={step} />

          <View style={styles.stepContent}>
            {step === 0 && renderStep0()}
            {step === 1 && renderStep1()}
            {step === 2 && renderStep2()}
            {step === 3 && renderStep3()}
          </View>

          {step < 3 ? (
            <TouchableOpacity
              style={styles.nextButton}
              onPress={handleNext}
              activeOpacity={0.85}
            >
              <Text style={styles.nextButtonText}>
                {step === 2 ? 'Continue to PIN Setup' : 'Next'}
              </Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.nextButton, loading && styles.nextButtonDisabled]}
              onPress={handleRegister}
              disabled={loading || (pinStage === 'confirm' && pinConfirm.length < 4)}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator color={COLORS.white} />
              ) : (
                <Text style={styles.nextButtonText}>
                  {pinStage === 'create' ? 'Confirm PIN' : 'Create My Account'}
                </Text>
              )}
            </TouchableOpacity>
          )}

          <View style={styles.loginRow}>
            <Text style={styles.loginText}>Already have an account? </Text>
            <TouchableOpacity onPress={() => navigation.navigate('Login')}>
              <Text style={styles.loginLink}>Sign In</Text>
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
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
  },
  stepItem: {
    alignItems: 'center',
  },
  stepCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#CBD5E1',
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  stepCircleActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary + '15',
  },
  stepCircleDone: {
    borderColor: COLORS.success,
    backgroundColor: COLORS.success,
  },
  stepNumber: {
    fontSize: 13,
    fontWeight: '700',
    color: '#CBD5E1',
  },
  stepNumberActive: {
    color: COLORS.primary,
  },
  stepCheckmark: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.white,
  },
  stepLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#CBD5E1',
  },
  stepLabelActive: {
    color: COLORS.primary,
  },
  stepConnector: {
    flex: 1,
    height: 2,
    backgroundColor: '#E2E8F0',
    marginHorizontal: 4,
    marginBottom: 18,
  },
  stepConnectorDone: {
    backgroundColor: COLORS.success,
  },
  stepContent: {
    marginBottom: 24,
  },
  stepTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.textDark,
    letterSpacing: -0.3,
    marginBottom: 6,
  },
  stepSubtitle: {
    fontSize: 14,
    color: COLORS.textMuted,
    marginBottom: 24,
    lineHeight: 20,
  },
  rowFields: {
    flexDirection: 'row',
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
  npiHint: {
    fontSize: 12,
    color: '#64748B',
    marginBottom: 8,
    lineHeight: 17,
  },
  npiFindButton: {
    marginTop: 8,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2563EB',
  },
  npiFindButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2563EB',
  },
  npiMatchRow: {
    marginTop: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
  },
  npiMatchRowSelected: {
    borderColor: '#2563EB',
    backgroundColor: '#EFF6FF',
  },
  npiMatchName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  npiMatchMeta: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  pickerContainer: {
    flexDirection: 'column',
    gap: 8,
  },
  pickerOption: {
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingVertical: 13,
    paddingHorizontal: 16,
    backgroundColor: COLORS.card,
  },
  pickerOptionSelected: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary + '12',
  },
  pickerOptionText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.textMuted,
  },
  pickerOptionTextSelected: {
    color: COLORS.primary,
    fontWeight: '700',
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    marginTop: 1,
    flexShrink: 0,
  },
  checkboxChecked: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  checkmark: {
    fontSize: 13,
    fontWeight: '800',
    color: COLORS.white,
  },
  checkboxLabel: {
    flex: 1,
    fontSize: 13,
    color: COLORS.textDark,
    lineHeight: 19,
  },
  pinRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginVertical: 24,
  },
  pinBox: {
    width: 56,
    height: 56,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
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
  },
  numKey: {
    width: 76,
    height: 54,
    borderRadius: 12,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  numKeyEmpty: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    shadowOpacity: 0,
    elevation: 0,
  },
  numKeyText: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.textDark,
  },
  nextButton: {
    backgroundColor: COLORS.navy,
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: COLORS.navy,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  nextButtonDisabled: {
    opacity: 0.6,
  },
  nextButtonText: {
    color: COLORS.white,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  loginRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loginText: {
    fontSize: 14,
    color: COLORS.textMuted,
  },
  loginLink: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.primary,
  },
});
