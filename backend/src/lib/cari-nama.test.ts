import { describe, expect, test } from 'vitest';
import { cariNama, menunjukDiriSendiri, normalisasiNama, type KandidatNama } from './cari-nama';

/**
 * Direktori tiruan yang meniru bentuk data sungguhan: sembilan nama berawalan sama
 * ("Muhammad" memang dipakai 13 orang di data asli), nama satu kata, dan beberapa nama
 * yang saling mirip tapi berbeda orang.
 */
const orang = (name: string, employeeNik = name.slice(0, 3).toUpperCase()): KandidatNama => ({
  employeeNik,
  name,
  jobTitle: 'Engineer',
});

const DIREKTORI: KandidatNama[] = [
  orang('Reyhan Ramadhan', '21225'),
  orang('Siti Ramadhani', '21226'),
  orang('Budi Santoso', '10001'),
  orang('Ade Eka Asukma', '10002'),
  orang('Adi Nugroho', '10003'),
  orang('Aditya Pratama Nur', '10004'),
  orang('Fadhlan', '14023'),
  orang('Ahmad Muhammad Sidik', '10005'),
  orang('Muhammad Alif', '20001'),
  orang('Muhammad Bagas', '20002'),
  orang('Muhammad Candra', '20003'),
  orang('Muhammad Dimas', '20004'),
  orang('Muhammad Fajar', '20005'),
  orang('Muhammad Ilham', '20006'),
  orang('Muhammad Rizki', '20007'),
  orang('Muhammad Yusuf', '20008'),
  orang('Muhammad Zaki', '20009'),
];

const namaDari = (hasil: KandidatNama[]) => hasil.map((k) => k.name);

describe('normalisasiNama', () => {
  test('huruf besar dan spasi berlebih diratakan', () => {
    expect(normalisasiNama('  Budi   SANTOSO ')).toBe('budi santoso');
  });

  test('tanda baca jadi pemisah kata, bukan bagian nama', () => {
    expect(normalisasiNama('M. Rizky-Alif')).toBe('m rizky alif');
  });

  test('diakritik dibuang supaya bisa dicari tanpa mengetiknya', () => {
    expect(normalisasiNama('José Ábdul')).toBe('jose abdul');
  });
});

describe('cocok pasti', () => {
  test('satu kecocokan dikembalikan sebagai hasil pasti', () => {
    const hasil = cariNama('budi', DIREKTORI);

    expect(hasil.jenis).toBe('pasti');
    expect(namaDari(hasil.hasil)).toEqual(['Budi Santoso']);
    expect(hasil.total).toBe(1);
  });

  test('nama lengkap bespasi ikut dikenali', () => {
    expect(namaDari(cariNama('budi santoso', DIREKTORI).hasil)).toEqual(['Budi Santoso']);
  });

  test('awalan token dikenali — orang dipanggil dengan nama belakangnya', () => {
    expect(namaDari(cariNama('nugroho', DIREKTORI).hasil)).toEqual(['Adi Nugroho']);
  });

  test('potongan di tengah kata masih dicari, sebagai jalan terakhir', () => {
    expect(namaDari(cariNama('sukma', DIREKTORI).hasil)).toEqual(['Ade Eka Asukma']);
  });

  test('token utuh menang atas token yang cuma berawalan sama', () => {
    expect(namaDari(cariNama('ramadhan', DIREKTORI).hasil)).toEqual([
      'Reyhan Ramadhan',
      'Siti Ramadhani',
    ]);
  });

  test('nama satu kata yang persis sama menempati peringkat teratas', () => {
    const hasil = cariNama('fadhlan', DIREKTORI);
    expect(hasil.jenis).toBe('pasti');
    expect(namaDari(hasil.hasil)).toEqual(['Fadhlan']);
  });

  test('huruf besar-kecil dan spasi pinggir tidak berpengaruh', () => {
    expect(namaDari(cariNama('  BuDi  ', DIREKTORI).hasil)).toEqual(['Budi Santoso']);
  });
});

describe('kecocokan yang terlalu banyak', () => {
  test('total menyebut jumlah sebenarnya, hasil dipotong delapan', () => {
    const hasil = cariNama('muhammad', DIREKTORI);

    expect(hasil.jenis).toBe('pasti');
    expect(hasil.total).toBe(10); // sembilan "Muhammad X" + satu nama tengah
    expect(hasil.hasil).toHaveLength(8);
  });

  test('nama berawalan query didahulukan daripada yang menaruhnya di tengah', () => {
    const hasil = cariNama('muhammad', DIREKTORI);

    expect(namaDari(hasil.hasil)).not.toContain('Ahmad Muhammad Sidik');
    expect(hasil.hasil.every((k) => k.name.startsWith('Muhammad'))).toBe(true);
  });

  test('urutan hasil tidak bergantung urutan direktori', () => {
    const terbalik = [...DIREKTORI].reverse();
    expect(namaDari(cariNama('muhammad', terbalik).hasil)).toEqual(
      namaDari(cariNama('muhammad', DIREKTORI).hasil)
    );
  });
});

describe('query terlalu pendek', () => {
  test.each(['', 'a', 'ad', '  b  '])('%j tidak diproses sama sekali', (query) => {
    expect(cariNama(query, DIREKTORI)).toEqual({ jenis: 'kosong', hasil: [], total: 0 });
  });
});

describe('saran typo', () => {
  test('ketikan salah satu huruf tetap menemukan orangnya', () => {
    const hasil = cariNama('budhi', DIREKTORI);

    expect(hasil.jenis).toBe('saran');
    expect(namaDari(hasil.hasil)).toContain('Budi Santoso');
  });

  test('huruf tertukar di tengah nama juga tertangkap', () => {
    const hasil = cariNama('reyhna', DIREKTORI);

    expect(hasil.jenis).toBe('saran');
    expect(namaDari(hasil.hasil)).toContain('Reyhan Ramadhan');
  });

  test('typo pada nama belakang dinilai per token, bukan atas nama penuh', () => {
    const hasil = cariNama('nugrohu', DIREKTORI);

    expect(hasil.jenis).toBe('saran');
    expect(namaDari(hasil.hasil)).toContain('Adi Nugroho');
  });

  test('typo pada dua kata terakhir tetap ketemu, tanpa mengetik nama depannya', () => {
    // "Ade Eka Asukma" diketik separuh dan salah satu huruf: nama depannya tidak ikut,
    // jadi yang harus dibandingkan adalah "eka asukma" di dalam namanya.
    const hasil = cariNama('eka asukmo', DIREKTORI);

    expect(hasil.jenis).toBe('saran');
    expect(namaDari(hasil.hasil)).toContain('Ade Eka Asukma');
  });

  test('saran dibatasi tiga, meski yang mirip lebih banyak', () => {
    const hasil = cariNama('muhammed', DIREKTORI);

    expect(hasil.jenis).toBe('saran');
    expect(hasil.hasil.length).toBeLessThanOrEqual(3);
    expect(hasil.total).toBeGreaterThan(3);
  });

  test('ketikan yang sudah benar tidak menyeret nama mirip sebagai bonus', () => {
    const hasil = cariNama('ade', DIREKTORI);

    // "Adi Nugroho" hanya berjarak satu huruf, tapi tahap fuzzy tidak boleh ikut jalan
    // selama masih ada kecocokan pasti.
    expect(hasil.jenis).toBe('pasti');
    expect(namaDari(hasil.hasil)).toEqual(['Ade Eka Asukma']);
  });

  test('nama yang sama sekali tidak mirip tidak ditebak-tebak', () => {
    expect(cariNama('zzqqxx', DIREKTORI)).toEqual({ jenis: 'kosong', hasil: [], total: 0 });
  });
});

describe('direktori kosong', () => {
  test('tidak meledak saat tidak ada satu pun karyawan', () => {
    expect(cariNama('budi', [])).toEqual({ jenis: 'kosong', hasil: [], total: 0 });
  });
});

describe('menunjukDiriSendiri', () => {
  const AKU = '21225'; // Reyhan Ramadhan
  const hasilOrangLain = (query: string) =>
    cariNama(query, DIREKTORI.filter((k) => k.employeeNik !== AKU));

  test('nama sendiri yang cocok pasti, tanpa saingan, dikenali', () => {
    expect(menunjukDiriSendiri('reyhan', DIREKTORI, AKU, hasilOrangLain('reyhan'))).toBe(true);
  });

  test('orang lain yang juga cocok pasti tetap menang', () => {
    // "ramadhan" cocok dengan diri sendiri sekaligus Siti Ramadhani.
    expect(menunjukDiriSendiri('ramadhan', DIREKTORI, AKU, hasilOrangLain('ramadhan'))).toBe(false);
  });

  test('typo nama sendiri dikenali hanya kalau tidak ada siapa pun lagi', () => {
    expect(menunjukDiriSendiri('reyhna', DIREKTORI, AKU, hasilOrangLain('reyhna'))).toBe(true);
  });

  test('user yang belum terpasang ke data karyawan tidak pernah dianggap cocok', () => {
    expect(menunjukDiriSendiri('reyhan', DIREKTORI, null, hasilOrangLain('reyhan'))).toBe(false);
  });

  test('nama orang lain tidak pernah disangka diri sendiri', () => {
    expect(menunjukDiriSendiri('budi', DIREKTORI, AKU, hasilOrangLain('budi'))).toBe(false);
  });
});
