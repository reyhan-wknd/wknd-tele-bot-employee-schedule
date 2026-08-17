import { Telegram } from 'telegraf';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * Tes ini menggerakkan handler bot yang sebenarnya lewat bot.handleUpdate, dengan
 * Telegram, database, dan Google Calendar ditiru.
 *
 * Fokus utamanya satu aturan yang mudah dirusak tanpa sadar: orang yang sudah check-in
 * lalu mendadak cuti di tengah hari harus tetap bisa check-out.
 */

const prismaTiruan = {
  user: { findUnique: vi.fn() },
  attendance: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  schedule: { findMany: vi.fn() },
  userSchedule: { findUnique: vi.fn() },
  holiday: { findMany: vi.fn() },
  scheduledJob: { create: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
};
vi.mock('./db', () => ({ prisma: prismaTiruan }));

const isUserOnLeave = vi.fn();
vi.mock('./services/calendar', () => ({ isUserOnLeave }));

const USER = {
  telegramId: 839050319n,
  googleEmail: 'reyhan.ramadhan@weekendinc.com',
  accessToken: 'a',
  refreshToken: 'r',
};

let bot: import('telegraf').Telegraf;
let terkirim: string[];

beforeAll(async () => {
  vi.stubEnv('BOT_TOKEN', '123:token-uji');
  vi.stubEnv('FRONTEND_URL', 'https://contoh.test');

  ({ bot } = await import('./bot'));
  bot.botInfo = { id: 1, is_bot: true, first_name: 'uji', username: 'uji_bot' } as never;
});

afterAll(() => vi.unstubAllEnvs());

beforeEach(() => {
  terkirim = [];
  // Disadap di prototipe, bukan di bot.telegram: handleUpdate membuat instance Telegram
  // baru untuk setiap update, jadi menambal instance yang ada tidak akan kena.
  vi.spyOn(Telegram.prototype, 'callApi').mockImplementation((async (metode: string, payload: { text?: string }) => {
    if (metode === 'sendMessage' && payload?.text) terkirim.push(payload.text);
    return {};
  }) as never);

  prismaTiruan.user.findUnique.mockResolvedValue(USER);
  prismaTiruan.attendance.update.mockResolvedValue({});
  // Bawaannya hari biasa; tes hari libur mengisinya sendiri.
  prismaTiruan.holiday.findMany.mockResolvedValue([]);
  prismaTiruan.attendance.create.mockResolvedValue({ id: 1 });
  prismaTiruan.scheduledJob.create.mockResolvedValue({ id: 1 });
  prismaTiruan.scheduledJob.updateMany.mockResolvedValue({ count: 0 });
  prismaTiruan.scheduledJob.findMany.mockResolvedValue([]);
  // Senin, 17 Agustus 2026, 11:00 WIB — hari kerja, sebelum jam pulang.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-08-17T04:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

const perintah = (text: string) =>
  bot.handleUpdate({
    update_id: 1,
    message: {
      message_id: 1,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 839050319, type: 'private' },
      from: { id: 839050319, is_bot: false, first_name: 'Reyhan' },
      text,
      entities: [{ offset: 0, length: text.length, type: 'bot_command' }],
    },
  } as never);

/** Balasan user ke pesan bot — bentuk yang dihasilkan force_reply di klien Telegram. */
const balasanKeBot = (text: string) =>
  bot.handleUpdate({
    update_id: 2,
    message: {
      message_id: 2,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 839050319, type: 'private' },
      from: { id: 839050319, is_bot: false, first_name: 'Reyhan' },
      text,
      reply_to_message: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 839050319, type: 'private' },
        from: { id: 1, is_bot: true, first_name: 'uji', username: 'uji_bot' },
        text: 'Balas pesan ini dengan jam pulangmu',
      },
    },
  } as never);

const absensi = (jamCheckInWIB: string, checkOut: Date | null = null) => ({
  id: 1,
  telegramId: USER.telegramId,
  date: new Date('2026-08-17T00:00:00.000Z'),
  checkIn: new Date(jamCheckInWIB),
  checkOut,
});

describe('/check_out saat user mendadak cuti', () => {
  test('tetap bisa check-out meski sedang cuti, asal sudah check-in', async () => {
    isUserOnLeave.mockResolvedValue(true); // OOO muncul di tengah hari
    prismaTiruan.attendance.findUnique.mockResolvedValue(absensi('2026-08-17T02:00:00Z')); // check-in 09:00 WIB
    vi.setSystemTime(new Date('2026-08-17T11:30:00Z')); // 18:30 WIB, sudah lewat 9,5 jam

    await perintah('/check_out');

    expect(prismaTiruan.attendance.update).toHaveBeenCalledOnce();
    expect(terkirim.join('\n')).toContain('Check-out berhasil');
    expect(isUserOnLeave).not.toHaveBeenCalled(); // status cuti tidak ikut diperiksa
  });

  test('belum genap jam kerja minta konfirmasi, bukan ditolak karena jam', async () => {
    isUserOnLeave.mockResolvedValue(true);
    prismaTiruan.attendance.findUnique.mockResolvedValue(absensi('2026-08-17T02:00:00Z'));
    // masih 11:00 WIB, ambangnya 18:00

    await perintah('/check_out');

    expect(prismaTiruan.attendance.update).not.toHaveBeenCalled();
    expect(terkirim.join('\n')).toMatch(/tetap mau check-out/i);
  });
});

describe('/check_out untuk absensi yang terlewat', () => {
  const KEMARIN = {
    ...absensi('2026-08-16T02:00:00Z'), // check-in 09:00 WIB tanggal 16
    id: 77,
    date: new Date('2026-08-16T00:00:00.000Z'),
  };

  beforeEach(() => {
    isUserOnLeave.mockResolvedValue(false);
    prismaTiruan.attendance.findUnique.mockResolvedValue(null); // belum check-in hari ini
    prismaTiruan.attendance.findFirst.mockResolvedValue(KEMARIN);
  });

  test('bot bertanya jamnya, tidak menutup dengan jam sekarang', async () => {
    await perintah('/check_out');

    expect(prismaTiruan.attendance.update).not.toHaveBeenCalled();
    expect(terkirim.join('\n')).toMatch(/format HH:MM/i);
  });

  test('balasan jam menutup absensi pada tanggalnya sendiri, bukan hari ini', async () => {
    await balasanKeBot('17:30');

    expect(prismaTiruan.attendance.update).toHaveBeenCalledOnce();
    const checkOut = prismaTiruan.attendance.update.mock.calls[0][0].data.checkOut as Date;
    // 17:30 WIB tanggal 16 = 10:30Z tanggal 16
    expect(checkOut.toISOString()).toBe('2026-08-16T10:30:00.000Z');
    expect(terkirim.join('\n')).toContain('Check-out berhasil');
  });

  test('titik sebagai pemisah juga diterima', async () => {
    await balasanKeBot('17.30');
    expect(prismaTiruan.attendance.update).toHaveBeenCalledOnce();
  });

  test('jam yang lebih awal dari check-in ditolak', async () => {
    await balasanKeBot('08:00'); // check-in 09:00

    expect(prismaTiruan.attendance.update).not.toHaveBeenCalled();
    expect(terkirim.join('\n')).toContain('setelah jam check-in');
  });

  test('format ngawur ditolak dengan contoh, bukan error server', async () => {
    await balasanKeBot('kemarin sore');

    expect(prismaTiruan.attendance.update).not.toHaveBeenCalled();
    expect(terkirim.join('\n')).toContain('17:30');
  });

  test('jam di luar 23:59 ditolak', async () => {
    await balasanKeBot('24:00');
    expect(prismaTiruan.attendance.update).not.toHaveBeenCalled();
  });

  test('reminder yang mengantre ikut dibatalkan setelah ditutup', async () => {
    await balasanKeBot('17:30');

    expect(prismaTiruan.scheduledJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { attendanceId: 77, status: 'pending' } })
    );
  });
});

describe('/check_in tetap menolak saat cuti', () => {
  test('cuti memblokir check-in — kontrol pembanding', async () => {
    isUserOnLeave.mockResolvedValue(true);
    prismaTiruan.attendance.findUnique.mockResolvedValue(null);

    await perintah('/check_in');

    expect(isUserOnLeave).toHaveBeenCalledOnce();
    expect(prismaTiruan.attendance.create).not.toHaveBeenCalled();
    expect(terkirim.join('\n')).toContain('sedang cuti');
  });

  test('tidak cuti — check-in berjalan normal', async () => {
    isUserOnLeave.mockResolvedValue(false);
    prismaTiruan.attendance.findUnique.mockResolvedValue(null);

    await perintah('/check_in');

    expect(prismaTiruan.attendance.create).toHaveBeenCalledOnce();
    expect(terkirim.join('\n')).toContain('Check-in berhasil');
  });
});

describe('/status ikut melaporkan status cuti', () => {
  test('sedang cuti dan belum absen — disebut, dan bukan "belum check-in"', async () => {
    isUserOnLeave.mockResolvedValue(true);
    prismaTiruan.attendance.findUnique.mockResolvedValue(null);

    await perintah('/status');

    const pesan = terkirim.join('\n');
    expect(pesan).toContain('sedang cuti hari ini');
    expect(pesan).toContain('Tidak perlu check-in');
    expect(pesan).not.toContain('Belum check-in');
  });

  test('hari kerja biasa — tidak ada keterangan apa pun', async () => {
    isUserOnLeave.mockResolvedValue(false);
    prismaTiruan.attendance.findUnique.mockResolvedValue(null);

    await perintah('/status');

    const pesan = terkirim.join('\n');
    expect(pesan).not.toContain('cuti');
    expect(pesan).not.toContain('libur');
    expect(pesan).toContain('Belum check-in');
  });

  test('hari libur terdaftar disebut, dan check-in tidak lagi dituntut', async () => {
    isUserOnLeave.mockResolvedValue(false);
    prismaTiruan.attendance.findUnique.mockResolvedValue(null);
    prismaTiruan.holiday.findMany.mockResolvedValue([
      { year: 0, month: 8, day: 17, label: 'Hari Proklamasi Kemerdekaan R.I.' },
    ]);

    await perintah('/status');

    const pesan = terkirim.join('\n');
    expect(pesan).toContain('Hari ini libur: Hari Proklamasi Kemerdekaan R.I.');
    expect(pesan).toContain('Tidak perlu check-in');
    expect(pesan).not.toContain('Belum check-in');
  });

  test('akhir pekan disebut sebagai akhir pekan', async () => {
    vi.setSystemTime(new Date('2026-08-22T03:00:00Z')); // Sabtu
    isUserOnLeave.mockResolvedValue(false);
    prismaTiruan.attendance.findUnique.mockResolvedValue(null);

    await perintah('/status');

    const pesan = terkirim.join('\n');
    expect(pesan).toContain('akhir pekan');
    expect(pesan).toContain('Tidak perlu check-in');
  });

  test('hari libur yang jatuh di akhir pekan disebut libur saja, tidak dua-duanya', async () => {
    vi.setSystemTime(new Date('2026-08-22T03:00:00Z')); // Sabtu
    isUserOnLeave.mockResolvedValue(false);
    prismaTiruan.attendance.findUnique.mockResolvedValue(null);
    prismaTiruan.holiday.findMany.mockResolvedValue([
      { year: 2026, month: 8, day: 22, label: 'Libur khusus' },
    ]);

    await perintah('/status');

    const pesan = terkirim.join('\n');
    expect(pesan).toContain('Hari ini libur: Libur khusus');
    expect(pesan).not.toContain('akhir pekan');
  });

  test('cuti dan hari libur bersamaan disebut dua-duanya', async () => {
    isUserOnLeave.mockResolvedValue(true);
    prismaTiruan.attendance.findUnique.mockResolvedValue(null);
    prismaTiruan.holiday.findMany.mockResolvedValue([
      { year: 0, month: 8, day: 17, label: 'Hari Kemerdekaan' },
    ]);

    await perintah('/status');

    const pesan = terkirim.join('\n');
    expect(pesan).toContain('sedang cuti hari ini');
    expect(pesan).toContain('Hari ini libur: Hari Kemerdekaan');
  });

  test('cuti tapi terlanjur check-in — absensinya tetap ditampilkan apa adanya', async () => {
    isUserOnLeave.mockResolvedValue(true);
    prismaTiruan.attendance.findUnique.mockResolvedValue(absensi('2026-08-17T02:00:00Z'));

    await perintah('/status');

    const pesan = terkirim.join('\n');
    expect(pesan).toContain('sedang cuti hari ini');
    expect(pesan).toContain('Check-in: 09.00');
  });

  test('kalender gagal dipanggil — status tetap tampil tanpa menuduh apa pun', async () => {
    // isUserOnLeave sudah fail-open di dalamnya; di sini dipastikan /status ikut aman.
    isUserOnLeave.mockResolvedValue(false);
    prismaTiruan.attendance.findUnique.mockResolvedValue(null);

    await perintah('/status');

    expect(terkirim.join('\n')).toContain('Akun terverifikasi');
  });
});

describe('guest hanya boleh /start dan /login', () => {
  beforeEach(() => {
    prismaTiruan.user.findUnique.mockResolvedValue(null); // belum login
  });

  test('/holiday ditolak sebelum login dan tidak menyentuh tabel libur', async () => {
    await perintah('/holiday');

    expect(terkirim.join('\n')).toContain('belum terverifikasi');
    expect(prismaTiruan.holiday.findMany).not.toHaveBeenCalled();
  });

  test.each(['/status', '/schedule', '/check_in', '/check_out', '/logout', '/history'])(
    '%s juga ditolak sebelum login',
    async (cmd) => {
      await perintah(cmd);
      expect(terkirim.join('\n')).toContain('belum terverifikasi');
    }
  );

  test('/start tetap terbuka untuk guest', async () => {
    await perintah('/start');
    expect(terkirim.join('\n')).toContain('Selamat datang');
  });
});

/** Waktu tes ini memang 17 Agustus 2026 — Hari Kemerdekaan, dan jatuh di hari Senin. */
describe('/check_in di hari libur meminta konfirmasi dulu', () => {
  const KEMERDEKAAN = [{ year: 0, month: 8, day: 17, label: 'Hari Kemerdekaan' }];

  test('entri berulang menahan pencatatan dan menawarkan tombol', async () => {
    isUserOnLeave.mockResolvedValue(false);
    prismaTiruan.attendance.findUnique.mockResolvedValue(null);
    prismaTiruan.holiday.findMany.mockResolvedValue(KEMERDEKAAN);

    await perintah('/check_in');

    expect(prismaTiruan.attendance.create).not.toHaveBeenCalled();
    expect(terkirim.join('\n')).toContain('Hari Kemerdekaan');
    expect(terkirim.join('\n')).toMatch(/tetap mau check-in/i);
  });

  test('entri khusus tahun lain tidak ikut menahan', async () => {
    isUserOnLeave.mockResolvedValue(false);
    prismaTiruan.attendance.findUnique.mockResolvedValue(null);
    prismaTiruan.holiday.findMany.mockResolvedValue([
      { year: 2027, month: 8, day: 17, label: 'Kemerdekaan 2027' },
    ]);

    await perintah('/check_in');

    expect(prismaTiruan.attendance.create).toHaveBeenCalledOnce();
    expect(terkirim.join('\n')).toContain('Check-in berhasil');
  });
});

describe('/check_in di akhir pekan juga meminta konfirmasi', () => {
  beforeEach(() => {
    isUserOnLeave.mockResolvedValue(false);
    prismaTiruan.attendance.findUnique.mockResolvedValue(null);
  });

  test('Sabtu siang menahan pencatatan dan menyebut akhir pekan', async () => {
    vi.setSystemTime(new Date('2026-08-22T03:00:00Z')); // Sabtu, 10:00 WIB

    await perintah('/check_in');

    expect(prismaTiruan.attendance.create).not.toHaveBeenCalled();
    expect(terkirim.join('\n')).toMatch(/akhir pekan/i);
    expect(terkirim.join('\n')).toMatch(/tetap mau check-in/i);
  });

  test('Minggu siang diperlakukan sama', async () => {
    vi.setSystemTime(new Date('2026-08-23T03:00:00Z')); // Minggu, 10:00 WIB

    await perintah('/check_in');

    expect(prismaTiruan.attendance.create).not.toHaveBeenCalled();
    expect(terkirim.join('\n')).toMatch(/akhir pekan/i);
  });

  test('Sabtu sebelum jam 08:00 tetap ditolak mutlak, tanpa tombol', async () => {
    vi.setSystemTime(new Date('2026-08-21T23:00:00Z')); // Sabtu, 06:00 WIB

    await perintah('/check_in');

    expect(prismaTiruan.attendance.create).not.toHaveBeenCalled();
    expect(terkirim.join('\n')).toContain('08:00');
    expect(terkirim.join('\n')).not.toMatch(/tetap mau check-in/i);
  });

  test('akhir pekan yang sekaligus hari libur menyebut dua-duanya', async () => {
    vi.setSystemTime(new Date('2026-05-31T03:00:00Z')); // Minggu, Waisak
    prismaTiruan.holiday.findMany.mockResolvedValue([
      { year: 2026, month: 5, day: 31, label: 'Hari Raya Waisak' },
    ]);

    await perintah('/check_in');

    const pesan = terkirim.join('\n');
    expect(pesan).toMatch(/akhir pekan/i);
    expect(pesan).toContain('Hari Raya Waisak');
  });

  test('hari kerja biasa tetap langsung tercatat tanpa tombol', async () => {
    vi.setSystemTime(new Date('2026-08-18T03:00:00Z')); // Selasa, 10:00 WIB

    await perintah('/check_in');

    expect(prismaTiruan.attendance.create).toHaveBeenCalledOnce();
    expect(terkirim.join('\n')).toContain('Check-in berhasil');
  });
});
