import React, { useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

// Inline copy of shared types (avoids cross-package import issues)
interface AuthState {
  user: { id: string };
  accessToken: string;
  refreshToken: string;
  accessTokenExpiry: number;
}

const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000');

async function apiCall(endpoint: string, options: RequestInit = {}, token?: string): Promise<any> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers: { ...headers, ...options.headers } });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message || `API error ${res.status}`);
  return json;
}

interface Props {
  onAuth: (state: AuthState) => void;
  onError: (msg: string) => void;
}

const otpCode = Array.from({ length: 6 }, () =>
  Math.floor(Math.random() * 10)
).join('');

export default function AuthScreen({ onAuth, onError }: Props) {
  const phoneRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<'phone' | 'code'>('phone');
  const [phone, setPhone] = React.useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const requestCode = useCallback(async () => {
    if (!phoneRef.current?.value) { onError('Enter phone number'); return; }
    setLoading(true);
    try {
      await apiCall('/auth/otp/request', {
        method: 'POST',
        body: JSON.stringify({ phone: phoneRef.current.value }),
      });
      setSent(true);
      stageRef.current = 'code';
    } catch (e: any) {
      onError(e.message || 'Failed to request OTP');
    } finally {
      setLoading(false);
    }
  }, [phone, onError]);

  const verifyCode = useCallback(async () => {
    if (!codeRef.current?.value) { onError('Enter verification code'); return; }
    setLoading(true);
    try {
      const data = await apiCall('/auth/otp/verify', {
        method: 'POST',
        body: JSON.stringify({ phone: phoneRef.current?.value, code: codeRef.current?.value }),
      });
      onAuth({
        user: data.user,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        accessTokenExpiry: Date.now() + 15 * 60 * 1000, // 15 min default
      });
    } catch (e: any) {
      onError(e.message || 'Invalid code');
    } finally {
      setLoading(false);
    }
  }, [onAuth, onError]);

  return React.createElement('div', { className: 'auth-overlay' },
    React.createElement('div', { className: 'auth-box' },
      React.createElement('h1', null, '>_ BIRGAP'),
      React.createElement('p', { style: { color: '#00d4ff', marginBottom: 20, fontSize: 12 } },
        'End-to-End Encrypted Messenger — Terminal Edition'),

      stageRef.current === 'phone' && React.createElement(React.Fragment, null,
        React.createElement('label', null, 'PHONE NUMBER'),
        React.createElement('input', {
          ref: phoneRef,
          type: 'tel',
          placeholder: '+1234567890',
          onChange: (e) => setPhone(e.target.value),
        }),
        React.createElement('button', {
          onClick: requestCode,
          disabled: loading || !phone.trim(),
          style: { opacity: loading || !phone.trim() ? 0.5 : 1 },
        }, loading ? 'REQUESTING...' : 'REQUEST OTP'),
      ),

      stageRef.current === 'code' && React.createElement(React.Fragment, null,
        React.createElement('label', null, 'OTP CODE'),
        React.createElement('input', {
          ref: codeRef,
          type: 'text',
          maxLength: 6,
          placeholder: '------',
          onChange: (e) => setCode(e.target.value),
          autoFocus: true,
        }),
        sent && React.createElement('div', { className: 'muted' },
          `Mock code: ${otpCode}`),
        React.createElement('button', {
          onClick: verifyCode,
          disabled: loading || code.length < 6,
          style: { opacity: loading || code.length < 6 ? 0.5 : 1 },
        }, loading ? 'VERIFYING...' : 'VERIFY & LOGIN'),
      ),

      React.createElement('div', { className: 'muted' },
        'OTP mode: mock | API: ',
        API_BASE
      )
    )
  );
}