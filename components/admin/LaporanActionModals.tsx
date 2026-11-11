'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { formatWibDateTime } from '@/lib/time';
import { Modal } from '@/components/ui/Modal';

export interface LaporanAuditItem {
  id: string;
  action?: string;
  reason: string | null;
  actor_name: string;
  created_at: string;
}

export function DeleteLaporanModal({
  open,
  title,
  summary,
  loading,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  summary: string;
  loading: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason('');
      setError(null);
    }
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < 3) {
      setError('Alasan penghapusan wajib diisi minimal 3 karakter.');
      return;
    }
    setError(null);
    onConfirm(reason.trim());
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description="Penghapusan data bersifat permanen dan tercatat di Audit Log."
      maxWidthClass="max-w-md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex items-start gap-3 rounded-xl bg-danger/10 border border-danger/25 p-3.5 text-sm text-ink">
          <AlertTriangle className="w-5 h-5 text-danger shrink-0 mt-0.5" />
          <p className="leading-relaxed">{summary}</p>
        </div>

        <div>
          <label className="block text-sm font-semibold text-ink mb-1">
            Alasan Penghapusan *
          </label>
          <textarea
            rows={2}
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Contoh: Salah scan saat uji coba / data ganda"
            className="w-full rounded-xl border border-border-sky px-3.5 py-2.5 text-sm focus:border-primary-600 focus:outline-none"
          />
          {error && <p className="mt-1 text-xs font-semibold text-danger">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-3 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-xl border border-border-sky bg-white px-4 py-2.5 text-sm font-semibold text-ink hover:bg-page"
          >
            Batal
          </button>
          <button
            type="submit"
            disabled={loading}
            className="rounded-xl bg-danger hover:bg-red-600 disabled:opacity-60 text-white px-4 py-2.5 text-sm font-semibold flex items-center gap-2 transition"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>Hapus Permanen</span>
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function AuditLogsModal({
  open,
  onClose,
  title,
  auditLogs,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  auditLogs: LaporanAuditItem[];
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} maxWidthClass="max-w-2xl">
      {auditLogs.length === 0 ? (
        <p className="text-sm text-ink-muted py-6 text-center">
          Belum ada riwayat koreksi atau penghapusan.
        </p>
      ) : (
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {auditLogs.map((log) => {
            const isDelete = log.action === 'admin_delete';
            return (
              <div
                key={log.id}
                className="rounded-xl bg-page border border-border-sky p-3.5 text-xs space-y-1.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 font-bold text-ink">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${
                        isDelete
                          ? 'bg-danger/15 text-danger'
                          : 'bg-primary-100 text-primary-700'
                      }`}
                    >
                      {isDelete ? 'Hapus' : 'Koreksi'}
                    </span>
                    <span>Oleh: {log.actor_name}</span>
                  </div>
                  <span className="text-ink-muted">{formatWibDateTime(log.created_at)} WIB</span>
                </div>
                <div className="text-ink-muted">
                  Alasan: <strong className="text-ink">{log.reason || '-'}</strong>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
