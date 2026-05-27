import React, { useState } from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AvailabilityScreen from '../screens/AvailabilityScreen';
import FeedScreen from '../screens/FeedScreen';
import ProfileScreen from '../screens/ProfileScreen';

const TABS = [
  { key: 'calendar', label: 'Calendar', icon: '📅' },
  { key: 'marketplace', label: 'Marketplace', icon: '🧭' },
  { key: 'profile', label: 'Profile', icon: '👤' },
];

export default function MainTabs({ navigation }) {
  const [activeTab, setActiveTab] = useState('calendar');

  return (
    <View style={{ flex: 1, backgroundColor: '#FAFAFA' }}>
      <View style={{ flex: 1 }}>
        {activeTab === 'calendar' && <AvailabilityScreen navigation={navigation} />}
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
    color: '#6366F1',
    fontWeight: '700',
  },
  tabIndicator: {
    position: 'absolute',
    top: 0,
    left: '25%',
    right: '25%',
    height: 2,
    backgroundColor: '#6366F1',
    borderRadius: 1,
  },
});
