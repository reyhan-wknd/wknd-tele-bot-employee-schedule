# Aset profil bot

Gambar di sini dipasang manual lewat **@BotFather**, bukan dipakai saat runtime —
karena itu `assets/` sengaja tidak ikut disalin ke image Docker.

| Berkas | Ukuran | Dipasang di |
|---|---|---|
| `avatar-512.png` | 512×512 | foto profil bot |
| `welcome-640x360.png` | 640×360 | tombol **Set Welcome Picture** |

Sumber tiap PNG adalah berkas `.html` di sebelahnya. Untuk mengubah lalu render ulang,
buka HTML-nya di browser pada ukuran persis di tabel atas, atau screenshot lewat CDP
dengan `deviceScaleFactor: 1`.

## Catatan desain

**Avatar** dirancang untuk terbaca pada ~40px di daftar chat, bukan pada 512px. Karena itu
centangnya tebal dan hurufnya tipis: W·K·N·D di posisi 12/3/6/9 melebur jadi tekstur saat
mengecil, sementara centangnya tetap terbaca. Kedua lengan centang sekaligus terbaca sebagai
jarum jam — yang pendek berwarna kuning seperti jarum jam pada umumnya.

Poros kedua jarum ada di atribut `d` pada `<path>`, dan **keduanya harus memakai titik awal
yang sama**. Koordinat tidak bisa memakai variabel CSS. Makin dekat ke `50,50` makin terbaca
sebagai jam; makin ke bawah makin terbaca sebagai centang. Nilai sekarang `47,56`.

**Welcome picture** memakai teks berukuran besar karena Telegram menyusutkannya ke sekitar
setengah lebar di dalam chat.

Teks About dan Description bot ada di `FEATURES.md`.
