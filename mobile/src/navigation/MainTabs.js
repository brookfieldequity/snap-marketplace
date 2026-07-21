import React, { useEffect, useState } from 'react';
import { View, TouchableOpacity, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AvailabilityScreen from '../screens/AvailabilityScreen';
import FeedScreen from '../screens/FeedScreen';
import HoursScreen from '../screens/HoursScreen';
import ProfileScreen from '../screens/ProfileScreen';
import MyScheduleScreen from '../screens/MyScheduleScreen';
import TodayScreen from '../screens/TodayScreen';
import { providerAPI } from '../api/client';

// Tab order is deliberate: the two read-only Shifts views come first
// because they're the daily-driver views for staff on a SNAP-Shifts roster
// (CAPA pilot). Availability, Hours, and Marketplace stay in the middle as
// they're less frequently used. Profile anchors the right edge.
// The Hours tab always renders — HoursScreen shows a friendly "not enabled
// for your practice yet" state when the provider has no hours-entry
// facilities (simpler than hiding/showing the tab from a fetch here).
const TABS = [
  { key: 'mySchedule', label: 'My Schedule', icon: '🗓️' },
  { key: 'today', label: 'Daily', icon: '🏥' },
  { key: 'calendar', label: 'Availability', icon: '✅' },
  { key: 'hours', label: 'Hours', icon: '⏱️' },
  { key: 'marketplace', label: 'Marketplace', icon: '🧭' },
  { key: 'profile', label: 'Profile', icon: '👤' },
];

export default function MainTabs({ navigation }) {
  // Mode-aware landing: roster-linked providers land on My Schedule (CAPA
  // pilot daily driver); marketplace-only providers land on the shift feed.
  // activeTab stays null (brief spinner, no wrong-tab flash) until
  // /providers/me resolves; any error falls back to My Schedule.
  const [activeTab, setActiveTab] = useState(null);

  useEffect(() => {
    let cancelled = false;
    providerAPI.getMe()
      .then((res) => {
        if (!cancelled) setActiveTab(res.data?.hasRosterLink === false ? 'marketplace' : 'mySchedule');
      })
      .catch(() => {
        if (!cancelled) setActiveTab('mySchedule');
      });
    return () => { cancelled = true; };
  }, []);

  if (activeTab === null) {
    return (
      <View style={{ flex: 1, backgroundColor: '#FAFAFA', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color="#2563EB" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#FAFAFA' }}>
      <View style={{ flex: 1 }}>
        {activeTab === 'mySchedule' && <MyScheduleScreen navigation={navigation} />}
        {activeTab === 'today' && <TodayScreen navigation={navigation} />}
        {activeTab === 'calendar' && <AvailabilityScreen navigation={navigation} />}
        {activeTab === 'hours' && <HoursScreen navigation={navigation} />}
        {activeTab === 'marketplace' && <FeedScreen navigation={navigation} />}
        {activeTab === 'profile' && <ProfileScreen navigation={navigation} />}
      </View>
      <View style={styles.tabBar}>
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              style={styles.tab}
              onPress={() => setActiveTab(tab.key)}
              activeOpacity={0.7}
            >
              <Text style={styles.tabIcon}>{tab.icon}</Text>
              <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
                {tab.label}
              </Text>
              {isActive && <View style={styles.tabIndicator} />}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    paddingBottom: 20,
    paddingTop: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 8,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 4,
    position: 'relative',
  },
  tabIcon: {
    fontSize: 22,
    marginBottom: 2,
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '500',
    color: '#94A3B8',
    letterSpacing: 0.3,
  },
  tabLabelActive: {
    color: '#2563EB',
    fontWeight: '700',
  },
  tabIndicator: {
    position: 'absolute',
    top: 0,
    left: '25%',
    right: '25%',
    height: 2,
    backgroundColor: '#2563EB',
    borderRadius: 1,
  },
});
