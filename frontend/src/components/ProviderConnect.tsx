'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { PlugZap, Unplug, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { providersAPI, type ProviderStatus } from '@/lib/playback';

interface ProviderConnectProps {
  compact?: boolean;
  onStatusChange?: (connected: boolean) => void;
}

/**
 * Minimal TorBox connect/status card. The API key is sent once in the connect
 * POST body and never rendered back — status only shows the masked fingerprint.
 */
export default function ProviderConnect({ compact, onStatusChange }: ProviderConnectProps) {
  const { status } = useSession();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [torbox, setTorbox] = useState<ProviderStatus | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchStatus = useCallback(async () => {
    if (status !== 'authenticated') {
      setLoading(false);
      return;
    }
    try {
      const data = await providersAPI.status();
      const tb = data?.torbox ?? null;
      setTorbox(tb);
      onStatusChange?.(Boolean(tb?.connected));
    } catch {
      // Backend down or unauthorized: leave card in disconnected state.
      setTorbox(null);
    } finally {
      setLoading(false);
    }
  }, [status, onStatusChange]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    const key = apiKey.trim();
    if (key.length < 8) {
      setMessage({ type: 'error', text: 'API key quá ngắn, vui lòng kiểm tra lại' });
      return;
    }
    setSaving(true);
    try {
      await providersAPI.connect(key);
      setApiKey('');
      setMessage({ type: 'success', text: 'Đã kết nối TorBox' });
      await fetchStatus();
    } catch (error: any) {
      setMessage({
        type: 'error',
        text: error?.message || 'Kết nối thất bại, vui lòng thử lại',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    setMessage(null);
    setSaving(true);
    try {
      await providersAPI.disconnect();
      setTorbox(null);
      onStatusChange?.(false);
      setMessage({ type: 'success', text: 'Đã ngắt kết nối TorBox' });
    } catch (error: any) {
      setMessage({
        type: 'error',
        text: error?.message || 'Ngắt kết nối thất bại',
      });
    } finally {
      setSaving(false);
    }
  };

  if (status === 'unauthenticated') {
    return (
      <div className="rounded-xl border border-white/10 bg-surface-light p-4 text-sm text-cinema-subtle">
        Đăng nhập để kết nối TorBox và phát phim từ nguồn của bạn.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-surface-light p-4 text-sm text-cinema-subtle">
        <Loader2 size={16} className="animate-spin" /> Đang kiểm tra kết nối TorBox...
      </div>
    );
  }

  const connected = Boolean(torbox?.connected);

  return (
    <div className="rounded-xl border border-white/10 bg-surface-light p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <PlugZap size={18} className={connected ? 'text-green-500' : 'text-cinema-subtle'} />
          <p className="text-sm font-bold text-white">TorBox</p>
        </div>
        {connected ? (
          <span className="flex items-center gap-1 text-xs font-bold text-green-500">
            <CheckCircle2 size={14} /> Đã kết nối
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs font-bold text-cinema-subtle">
            <XCircle size={14} /> Chưa kết nối
          </span>
        )}
      </div>

      {connected && torbox ? (
        <div className="mt-3 space-y-2 text-sm">
          <p className="font-mono text-xs text-cinema-subtle">
            Key: <span className="text-cinema-text">{torbox.masked || '••••'}</span>
            {torbox.plan && <span className="ml-2 text-cinema-subtle">· {torbox.plan}</span>}
          </p>
          {!compact && (
            <button
              onClick={handleDisconnect}
              disabled={saving}
              className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-bold text-cinema-muted transition-colors hover:bg-surface-container disabled:opacity-50"
            >
              <Unplug size={14} />
              {saving ? 'Đang xử lý...' : 'Ngắt kết nối'}
            </button>
          )}
        </div>
      ) : (
        <form onSubmit={handleConnect} className="mt-3 space-y-2">
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Dán TorBox API key..."
            className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 font-mono text-sm text-white placeholder:text-cinema-subtle focus:border-amber-primary focus:outline-none"
          />
          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-lg bg-amber-primary px-3 py-2 text-sm font-bold text-white transition-colors hover:bg-amber-600 disabled:opacity-50"
          >
            {saving ? 'Đang kết nối...' : 'Kết nối TorBox'}
          </button>
          <p className="text-[11px] leading-relaxed text-cinema-subtle">
            Key chỉ gửi tới server của bạn để xác thực, không bao giờ hiển thị lại.
          </p>
        </form>
      )}

      {message && (
        <p
          className={`mt-3 rounded-lg border px-3 py-2 text-xs font-bold ${
            message.type === 'success'
              ? 'border-green-900/30 bg-green-900/20 text-green-500'
              : 'border-wine-accent/30 bg-wine-accent/15 text-amber-gold'
          }`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
