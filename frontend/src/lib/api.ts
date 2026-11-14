/**
 * MedSupply Sentinel - Typed API Client for FastAPI Backend
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';

export async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('sentinel_jwt') : null;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ detail: 'Request failed' }));
    throw new Error(errBody.detail || `HTTP error ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export const sentinelApi = {
  getOverview: () => apiRequest<Record<string, number>>('/analytics/overview'),
  listBatches: () => apiRequest<any[]>('/manufacturer/batches'),
  createBatch: (payload: Record<string, any>) =>
    apiRequest<any>('/manufacturer/batches', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  verifyQR: (payload: { qr_payload?: string; serial_number?: string }) =>
    apiRequest<any>('/verification/scan', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  recordTelemetry: (payload: {
    batch_id: string;
    temperature: number;
    humidity: number;
    latitude: number;
    longitude: number;
    device_id: string;
  }) =>
    apiRequest<any>('/distributor/telemetry', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  quarantineBatch: (payload: { batch_id: string; reason: string; severity?: string }) =>
    apiRequest<any>('/regulator/quarantine', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};
