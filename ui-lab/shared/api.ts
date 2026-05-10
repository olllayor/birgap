// Shared API Client for BirGap Backend
// Used by all 4 UI versions

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

export const api = {
  // ── Auth ──────────────────────────────────────────────
  async requestOtp(phone: string) {
    return fetch(`${API_BASE}/auth/otp/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    }).then(r => r.json());
  },

  async verifyOtp(phone: string, code: string) {
    return fetch(`${API_BASE}/auth/otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, code }),
    }).then(async r => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || 'OTP verification failed');
      return data; // { user: { id }, accessToken, refreshToken }
    });
  },

  async refreshToken(refreshToken: string) {
    return fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    }).then(async r => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || 'Token refresh failed');
      return data;
    });
  },

  async logout(accessToken: string, refreshToken?: string) {
    const body: Record<string, string> = {};
    if (refreshToken) body.refreshToken = refreshToken;
    return fetch(`${API_BASE}/auth/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: refreshToken ? JSON.stringify(body) : undefined,
    });
  },

  // ── Devices ───────────────────────────────────────────
  async registerDevice(accessToken: string, device: any) {
    return fetch(`${API_BASE}/devices/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(device),
    }).then(r => r.json());
  },

  async getDevices(accessToken: string) {
    return fetch(`${API_BASE}/devices`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }).then(r => r.json());
  },

  async deleteDevice(accessToken: string, deviceId: string) {
    return fetch(`${API_BASE}/devices/${deviceId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  },

  // ── Messages ──────────────────────────────────────────
  async sendMessage(accessToken: string, msg: any) {
    return fetch(`${API_BASE}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(msg),
    }).then(async r => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || 'Send failed');
      return data;
    });
  },

  async getPendingMessages(accessToken: string, deviceId: string) {
    return fetch(`${API_BASE}/messages/pending?deviceId=${encodeURIComponent(deviceId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }).then(r => r.json());
  },

  async ackMessage(accessToken: string, messageId: string, deviceId: string, status: 'DELIVERED' | 'READ') {
    return fetch(`${API_BASE}/messages/${messageId}/ack`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ deviceId, status }),
    }).then(r => r.json());
  },

  // ── Prekeys ───────────────────────────────────────────
  async refillPrekeys(accessToken: string, deviceId: string, prekeys: any[]) {
    return fetch(`${API_BASE}/devices/${deviceId}/prekeys/refill`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ prekeys }),
    }).then(r => r.json());
  },

  async rotateSignedPrekey(accessToken: string, deviceId: string, data: any) {
    return fetch(`${API_BASE}/devices/${deviceId}/signed-prekey`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(data),
    }).then(r => r.json());
  },

  // ── Key Bundles ───────────────────────────────────────
  async getKeyBundles(accessToken: string, userId: string) {
    return fetch(`${API_BASE}/users/${userId}/devices/key-bundles`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }).then(r => r.json());
  },

  // ── Realtime Token ────────────────────────────────────
  async getSocketTicket(accessToken: string, deviceId: string) {
    return fetch(`${API_BASE}/realtime/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ deviceId }),
    }).then(r => r.json());
  },

  // ── Backups ───────────────────────────────────────────
  async putBackup(accessToken: string, data: any) {
    return fetch(`${API_BASE}/backups/current`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(data),
    }).then(r => r.json());
  },

  async getBackup(accessToken: string) {
    return fetch(`${API_BASE}/backups/current`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }).then(r => r.json());
  },

  async getBackupMetadata(accessToken: string) {
    return fetch(`${API_BASE}/backups/metadata`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }).then(r => r.json());
  },

  // ── Health ────────────────────────────────────────────
  async health() {
    return fetch(`${API_BASE}/health`).then(r => r.json());
  },
};