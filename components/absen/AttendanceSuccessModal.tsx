'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, Calendar, Check, Clock, User } from 'lucide-react';

interface SuccessPopupProps {
  open: boolean;
  title?: string;
  name: string;
  subtitle?: string;
  dateLabel: string;
  timeLabel: string;
  extraRows?: { label: string; value: string }[];
  onClose: () => void;
  autoCloseSeconds?: number;
}

export function AttendanceSuccessModal({
  open,
  title = 'Absen Berhasil',
  name,
  subtitle,
  dateLabel,
  timeLabel,
  extraRows,
  onClose,
  autoCloseSeconds = 4,
}: SuccessPopupProps) {
  const [remaining, setRemaining] = useState(autoCloseSeconds);

  useEffect(() => {
    if (!open) return;
    setRemaining(autoCloseSeconds);
    const interval = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          onClose();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [open, autoCloseSeconds, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/45 backdrop-blur-sm p-4">
      <motion.div
        initial={{ scale: 0.9, opacity: 0, y: 12 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        className="w-full max-w-lg rounded-3xl bg-white border-2 border-primary-200 shadow-card overflow-hidden"
      >
        <div className="bg-gradient-to-br from-primary-50 via-white to-sky-100/70 px-8 pt-8 pb-6 text-center">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 18, delay: 0.08 }}
            className="w-20 h-20 rounded-full bg-emerald-500 text-white flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/30"
          >
            <Check className="w-11 h-11 stroke-[3]" />
          </motion.div>
          <h2 className="mt-4 text-2xl font-extrabold text-ink">{title}</h2>
          {subtitle && <p className="text-sm font-medium text-ink-muted mt-1">{subtitle}</p>}
        </div>

        <div className="px-8 py-6 space-y-3 bg-white">
          <div className="rounded-2xl bg-page border border-border-sky p-4 space-y-3">
            <div className="flex items-center gap-3">
              <User className="w-5 h-5 text-primary-600 shrink-0" />
              <div>
                <div className="text-xs font-semibold text-ink-muted">Nama</div>
                <div className="text-lg font-extrabold text-ink">{name}</div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Calendar className="w-5 h-5 text-primary-600 shrink-0" />
              <div>
                <div className="text-xs font-semibold text-ink-muted">Tanggal</div>
                <div className="text-base font-bold text-ink">{dateLabel}</div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Clock className="w-5 h-5 text-primary-600 shrink-0" />
              <div>
                <div className="text-xs font-semibold text-ink-muted">Jam</div>
                <div className="text-lg font-extrabold text-primary-700 tabular-nums">
                  {timeLabel}
                </div>
              </div>
            </div>

            {extraRows?.map((row) => (
              <div key={row.label} className="pt-2 border-t border-border-sky flex justify-between text-sm">
                <span className="font-semibold text-ink-muted">{row.label}</span>
                <span className="font-extrabold text-ink">{row.value}</span>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-2xl bg-primary-600 hover:bg-primary-700 text-white py-3.5 text-base font-bold transition min-h-[54px]"
          >
            Selesai ({remaining}d)
          </button>
        </div>
      </motion.div>
    </div>
  );
}

export function AttendanceWarningModal({
  open,
  title,
  message,
  employeeName,
  onClose,
}: {
  open: boolean;
  title: string;
  message: string;
  employeeName?: string;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/45 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-3xl bg-white border-2 border-amber-200 shadow-card p-7 text-center space-y-4">
        <div className="w-16 h-16 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center mx-auto">
          <AlertTriangle className="w-9 h-9" />
        </div>
        <div>
          <h3 className="text-xl font-extrabold text-ink">{title}</h3>
          {employeeName && (
            <p className="text-sm font-bold text-primary-700 mt-1">{employeeName}</p>
          )}
          <p className="text-sm text-ink-muted mt-2 leading-relaxed">{message}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-2xl bg-amber-500 hover:bg-amber-600 text-white py-3.5 text-base font-bold transition min-h-[52px]"
        >
          Mengerti
        </button>
      </div>
    </div>
  );
}

