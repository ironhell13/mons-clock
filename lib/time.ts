import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { id as idLocale } from 'date-fns/locale';

export const WIB_TIMEZONE = 'Asia/Jakarta';

export function toWibDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return formatInTimeZone(d, WIB_TIMEZONE, "yyyy-MM-dd'T'HH:mm");
}

export function fromWibDatetimeLocal(localValue: string | null | undefined): string | null {
  if (!localValue || !localValue.trim()) return null;
  const utcDate = fromZonedTime(localValue.trim(), WIB_TIMEZONE);
  if (Number.isNaN(utcDate.getTime())) return null;
  return utcDate.toISOString();
}

export function getWibDateString(date: Date | string = new Date()): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return formatInTimeZone(d, WIB_TIMEZONE, 'yyyy-MM-dd');
}

export function formatWibDateFull(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return formatInTimeZone(d, WIB_TIMEZONE, 'EEEE, dd MMMM yyyy', { locale: idLocale });
}

export function formatWibDateShort(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return formatInTimeZone(d, WIB_TIMEZONE, 'dd MMM yyyy', { locale: idLocale });
}

export function formatWibTimeSeconds(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return `${formatInTimeZone(d, WIB_TIMEZONE, 'HH:mm:ss')} WIB`;
}

export function formatWibTimeShort(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return formatInTimeZone(d, WIB_TIMEZONE, 'HH:mm');
}

export function formatWibDateTime(date: Date | string | null | undefined): string {
  if (!date) return '-';
  const d = typeof date === 'string' ? new Date(date) : date;
  return formatInTimeZone(d, WIB_TIMEZONE, 'dd/MM/yyyy HH:mm', { locale: idLocale });
}

export function formatWibDateTimeExcel(date: Date | string | null | undefined): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  return formatInTimeZone(d, WIB_TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
}

export function formatDurationHHMM(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || Number.isNaN(minutes)) return '-';
  const safe = Math.max(0, Math.floor(minutes));
  const hrs = Math.floor(safe / 60);
  const mins = safe % 60;
  return `${String(hrs).padStart(2, '0')}-${String(mins).padStart(2, '0')}`;
}

export function formatWibDateOnlyLabel(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  // Parse YYYY-MM-DD safely as midnight WIB
  const d = new Date(`${dateStr}T00:00:00+07:00`);
  return formatInTimeZone(d, WIB_TIMEZONE, 'dd MMM yyyy', { locale: idLocale });
}
