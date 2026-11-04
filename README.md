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

Akun ini hanya dibuat jika belum ada user `admin`. Penanda `force_pass_change` sekarang benar-benar
dipakai: akun yang masih memakai sandi bawaan langsung diarahkan ke **Ganti Sandi** (`/ganti-sandi`)
setelah login dan belum bisa membuka halaman lain sebelum sandinya diganti (minimal 8 karakter).
Akun Manager Cabang dan Kasir yang dibuat lewat **Kelola Staff Kasir** ikut mendapat penanda itu,
begitu juga akun yang sandinya di-reset admin di sana — jadi sandi awal cukup diketahui pembuatnya,
lalu diganti sendiri oleh pemakai.

## Urutan pakai yang disarankan
1. **Cabang Toko** (`/cabang`) — daftarkan setiap lokasi, status aktif menentukan bisa tidaknya login.
2. **Kelola Staff Kasir** (`/pengguna`) — buat akun per cabang dengan role yang sesuai.
3. **Data Produk** (`/produk`) — tambah produk dan pilih cabang untuk stok awal.
4. Isi stok cabang lain lewat **Stok Opname** (`/opname`) atau **Transfer Antar Cabang** (`/transfer`).
5. **Kasir** (`/kasir`) — scan barcode atau klik produk, pilih voucher bila perlu, isi member bila
   pembeli sudah terdaftar, lalu bayar dan cetak struk. Metode pembayaran hanya Tunai dan QRIS;
   detailnya di bagian **Pembayaran dan member** di bawah.
6. **Tarif Pajak** (`/pengaturan/voucher`) dipakai mengatur persentase pajak. Voucher sendiri
   dibuat, diaktif/nonaktifkan, dan dihapus di halaman **Voucher / Diskon** (`/voucher`);
   **Pengaturan Toko** (`/pengaturan`) untuk nama toko, logo, dan catatan struk. Logo hanya muncul
   di **struk kasir** — struk rekap laporan tidak pernah mencantumkan logo — dan `printReceipt()`
   menunggu gambar logo selesai dimuat (maks 1,2 detik) sebelum memanggil print, karena struk
   diambil snapshot-nya sedetik setelah `<img>` disisipkan: tanpa penundaan itu logo hilang di
   pencetakan pertama setelah restart atau saat koneksi LAN lemot, lalu muncul lagi berikutnya.
7. **Laporan Penjualan** (`/laporan`) menghitung omzet, HPP, laba kotor, dan laba bersih
   setelah pengeluaran operasional serta gaji. Ringkasan selalu dihitung atas **seluruh**
   transaksi yang cocok dengan filter, sementara tabelnya dipecah 50 baris per halaman;
   baris berstatus VOID tampil sebagai jejak audit tetapi tidak masuk angka ringkasan.
   **Omset bukan pendapatan toko**: `total = subtotal − diskon + pajak`, jadi angka omzet masih
   memuat PPN yang harus disetor. Karena itu ada baris **Omset Bersih Pajak** (`Σ total − Σ tax`)
   di kartu Omset pada layar dan di struk thermal, muncul hanya bila periode itu memang memungut
   pajak. Urutannya: Omset − HPP = Laba Kotor, Laba Kotor − Pengeluaran − Gaji = Laba Bersih.
   Ada dropdown **Filter member** untuk mempersempit ke satu pelanggan; kolom Member
   menampilkan **Umum** untuk transaksi yang tidak memakai member, dan filter waktu, member,
   serta halaman selalu dibawa bersama supaya hasil yang sedang dilihat tidak melebar diam-diam.
   **Cetak struk thermal** untuk laporan memakai bahasa manusia, bukan token filter: judulnya
   `November 2026` (bulan_ini), `04/11/2026` (hari_ini), atau `Semua Periode` (semua), lalu di
   bawah ringkasan ada baris **Barang Keluar** (total pcs dari `sale_items`, bukan jumlah nota)
   dan **RINCIAN PER HARI** — hanya tanggal yang ada transaksi aktifnya, tiap baris
   `dd/mm  NT MP  omset` (T = jumlah nota, P = pcs). Untuk filter **Semua Transaksi** rinciannya
   otomatis menebal ke per bulan (`11/2026`) supaya struk tidak memanjang tak berguna, dan daftar
   itu tidak dicetak bila isinya cuma satu periode (filter hari ini) karena sama persis dengan
   ringkasannya.
   Lebar struk tidak dititipkan ke dialog print: `cetakStrukThermal()` di `layout-footer.ejs`
   menyisipkan `@page { size: 58mm auto; margin: 0 }` tepat sebelum `window.print()` lalu
   mencabutnya lagi sesudahnya — dipakai juga oleh **struk kasir**, jadi kedua struk thermal ikut
   diperbaiki sekaligus. Margin default Chrome ±10 mm membuat isi 58 mm terpotong di kanan, dan
   bila aturan itu dibiarkan permanen tombol **Cetak PDF / A4** ikut terjepit ke 58 mm.
   Isi struk selebar **44 mm dan dipusat** di halaman, bukan rata kiri 58 mm: kertas memang 58 mm,
   tapi kepala cetak printer thermal 58 mm (Zjiang/MP-58X1, 384 dot @203 dpi) hanya mencetak pita di
   tengah. Diukur langsung dengan halaman **/uji-struk.html** pada MP-58X1 milik toko: cetakan pertama
   muncul di ±5 mm dan terakhir di ±52,6 mm, jadi band cetaknya ±48 mm terpusat dan kotak rata kiri
   terpotong di dua sisi. Karena itu isinya 44 mm (7–51 mm) — 2 mm pengaman tiap sisi untuk kertas
   yang bergeser di holder. Nilainya ada di satu tempat, `--lebar-struk` pada blok `@media print`
   `public/css/style.css`; jangan diubah kembali menjadi rata kiri. Font monospace 10 px memuat
   ±30 karakter di 44 mm dan `overflow-wrap: anywhere` di sisi kiri baris membuat nama produk panjang
   turun ke baris berikutnya alih-alih mendorong harga keluar kertas.
   `/uji-struk.html` (halaman statis, tanpa login) mencetak skala milimeter 0–58 plus lima kotak uji
   simetris PITA 48/44/40/36/32 mm berhuruf `L` dan `R` di ujungnya; kotak teratas yang masih tercetak
   penuh kedua ujungnya = lebar aman. Cetak dengan Paper size 58 mm, Margins None, Scale 100 %.
8. **Ganti Sandi** (`/ganti-sandi`) tersedia untuk semua role lewat menu sidebar — di layar HP
   lewat nav bawah tombol **Lainnya**. Admin tidak perlu ikut campur saat staff ingin mengganti
   sandinya sendiri.

## Pembayaran dan member
- Metode pembayaran sengaja **statis dua pilihan**: Tunai dan QRIS. Daftarnya divalidasi lagi di
  server (`METODE_BAYAR` di `server.js`), jadi request langsung tidak bisa menyimpan metode lain.
- **Tunai**: kolom Uang Diterima diketik manual, ada tombol **Uang Pas** untuk mengisi total
  sekali klik, dan Kembalian dihitung otomatis.
- **QRIS**: blok Tunai (Uang Diterima / Uang Pas / Kembalian) diganti panel **QRIS statis** milik
  cabang yang sedang dipakai — gambar QR ditampilkan penuh plus nominal yang harus dibayar, dan
  tombol footer berubah menjadi **Sudah Dibayar & Cetak Struk**. Server selalu mencatat jumlah bayar
  = total tanpa membaca input, jadi nominal tidak bisa dimanipulasi dari request.
- QR di dalam modal punya dua penolong khusus layar HP, karena badan modal lebih pendek dari isinya:
  panel otomatis digulir begitu QR tampil (`gulirKeQris()` menghitung selisih posisi, bukan
  `scrollIntoView({behavior:'smooth'})` yang bisa tidak jalan), dan **ketuk QR** untuk membukanya
  fullscreen (`#qris-besar`, `z-index:2000` di atas modal) dengan margin putih lengkap — pemindai
  butuh quiet zone, QR yang terpotong 40px di layar 390px tidak selalu terbaca.
- Aplikasi ini **tidak** terhubung ke bank/agregator payment, sehingga tidak ada notifikasi
  otomatis "uang sudah masuk". Kasir yang mengonfirmasi pembayaran setelah melihat mutasi rekening
  atau aplikasi merchant bank-nya. Kalau cabang belum punya gambar QRIS, panel menampilkan
  peringatan dan arahannya (upload lewat menu Cabang), transaksi tetap bisa jalan dengan Tunai.
- Gambar QRIS diunggah per cabang di **Cabang → Edit → Gambar QRIS** (PNG/JPG/WebP maksimal 4 MB,
  tersimpan sebagai `public/uploads/qris-<waktu>.<ekstensi>` dan kolom `branches.qris_image`).
  Mengganti gambar lama menghapus berkas lamanya; tombol `x` di kolom QRIS tabel menghapus
  gambar tanpa mengubah data cabang lain.
- **Member** dipilih di modal pembayaran lewat satu kolom pencarian yang menerima kode, nama, atau
  nomor telepon (datalist). Yang tersimpan adalah id pelanggan hasil pencocokan persis, jadi nama
  yang diketik bebas tidak bisa salah nyambung; kalau tidak cocok, hint merah muncul dan transaksi
  jalan sebagai Umum.
- Transaksi tanpa member menyimpan `customer_id = NULL`, jadi tidak ada data lama yang berubah
  makna. Struk hanya mencetak baris `Member: NAMA (KODE)` bila member dipilih.
- Pelanggan yang sudah pernah belanja **tidak bisa dihapus** (`/pelanggan/delete` menolak) karena
  laporan dan jejak struk mengambil namanya dari baris itu.

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
kerangka (sidebar, nav bawah khusus HP + bootstrap) yang di-`include` oleh halaman-halaman lain.

## Role dan hak akses
| Role | Akses |
| --- | --- |
| Administrator | semua halaman, boleh pindah-pilih cabang, kelola cabang/gaji/voucher/pengaturan |
| Manager Cabang | data cabang sendiri, produk, opname, stok, transfer, pengeluaran operasional, laporan, kelola kasir di cabangnya |
| Kasir | dashboard, kasir, pelanggan, laporan; tidak melihat produk/opname/stok/transfer milik cabang lain |

Pencabutan akses mengikuti pola `isManagerOrAdmin` dan `canAccessBranch` di `server.js`;
helper `getBranchScope` menentukan cabang mana yang dipakai suatu query.

## Navigasi per ukuran layar
- **HP (≤ 767,98px):** laci sidebar digantikan bar navigasi tetap di bawah — Dashboard, Laporan,
  tombol Kasir menonjol di tengah, Pelanggan, dan **Lainnya**. Daftar Lainnya disalin dari menu
  sidebar lewat JavaScript (`#sidebarMenu` di `layout-header.ejs`), jadi aturan role tidak ditulis
  dua kali dan rute baru otomatis ikut muncul tanpa menyentuh nav.
- **Tablet dan PC (≥ 768px):** tidak berubah, sidebar seperti semula dan nav bawah disembunyikan.
- Bar bawah tingginya ditambah `env(safe-area-inset-bottom)` (dengan `viewport-fit=cover` di
  `layout-header.ejs`) supaya tidak tertutup gesture bar; isi `.app-main` dan bilah bayar di
  `/kasir` dinaikkan setinggi bar tersebut agar tetap bisa disentuh.
- **Layar kasir di ≤ 991,98px** dikunci satu layar: `.pos-stack` dipaksa `flex-wrap: nowrap` karena
  `.row` bawaan Bootstrap membolehkan wrap — dulu panel keranjang terlipat ke kolom kedua dan
  tombol BAYAR hilang begitu item melebihi tiga. Bilah subtotal/BAYAR berhenti sticky dan selalu
  jadi baris terakhir, yang menggulir hanya daftar pesanan, dan grid produk boleh menyusut saat
  pesanan panjang tapi tidak di bawah `25vh` supaya tombol produk tetap ada. Aturan ini memakai
  `:has()`; di browser yang belum mendukungnya halaman tetap jalan dengan layout lama (satu gulir
  halaman), hanya bilah bayarnya kembali sticky.

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
  (`sales.subtotal/discount/tax`, `sales.customer_id`, `branches.qris_image`, `settings.tax_rate`) ditambahkan lewat
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
