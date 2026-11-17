'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Check, Delete, KeyRound, Loader2, RotateCcw, UserCheck, X } from 'lucide-react';
import type { SubjectType } from '@/types/database';

export interface ConfirmCandidate {
  id: string;
  name: string;
  subtitle: string;
}

interface ConfirmIdentitySheetProps {
  open: boolean;
  verificationId: string;
  subjectType: SubjectType;
  candidates: ConfirmCandidate[];
  onConfirmed: (subject: { id: string; name: string; subtitle: string; code?: string }) => void;
  onCancel: () => void;
}

export function ConfirmIdentitySheet({
  open,
  verificationId,
  subjectType,
  candidates,
  onConfirmed,
  onCancel,
}: ConfirmIdentitySheetProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pinCode, setPinCode] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [remainingAttempts, setRemainingAttempts] = useState<number>(3);
  const [isLocked, setIsLocked] = useState<boolean>(false);

  if (!open) return null;

  const selectedCandidate = candidates.find((c) => c.id === selectedId);

  const handleKeyPress = (digit: string) => {
    if (pinCode.length < 6) {
      setPinCode((prev) => prev + digit);
      setErrorMessage(null);
    }
  };

  const handleDeleteKey = () => {
    setPinCode((prev) => prev.slice(0, -1));
    setErrorMessage(null);
  };

  const handleSubmitConfirm = async (subjectId: string, factorVal?: string) => {
    setSubmitting(true);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/face/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          verification_id: verificationId,
          chosen_subject_id: subjectId,
          factor: factorVal ?? pinCode,
        }),
      });

      const json = (await res.json()) as {
        status?: string;
        error?: string;
        subject?: { id: string; name: string; subtitle: string; code?: string };
        remainingAttempts?: number;
      };

      if (!res.ok || json.status !== 'accepted') {
        if (json.status === 'locked' || (json.remainingAttempts !== undefined && json.remainingAttempts <= 0)) {
          setIsLocked(true);
          setErrorMessage(json.error ?? 'Percobaan salah 3 kali. Sesi verifikasi terkunci.');
          setTimeout(() => {
            onCancel();
          }, 2400);
          return;
        }

        setRemainingAttempts(json.remainingAttempts ?? remainingAttempts - 1);
        setErrorMessage(json.error ?? 'Verifikasi gagal. Periksa kembali 4 karakter terakhir No ID Anda.');
        setPinCode('');
        return;
      }

      if (json.subject) {
        onConfirmed(json.subject);
      }
    } catch {
      setErrorMessage('Terjadi gangguan jaringan saat konfirmasi.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink/50 backdrop-blur-sm p-0 sm:p-4">
      <motion.div
        initial={{ y: 50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 50, opacity: 0 }}
        className="w-full max-w-lg rounded-t-3xl sm:rounded-3xl bg-white border border-border-sky shadow-card overflow-hidden"
      >
        {/* Header Sheet */}
        <div className="bg-gradient-to-r from-amber-50 via-white to-primary-50 px-6 py-5 border-b border-border-sky flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center font-bold">
              <UserCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-extrabold text-ink">Konfirmasi Identitas</h3>
              <p className="text-xs text-ink-muted">
                {selectedId
                  ? 'Masukkan 4 karakter terakhir No ID Anda'
                  : 'Sistem mendeteksi kemiripan wajah. Pilih nama Anda:'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="w-9 h-9 rounded-xl hover:bg-page flex items-center justify-center text-ink-muted transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-4">
          {errorMessage && (
            <div className="rounded-2xl bg-danger/10 border border-danger/20 p-3.5 flex items-center gap-3 text-danger text-sm font-semibold">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          <AnimatePresence mode="wait">
            {!selectedId ? (
              // Step 1: Pilihan Nama Kandidat
              <motion.div
                key="step-select"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-2.5"
              >
                {candidates.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    disabled={submitting}
                    onClick={() => {
                      if (subjectType === 'escort') {
                        // Pengawal langsung submit tanpa No ID
                        handleSubmitConfirm(c.id, '');
                      } else {
                        setSelectedId(c.id);
                        setErrorMessage(null);
                      }
                    }}
                    className="w-full text-left rounded-2xl border-2 border-border-sky hover:border-primary-500 bg-white hover:bg-page p-4 flex items-center justify-between transition group shadow-sm active:scale-[0.99]"
                  >
                    <div>
                      <div className="text-base font-extrabold text-ink group-hover:text-primary-700">
                        {c.name}
                      </div>
                      <div className="text-xs font-semibold text-ink-muted mt-0.5">
                        {c.subtitle}
                      </div>
                    </div>
                    <div className="w-8 h-8 rounded-full border border-border-sky flex items-center justify-center group-hover:border-primary-500 group-hover:bg-primary-50 text-primary-600">
                      <Check className="w-4 h-4 opacity-0 group-hover:opacity-100 transition" />
                    </div>
                  </button>
                ))}
              </motion.div>
            ) : (
              // Step 2: Keypad 4 Karakter Terakhir No ID (Khusus Karyawan)
              <motion.div
                key="step-pin"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <div className="bg-primary-50/60 rounded-2xl p-3 flex items-center justify-between border border-primary-200">
                  <div>
                    <div className="text-xs font-semibold text-primary-700">Nama Dipilih:</div>
                    <div className="text-base font-extrabold text-ink">{selectedCandidate?.name}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(null);
                      setPinCode('');
                      setErrorMessage(null);
                    }}
                    className="text-xs font-bold text-primary-700 hover:underline inline-flex items-center gap-1"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Ganti Nama
                  </button>
                </div>

                {/* Display Kode Terketik */}
                <div className="text-center">
                  <div className="text-xs font-semibold text-ink-muted mb-2 flex items-center justify-center gap-1.5">
                    <KeyRound className="w-4 h-4 text-primary-600" />
                    <span>Ketik 4 digit/huruf terakhir No ID Anda (Sisa kesempatan: {remainingAttempts})</span>
                  </div>
                  <div className="h-14 rounded-2xl border-2 border-primary-300 bg-page flex items-center justify-center gap-2 px-4">
                    <span className="text-2xl font-black tracking-widest text-ink tabular-nums uppercase">
                      {pinCode || '____'}
                    </span>
                  </div>
                </div>

                {/* Keypad Angka Ramah Tablet */}
                <div className="grid grid-cols-3 gap-2 max-w-xs mx-auto">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                    <button
                      key={digit}
                      type="button"
                      disabled={submitting || isLocked}
                      onClick={() => handleKeyPress(digit)}
                      className="h-12 rounded-xl border border-border-sky bg-white hover:bg-page active:bg-primary-50 text-lg font-extrabold text-ink shadow-sm transition"
                    >
                      {digit}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={submitting || isLocked}
                    onClick={handleDeleteKey}
                    className="h-12 rounded-xl border border-border-sky bg-white hover:bg-page active:bg-danger/10 text-ink-muted flex items-center justify-center shadow-sm transition"
                  >
                    <Delete className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    disabled={submitting || isLocked}
                    onClick={() => handleKeyPress('0')}
                    className="h-12 rounded-xl border border-border-sky bg-white hover:bg-page active:bg-primary-50 text-lg font-extrabold text-ink shadow-sm transition"
                  >
                    0
                  </button>
                  <button
                    type="button"
                    disabled={submitting || isLocked || pinCode.length < 2}
                    onClick={() => handleSubmitConfirm(selectedId, pinCode)}
                    className="h-12 rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white font-extrabold text-sm flex items-center justify-center shadow-sm transition"
                  >
                    {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Kirim'}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="pt-2 border-t border-border-sky flex items-center justify-between">
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="text-xs font-bold text-ink-muted hover:text-ink transition"
            >
              Bukan salah satu ini / Scan ulang
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

