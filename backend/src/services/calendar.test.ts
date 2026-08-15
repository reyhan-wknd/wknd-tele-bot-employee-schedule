import { describe, expect, test } from 'vitest';
import { isLeaveEvent } from './calendar';

describe('isLeaveEvent', () => {
  test('tipe outOfOffice selalu dianggap cuti, apa pun judulnya', () => {
    expect(isLeaveEvent({ eventType: 'outOfOffice', summary: 'Rapat' })).toBe(true);
    expect(isLeaveEvent({ eventType: 'outOfOffice' })).toBe(true);
  });

  test('judul yang menyebut cuti secara utuh', () => {
    for (const judul of ['Cuti tahunan', 'Annual Leave', 'Day off', 'day-off', 'Izin sakit', 'PTO', 'OOO']) {
      expect(isLeaveEvent({ summary: judul }), judul).toBe(true);
    }
  });

  test('kata yang kebetulan memuat "off" tidak lagi terbaca cuti', () => {
    for (const judul of [
      'Ke office pagi',
      'Coffee chat with PM',
      'Kickoff project NEMO',
      'Offsite team',
      'Sprint handoff',
      'Backoffice sync',
    ]) {
      expect(isLeaveEvent({ summary: judul }), judul).toBe(false);
    }
  });

  test('event biasa tanpa judul relevan', () => {
    expect(isLeaveEvent({ summary: 'Daily standup' })).toBe(false);
    expect(isLeaveEvent({ summary: null })).toBe(false);
    expect(isLeaveEvent({})).toBe(false);
  });
});
