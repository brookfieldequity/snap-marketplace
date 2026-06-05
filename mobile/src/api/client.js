import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Set EXPO_PUBLIC_API_URL in eas.json (under build profile env) or in a .env file.
// Falls back to the live Railway backend so builds without the env still work.
const BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'https://snap-marketplace-production.up.railway.app/api';

// ---------------------------------------------------------------------------
// Axios instance
// ---------------------------------------------------------------------------

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Attach Bearer token to every request
api.interceptors.request.use(
  async (config) => {
    try {
      const token = await AsyncStorage.getItem('snapToken');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    } catch {
      // proceed without token
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Global response error handler
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      await AsyncStorage.removeItem('snapToken');
    }
    return Promise.reject(error);
  }
);

// ---------------------------------------------------------------------------
// Auth API
// ---------------------------------------------------------------------------

export const authAPI = {
  /**
   * Register a new provider account.
   * @param {object} data - { email, password, firstName, lastName, specialty,
   *   yearsExperience, city, maLicenseNumber, maLicenseExpiry,
   *   maLicenseAcknowledged, pin }
   */
  providerRegister: (data) => api.post('/auth/provider/register', data),

  /**
   * Log in an existing provider.
   * @param {object} data - { email, password }
   * Returns { token, provider }
   */
  providerLogin: (data) => api.post('/auth/provider/login', data),

  /**
   * Verify the 4-digit PIN before booking a shift.
   * @param {object} data - { pin }
   */
  verifyPin: (data) => api.post('/auth/provider/verify-pin', data),
};

// ---------------------------------------------------------------------------
// Shift API
// ---------------------------------------------------------------------------

export const shiftAPI = {
  /**
   * Get the shift feed with optional filters/sort.
   * @param {object} params - { page, limit, sort, specialty, minRate, maxRate,
   *                            dateRange ('NEXT_7'|'THIS_MONTH'|'NEXT_MONTH'|'ALL'),
   *                            facilityType (CSV of FacilityType enum),
   *                            shiftType ('DAY'|'NIGHT') }
   */
  getFeed: (params = {}) => api.get('/shifts/feed', { params }),

  /**
   * Get the FacilityType options + counts for the filter UI.
   */
  getFacilityTypes: () => api.get('/facilities/types'),

  /**
   * Get a single shift by ID.
   * @param {string} shiftId
   */
  getShift: (shiftId) => api.get(`/shifts/${shiftId}`),

  /**
   * Book a credentialed shift (direct booking).
   * @param {string} shiftId
   */
  bookShift: (shiftId) => api.post(`/shifts/${shiftId}/book`),

  /**
   * Apply for a shift (triggers credentialing flow if needed).
   * @param {string} shiftId
   * @param {object} data - optional cover note / documents
   */
  applyShift: (shiftId, data = {}) => api.post(`/shifts/${shiftId}/apply`, data),
};

// ---------------------------------------------------------------------------
// Schedule API — provider-facing reads against the SNAP Shifts module.
// "My Schedule" and "Today" tabs both pull from here. iCal subscription
// returns one URL per facility the provider is on; Apple/Google Calendar
// polls those URLs to keep the provider's local calendar in sync.
// ---------------------------------------------------------------------------

export const scheduleAPI = {
  /** Provider's own assignments for a month across every facility roster. */
  getMyMonth: (year, month) => api.get('/schedule/my-month', { params: { year, month } }),

  /** Full daily schedule for a facility the provider is on (read-only). */
  getDailyAtFacility: (facilityId, date) =>
    api.get(`/schedule/today-at/${facilityId}`, { params: date ? { date } : {} }),

  /** Return iCal subscription URLs (mints a token on first call). */
  getIcalSubscriptions: () => api.post('/schedule/ical-subscribe', {}),

  /** Regenerate tokens — invalidates any previously-distributed URLs. */
  rotateIcalSubscriptions: () => api.post('/schedule/ical-subscribe', { rotate: true }),
};

// ---------------------------------------------------------------------------
// Provider API
// ---------------------------------------------------------------------------

export const providerAPI = {
  /**
   * Get the authenticated provider's own profile.
   */
  getMe: () => api.get('/providers/me'),

  /**
   * Update the authenticated provider's profile.
   * @param {object} data - partial provider fields to update
   */
  updateMe: (data) => api.patch('/providers/me', data),

  /**
   * Upload a provider profile photo to S3.
   * @param {string} localUri - local file URI from expo-image-picker
   */
  uploadPhoto: async (localUri) => {
    const token = await AsyncStorage.getItem('snapToken');
    const formData = new FormData();
    formData.append('photo', { uri: localUri, type: 'image/jpeg', name: 'photo.jpg' });
    return api.post('/uploads/provider-photo', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  },

  /**
   * Get the provider's availability calendar.
   * @param {object} params - { month, year }
   */
  getAvailability: (params = {}) => api.get('/providers/me/availability', { params }),

  /**
   * Set / bulk-update availability.
   * @param {object} data - { availability: [{ date: 'YYYY-MM-DD', available: bool }] }
   */
  setAvailability: (data) => api.post('/providers/me/availability', data),

  /**
   * Get earnings summary and shift payment list.
   * @param {object} params - { month, year }
   */
  getEarnings: (params = {}) => api.get('/providers/me/earnings', { params }),

  /**
   * Get VIP status, points balance, and point log.
   */
  getVip: () => api.get('/providers/me/vip'),

  /**
   * Get active availability windows for the authenticated provider.
   * Returns windows from facilities where this provider is on the roster.
   */
  getActiveWindows: () => api.get('/providers/me/active-windows'),

  /**
   * Get active incentive shifts targeted at this provider.
   */
  getActiveIncentiveShifts: () => api.get('/incentive/provider/active'),

  /**
   * Accept or decline an incentive shift.
   * @param {string} shiftId
   * @param {boolean} accepted
   */
  respondToIncentiveShift: (shiftId, accepted) => api.post(`/incentive/${shiftId}/respond`, { accepted }),
};

// ---------------------------------------------------------------------------
// Message API
// ---------------------------------------------------------------------------

export const messageAPI = {
  /**
   * Send a message on a shift thread.
   * @param {object} data - { shiftId, recipientId, body }
   */
  send: (data) => api.post('/messages', data),

  /**
   * Get all messages for a specific shift.
   * @param {string} shiftId
   */
  getForShift: (shiftId) => api.get(`/messages/shift/${shiftId}`),
};

export default api;
