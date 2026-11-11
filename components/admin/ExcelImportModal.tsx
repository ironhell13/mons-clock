'use client';

import { useState } from 'react';
import { FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Modal } from '@/components/ui/Modal';
import { parseMasterExcelFile, type MasterEntityKey, type ParsedMasterPreview } from '@/lib/excel';
import { MASTER_CONFIG } from '@/lib/master-config';

interface ExcelImportModalProps {
  open: boolean;
  onClose: () => void;
  entity: MasterEntityKey;
  onImported: () => void;
}

export function ExcelImportModal({
  open,
  onClose,
  entity,
  onImported,
}: ExcelImportModalProps) {
  const meta = MASTER_CONFIG[entity];
  const [preview, setPreview] = useState<ParsedMasterPreview | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParsing(true);
    try {
      const result = await parseMasterExcelFile(file, entity);
      setPreview(result);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal membaca file Excel/CSV.');
      setPreview(null);
    } finally {
      setParsing(false);
    }
  };

  const handleConfirmImport = async () => {
    if (!preview || preview.rows.length === 0) return;
    setImporting(true);
    try {
      const res = await fetch(`/api/master/${entity}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: preview.rows }),
      });
      const json = (await res.json()) as { count?: number; error?: string };
      if (!res.ok) {
        toast.error(json.error ?? 'Gagal mengimport data.');
        return;
      }
      toast.success(`${json.count ?? preview.rows.length} data ${meta.singular} berhasil diimport.`);
      setPreview(null);
      onImported();
      onClose();
    } catch {
      toast.error('Terjadi kesalahan jaringan saat import.');
    } finally {
      setImporting(false);
    }
  };

  const handleClose = () => {
    setPreview(null);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={`Import ${meta.title} dari Excel / CSV`}
      description={`Otomatis mencari sheet "${meta.sheetName}" (atau sheet pertama), membersihkan spasi berlebih, dan menghapus duplikat.`}
      maxWidthClass="max-w-3xl"
    >
      <div className="space-y-4">
        <label className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-primary-300 bg-page/60 hover:bg-primary-50/70 px-6 py-8 cursor-pointer transition">
          <Upload className="w-8 h-8 text-primary-600 mb-2" />
          <span className="text-sm font-bold text-ink">Pilih file .xlsx, .xls, atau .csv</span>
          <span className="text-xs text-ink-muted mt-1">
            Kolom diharapkan: {meta.exportHeaders.join(', ')}
          </span>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFileChange}
            className="hidden"
          />
        </label>

        {parsing && (
          <div className="flex items-center justify-center gap-2 py-4 text-sm text-primary-700">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Membaca dan membersihkan data...</span>
          </div>
        )}

        {preview && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-primary-100 text-primary-700 px-3 py-1 font-bold">
                <FileSpreadsheet className="w-3.5 h-3.5" />
                Sheet: {preview.sheetUsed}
              </span>
              <span className="rounded-lg bg-emerald-100 text-emerald-800 px-3 py-1 font-bold">
                Siap import: {preview.rows.length} baris
              </span>
              {preview.duplicatesRemoved > 0 && (
                <span className="rounded-lg bg-amber-100 text-amber-800 px-3 py-1 font-semibold">
                  Duplikat dibersihkan: {preview.duplicatesRemoved}
                </span>
              )}
              {preview.invalidRows > 0 && (
                <span className="rounded-lg bg-slate-100 text-slate-700 px-3 py-1 font-semibold">
                  Baris kosong dilewati: {preview.invalidRows}
                </span>
              )}
            </div>

            <div className="max-h-64 overflow-auto rounded-xl border border-border-sky">
              <table className="w-full text-xs text-left">
                <thead className="bg-primary-50 text-ink font-bold sticky top-0">
                  <tr>
                    <th className="px-3 py-2">#</th>
                    {meta.previewColumns.map((col) => (
                      <th key={col.key} className="px-3 py-2">
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-sky">
                  {preview.rows.slice(0, 50).map((row, idx) => (
                    <tr key={idx}>
                      <td className="px-3 py-2 text-ink-muted">{idx + 1}</td>
                      {meta.previewColumns.map((col) => (
                        <td key={col.key} className="px-3 py-2 font-medium text-ink">
                          {row[col.key] || '-'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.rows.length > 50 && (
                <div className="px-3 py-2 text-xs text-ink-muted bg-page/60 border-t border-border-sky">
                  Menampilkan 50 baris pertama dari {preview.rows.length} baris bersih.
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-xl border border-border-sky bg-white px-4 py-2.5 text-sm font-semibold text-ink hover:bg-page"
          >
            Batal
          </button>
          <button
            type="button"
            disabled={!preview || preview.rows.length === 0 || importing}
            onClick={handleConfirmImport}
            className="rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white px-5 py-2.5 text-sm font-semibold flex items-center gap-2 transition"
          >
            {importing && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>Import ke Database</span>
          </button>
        </div>
      </div>
    </Modal>
  );
}

