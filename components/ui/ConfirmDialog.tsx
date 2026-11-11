'use client';

import { AlertTriangle, Loader2 } from 'lucide-react';
import { Modal } from './Modal';

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'primary';
  loading?: boolean;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Ya, Lanjutkan',
  cancelLabel = 'Batal',
  variant = 'danger',
  loading = false,
}: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onClose} title={title} maxWidthClass="max-w-md">
      <div className="flex items-start gap-3.5">
        <div
          className={`rounded-xl p-2.5 shrink-0 ${
            variant === 'danger' ? 'bg-danger/10 text-danger' : 'bg-primary-100 text-primary-700'
          }`}
        >
          <AlertTriangle className="w-5 h-5" />
        </div>
        <p className="text-sm text-ink-muted leading-relaxed">{message}</p>
      </div>
      <div className="mt-6 flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          disabled={loading}
          className="rounded-xl border border-border-sky bg-white px-4 py-2.5 text-sm font-semibold text-ink hover:bg-page transition"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={loading}
          className={`rounded-xl px-4 py-2.5 text-sm font-semibold text-white flex items-center gap-2 transition disabled:opacity-60 ${
            variant === 'danger'
              ? 'bg-danger hover:bg-red-600'
              : 'bg-primary-600 hover:bg-primary-700'
          }`}
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          <span>{confirmLabel}</span>
        </button>
      </div>
    </Modal>
  );
}

