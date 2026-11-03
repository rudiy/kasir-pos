# KASIR POS
Aplikasi Point of Sale lengkap dengan fitur inventaris, pelanggan, dan laporan.

Didukung: penjualan multi-cabang, stok per cabang dengan buku besar pergerakan,
transfer antar cabang, stok opname, voucher & pajak, pengeluaran operasional,
gaji staff, dan laporan laba rugi.

## Prasyarat
- **Node.js 20 atau 22 LTS.** Cek dengan `node -v`. Hindari Node di bawah 18 karena
  `better-sqlite3` punya kode native yang harus di-compile ulang setiap ganti versi Node.
- **npm** yang ikut terpasang bersama Node. Jika npm memunculkan peringatan
  `npm vX does not support Node.js vY`, itu hanya ketidakcocokan versi alat, bukan error aplikasi.

## Instalasi pertama
1. Ambil project ini (clone atau salin foldernya) lalu masuk ke direktorinya:
   ```bash
   cd kasir-pos
   ```
2. Pasang dependensi. `node_modules` sudah ikut direpo, jadi langkah ini tetap dianjurkan
   agar binari native cocok dengan mesin kamu:
   ```bash
   npm install
   ```
3. Buat berkas konfigurasi dari contoh yang tersedia:
   ```bash
   copy .env.example .env       # Windows
   cp .env.example .env         # Linux/macOS/Git Bash
   ```
4. Isi `SESSION_SECRET` dengan nilai acak 256 bit. Jangan pakai nilai contoh, dan jangan
   pernah menaruh nilai ini ke git (`.env` sudah ada di `.gitignore`):
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   Tempel hasilnya ke baris `SESSION_SECRET=` di `.env`. Kalau kosong, server jatuh ke
   fallback `'secret'` sehingga sesi semua pengguna bisa dipalsukan.
5. Jalankan aplikasinya:
   ```bash
   npm run dev      # development: restart otomatis saat kode .js berubah
   npm start        # production: tanpa watch
   ```
   Database dibuat dan dimigrasi otomatis saat pertama kali jalan, jadi tidak perlu
   perintah install database terpisah.
6. Buka http://localhost:3000

## Kredensial Default
- **Username**: admin
- **Password**: admin12345

Akun ini hanya dibuat jika belum ada user `admin`. Segera ganti sandinya lewat menu
**Kelola Staff Kasir** setelah login pertama, dan buat akun Manager Cabang serta Kasir
untuk tiap toko.

## Urutan pakai yang disarankan
1. **Cabang Toko** (`/cabang`) — daftarkan setiap lokasi, status aktif menentukan bisa tidaknya login.
2. **Kelola Staff Kasir** (`/pengguna`) — buat akun per cabang dengan role yang sesuai.
3. **Data Produk** (`/produk`) — tambah produk dan pilih cabang untuk stok awal.
4. Isi stok cabang lain lewat **Stok Opname** (`/opname`) atau **Transfer Antar Cabang** (`/transfer`).
5. **Kasir** (`/kasir`) — scan barcode atau klik produk, pilih voucher bila perlu, lalu bayar dan cetak struk.
6. **Pajak & Voucher** (`/pengaturan/voucher`) atur tarif pajak; **Pengaturan Toko** (`/pengaturan`)
   untuk nama toko, logo, dan catatan struk.
7. **Laporan Penjualan** (`/laporan`) menghitung omzet, HPP, laba kotor, dan laba bersih
   setelah pengeluaran operasional serta gaji. Ringkasan selalu dihitung atas **seluruh**
   transaksi yang cocok dengan filter, sementara tabelnya dipecah 50 baris per halaman;
   baris berstatus VOID tampil sebagai jejak audit tetapi tidak masuk angka ringkasan.

## Struktur folder
```
kasir-pos/
  server.js                 seluruh route dan logika aplikasi
  config/
    database.js             koneksi SQLite (WAL mode) + path database/kasir.db
    sessionStore.js         penyimpanan sesi di SQLite, agar sesi tidak hilang saat restart
  database/
    kasir.db                database development — TIDAK ikut git, dibuat otomatis saat start
    migrations/init.js      skema tabel, kolom tambahan, seed admin, pemindahan stok lama
  middleware/auth.js        penjaga route yang wajib login
  scripts/
    checkpoint-db.js        pindahkan isi kasir.db-wal ke kasir.db
    backup-db.js            cadangan online + retensi, dipakai juga oleh penjadwal di server.js
  views/                    tampilan EJS, semuanya berkas datar (tanpa subfolder)
  public/                   aset statis dan hasil upload logo
    vendor/                 Bootstrap 5.3.0 + bootstrap-icons 1.11.1 lokal (tanpa CDN)
    sw.js                   service worker: cache halaman terakhir untuk mode offline
  backup/                   hasil cadangan otomatis, tidak ikut git
```

Aturan penamaan view dibuat satu-ke-satu dengan route supaya mudah dicari:
route `/kasir` memakai `views/kasir.ejs`, `/pengaturan/voucher` memakai
`views/pengaturan-voucher.ejs`, dan `/stok` memakai `views/stok.ejs`.
Dua berkas `views/layout-header.ejs` dan `views/layout-footer.ejs` adalah potongan
kerangka (sidebar + bootstrap) yang di-`include` oleh halaman-halaman lain.

## Role dan hak akses
| Role | Akses |
| --- | --- |
| Administrator | semua halaman, boleh pindah-pilih cabang, kelola cabang/gaji/voucher/pengaturan |
| Manager Cabang | data cabang sendiri, produk, opname, stok, transfer, pengeluaran operasional, laporan, kelola kasir di cabangnya |
| Kasir | dashboard, kasir, pelanggan, laporan; tidak melihat produk/opname/stok/transfer milik cabang lain |

Pencabutan akses mengikuti pola `isManagerOrAdmin` dan `canAccessBranch` di `server.js`;
helper `getBranchScope` menentukan cabang mana yang dipakai suatu query.

## Perintah yang tersedia
| Perintah | Fungsi |
| --- | --- |
| `npm run dev` | jalankan dengan nodemon (restart otomatis) |
| `npm start` | jalankan biasa |
| `npm run db:checkpoint` | dorong isi `kasir.db-wal` ke `kasir.db` (hanya perlu kalau mau menyalin DB dengan tangan) |
| `npm run db:backup` | buat satu cadangan online sekarang juga, tanpa mematikan server |

## Cadangan database
`scripts/backup-db.js` memakai API *online backup* SQLite, jadi cadangan tetap aman meski
kasir sedang bertransaksi. Setiap cadangan:

1. ditulis sebagai satu berkas `backup/kasir-YYYYMMDD-HHmmss.db` (nama pakai waktu WIB),
2. diubah dari mode WAL ke `journal_mode = DELETE` supaya isinya tertekan ke satu berkas
   dan tidak meninggalkan `-wal`/`-shm`,
3. diperiksa dengan `PRAGMA integrity_check` — kalau hasilnya bukan `ok`, log menandai
   `[backup] GAGAL`,
4. mempertahankan `BACKUP_KEEP` berkas terbaru (bawaan 14) dan menghapus sisanya.

Server memanggil skrip ini saat start lalu tiap `BACKUP_INTERVAL_MIN` menit (bawaan 60,
isi `0` untuk mematikan). Supaya cadangan benar-benar berguna, salin folder `backup/` ke
luar mesin kasir secara berkala — kalau laptop kasir hilang, cadangan di dalamnya ikut hilang.

**Memulihkan:** matikan server, salin `backup/kasir-<terbaru>.db` menimpa
`database/kasir.db`, hapus `kasir.db-wal`/`kasir.db-shm` lama bila ada, lalu jalankan
`npm start`. Migrasi di `init.js` hanya menambah yang belum ada, jadi data lama tetap utuh.

## Database dan backup
- Storage: SQLite satu berkas di `database/kasir.db`, mode WAL, foreign key aktif.
- Migrasi berjalan tiap start: tabel baru dibuat bila belum ada, dan kolom tambahan
  (`sales.subtotal/discount/tax`, `settings.tax_rate`) ditambahkan lewat
  `ensureColumn` tanpa merusak data lama.
- Sumber kebenaran stok adalah `stock_per_branch`, **bukan** `products.stock`. Setiap
  perubahan stok (penjualan, opname, koreksi, transfer) tercatat di `stock_movements`,
  sehingga total ledger selalu sama dengan posisi stok.
- `database/kasir.db` tidak dilacak git (lihat `.gitignore`), jadi sumber skema tetap
  `database/migrations/init.js` dan sumber data adalah file di mesin kasir plus folder
  `backup/`. Lihat bagian **Cadangan database** di bawah untuk cara mencadangkan dan
  memulihkan.

## Aset lokal dan perilaku offline
- Seluruh CSS/JS/font Bootstrap diambil dari `public/vendor/`, jadi tidak ada satu pun
  permintaan ke internet saat halaman dibuka. Internet mati tidak lagi merusak tampilan
  atau mematikan modal pembayaran.
- `public/sw.js` (service worker) memakai **network-first** untuk halaman: selama server
  terjangkau, yang tampil selalu jawaban server terbaru. Begitu koneksi atau server putus,
  permintaan jatuh ke cache sehingga kasir tetap melihat halaman terakhir yang pernah
  dibuka; URL yang belum pernah dibuka diarahkan ke salinan halaman login, bukan layar
  error browser. Aset statis memakai cache-first lalu diperbarui diam-diam.
- Yang **tidak** dijamin offline: membuat transaksi baru. Stok, harga, dan struk dihitung
  di server, jadi saat server tak terjangkau layar hanya menampilkan bacaan terakhir dan
  tidak bisa dipakai menjual. Antrean transaksi offline (outbox) adalah fitur terpisah.
- Registrasi service worker hanya jalan di *secure context*: `http://localhost:...` dan
  HTTPS dianggap aman, sedangkan `http://192.168.x.x:3000` tidak. Akses lewat alamat IP LAN
  tetap normal, hanya tanpa cadangan offline.
- Penanda **Online/Offline** di kanan atas mencerminkan jaringan perangkat ini, bukan
  kepastian server kasir bisa dijawab.

## Masalah yang sering muncul
- `EADDRINUSE: address already in use :::3000` — port sudah dipakai proses lain, biasanya
  server yang lupa dimatikan. Cari dengan `netstat -ano \| findstr :3000` lalu tutup PID
  tersebut, atau pakai port lain lewat `PORT=3001` di `.env`.
- `Failed to lookup view "..."` — nama `res.render` di `server.js` tidak sama dengan nama
  berkas di `views/`. Ingat aturan datar di atas: tidak ada lagi subfolder halaman.
- `NODE_MODULE_VERSION` saat `npm install` / menjalankan — binari `better-sqlite3` tidak
  cocok dengan versi Node saat ini. Atasi dengan `npm rebuild better-sqlite3`.
- Semua user logout padahal sesi sudah di SQLite — berarti `SESSION_SECRET` berubah atau
  baris sesinya kedaluwarsa (masa berlaku 24 jam, diatur di `config/sessionStore.js`).
- Perubahan `.ejs` tidak tampak — pastikan `NODE_ENV=development`; pada mode production
  Express meng-cache hasil render dan menyembunyikan detail error.

## Catatan keamanan
- `.env` tidak dilacak git. Nilai `SESSION_SECRET` lama masih ada di history commit
  terdahulu, jadi sudah diganti dan sebaiknya dianggap tidak dipakai lagi.
- Berkas `kasir-pos.zip` di root adalah arsip lama, bukan bagian aplikasi, dan tidak perlu di-commit.
- Ganti kredensial default dan batasi akses jaringan ke mesin kasir sebelum dipakai nyata.
