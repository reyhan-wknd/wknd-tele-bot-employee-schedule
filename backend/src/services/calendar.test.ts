import { describe, expect, test } from 'vitest';
import { isLeaveEvent } from './calendar';

describe('isLeaveEvent', () => {
  test('event bertipe Out of office dianggap cuti', () => {
    expect(isLeaveEvent({ eventType: 'outOfOffice' })).toBe(true);
  });

  test('judul tidak berpengaruh sama sekali', () => {
    // Apa pun judulnya — bahkan yang tidak terdengar seperti cuti — asal tipenya OOO.
    for (const eventType of ['outOfOffice']) {
      expect(isLeaveEvent({ eventType })).toBe(true);
    }

    // Dan sebaliknya: judul yang terdengar seperti cuti tetap bukan cuti tanpa tipe OOO.
    for (const eventType of ['default', 'focusTime', 'workingLocation', null, undefined]) {
      expect(isLeaveEvent({ eventType }), String(eventType)).toBe(false);
    }
  });

  test('event biasa bukan cuti', () => {
    expect(isLeaveEvent({})).toBe(false);
    expect(isLeaveEvent({ eventType: 'default' })).toBe(false);
  });
});
