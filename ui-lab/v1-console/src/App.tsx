import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/main.css';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000');

// ── Types ──
interface AuthState {
  user: { id: string };
  accessToken: string;
  refreshToken: string;
  accessTokenExpiry: number;
}

interface Contact {
  id: string;
  name: string;
  phone: string;
  unread: number;
  lastMessage: string;
  lastTime: string;
}

interface Message {
  id: string;
  senderUserId: string;
  senderDeviceId: string;
  threadSequence: number;
  createdAt: string;
  envelopes: Array<{
    recipientDeviceId: string;
    ciphertext: any;
    status: 'PENDING' | 'DELIVERED' | 'READ';
  }>;
}

interface Device {
  id: string;
  platform: string;
  displayName: string;
  identityPublicKey: string;
  active: boolean;
}

// ── API ──
async function apiCall(endpoint: string, options: RequestInit = {}, token?: string): Promise<any> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers: { ...headers, ...options.headers } });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message || `API error ${res.status}`);
  return json;
}

// ── Auth Screen ──
let globalAuth: AuthState | null = null;
let globalWs: WebSocket | null = null;

function AuthScreen({ onAuth }: { onAuth: (s: AuthState) => void }) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const stage = sent ? 'code' : 'phone';

  const requestOtp = async () => {
    if (!phone) { setError('Enter phone'); return; }
    setLoading(true); setError('');
    try {
      await apiCall('/auth/otp/request', { method: 'POST', body: JSON.stringify({ phone }) });
      setSent(true);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  };

  const verify = async () => {
    if (code.length < 6) { setError('Enter 6-digit code'); return; }
    setLoading(true); setError('');
    try {
      const data = await apiCall('/auth/otp/verify', {
        method: 'POST',
        body: JSON.stringify({ phone, code }),
      });
      const state: AuthState = {
        user: data.user,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        accessTokenExpiry: Date.now() + 15 * 60 * 1000,
      };
      globalAuth = state;
      onAuth(state);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  };

  return React.createElement('div', { className: 'auth-overlay' },
    React.createElement('div', { className: 'auth-box' },
      React.createElement('h1', null, '>_ BIRGAP'),
      React.createElement('p', { className: 'muted' }, 'E2EE Messenger — Terminal Console'),
      stage === 'phone' && [
        React.createElement('label', { key: 'l1' }, 'PHONE'),
        React.createElement('input', { key: 'i1', ref: null as any, type: 'tel', placeholder: '+1234567890', value: phone, onChange: e => setPhone(e.target.value), onKeyPress: e => e.key === 'Enter' && requestOtp() }),
        React.createElement('button', { key: 'b1', onClick: requestOtp, disabled: loading || !phone }, loading ? 'REQUESTING...' : 'REQUEST OTP'),
      ],
      stage === 'code' && [
        React.createElement('label', { key: 'l2' }, 'OTP CODE'),
        React.createElement('input', { key: 'i2', ref: null as any, type: 'text', maxLength: 6, placeholder: '000000', value: code, onChange: e => setCode(e.target.value), autoFocus: true, onKeyPress: e => e.key === 'Enter' && verify() }),
        React.createElement('div', { key: 'hint', className: 'muted' }, 'Mock code: 000000'),
        React.createElement('button', { key: 'b2', onClick: verify, disabled: loading || code.length < 6 }, loading ? 'VERIFYING...' : 'VERIFY & LOGIN'),
      ],
      error && React.createElement('div', { style: { color: '#ff3333', marginTop: 12 } }, error),
      React.createElement('div', { className: 'muted', style: { marginTop: 16 } }, `API: ${API_BASE}`),
    )
  );
}

// ── Main Console App ──
function ConsoleApp() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [activeContact, setActiveContact] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState('disconnected');
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>('');
  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auth effect
  useEffect(() => {
    if (!auth) {
      globalAuth = null;
      return;
    }
    // Auto-refresh token
    const interval = setInterval(async () => {
      if (globalAuth && Date.now() > globalAuth.accessTokenExpiry - 60000) {
        try {
          const data = await apiCall('/auth/refresh', {
            method: 'POST',
            body: JSON.stringify({ refreshToken: globalAuth.refreshToken }),
          });
          globalAuth = { ...globalAuth, accessToken: data.accessToken, refreshToken: data.refreshToken, accessTokenExpiry: Date.now() + 15 * 60 * 1000 };
          setAuth({ ...globalAuth });
        } catch (e) { console.error('Token refresh failed'); }
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [auth]);

  // Device fetch on auth
  useEffect(() => {
    if (!auth) return;
    apiCall('/devices', { headers: { Authorization: `Bearer ${auth.accessToken}` } })
      .then((data: Device[]) => {
        setDevices(data);
        if (data.length > 0) setSelectedDevice(data[0].id);
      })
      .catch(e => console.error('Device fetch failed:', e));
  }, [auth]);

  // WebSocket connection
  useEffect(() => {
    if (!auth || !selectedDevice) return;
    const connectWs = async () => {
      try {
        const ticketData = await apiCall('/realtime/token', {
          method: 'POST',
          headers: { Authorization: `Bearer ${auth.accessToken}` },
          body: JSON.stringify({ deviceId: selectedDevice }),
        });

        const ws = new WebSocket(`ws://${new URL(API_BASE).host}/socket.io/?EIO=4&transport=websocket`);
        wsRef.current = ws;
        globalWs = ws;

        ws.onopen = () => {
          // Socket.IO handshake and auth
          ws.send(`40${JSON.stringify({ ticket: ticketData.ticket })}`);
          setStatus('connected');
        };

        ws.onmessage = (event) => {
          const raw = event.data as string;
          if (raw.startsWith('42')) {
            try {
              const payload = JSON.parse(raw.substring(2));
              const eventName = payload[0];
              const data = payload[1];

              if (eventName === 'message.new') {
                setMessages(prev => [...prev, { ...data, envelopes: [], senderUserId: data.senderUserId || '', senderDeviceId: data.senderDeviceId || '', threadSequence: 0, createdAt: new Date().toISOString(), id: data.messageId || '' }]);
              }
              if (eventName === 'message.ack') {
                setMessages(prev => prev.map(m => m.id === data.messageId ? { ...m, status: data.status } : m));
              }
            } catch {}
          }
        };

        ws.onclose = () => { setStatus('disconnected'); };
      } catch (e) { console.error('WS failed:', e); }
    };

    connectWs();
    return () => { wsRef.current?.close(); globalWs = null; };
  }, [auth, selectedDevice]);

  // Fetch contacts (simplified — uses key bundles)
  useEffect(() => {
    if (!auth) return;
    apiCall('/users/me/devices/key-bundles', { headers: { Authorization: `Bearer ${auth.accessToken}` } })
      .then(() => {}) // In real app, would list contacts
      .catch(() => {});
  }, [auth]);

  const sendMessage = () => {
    if (!input.trim() || !selectedDevice || !auth) return;
    const idempotencyKey = crypto.randomUUID();
    const payload = {
      senderDeviceId: selectedDevice,
      recipientUserId: activeContact || '',
      idempotencyKey,
      envelopes: activeContact ? [{ recipientDeviceId: activeContact, ciphertext: { body: btoa(input) } }] : [],
    };
    apiCall('/messages', { method: 'POST', headers: { Authorization: `Bearer ${auth.accessToken}` }, body: JSON.stringify(payload) })
      .then((data) => {
        setMessages(prev => [...prev, data]);
        setInput('');
      })
      .catch(e => console.error('Send failed:', e));
  };

  if (!auth) return React.createElement(AuthScreen as any, { onAuth: setAuth });

  return React.createElement('div', { className: 'app' },
    // Topbar
    React.createElement('div', { className: 'topbar' },
      React.createElement('span', { className: 'logo' }, '>_ BIRGAP'),
      React.createElement('span', { className: 'status ' + status },
        React.createElement('span', { className: 'status-dot ' + status }),
        status.toUpperCase(),
      ),
      React.createElement('span', { className: 'status' },
        `User: ${auth.user.id.slice(0, 8)}... | Token: ${auth.accessToken.slice(0, 12)}...`
      ),
    ),

    // Sidebar
    React.createElement('div', { className: 'sidebar' },
      React.createElement('h2', null, 'Devices'),
      devices.map(d => React.createElement('div', {
        key: d.id,
        className: 'contact-item' + (d.id === selectedDevice ? ' active' : ''),
        onClick: () => setSelectedDevice(d.id),
      },
        React.createElement('span', { className: 'name' }, `${d.platform} — ${d.displayName || d.id.slice(0, 8)}`),
        React.createElement('span', { className: 'meta' }, d.active ? '●' : '○'),
      )),
      React.createElement('h2', { style: { marginTop: 16 } }, 'Contacts'),
      React.createElement('div', { className: 'contact-item dimmer' },
        React.createElement('span', { className: 'name' }, 'Loading...'),
      ),
    ),

    // Chat area
    React.createElement('div', { className: 'chat-area' },
      React.createElement('div', { className: 'chat-messages', ref: messagesEndRef },
        messages.length === 0 && React.createElement('div', { className: 'system-message' }, 'Select a conversation to begin'),
        messages.map((msg, i) => {
          const isSent = msg.senderDeviceId === selectedDevice;
          return React.createElement('div', { key: i, className: 'message-row ' + (isSent ? 'sent' : 'received') },
            React.createElement('div', null,
              React.createElement('div', { className: 'sender-label' }, isSent ? 'You' : msg.senderUserId?.slice(0, 8)),
              React.createElement('div', { className: 'message-bubble' },
                msg.envelopes?.[0]?.ciphertext?.body ? atob(msg.envelopes[0].ciphertext.body) : '[encrypted]',
              ),
              React.createElement('div', { className: 'message-meta' },
                new Date(msg.createdAt).toLocaleTimeString(),
                ' | ',
                msg.envelopes?.[0]?.status || 'PENDING',
              ),
            ),
          );
        }),
        React.createElement('div', { ref: messagesEndRef }),
      ),
      React.createElement('div', { className: 'chat-input' },
        React.createElement('input', {
          value: input,
          onChange: e => setInput(e.target.value),
          placeholder: 'Type a message...',
          onKeyPress: e => e.key === 'Enter' && sendMessage(),
        }),
        React.createElement('button', { onClick: sendMessage, disabled: !input.trim() }, 'SEND'),
      ),
    ),

    // Info panel
    React.createElement('div', { className: 'info-panel' },
      React.createElement('div', { className: 'info-line' },
        React.createElement('span', { className: 'info-key' }, 'User ID'),
        React.createElement('span', { className: 'info-val' }, auth.user.id),
      ),
      React.createElement('div', { className: 'info-line' },
        React.createElement('span', { className: 'info-key' }, 'Selected Device'),
        React.createElement('span', { className: 'info-val' }, selectedDevice),
      ),
      React.createElement('div', { className: 'info-line' },
        React.createElement('span', { className: 'info-key' }, 'Messages'),
        React.createElement('span', { className: 'info-val' }, messages.length),
      ),
      React.createElement('div', { className: 'info-line' },
        React.createElement('span', { className: 'info-key' }, 'Access Token TTL'),
        React.createElement('span', { className: 'info-val' },
          auth.accessTokenExpiry ? `${Math.round((auth.accessTokenExpiry - Date.now()) / 1000)}s` : 'N/A'
        ),
      ),
    ),
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(React.createElement(ConsoleApp));