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

### Lupa sandi? Reset lewat `.env`, tidak perlu menyentuh database
Isi baris berikut di `.env` lalu start ulang (`npm run dev`):

| kolom | fungsi |
|---|---|
| `ADMIN_PASSWORD` | sandi akun `admin` (Administrator / super admin) |
| `ADMIN_CABANG_USERNAME` | nama akun admin cabang; bawaannya `admin_cabang` |
| `ADMIN_CABANG_PASSWORD` | sandinya; kosong artinya ikut `ADMIN_PASSWORD` |
| `ADMIN_CABANG_BRANCH` | id cabang milik akun cabang itu (lihat `/cabang`), bawaannya 1 |

Cara kerjanya di `database/migrations/init.js`, dan ada dua pengaman supaya fitur ini tidak
membuka lubang:

- **Baris yang kosong diabaikan.** Install lama yang sudah mengganti sandi tidak tiba-tiba balik
  ke `admin12345` hanya karena kode ini naik versi.
- **Reset hanya jalan kalau nilainya berubah sejak start terakhir** (bekas nilai yang sudah dipakai
  disimpan sebagai hash di tabel `app_state`). Jadi sandi yang diganti dari **Ganti Sandi**
  (`/ganti-sandi`) tidak tertimpa setiap restart. Lupa lagi? Ubah satu karakter di `.env`, restart —
  akun langsung kembali ke nilai baru itu dan diminta ganti sandi saat login pertama.

Akun admin cabang dibuat otomatis dengan role **Manager Cabang** kalau nama itu belum ada; kalau
sudah ada, yang diganti hanya sandinya (role, cabang, dan status aktif akun itu tidak disentuh).
Akun lain — kasir, manager yang sudah ada — tidak pernah ikut berubah.

## Urutan pakai yang disarankan
1. **Cabang Toko** (`/cabang`) — daftarkan setiap lokasi, status aktif menentukan bisa tidaknya login.
2. **Kelola Staff Kasir** (`/pengguna`) — buat akun per cabang dengan role yang sesuai.
3. **Kategori Produk** (`/kategori`) lalu **Data Produk** (`/produk`) — kategori hanya tempat
   mengelompokkan produk dan isinya **bisa ditambah sebebasnya** dari halaman itu (Manager + Admin);
   seed awal cuma menyediakan `Umum` dan `Makanan`. Nama kategori tidak boleh kembar (huruf besar/kecil
   dianggap sama), dan kategori yang masih dipakai produk **tidak bisa dihapus** — halaman penolaknya
   langsung menampilkan produk mana yang menahannya. Mengganti nama kategori aman: produk menyimpan
   `category_id`, jadi label, laporan, dan layar kasir ikut menyesuaikan sendiri. Setelah itu baru
   tambah produk dan pilih cabang untuk stok awal.
4. **Cetak Barcode** (`/barcode`) — kalau kemasan barang belum ada barcode-nya, cetak labelnya di
   sini lalu tempel. Pilih produk (bisa banyak sekaligus, lengkap dengan jumlah label per produk),
   pilih bentuk kertas di kartu **Kertas label** (roll tanpa potong, atau die-cut 50 × 30 /
   43 × 25 / 33 × 15 mm / ukuran sendiri), atur **Jarak antar garis potong** serta
   **Tinggi/Lebar barcode** bila perlu (kolom ukuran barcode dibiarkan kosong = ikut ukuran kertas),
   tekan **Cetak Label**. Belum tahu jarak potong kertasnya dan tidak punya penggaris? Tekan
   **Cetak penggaris** di bawah kolom jarak — strip yang keluar sudah berskala milimeter, jadi garis
   potong kertas tinggal dibaca angkanya.
   Pada roll, satu label terbit per
   garis putus-putus sebagai patokan gunting; pada die-cut, tiap blok dicetak setinggi
   `min(tinggi label, jarak potong)` dan berjarak persis seperti angka yang diketik. Tekan **Pilih kandidat** untuk otomatis menandai produk yang
   kodenya dibuatkan oleh sistem (`899` + 10 angka) — biasanya justru merekalah yang belum punya
   label fisik. Formatnya **Code 128**, bukan EAN-13; alasannya ada di bagian **Label barcode** di
   bawah.
5. Isi stok cabang lain lewat **Stok Opname** (`/opname`) atau **Transfer Antar Cabang** (`/transfer`).
6. **Kasir** (`/kasir`) — scan barcode atau klik produk, pilih voucher bila perlu, isi member bila
   pembeli sudah terdaftar, lalu bayar dan cetak struk. Metode pembayaran hanya Tunai dan QRIS;
   detailnya di bagian **Pembayaran dan member** di bawah.
7. **Tarif Pajak** (`/pengaturan/voucher`) dipakai mengatur persentase pajak. Voucher sendiri
   dibuat, diaktif/nonaktifkan, dan dihapus di halaman **Voucher / Diskon** (`/voucher`);
   **Pengaturan Toko** (`/pengaturan`) untuk nama toko, logo, dan catatan struk. Logo hanya muncul
   di **struk kasir** — struk rekap laporan tidak pernah mencantumkan logo — dan `printReceipt()`
   menunggu gambar logo selesai dimuat (maks 1,2 detik) sebelum memanggil print, karena struk
   diambil snapshot-nya sedetik setelah `<img>` disisipkan: tanpa penundaan itu logo hilang di
   pencetakan pertama setelah restart atau saat koneksi LAN lemot, lalu muncul lagi berikutnya.
8. **Laporan Penjualan** (`/laporan`) menghitung omzet, HPP, laba kotor, dan laba bersih
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
   yang bergeser di holder. Nilainya ada di satu tempat, `--lebar-struk` pada `:root` di dalam blok
   `@media print` `public/css/style.css` — dipakai struk dan label barcode sekaligus; jangan diubah
   kembali menjadi rata kiri. Font monospace 10 px memuat
   ±30 karakter di 44 mm dan `overflow-wrap: anywhere` di sisi kiri baris membuat nama produk panjang
   turun ke baris berikutnya alih-alih mendorong harga keluar kertas.
   `/uji-struk.html` (halaman statis, tanpa login) mencetak skala milimeter 0–58 plus lima kotak uji
   simetris PITA 48/44/40/36/32 mm berhuruf `L` dan `R` di ujungnya; kotak teratas yang masih tercetak
   penuh kedua ujungnya = lebar aman. Cetak dengan Paper size 58 mm, Margins None, Scale 100 %.
9. **Ganti Sandi** (`/ganti-sandi`) tersedia untuk semua role lewat menu sidebar — di layar HP
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

## Kategori produk
Aplikasi ini dipakai untuk jenis usaha apa pun, jadi daftarnya bukan daftar tetap. Tabel `categories`
sejak awal sudah ada (`id`, `name` UNIQUE, `description`) tetapi satu-satunya isinya adalah seed
`Umum` dan `Makanan` di `init.js` — tidak pernah ada halaman untuk menambahnya, sehingga dropdown di
Data Produk berhenti di dua pilihan. Sekarang pengelolaannya ada di **Kategori Produk** (`/kategori`,
`isManagerOrAdmin`, menu sidebar di bawah Data Produk sehingga ikut muncul di sheet Lainnya pada HP).

- **Tambah / ganti nama** terbuka untuk Manager dan Admin. Nama dipangkas (spasi berlebih dirapatkan,
  maksimal 60 karakter) dan dicek **case-insensitive** lewat `COLLATE NOCASE`, karena UNIQUE bawaan
  SQLite memakai collation BINARY sehingga `Minuman` dan `minuman` boleh masuk bersamaan.
- **Ganti nama tidak menyentuh tabel produk.** Produk menyimpan `category_id`, jadi nama lama yang
  sudah tercetak di label, struk, dan laporan ikut berubah sendiri tanpa migrasi.
- **Hapus diblokir selama masih ada produknya.** Rutenya mengembalikan jumlah produk pemakainya lewat
  `/kategori?terpakai=<id>`, dan halaman itu merender daftar produk penahannya (maks 200 baris pertama,
  jumlah aslinya tetap ditampilkan) supaya operator tahu apa yang harus dipindahkan lebih dulu.
  Tombol hapus di tabel juga dimatikan untuk kategori terpakai, jadi penolakan tidak perlu waited dulu.
  Persis pola proteksi hapus pelanggan (`/pelanggan/delete`).
- Semua nilai keluar lewat `<%= %>` EJS. Nama kategori iseng seperti `<script>alert(1)</script>`
  tersimpan apa adanya tetapi ter-render `&#60;script&#62;` (nol elemen `<script>` di dalam tabel),
  dan tetap kembali utuh saat tombol Edit membuka modal — angka-angka itu lolos dari `onclick='...'`
  karena JSON-nya ikut di-escape EJS.
- **Belum ada filter kategori di layar Kasir** — grid produk sampai sekarang hanya disaring lewat
  ketik nama/barcode. Kalau nanti kategorinya sudah puluhan, tinggal tambahkan chip filter di atas
  grid `views/kasir.ejs`; datanya sudah siap karena `/kasir` sudah ikut menarik `category_id`.

## Label barcode
Barang yang kemasannya tidak punya barcode tetap bisa discan di kasir kalau labelnya dicetak dari
halaman **Cetak Barcode** (`/barcode`, role Manager + Admin, sama seperti Data Produk).

- Produk yang diambil **global, bukan per cabang**: label ditempel di kemasannya dan kemasan yang sama
  berpindah antar cabang. Hanya produk aktif yang ditampilkan supaya label tidak dicetak untuk barang
  yang sudah tidak dijual. Produk tanpa kode di database ditandai `tanpa kode` dan tidak bisa dipilih —
  isikan atau buat kodenya dulu di Data Produk.
- Formatnya **Code 128**, bukan EAN-13. Produk yang disimpan tanpa barcode diberi kode otomatis oleh
  server (`'899' + 10 angka acak`, server.js), dan 13 angka acak itu **tidak memenuhi rumus digit cek
  EAN-13** — scanner yang memeriksa digit cek akan menolak kodenya. Code 128 membaca keseluruhan
  sebagai satu string tanpa validasi digit cek oleh pemindai biasa, jadi kode acak itu tetap terpakai.
  Konsekuensinya: jangan ganti kodenya menjadi format EAN-13 sungguhan kecuali digit cek-nya ikut
  dihitung.
- Pustaka **JsBarcode 3** (MIT) di-vendor ke `public/vendor/jsbarcode/JsBarcode.all.min.js` — sama
  seperti Bootstrap, tidak diambil dari CDN supaya kasir tetap bisa mencetak saat internet mati.
  Berkasnya ikut diprecache di `public/sw.js`; naikkan `STATIC_CACHE` bila bentuk aset berubah.
- Lebar barcode **selalu jatuh pada kelipatan bulat dot printer**. Head 58 mm punya 384 dot @203 dpi
  dan pita yang benar-benar tercetak ±48 mm terpusat (diukur lewat `/uji-struk.html`), jadi isinya
  dibatasi `--lebar-struk` = 44 mm. Dari 44 mm itu 6 mm dicadangkan untuk quiet zone (±10 modul putih
  tiap sisi, syarat pemindai), tersisa 303 dot. SVG digambar dengan `width: 1` sehingga satu satuan
  SVG = satu modul, jumlah modul dibaca dari atribut `width`, lalu `dotPerModul = floor(dot / modul)`
  dan ukuran akhir dikunci lewat CSS dalam mm (`modul × dotPerModul × 25,4 / 203`). Kalau lebarnya
  dibiarkan pecahan dot, tepi bar bergeser sepersekian dot per bar dan setelah seratus lebih bar
  kodenya melenceng beberapa dot — gagal baca. `dotPerModul` dibatasi maksimal 4 supaya kode pendek
  tidak melebar sia-sia.
- Kode 13 angka memakai **Code C** (JsBarcode otomatis beralih untuk deretan angka), hasilnya 123 modul
  → 2 dot/modul → 30,8 mm. Kode campuran sepanjang 13 karakter (misal `ABC-01`) 101 modul → 3 dot/modul.
  Produk yang kodenya terlalu panjang sampai tidak mencapai 2 dot/modul **dilewati saat mencetak** dan
  muncul di daftar pemberitahuan, bukan dicetak jadi barcode selebar 1 dot yang tidak bisa dipindai.
- Alur cetaknya sama dengan struk: label dibangun di `#print-label`, `body.print-label-mode` menahan
  seluruh halaman tetap tersembunyi kecuali area label, lalu `cetakStrukThermal()` menyisipkan
  `@page { size: 58mm auto; margin: 0 }`. `break-inside: avoid` menjaga satu label tidak terbelah di
  antar halaman. Barcode dibuat sebagai SVG inline sehingga tidak ada race seperti logo struk yang
  harus menunggu gambar selesai dimuat.
- Kartu **Kertas label** menyediakan bentuk kertas: `Roll 58 mm — tanpa potong` (satu kolom isi 44 mm,
  tiap label ditutup garis putus-putus sebagai patokan gunting) dan preset die-cut
  `50 × 30`, `43 × 25`, `33 × 15` mm, plus **Ukuran sendiri** (lebar 20–58, tinggi 12–80 mm).
  Preset maupun ukuran custom hanya mengubah tiga variabel CSS pada `#print-label` (`--label-w`,
  `--label-h`, `--label-gap`) dan kelas `.potong`; tidak ada route, tabel, atau kolom baru karena ini
  setelan printer lokal, bukan data toko.
- **Jarak antar garis potong (10–90 mm)** adalah kolom tersendiri dan artinya **berbeda per mode**:
  pada die-cut angka ini adalah jarak garis-potong-ke-garis-potong, yaitu sejauh mana kertas
  dimajukan tiap label; pada roll (kolomnya berganti judul jadi *Jarak setelah isi label*) angkanya
  adalah ruang ekstra 0–10 mm setelah isi. Yang dulu salah tangkap: kolom ini sempat berarti
  "celah tambahan" sehingga jarak cetak selalu `tinggi + celah` dan **tidak pernah bisa lebih kecil
  dari tinggi label**. Padahal itu justru yang dibutuhkan kertas die-cut — MP-58X1 memajukan kertas
  persis sejumlah yang diminta, jadi kalau kertas aslinya berpotongan tiap 29,5 mm sementara kita
  minta 30 mm, isinya meluncur naik 0,5 mm per label dan baris harga tercetak di label berikutnya.
  Sekarang `pitch` dibaca apa adanya dan **boleh di bawah tinggi label**: `area = min(tinggi, pitch)`
  menjadi tinggi blok cetak (`--label-h`) dan margin antar blok `pitch − area`, selalu ≥ 0 sehingga
  tidak pernah ada margin negatif yang bisa dirusak mesin layout. `min`/`max`/judul kolomnya
  di-set ulang setiap preset berganti, dan mengganti preset mengisi ulang kolom ini dengan
  `tinggi + celah` kertas baru — kertas berbeda memang punya jarak potong berbeda.
- **Tinggi & lebar barcode (mm)** punya dua kolom sendiri di kartu yang sama; kosong artinya
  *otomatis* dan mengikuti ukuran kertas, sedang tombol **Pakai ukuran otomatis** mengosongkan
  keduanya lagi. Ini tuas yang benar-benar memendekkan label: di roll, tinggi 12 → 6 mm menurunkan
  jarak cetak dari **24,06 mm** ke **18,07 mm** per label (diukur di browser, bukan dihitung).
  Atapnya ikut area cetak — die-cut hanya boleh memakai sisa `area − dasar`, jadi permintaan 24 mm
  pada label 50 × 30 dipangkas ke 14 mm, dan pada pitch 29,5 mm otomatis turun lagi ke 13,5 mm
  karena 1,5 mm paling bawah label itu secara fisik sudah jadi milik label berikutnya.
  Di roll atapnya 24 mm karena kertasnya memanjang.
  **Lebar barcode hanya bisa dipersempit**, tidak pernah dilebarkan keluar `lebar isi − 6 mm` quiet
  zone, dan hasilnya terkuantum ke bilangan bulat dot: kode 13 angka = 123 modul, jadi di roll ruang
  38 mm menghasilkan 2 dot/modul = **30,78 mm** — angka manual di bawah itu melompat langsung ke
  1 dot/modul (15,39 mm) yang ditandai merah dan produknya otomatis dilewati saat mencetak.
  Setiap pemangkasan maupun penurunan ke 1 dot ditulis di baris info di bawah kolom, tidak disimpan
  diam-diam.
- Label die-cut tetap **terbatas pada pita cetak 44 mm**: lebar isi sebuah label dihitung
  `min(lebar label, 44) − 2` mm — 2 mm pengaman, 1 mm tiap sisi, supaya tidak mepet garis potongan.
  Karena itu label 50 × 30 mm hanya memuat barcode 42 mm, dan **dua label 33 mm sebaris tidak mungkin**
  dicetak di printer ini: pita cetaknya ±48 mm, dua kolom 33 mm pasti terpotong di kiri-kanan. Kalau
  nanti pindah ke printer label 80 mm, yang ditinjau ulang cuma dua tempat: `PITA_MM` di
  `views/barcode.ejs` dan `--lebar-struk` di `public/css/style.css`.
- **Tata letak mengikuti area cetak**, yaitu `min(tinggi label, jarak potong)`. 24 mm ke atas memakai
  nama (maksimal dua baris, di-`line-clamp` supaya tidak bisa tumbuh tanpa batas), barcode, kode, dan
  harga; di bawahnya turun ke tata letak ringkas — nama satu baris berelipsis, kode dan harga
  digabung sebaris dengan font 8 px. Barcode tidak pernah memakan jatah teks:
  `tinggiBarcode = area − dasar`, dengan `DASAR = { ringkas: 7, penuh: 16 }` mm yang **diukur dari
  cetakan**, bukan dari rumus tinggi garis. Label 33 × 15 maupun ukuran custom seperti 38 × 19
  karenanya tetap utuh dan tidak ada yang terpotong `overflow: hidden`. Kolom tinggi manual hanya
  boleh memakai atap yang sama (`tinggiBarcodeMaks`), dan ukurannya dipasang langsung sebagai
  `style` SVG (`width`/`height` dalam mm) sehingga tidak perlu variabel CSS baru.
- **Jarak cetak = angka di kolom jarak potong**, bukan hasil jumlah tinggi label. Blok dicetak
  setinggi `area` dengan `margin-bottom = pitch − area`, jadi jarak antar puncaknya selalu sama
  dengan yang diketik operator (terukur 29,5 / 30 / 25 mm persis di browser). Posisi awal label
  pertama dikoreksi lewat **Geser turun** (`--label-geser`, dipasang sebagai `top` pada kontainer
  absolut — `padding-top` negatif tidak valid). Mobile printer seperti MP-58X1 tidak punya sensor
  celah die-cut, jadi kalibrasinya dua tahap dan masing-masing punya gejala sendiri: **label pertama
  sudah melenceng** atur *Geser turun*; **label pertama pas tapi yang ketiga mulai bergeser** atur
  *jarak potong*.
- **Cetak penggaris** (`cetakPenggaris()` + `svgPenggaris()`) menjawab "berapa jarak potong kertas
  ini" tanpa penggaris: printer mencetak satu kolom berskala 1–125 mm, dan MP-58X1 memajukan kertas
  0,125 mm per baris dots sehingga skala itu lebih teliti daripada penggaris plastik.
  Sengaja satu blok memanjang tanpa tinggi label, tanpa jarak potong, dan tanpa geser — kalau tidak,
  angka yang dibaca ikut ditentukan oleh setelan yang sedang diukur. Garis tebal di x 24–44 mm
  menandai batas label menurut angka yang sekarang diketik, jadi geseran bisa dilihat langsung tanpa
  berhitung. Diperiksa di browser: garis y=32 mendarat di 31,999 mm dan y=125 di 124,997 mm dari puncak
  blok. Syaratnya cuma satu — **Scale: 100%** di dialog print, karena cetakan yang menyusut membuat
  skalanya ikut salah.
- Pilihan kertas, ukuran custom, jarak, ukuran barcode, dan nilai geser disimpan di `localStorage`
  kunci `kasir-label-barcode` — di browser operator, bukan di database, karena tiap mesin punya
  kalibrasi sendiri dan kertas yang sama dipakai berulang sepanjang hari. Kosong pada kolom tinggi
  dan lebar barcode juga ikut disimpan, karena "otomatis" adalah pilihan operator yang harus
  bertahan setelah halaman dimuat ulang, bukan sekadar "belum pernah diisi". Nilai jarak lama
  (zaman kolom itu masih "celah 0–10 mm") diterjemahkan saat dipulihkan — `tinggi + celah` — supaya
  kalibrasi orang yang sudah menyimpan setelan tidak tiba-tiba jatuh ke pitch 2 mm.
- Kapasitas kode per ukuran ditampilkan lewat `kapasitasLabel()`: jumlah modul maksimum dicari dengan
  mencoba kode contoh betulan sampai `dotPerModul` masih 2 — ±18 angka atau 10 karakter huruf+angka
  pada lebar 44 mm, ±8 angka pada label 33 mm (isi 31 mm). Kode yang tidak lolos dilewati, dan
  peringatan cetaknya menyebut angka hasil pengukuran itu, bukan angka tetap yang bisa salah.

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
    vendor/                 Bootstrap 5.3.0 + bootstrap-icons 1.11.1 + JsBarcode 3 lokal (tanpa CDN)
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
| Manager Cabang | data cabang sendiri, produk (tambah + atur kategori), cetak label barcode, opname, stok, transfer, pengeluaran operasional, laporan, kelola kasir di cabangnya |
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

## Menjalankan di latar belakang
`npm run dev` dan `npm start` menempel di jendela terminal: jendela ditutup, kasir mati.
Untuk mesin kasir yang sebenarnya, jalankan sebagai proses latar belakang. Dua aturan dulu:

- **Satu proses saja per folder.** `database/kasir.db` satu berkas dan scheduler cadangan
  berjalan di dalam proses, jadi dua instance yang hidup bersamaan berarti dua scheduler
  dan dua koneksi ke basis data yang sama.
- **Jangan nodemon di produksi.** nodemon restart saat file `.js` berubah, termasuk saat
  cadangan atau editor menyentuh folder proyek, dan restart di tengah transaksi membuat
  struk tidak tercetak.

### pm2 (disarankan, Linux dan Windows)

```bash
npm install -g pm2
cd C:\Users\HRJNET\Desktop\kasir-pos
pm2 start server.js --name kasir
pm2 save
```

`pm2 status` untuk melihat, `pm2 logs kasir --lines 50` untuk membaca log, `pm2 restart kasir`
untuk restart, `pm2 stop kasir` / `pm2 delete kasir` untuk melepasnya. Variarbel lingkungan
diberikan lewat berkas `.env` di folder proyek (`dotenv` sudah dimuat `server.js`), jadi
`PORT`, `SESSION_SECRET`, dan `BACKUP_INTERVAL_MIN` tidak perlu diulang di perintah.

`pm2 startup` (hidup otomatis saat mesin nyala) **tidak mendukung Windows**. Di Windows,
pasang auto-start lewat Task Scheduler:

```powershell
schtasks /Create /TN KasirPOS /TR "pm2 resurrect" /SC ONSTART /RU %USERNAME% /F
```

`pm2 resurrect` menjalankan kembali daftar yang tersimpan `pm2 save`, jadi tidak perlu
mengulang perintah start tiap boot. Alternatifnya: pasang pm2 sebagai service lewat NSSM
(`nssm install KasirPOS` lalu arahkan ke `pm2.cmd` dengan argumen `resurrect`).

### Alternatif tanpa dependensi tambahan

Kalau tidak mau memasang pm2, cukup sembunyikan jendelanya:

```powershell
Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory "C:\Users\HRJNET\Desktop\kasir-pos" -WindowStyle Hidden
```

Cara ini tidak menahan proses tetap hidup saat mesin restart dan tidak otomatis
menghidupkan ulang kalau proses mati, jadi hanya cocok untuk uji cepat. Untuk layanan yang
ikut boot, pakai NSSM (`nssm install KasirPOS "C:\Program Files\nodejs\node.exe" "server.js"`)
yang mendaftar `server.js` sebagai Windows service.

### Setelah mengubah CSS

`ASSET_VER` dihitung dari `mtime` `public/css/style.css` **satu kali saat proses start**, dan
nilai itu dipakai sebagai penanda `?v=` di semua halaman. Tanpa restart, browser tetap
meminta `style.css?v=<lama>` sehingga perubahan tampilan tidak kelihatan. Karena itu, setiap
mengubah CSS: `pm2 restart kasir` (atau Ctrl+C lalu `npm start` ulang).

## Tunneling lewat Cloudflare
Cloudflare Tunnel (`cloudflared`) membuat kasir bisa dibuka dari luar jaringan lokal tanpa
membuka port, tanpa IP tetap, dan tanpa memasang SSL sendiri: `cloudflared` membuka koneksi
keluar ke Cloudflare, jadi mesin kasir hanya perlu internet.

### Uji cepat (tanpa akun Cloudflare, tanpa domain)

```powershell
winget install --id Cloudflare.cloudflared
cloudflared tunnel --url http://localhost:3000
```

Cloudflare mencetak URL `https://<acak>.trycloudflare.com` yang langsung menunjuk ke kasir.
URL ini **tidak terlindungi apa pun**: siapa pun yang mengetahuinya bisa membuka halaman
kasir, dan URL-nya berubah setiap kali `cloudflared` dijalankan ulang. Pakai untuk cek
tampilan dari HP di luar WiFi toko, jangan untuk transaksi sehari-hari.

### Produksi (domain sendiri + tunnel bernama)

1. `cloudflared tunnel login` — browser terbuka, pilih zone domain Anda.
2. `cloudflared tunnel create kasir-pos` — menyimpan kredensial
   `C:\Users\<anda>\.cloudflared\<TUNNEL_ID>.json`.
3. `cloudflared tunnel route dns kasir-pos pos.domainanda.com` — membuat DNS `CNAME` ke tunnel.
4. Isi `C:\Users\<anda>\.cloudflared\config.yml`:

```yaml
tunnel: <TUNNEL_ID>
credentials-file: C:\Users\<anda>\.cloudflared\<TUNNEL_ID>.json
ingress:
  - hostname: pos.domainanda.com
    service: http://localhost:3000
  - service: http_status:404
```

5. `cloudflared tunnel run kasir-pos` — cek `https://pos.domainanda.com/login` terbuka,
   lalu pasang sebagai service Windows dari PowerShell **Run as administrator**:

```powershell
cloudflared service install
```

Service membaca `C:\ProgramData\cloudflared\config.yml`, jadi salin `config.yml` dan berkas
`<TUNNEL_ID>.json` ke `C:\ProgramData\cloudflared\` (dan sesuaikan `credentials-file` di
dalamnya) sebelum `service install`. Jalankan `cloudflared service uninstall` untuk melepas.

### Yang wajib ditutup sebelum tunnel dipakai transaksi

Aplikasi ini dibuat untuk jaringan lokal toko, jadi ekspos ke internet menambah risiko yang
belum ditangani kode:

- **Pasang Cloudflare Zero Trust Access di depan hostname.** Tanpa Access, URL tunnel adalah
  pintu masuk kasir. Di dashboard One: *Access > Applications > Add application > Self-hosted*,
  domain `pos.domainanda.com`, policy **Allow** untuk email owner/kasir saja. Pengguna akan
  lewat kode OTP email sebelum menyentuh aplikasi, dan kredensial kasir tidak lagi satu-satunya
  lapis.
- **Ganti `SESSION_SECRET`** di `.env`. Bawaannya jatuh ke `'secret'`
  (`server.js:33`), dan cookie sesi hanya `httpOnly; SameSite=Lax` tanpa flag `secure`
  (`server.js:36`) — jadi rahasia itu yang menahan pemalsuan cookie.
- **Matikan sandi default.** Login admin bawaan ditandai `force_pass_change` dan diarahkan ke
  `/ganti-sandi`; pastikan semua akun sudah ganti sebelum hostname publik.
- **Perhatikan port lokal.** `app.listen(PORT)` tanpa argumen host, jadi kasir tetap terbuka di
  semua interface mesin (`http://192.168.x.x:3000`). Kalau akses LAN tidak dibutuhkan, batasi
  3000 dengan Windows Firewall agar hanya lewat tunnel.
- **Ukuran upload.** Gambar QRIS dan logo dibatasi 4 MB (`server.js:53`); lewat tunnel batas ini
  tetap di sisi aplikasi, tapi Cloudflare punya batas body sendiri — kalau upload QRIS gagal di
  tunnel padahal lokal berhasil, cek ukuran berkasnya lebih dulu.

### Yang justru membaik lewat tunnel

Halaman yang dibuka dari `https://pos.domainanda.com` adalah *secure context*, sehingga
service worker di `public/sw.js` terdaftar dan HP kasir dapat salinan offline. Lewat
`http://192.168.x.x:3000` hal itu tidak terjadi karena konteksnya tidak aman. Sisi
buruknya: setiap hop keluar menambah latensi, dan kalau internet toko mati, tunnel ikut mati —
kasir tetap bisa dipakai lewat alamat LAN, dengan struk QRIS dan harga yang tersaji dari cache.

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
- Sebelum hostname hasil tunnel dipakai transaksi, selesaikan checklist di bagian
  **Yang wajib ditutup sebelum tunnel dipakai transaksi** — yang paling penting Access
  dan `SESSION_SECRET`.
