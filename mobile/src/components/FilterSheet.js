import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { shiftAPI } from '../api/client';

const COLORS = {
  primary: '#6366F1',
  background: '#FAFAFA',
  textDark: '#0F172A',
  textMuted: '#64748B',
  card: '#FFFFFF',
  border: '#E2E8F0',
  white: '#FFFFFF',
};

const DATE_RANGE_OPTIONS = [
  { key: 'NEXT_7', label: 'Next 7 days' },
  { key: 'THIS_MONTH', label: 'This month' },
  { key: 'NEXT_MONTH', label: 'Next month' },
  { key: 'ALL', label: 'All upcoming' },
];

const SHIFT_TYPE_OPTIONS = [
  { key: '', label: 'Any' },
  { key: 'DAY', label: 'Day (7a–7p)' },
  { key: 'NIGHT', label: 'Night (7p–7a)' },
];

const RATE_MIN = 100;
const RATE_MAX = 500;

export default function FilterSheet({ visible, initial, onApply, onClose }) {
  const [minRate, setMinRate] = useState(initial?.minRate ?? RATE_MIN);
  const [maxRate, setMaxRate] = useState(initial?.maxRate ?? RATE_MAX);
  const [dateRange, setDateRange] = useState(initial?.dateRange || 'ALL');
  const [shiftType, setShiftType] = useState(initial?.shiftType || '');
  const [selectedTypes, setSelectedTypes] = useState(new Set(initial?.facilityType || []));
  const [facilityTypes, setFacilityTypes] = useState([]);
  const [loadingTypes, setLoadingTypes] = useState(true);

  useEffect(() => {
    if (!visible) return;
    setMinRate(initial?.minRate ?? RATE_MIN);
    setMaxRate(initial?.maxRate ?? RATE_MAX);
    setDateRange(initial?.dateRange || 'ALL');
    setShiftType(initial?.shiftType || '');
    setSelectedTypes(new Set(initial?.facilityType || []));
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    setLoadingTypes(true);
    shiftAPI.getFacilityTypes()
      .then((res) => setFacilityTypes(res.data?.types || []))
      .catch(() => setFacilityTypes([
        { value: 'HOSPITAL', label: 'Hospital', count: 0 },
        { value: 'SURGERY_CENTER', label: 'Surgery Center', count: 0 },
        { value: 'OUTPATIENT', label: 'Outpatient Clinic', count: 0 },
        { value: 'DENTAL', label: 'Dental Office', count: 0 },
        { value: 'OTHER', label: 'Other', count: 0 },
      ]))
      .finally(() => setLoadingTypes(false));
  }, [visible]);

  const toggleType = (value) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  const handleApply = () => {
    onApply({
      minRate: minRate > RATE_MIN ? minRate : undefined,
      maxRate: maxRate < RATE_MAX ? maxRate : undefined,
      dateRange: dateRange !== 'ALL' ? dateRange : undefined,
      facilityType: selectedTypes.size > 0 ? Array.from(selectedTypes) : undefined,
      shiftType: shiftType || undefined,
    });
    onClose();
  };

  const handleReset = () => {
    setMinRate(RATE_MIN);
    setMaxRate(RATE_MAX);
    setDateRange('ALL');
    setShiftType('');
    setSelectedTypes(new Set());
  };

  // Keep min ≤ max as user drags.
  const handleMinChange = (v) => {
    const rounded = Math.round(v / 5) * 5;
    setMinRate(rounded);
    if (rounded > maxRate) setMaxRate(rounded);
  };
  const handleMaxChange = (v) => {
    const rounded = Math.round(v / 5) * 5;
    setMaxRate(rounded);
    if (rounded < minRate) setMinRate(rounded);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <Text style={styles.title}>Filters</Text>
            <TouchableOpacity onPress={handleReset}>
              <Text style={styles.resetText}>Reset</Text>
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 12 }}>
            {/* Pay rate */}
            <Text style={styles.sectionTitle}>Pay Rate</Text>
            <View style={styles.rateRow}>
              <Text style={styles.rateValue}>${minRate}</Text>
              <Text style={styles.rateConnector}>—</Text>
              <Text style={styles.rateValue}>
                {maxRate >= RATE_MAX ? `$${RATE_MAX}+` : `$${maxRate}`}
              </Text>
              <Text style={styles.ratePer}>/hr</Text>
            </View>
            <Text style={styles.sliderLabel}>Min</Text>
            <Slider
              minimumValue={RATE_MIN}
              maximumValue={RATE_MAX}
              step={5}
              value={minRate}
              onValueChange={handleMinChange}
              minimumTrackTintColor={COLORS.primary}
              maximumTrackTintColor={COLORS.border}
              thumbTintColor={COLORS.primary}
            />
            <Text style={styles.sliderLabel}>Max</Text>
            <Slider
              minimumValue={RATE_MIN}
              maximumValue={RATE_MAX}
              step={5}
              value={maxRate}
              onValueChange={handleMaxChange}
              minimumTrackTintColor={COLORS.primary}
              maximumTrackTintColor={COLORS.border}
              thumbTintColor={COLORS.primary}
            />

            {/* Date range */}
            <Text style={styles.sectionTitle}>Date Range</Text>
            <View style={styles.chipRow}>
              {DATE_RANGE_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.key}
                  style={[styles.chip, dateRange === opt.key && styles.chipActive]}
                  onPress={() => setDateRange(opt.key)}
                >
                  <Text style={[styles.chipText, dateRange === opt.key && styles.chipTextActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Shift type */}
            <Text style={styles.sectionTitle}>Shift Type</Text>
            <View style={styles.chipRow}>
              {SHIFT_TYPE_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.key || 'any'}
                  style={[styles.chip, shiftType === opt.key && styles.chipActive]}
                  onPress={() => setShiftType(opt.key)}
                >
                  <Text style={[styles.chipText, shiftType === opt.key && styles.chipTextActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Facility type */}
            <Text style={styles.sectionTitle}>Facility Type</Text>
            {loadingTypes ? (
              <ActivityIndicator size="small" color={COLORS.primary} style={{ marginVertical: 12 }} />
            ) : (
              <View style={styles.typeList}>
                {facilityTypes.map((t) => {
                  const checked = selectedTypes.has(t.value);
                  return (
                    <TouchableOpacity
                      key={t.value}
                      style={styles.typeRow}
                      onPress={() => toggleType(t.value)}
                    >
                      <View style={[styles.checkbox, checked && styles.checkboxOn]}>
                        {checked && <Text style={styles.checkmark}>✓</Text>}
                      </View>
                      <Text style={styles.typeLabel}>{t.label}</Text>
                      <Text style={styles.typeCount}>{t.count > 0 ? t.count : ''}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.applyButton} onPress={handleApply}>
              <Text style={styles.applyText}>Apply Filters</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 32,
    maxHeight: '88%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#CBD5E1',
    alignSelf: 'center',
    marginBottom: 14,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.textDark,
  },
  resetText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: COLORS.textDark,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 18,
    marginBottom: 10,
  },
  rateRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  rateValue: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.primary,
  },
  rateConnector: {
    fontSize: 18,
    color: COLORS.textMuted,
    fontWeight: '600',
  },
  ratePer: {
    fontSize: 13,
    color: COLORS.textMuted,
    fontWeight: '600',
    marginLeft: 4,
  },
  sliderLabel: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 6,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  chipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  chipText: {
    fontSize: 13,
    color: COLORS.textDark,
    fontWeight: '600',
  },
  chipTextActive: {
    color: COLORS.white,
  },
  typeList: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    overflow: 'hidden',
  },
  typeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  checkboxOn: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  checkmark: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '800',
  },
  typeLabel: {
    flex: 1,
    fontSize: 14,
    color: COLORS.textDark,
    fontWeight: '500',
  },
  typeCount: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '600',
  },
  footer: {
    flexDirection: 'row',
    gap: 10,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    marginTop: 8,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    alignItems: 'center',
  },
  cancelText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textMuted,
  },
  applyButton: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
  },
  applyText: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.white,
  },
});
