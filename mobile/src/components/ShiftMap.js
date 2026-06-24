import React, { useMemo, useRef, useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import * as Location from 'expo-location';

const COLORS = {
  primary: '#2563EB',
  surge: '#F59E0B',
  vip: '#1E3A8A',
  card: '#FFFFFF',
  textDark: '#0F172A',
  textMuted: '#64748B',
  border: '#E2E8F0',
  white: '#FFFFFF',
};

// Massachusetts default fallback (Boston-area center) when no provider lat/lng yet.
const DEFAULT_REGION = {
  latitude: 42.3601,
  longitude: -71.0589,
  latitudeDelta: 0.5,
  longitudeDelta: 0.5,
};

function groupByFacility(shifts) {
  const map = new Map();
  for (const s of shifts) {
    const fid = s.facility?.id || s.facilityId;
    const lat = s.facility?.lat;
    const lng = s.facility?.lng;
    if (!fid || lat == null || lng == null) continue;
    if (!map.has(fid)) {
      map.set(fid, {
        facilityId: fid,
        facilityName: s.facility?.name || s.facilityName || 'Facility',
        lat,
        lng,
        shifts: [],
      });
    }
    map.get(fid).shifts.push(s);
  }
  return Array.from(map.values());
}

function regionForPoints(points) {
  if (points.length === 0) return DEFAULT_REGION;
  if (points.length === 1) {
    return {
      latitude: points[0].lat,
      longitude: points[0].lng,
      latitudeDelta: 0.15,
      longitudeDelta: 0.15,
    };
  }
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const padding = 0.25; // 25% padding around the bounds
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(0.05, (maxLat - minLat) * (1 + padding)),
    longitudeDelta: Math.max(0.05, (maxLng - minLng) * (1 + padding)),
  };
}

// 1° of latitude ≈ 69 miles. A search radius of ~0.6 × the visible height
// covers the viewport (center-to-edge is half the height; the extra reaches
// the corners) without pulling in far-off facilities.
function radiusMilesFromRegion(r) {
  return Math.max(2, Math.round((r.latitudeDelta || 0.5) * 69 * 0.6));
}

export default function ShiftMap({ shifts, onShiftPress, onSearchArea }) {
  const mapRef = useRef(null);
  const [selected, setSelected] = useState(null);
  const [region, setRegion] = useState(DEFAULT_REGION);
  const [showSearchHere, setShowSearchHere] = useState(false);
  const currentRegionRef = useRef(DEFAULT_REGION);
  const initializedRef = useRef(false);
  const hasSearchedRef = useRef(false);

  const groups = useMemo(() => groupByFacility(shifts), [shifts]);

  useEffect(() => {
    setRegion(regionForPoints(groups));
    setSelected(null);
  }, [groups]);

  // Fired after any region change. The first call is the initial layout; only
  // subsequent (user-driven) moves should reveal the "Search this area" button.
  const handleRegionChangeComplete = (r) => {
    currentRegionRef.current = r;
    if (initializedRef.current) setShowSearchHere(true);
    else initializedRef.current = true;
  };

  const handleSearchHere = () => {
    const r = currentRegionRef.current;
    setShowSearchHere(false);
    hasSearchedRef.current = true;
    onSearchArea?.({
      centerLat: r.latitude,
      centerLng: r.longitude,
      radiusMiles: radiusMilesFromRegion(r),
    });
  };

  // Try to center on the provider's current location, but never block the map render.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (cancelled || !mapRef.current) return;
        // Only recenter when we don't already have shifts to frame — and never
        // after a manual "search this area" (that would yank the user away).
        if (groups.length === 0 && !hasSearchedRef.current) {
          mapRef.current.animateToRegion({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            latitudeDelta: 0.2,
            longitudeDelta: 0.2,
          }, 400);
        }
      } catch {
        // permission denied / unavailable — fine, stick with default region
      }
    })();
    return () => { cancelled = true; };
  }, [groups.length]);

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_DEFAULT}
        style={StyleSheet.absoluteFill}
        initialRegion={region}
        onRegionChangeComplete={handleRegionChangeComplete}
        showsUserLocation
        showsMyLocationButton={Platform.OS === 'android'}
      >
        {groups.map((g) => (
          <Marker
            key={g.facilityId}
            coordinate={{ latitude: g.lat, longitude: g.lng }}
            onPress={() => setSelected(g)}
          >
            <View style={styles.pin}>
              <Text style={styles.pinText}>{g.shifts.length}</Text>
            </View>
          </Marker>
        ))}
      </MapView>

      {/* "Search this area" — appears after the user pans/zooms the map */}
      {showSearchHere && onSearchArea && (
        <View style={styles.searchHereWrap} pointerEvents="box-none">
          <TouchableOpacity style={styles.searchHereBtn} onPress={handleSearchHere} activeOpacity={0.85}>
            <Text style={styles.searchHereText}>⟳ Search this area</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Non-blocking "no shifts" pill so the user can keep panning + re-search */}
      {groups.length === 0 && (
        <View style={styles.noShiftsPillWrap} pointerEvents="none">
          <View style={styles.noShiftsPill}>
            <Text style={styles.noShiftsPillText}>No shifts in this area — pan and search again</Text>
          </View>
        </View>
      )}

      {/* Mini-card for the selected facility */}
      {selected && (
        <View style={styles.miniCardWrap} pointerEvents="box-none">
          <View style={styles.miniCard}>
            <View style={styles.miniHeader}>
              <Text style={styles.miniFacility} numberOfLines={1}>{selected.facilityName}</Text>
              <TouchableOpacity onPress={() => setSelected(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={styles.miniClose}>×</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.miniCount}>
              {selected.shifts.length} shift{selected.shifts.length === 1 ? '' : 's'} available
            </Text>

            {selected.shifts.slice(0, 3).map((s) => {
              const rate = s.currentRate ?? s.payRate ?? s.baseRate;
              const dateStr = s.date
                ? new Date(s.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                : '';
              return (
                <TouchableOpacity
                  key={s.id}
                  style={styles.miniShiftRow}
                  onPress={() => onShiftPress?.(s)}
                  activeOpacity={0.7}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.miniShiftDate}>
                      {dateStr}{s.startTime ? ` · ${s.startTime}` : ''}
                    </Text>
                    <Text style={styles.miniShiftMeta}>
                      {s.specialty || ''}{s.durationHours ? ` · ${s.durationHours}h` : ''}
                    </Text>
                  </View>
                  <Text style={styles.miniRate}>${rate ? Math.round(rate) : '—'}/hr</Text>
                </TouchableOpacity>
              );
            })}

            {selected.shifts.length > 3 && (
              <Text style={styles.miniMore}>+ {selected.shifts.length - 3} more</Text>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#E2E8F0',
  },
  searchHereWrap: {
    position: 'absolute',
    top: 14,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  searchHereBtn: {
    backgroundColor: COLORS.white,
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 5,
  },
  searchHereText: {
    fontSize: 13,
    fontWeight: '800',
    color: COLORS.primary,
  },
  noShiftsPillWrap: {
    position: 'absolute',
    top: 60,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  noShiftsPill: {
    backgroundColor: 'rgba(15,23,42,0.82)',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  noShiftsPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.white,
  },
  pin: {
    minWidth: 32,
    height: 32,
    paddingHorizontal: 8,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.white,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 2 },
  },
  pinText: {
    color: COLORS.white,
    fontWeight: '800',
    fontSize: 13,
  },
  miniCardWrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 16,
  },
  miniCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 14,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  miniHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  miniFacility: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.textDark,
    flex: 1,
    marginRight: 8,
  },
  miniClose: {
    fontSize: 22,
    color: COLORS.textMuted,
    fontWeight: '700',
    lineHeight: 24,
  },
  miniCount: {
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: '700',
    marginBottom: 10,
  },
  miniShiftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  miniShiftDate: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textDark,
  },
  miniShiftMeta: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 1,
  },
  miniRate: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.primary,
    marginLeft: 8,
  },
  miniMore: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '600',
    marginTop: 6,
    textAlign: 'center',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.textDark,
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 13,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 19,
  },
});
