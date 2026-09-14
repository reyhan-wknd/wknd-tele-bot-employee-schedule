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
  userSchedule: { findUnique: vi.fn(), upsert: vi.fn() },
  holiday: { findMany: vi.fn() },
  scheduledJob: { create: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
};
vi.mock('./db', () => ({ prisma: prismaTiruan }));

const isUserOnLeave = vi.fn();
vi.mock('./services/calendar', () => ({ isUserOnLeave }));

const fetchActiveEmployees = vi.fn();
const findEmployeeByNik = vi.fn();
const findEmployeeByEmail = vi.fn();
vi.mock('./services/supabase', () => ({
  fetchActiveEmployees,
  findEmployeeByNik,
  findEmployeeByEmail,
}));

const USER = {
  telegramId: 839050319n,
  googleEmail: 'reyhan.ramadhan@weekendinc.com',
  accessToken: 'a',
  refreshToken: 'r',
};

let bot: import('telegraf').Telegraf;
let terkirim: string[];
/** Teks hasil editMessageText — bukti bahwa tombolnya ikut hilang saat dijawab. */
let disunting: string[];
/** Susunan inline keyboard dari tiap pesan bertombol yang dikirim. */
let tombolTerkirim: { text: string; callback_data?: string }[][][];

beforeAll(async () => {
  vi.stubEnv('BOT_TOKEN', '123:token-uji');
  vi.stubEnv('FRONTEND_URL', 'https://contoh.test');

  ({ bot } = await import('./bot'));
  bot.botInfo = { id: 1, is_bot: true, first_name: 'uji', username: 'uji_bot' } as never;
});

afterAll(() => vi.unstubAllEnvs());

beforeEach(() => {
  terkirim = [];
  disunting = [];
  tombolTerkirim = [];
  // Disadap di prototipe, bukan di bot.telegram: handleUpdate membuat instance Telegram
  // baru untuk setiap update, jadi menambal instance yang ada tidak akan kena.
  vi.spyOn(Telegram.prototype, 'callApi').mockImplementation((async (
    metode: string,
    payload: {
      text?: string;
      reply_markup?: { inline_keyboard?: { text: string; callback_data?: string }[][] };
    }
  ) => {
    if (metode === 'sendMessage' && payload?.text) {
      terkirim.push(payload.text);
      if (payload.reply_markup?.inline_keyboard) {
        tombolTerkirim.push(payload.reply_markup.inline_keyboard);
      }
    }
    if (metode === 'editMessageText' && payload?.text) disunting.push(payload.text);
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
  // Bawaannya belum terpasang ke data karyawan, jadi tidak ada jadwal WFO yang ikut disebut.
  prismaTiruan.userSchedule.findUnique.mockResolvedValue(null);
  prismaTiruan.schedule.findMany.mockResolvedValue([]);
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
      // Entity-nya hanya sepanjang perintahnya sendiri, seperti yang dikirim Telegram —
      // argumen sesudah spasi bukan bagian dari bot_command.
      entities: [{ offset: 0, length: text.split(' ')[0].length, type: 'bot_command' }],
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

/** Penekanan tombol inline — bentuk update yang dikirim Telegram untuk callback_query. */
const tekanTombol = (data: string) =>
  bot.handleUpdate({
    update_id: 3,
    callback_query: {
      id: 'cb-1',
      chat_instance: 'ci-1',
      from: { id: 839050319, is_bot: false, first_name: 'Reyhan' },
      data,
      message: {
        message_id: 9,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 839050319, type: 'private' },
        from: { id: 1, is_bot: true, first_name: 'uji', username: 'uji_bot' },
        text: 'Pilih salah satu:',
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
    // Kalender memang tersentuh, tapi untuk keadaan besok — bukan sebagai gerbang hari ini.
    // Kalau ia dipakai sebagai gerbang, absensinya tidak akan tertutup di atas.
    expect((isUserOnLeave.mock.calls[0]?.[1] as Date | undefined)?.toISOString()).toBe(
      '2026-08-18T05:00:00.000Z' // tengah hari WIB besok
    );
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

describe('/check_out menyebutkan keadaan besok', () => {
  /** Sudah lewat jam pulang, jadi check-out langsung tercatat tanpa tombol konfirmasi. */
  const sudahJamPulang = () => {
    prismaTiruan.attendance.findUnique.mockResolvedValue(absensi('2026-08-17T02:00:00Z'));
    vi.setSystemTime(new Date('2026-08-17T11:30:00Z')); // 18:30 WIB
  };

  const jadwalBesok = (...projects: string[]) => {
    prismaTiruan.userSchedule.findUnique.mockResolvedValue({
      telegramId: USER.telegramId,
      employeeNik: 'NIK1',
    });
    prismaTiruan.schedule.findMany.mockResolvedValue(
      projects.map((projectName) => ({ date: new Date('2026-08-18T00:00:00.000Z'), projectName }))
    );
  };

  beforeEach(() => {
    isUserOnLeave.mockResolvedValue(false);
    sudahJamPulang();
  });

  test('jadwal WFO besok ikut disebut beserta projectnya', async () => {
    jadwalBesok('PPA', 'Prismalink');

    await perintah('/check_out');

    const pesan = terkirim.join('\n');
    expect(pesan).toContain('Check-out berhasil');
    expect(pesan).toContain('Besok (Selasa, 18 Agustus 2026)');
    expect(pesan).toContain('WFO — PPA, Prismalink');
    expect(prismaTiruan.schedule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { employeeNik: 'NIK1', date: new Date('2026-08-18T00:00:00.000Z') },
      })
    );
  });

  test('besok hari kerja WFH biasa — pesannya tetap seperti sebelumnya', async () => {
    await perintah('/check_out');

    const pesan = terkirim.join('\n');
    expect(pesan).toContain('Check-out berhasil');
    expect(pesan).not.toContain('Besok');
  });

  test('besok hari libur disebut beserta labelnya', async () => {
    prismaTiruan.holiday.findMany.mockResolvedValue([
      { year: 2026, month: 8, day: 18, label: 'Cuti bersama' },
    ]);

    await perintah('/check_out');

    expect(terkirim.join('\n')).toContain('Libur: Cuti bersama');
  });

  test('cuti besok disebut, dan bukan cuti hari ini yang diperiksa', async () => {
    isUserOnLeave.mockResolvedValue(true);

    await perintah('/check_out');

    expect(terkirim.join('\n')).toContain('Kamu cuti');
  });

  test('jadwal yang gagal diambil tidak menjatuhkan pesan check-out', async () => {
    prismaTiruan.userSchedule.findUnique.mockRejectedValue(new Error('MySQL sedang mati'));

    await perintah('/check_out');

    const pesan = terkirim.join('\n');
    expect(prismaTiruan.attendance.update).toHaveBeenCalledOnce();
    expect(pesan).toContain('Check-out berhasil');
    expect(pesan).not.toContain('Besok');
  });

  test('absensi terlewat yang ditutup lewat balasan jam juga menyebut besok', async () => {
    jadwalBesok('PPA');
    prismaTiruan.attendance.findUnique.mockResolvedValue(null);
    prismaTiruan.attendance.findFirst.mockResolvedValue({
      ...absensi('2026-08-16T02:00:00Z'),
      id: 77,
      date: new Date('2026-08-16T00:00:00.000Z'),
    });

    await balasanKeBot('17:30');

    const pesan = terkirim.join('\n');
    expect(pesan).toContain('Check-out berhasil');
    expect(pesan).toContain('WFO — PPA');
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

  test('sudah check-in — dijawab dari database tanpa menunggu Google Calendar', async () => {
    // Telegram mengirim ulang update yang tidak dijawab dalam ±60 detik. Kalau kalender
    // ditanya lebih dulu, tiap kiriman ulang ikut tertahan selama Google menggantung.
    prismaTiruan.attendance.findUnique.mockResolvedValue({
      id: 7,
      checkIn: new Date('2026-08-17T02:09:00Z'),
      checkOut: null,
    });

    await perintah('/check_in');

    expect(isUserOnLeave).not.toHaveBeenCalled();
    expect(prismaTiruan.attendance.create).not.toHaveBeenCalled();
    expect(terkirim.join('\n')).toContain('sudah check-in hari ini (09.09)');
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

  test.each([
    '/status',
    '/schedule',
    '/schedule_of budi',
    '/check_in',
    '/check_out',
    '/logout',
    '/history',
  ])('%s juga ditolak sebelum login', async (cmd) => {
    await perintah(cmd);
    expect(terkirim.join('\n')).toContain('belum terverifikasi');
  });

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

// --- /schedule_of ---

const karyawan = (employeeNik: string, name: string, jobTitle = 'Engineer') => ({
  employeeNik,
  name,
  jobTitle,
});

/** Sembilan nama berawalan sama, meniru 13 "Muhammad" di direktori sungguhan. */
const MUHAMMAD = ['Alif', 'Bagas', 'Candra', 'Dimas', 'Fajar', 'Ilham', 'Rizki', 'Yusuf', 'Zaki'].map(
  (belakang, i) => karyawan(`2000${i + 1}`, `Muhammad ${belakang}`)
);

const DIREKTORI = [
  karyawan('21225', 'Reyhan Ramadhan', 'Backend Developer'), // orang yang mengetik perintahnya
  karyawan('10001', 'Budi Santoso', 'QA Engineer'),
  ...MUHAMMAD,
];

const jadwal = (tanggal: string, projectName: string) => ({
  date: new Date(`${tanggal}T00:00:00.000Z`),
  projectName,
});

const terpasangKe = (employeeNik: string) =>
  prismaTiruan.userSchedule.findUnique.mockResolvedValue({
    telegramId: USER.telegramId,
    employeeNik,
  });

describe('/schedule_of menampilkan jadwal rekan kerja', () => {
  beforeEach(() => {
    fetchActiveEmployees.mockResolvedValue(DIREKTORI);
    findEmployeeByNik.mockImplementation(
      async (nik: string) => DIREKTORI.find((k) => k.employeeNik === nik) ?? null
    );
  });

  test('satu kecocokan langsung ditampilkan, tanpa tombol', async () => {
    prismaTiruan.schedule.findMany.mockResolvedValue([
      jadwal('2026-08-17', 'PPA'),
      jadwal('2026-08-25', 'NEMO'),
    ]);

    await perintah('/schedule_of budi');

    const pesan = terkirim.join('\n');
    expect(pesan).toContain('Budi Santoso — QA Engineer');
    expect(pesan).toContain('Hari ini: 🏢 WFO (PPA)');
    expect(pesan).toContain('Senin, 17 Agustus 2026 — PPA');
    expect(pesan).toContain('Selasa, 25 Agustus 2026 — NEMO');
    expect(tombolTerkirim).toHaveLength(0);
    expect(prismaTiruan.schedule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ employeeNik: '10001' }) })
    );
  });

  test('tanpa jadwal WFO tidak pernah diterjemahkan jadi WFH', async () => {
    prismaTiruan.schedule.findMany.mockResolvedValue([]);

    await perintah('/schedule_of budi');

    const pesan = terkirim.join('\n');
    expect(pesan).toContain('Budi Santoso — QA Engineer');
    expect(pesan).toContain('Tidak ada jadwal WFO terdaftar');
    expect(pesan).not.toContain('WFH');
    expect(pesan).not.toContain('Day Off');
  });

  test('hari ini tanpa jadwal tidak memunculkan baris "Hari ini" sama sekali', async () => {
    prismaTiruan.schedule.findMany.mockResolvedValue([jadwal('2026-08-25', 'NEMO')]);

    await perintah('/schedule_of budi');

    const pesan = terkirim.join('\n');
    expect(pesan).not.toContain('Hari ini');
    expect(pesan).toContain('Selasa, 25 Agustus 2026 — NEMO');
  });

  test('banyak kecocokan meminta pilihan dulu, jadwal belum disentuh', async () => {
    await perintah('/schedule_of muhammad');

    expect(prismaTiruan.schedule.findMany).not.toHaveBeenCalled();

    const pesan = terkirim.join('\n');
    expect(pesan).toContain('9 orang cocok');
    expect(pesan).toContain('Masih ada 1 lainnya');

    const keyboard = tombolTerkirim[0];
    expect(keyboard).toHaveLength(9); // delapan nama + tombol batal
    expect(keyboard[0][0].callback_data).toMatch(/^sof:nik:2000\d$/);
    expect(keyboard.at(-1)?.[0].callback_data).toBe('sof:batal');
  });

  test('kecocokan yang muat semua tidak menyebut sisa', async () => {
    fetchActiveEmployees.mockResolvedValue([...MUHAMMAD.slice(0, 3)]);

    await perintah('/schedule_of muhammad');

    const pesan = terkirim.join('\n');
    expect(pesan).toContain('3 orang cocok');
    expect(pesan).toContain('Pilih salah satu');
    expect(pesan).not.toContain('Masih ada');
  });

  test('menekan tombol mengganti pesannya sendiri, jadi tombolnya hilang', async () => {
    prismaTiruan.schedule.findMany.mockResolvedValue([jadwal('2026-08-17', 'PPA')]);

    await tekanTombol('sof:nik:20001');

    const hasil = disunting.join('\n');
    expect(hasil).toContain('Muhammad Alif');
    expect(hasil).toContain('Hari ini: 🏢 WFO (PPA)');
    expect(terkirim).toHaveLength(0); // jawaban menyunting pesan lama, bukan mengirim yang baru
    expect(findEmployeeByNik).toHaveBeenCalledWith('20001');
  });

  test('tombol batal menutup daftar tanpa menampilkan siapa pun', async () => {
    await tekanTombol('sof:batal');

    expect(disunting.join('\n')).toContain('dibatalkan');
    expect(prismaTiruan.schedule.findMany).not.toHaveBeenCalled();
    expect(findEmployeeByNik).not.toHaveBeenCalled();
  });

  test('NIK yang sudah tidak ada dijawab, bukan ditampilkan kosong', async () => {
    findEmployeeByNik.mockResolvedValue(null);

    await tekanTombol('sof:nik:99999');

    expect(disunting.join('\n')).toContain('sudah tidak tersedia');
    expect(prismaTiruan.schedule.findMany).not.toHaveBeenCalled();
  });

  test('nama sendiri diarahkan ke /schedule, bukan dijawab "tidak ditemukan"', async () => {
    terpasangKe('21225');

    await perintah('/schedule_of reyhan');

    const pesan = terkirim.join('\n');
    expect(pesan).toContain('Itu kamu sendiri');
    expect(pesan).toContain('/schedule');
    expect(prismaTiruan.schedule.findMany).not.toHaveBeenCalled();
  });

  test('diri sendiri tidak menghalangi rekan lain yang juga cocok', async () => {
    terpasangKe('20001'); // si pencari adalah salah satu "Muhammad"

    await perintah('/schedule_of muhammad');

    const pesan = terkirim.join('\n');
    expect(pesan).toContain('8 orang cocok');
    expect(pesan).not.toContain('Itu kamu');
    expect(tombolTerkirim[0].flat().map((t) => t.callback_data)).not.toContain('sof:nik:20001');
  });

  test('tombol yang menunjuk diri sendiri tetap ditolak saat ditekan', async () => {
    terpasangKe('10001');

    await tekanTombol('sof:nik:10001');

    expect(disunting.join('\n')).toContain('Itu kamu sendiri');
    expect(prismaTiruan.schedule.findMany).not.toHaveBeenCalled();
  });

  test('typo menawarkan tebakan sebagai tombol', async () => {
    await perintah('/schedule_of budhi');

    const pesan = terkirim.join('\n');
    expect(pesan).toContain('tidak ditemukan');
    expect(pesan).toContain('Maksud kamu');
    expect(tombolTerkirim[0][0][0].text).toBe('Budi Santoso');
    expect(tombolTerkirim[0][0][0].callback_data).toBe('sof:nik:10001');
    expect(prismaTiruan.schedule.findMany).not.toHaveBeenCalled();
  });

  test('nama yang sama sekali tidak ada dijawab apa adanya', async () => {
    await perintah('/schedule_of zzqqxx');

    expect(terkirim.join('\n')).toContain('Tidak ada karyawan bernama');
    expect(tombolTerkirim).toHaveLength(0);
  });

  test('tanpa nama, yang muncul cara pakainya', async () => {
    await perintah('/schedule_of');

    expect(terkirim.join('\n')).toContain('Contoh: /schedule_of budi');
    expect(fetchActiveEmployees).not.toHaveBeenCalled();
  });

  test('query dua huruf ditolak sebelum menyentuh Supabase', async () => {
    await perintah('/schedule_of bu');

    expect(terkirim.join('\n')).toContain('terlalu pendek');
    expect(fetchActiveEmployees).not.toHaveBeenCalled();
  });

  test('Supabase mati dijawab pesan biasa, bukan error server', async () => {
    fetchActiveEmployees.mockRejectedValue(new Error('ETIMEDOUT'));

    await perintah('/schedule_of budi');

    const pesan = terkirim.join('\n');
    expect(pesan).toContain('Data karyawan sedang tidak bisa diakses');
    expect(pesan).not.toContain('kesalahan di sisi server');
  });

  test('mencari jadwal orang lain tidak pernah membuat pairing baru', async () => {
    await perintah('/schedule_of budi');

    expect(findEmployeeByEmail).not.toHaveBeenCalled();
    expect(prismaTiruan.userSchedule.upsert).not.toHaveBeenCalled();
  });

  test('nama bespasi dicari utuh, bukan cuma kata pertamanya', async () => {
    prismaTiruan.schedule.findMany.mockResolvedValue([]);

    await perintah('/schedule_of budi santoso');

    expect(terkirim.join('\n')).toContain('Budi Santoso — QA Engineer');
  });
});

describe('/schedule tidak berubah setelah logikanya dipakai bersama', () => {
  beforeEach(() => {
    terpasangKe('NIK1');
  });

  test('menyebut hari ini, minggu ini, dan minggu depan', async () => {
    prismaTiruan.schedule.findMany.mockResolvedValue([
      jadwal('2026-08-17', 'PPA'),
      jadwal('2026-08-25', 'NEMO'),
    ]);

    await perintah('/schedule');

    const pesan = terkirim.join('\n');
    expect(pesan).toContain('📅 Jadwal WFO kamu:');
    expect(pesan).toContain('📍 Hari ini: 🏢 WFO (PPA)');
    expect(pesan).toContain('📌 Minggu ini:\n  • Senin, 17 Agustus 2026 — PPA');
    expect(pesan).toContain('📌 Minggu depan:\n  • Selasa, 25 Agustus 2026 — NEMO');
  });

  test('hari kerja tanpa jadwal tetap disebut WFH', async () => {
    prismaTiruan.schedule.findMany.mockResolvedValue([]);

    await perintah('/schedule');

    const pesan = terkirim.join('\n');
    expect(pesan).toContain('📍 Hari ini: 🏠 WFH');
    expect(pesan).toContain('📌 Minggu ini:\n  Belum ada jadwal');
    expect(pesan).toContain('📌 Minggu depan:\n  Belum ada jadwal');
  });

  test('akhir pekan tanpa jadwal tetap disebut Day Off', async () => {
    vi.setSystemTime(new Date('2026-08-22T03:00:00Z')); // Sabtu
    prismaTiruan.schedule.findMany.mockResolvedValue([]);

    await perintah('/schedule');

    expect(terkirim.join('\n')).toContain('📍 Hari ini: 🏖️ Day Off');
  });

  test('WFO di akhir pekan tetap mengalahkan sebutan Day Off', async () => {
    vi.setSystemTime(new Date('2026-08-22T03:00:00Z')); // Sabtu
    prismaTiruan.schedule.findMany.mockResolvedValue([jadwal('2026-08-22', 'PPA')]);

    await perintah('/schedule');

    const pesan = terkirim.join('\n');
    expect(pesan).toContain('📍 Hari ini: 🏢 WFO (PPA)');
    expect(pesan).not.toContain('Day Off');
  });
});
