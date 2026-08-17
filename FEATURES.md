# Panduan Bot Absensi WKND

Bot Telegram untuk absensi harian, jadwal WFO, dan hari libur. Semua lewat chat — tidak perlu
membuka aplikasi lain.

Semua jam memakai **WIB**.

---

## Mulai dari sini

Kirim **`/login`** ke bot. Akan muncul tombol **Verifikasi Akun**, lalu kamu login dengan
akun Google kantor.

Cukup sekali. Setelah itu bot mengenalimu, dan jadwal WFO-mu otomatis tertaut tanpa perlu
mengetik NIK.

> **Hanya akun `@weekendinc.com` yang bisa dipakai.** Akun Gmail pribadi akan ditolak.
> Kalau setelah login muncul pesan bahwa data karyawanmu belum ditemukan, hubungi admin —
> bot akan mencoba menautkannya lagi saat kamu membuka `/schedule`.

---

## Absen harian

### Masuk kerja

Kirim **`/check_in`**. Bot akan membalas dengan jam masukmu **dan jam pulang yang harus
kamu capai**:

```
✅ Check-in berhasil!

🕐 08.52
📌 Jam pulang: 18.00
```

Check-in paling awal jam **08:00**. Sebelum itu bot menolak.

### Pulang kerja

Kirim **`/check_out`**. Boleh kapan saja — tidak ada jam tertentu yang harus ditunggu.

Kalau jam kerjamu belum genap, bot tidak menolak, hanya bertanya dulu:

```
⏱️ Baru 6j 30m sejak check-in — kurang 2 jam 30 menit
dari jam kerja seharusnya.

Tetap mau check-out sekarang?
        [ ✅ Ya, check-out ]  [ ❌ Batal ]
```

Kalau memang perlu pulang lebih awal, tekan **Ya** dan absensimu tetap tercatat.

---

## Bagaimana jam pulang dihitung

Ini bagian yang paling sering ditanyakan, jadi mari diperjelas.

**Jam kerja dihitung mulai pukul 09:00.** Datang lebih pagi tidak membuatmu boleh pulang
lebih cepat — check-in jam 08:00 maupun 08:45, jam pulangmu tetap 18:00.

**Istirahat satu jam (12:00–13:00) sudah termasuk.** Kalau kamu baru mulai di tengah jam
istirahat, jatah istirahatmu ikut berkurang sesuai sisanya.

| Check-in | Jam pulang |
|---|---|
| 08:00 | 18:00 |
| 08:45 | 18:00 |
| 09:30 | 18:30 |
| 11:00 | 20:00 |
| 12:30 | 21:00 |
| 13:00 | 21:00 |
| 14:00 | 22:00 |

Perhatikan dua baris terakhir sebelum 14:00: mulai 12:30 dan mulai 13:00 sama-sama pulang
21:00. Yang mulai 12:30 masih kebagian 30 menit istirahat, yang mulai 13:00 sudah tidak
kebagian sama sekali — jadi hasilnya sama, dan tidak ada untungnya menggeser-geser jam
check-in.

---

## Kalau lupa check-out

**Absensi tidak bisa ditutup melewati tengah malam.** Kalau kamu lupa check-out dan hari
sudah berganti, kirim `/check_out` seperti biasa — bot akan bertanya:

```
⚠️ Absensi Senin, 17 Agustus 2026 belum kamu tutup,
dan check-out tidak bisa melewati hari.

🕐 Check-in: 08.52

Balas pesan ini dengan jam pulangmu hari itu,
format HH:MM — misalnya 17:30. Maksimal 23:59.
```

Balas dengan jamnya, misalnya `17:30`. Absensi kemarin tertutup dengan jam yang benar, bukan
jam saat kamu membalas.

---

## Cuti

Bot membaca cuti langsung dari **Google Calendar** milikmu. Tidak ada form yang perlu diisi.

Yang dibaca hanya event bertipe **Out of office** — jenis event khusus yang disediakan
Google Calendar, bukan judul biasa. Jadi menulis "Cuti" sebagai judul acara biasa **tidak**
akan terbaca; yang menentukan adalah tipe eventnya.

Satu event Out of office membuat hari itu terhitung cuti penuh, berapa pun durasinya.

Saat kamu cuti:
- Bot tidak menagihmu check-in
- `/check_in` ditolak dengan penjelasan
- `/status` menampilkannya

---

## Akhir pekan dan hari libur

Di Sabtu, Minggu, dan hari libur nasional, bot tidak menagih siapa pun.

Tapi kalau kamu memang masuk kerja, absensimu tetap bisa dicatat. `/check_in` akan bertanya
dulu:

```
📅 Perhatian: hari ini terdaftar libur:
Hari Proklamasi Kemerdekaan R.I.

Tetap mau check-in?
        [ ✅ Ya, tetap check-in ]  [ ❌ Batal ]
```

Tekan **Ya** dan absensimu tercatat seperti biasa.

---

## Melihat informasi

### `/status` — keadaan hari ini

Menampilkan akun yang tertaut, absensi hari ini, dan alasan kalau hari ini memang tidak
perlu absen (cuti, hari libur, atau akhir pekan).

### `/schedule` — jadwal WFO

Jadwal WFO-mu minggu ini dan minggu depan, lengkap dengan nama project.

### `/history` — riwayat 14 hari

Tabel riwayat absensi 14 hari terakhir:

| No | Tanggal | Masuk | Pulang | Durasi |
|---|---|---|---|---|
| 1 | Sel, 04 Agu | 08.58 | 18.03 | 9j 5m |
| 2 | Rab, 05 Agu | 09.12 | — | Berjalan |
| 3 | Kam, 06 Agu | — | — | Tidak absen |
| 4 | Jum, 07 Agu | — | — | Libur |
| 5 | Sab, 08 Agu | — | — | Akhir pekan |

Semua 14 hari selalu ditampilkan, termasuk yang kosong — supaya hari yang terlewat
kelihatan.

### `/holiday` — hari libur

Daftar hari libur 365 hari ke depan, termasuk cuti bersama.

---

## Pengingat yang akan kamu terima

**Belum check-in** — jam **09:05**, **09:30**, dan **09:50** pada hari kerja. Berhenti begitu
kamu check-in. Tidak dikirim kalau kamu sedang cuti, atau kalau hari itu libur atau akhir
pekan.

**Belum check-out** — dikirim tepat pada jam pulangmu sendiri, lalu diulang **setiap jam**
sampai maksimal jam **23:00**. Karena dihitung dari jam check-in masing-masing orang,
pengingatnya tidak datang berbarengan untuk semua orang.

**Jadwal WFO besok** — Senin sampai Kamis jam 21:00, hanya kalau besok kamu memang dijadwalkan WFO.

**Jadwal WFO minggu depan** — setiap Jumat jam 21:00.

---

## Daftar perintah

| Perintah | Fungsi |
|---|---|
| `/start` | Lihat daftar perintah |
| `/login` | Hubungkan akun Google |
| `/status` | Keadaan hari ini: absensi, cuti, libur |
| `/check_in` | Absen masuk |
| `/check_out` | Absen pulang |
| `/schedule` | Jadwal WFO minggu ini & depan |
| `/history` | Riwayat absensi 14 hari |
| `/holiday` | Hari libur 365 hari ke depan |
| `/logout` | Putuskan koneksi akun Google |

---

## Kalau ada yang aneh

**"Kamu belum terverifikasi"** — kirim `/login` dulu.

**Login ditolak** — pastikan yang dipakai akun `@weekendinc.com`, bukan Gmail pribadi.

**Jadwal WFO kosong** — jadwal disalin dari sistem HR setiap malam. Kalau tetap kosong
padahal seharusnya ada, hubungi admin.

**Cuti tidak terbaca** — periksa bahwa event di Google Calendar bertipe **Out of office**,
bukan acara biasa, dan berada di kalender utamamu.

**Hari libur belum terdaftar** — daftar hari libur dikelola manual oleh admin, terutama untuk
cuti bersama yang baru diumumkan. Hubungi admin agar ditambahkan.

Bot ini hanya bisa dipakai lewat **chat pribadi**. Di grup, semua perintah akan ditolak agar
data absensi dan email tidak bocor ke orang lain.

---

## Untuk admin

Admin punya satu perintah tambahan untuk mengelola hari libur:

```
/manage_holiday add 0817 Hari Kemerdekaan      → berulang tiap tahun
/manage_holiday add 20270319 Nyepi             → hanya tahun itu
/manage_holiday edit 0817 HUT RI
/manage_holiday remove 0817
```

Gunakan bentuk 4 angka (`MMDD`) untuk tanggal yang selalu sama tiap tahun, dan 8 angka
(`YYYYMMDD`) untuk yang berpindah — seperti Idul Fitri, Nyepi, Waisak, dan cuti bersama.
