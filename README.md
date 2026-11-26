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
   Setiap pemakaian voucher **dibekukan di nota**: `sales.voucher_id` dan `sales.voucher_code`
   diisi server saat checkout (bukan dari request klien), dan kodenya ikut dicetak di struk.
   Karena itu riwayat tetap terbaca walaupun vouchernya nanti diedit atau dihapus, dan kolom
   **Dipakai** di halaman `/voucher` menunjukkan berapa nota memakai kode itu beserta total
   potongannya. Yang belum ada: batas pemakaian — satu voucher aktif boleh dipakai di setiap
   transaksi tanpa batas, jadi voucher sebaiknya dianggap tombol diskon permanen sampai ada
   `max_usage`/tanggal berlaku.
8. **Laporan Penjualan** (`/laporan`) menghitung omzet, HPP, laba kotor, dan laba bersih
   setelah pengeluaran operasional serta gaji. Ringkasan selalu dihitung atas **seluruh**
   transaksi yang cocok dengan filter, sementara tabelnya dipecah 50 baris per halaman;
   baris berstatus VOID tampil sebagai jejak audit tetapi tidak masuk angka ringkasan.
   Diskon sekarang ikut terlihat: ada kolom **Diskon** di tabel nota (dengan kode vouchernya),
   baris **Diskon diberikan Rp … di N nota** di kartu Omset, satu baris **Diskon** di struk
   thermal, dan blok **Rekap Diskon** khusus Manager/Admin berisi per kasir/cabang
   (jumlah nota berdiskon dibanding seluruh notanya, total potongan, dan `% diskon` =
   `Σ discount ÷ Σ subtotal`) serta per kode voucher. Rekap ini alat periksa, bukan vonis:
   satu nota berdiskon itu promosi, sementara satu kasir yang memberi potongan di hampir
   setiap nota adalah pola yang perlu ditanyakan. Transaksi VOID dikecualikan dari rekap,
   tetapi jejak kodenya tetap terbaca di baris nota yang dibatalkan.
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
10. **Cadangan & Data** (`/backup`, khusus Admin) mengunduh satu ZIP berisi seluruh database +
   logo/QRIS + CSV, menampilkan berkas cadangan otomatis yang bisa diunduh satu-satu, dan
   mencatat aksi penghapusan data terakhir. Penghapusan data besar berada di kartu **Zona
   Berbahaya** pada halaman **Pengaturan Toko**.

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

## Scan barcode dengan kamera HP
Tombol **Scan** (ikon kamera) duduk di samping kolom pencarian produk `/kasir`, bukan sebagai
halaman terpisah. Satu tombol, dua jalur, karena keduanya pasti dipakai di toko:

- **Viewfinder langsung** — barcode masuk keranjang tanpa ketuk apa pun. Hanya hidup di
  *secure context*: `https://pos.domainanda.com` (tunnel) atau `http://localhost`. Di
  `http://192.168.x.x:3000` browser menolak `getUserMedia`, jadi jalur ini tidak pernah muncul
  lewat alamat LAN. Itu aturan browser, bukan bug aplikasi.
- **Mode foto** — tombol yang sama membuka kamera bawaan HP lewat
  `<input type="file" accept="image/*" capture="environment">`, fotonya dibaca dari berkas.
  Bukan `getUserMedia`, jadi jalan di konteks apa pun, termasuk alamat LAN. Kalau viewfinder ditolak
  atau kamera tidak ada, layar pemindai pindah ke mode ini dengan penyebabnya apa adanya (lihat
  tabel di bawah) — mode foto tidak pernah lagi jadi satu-satunya petunjuk.

**Tombolnya sendiri memberi tahu mode mana yang aktif** (`tandaModeScan()`), supaya bedanya tidak
perlu diketuk dulu untuk diketahui:

- Titik kecil di sudut kanan-atas ikon kamera — **hijau** = scan terus-menerus, **kuning** = potret
  per item. Warnanya titik, bukan tulisan, karena label tombolnya disembunyikan Bootstrap di bawah
  576px, padahal justru di HP alamat LAN itu membuka potret.
- Label `Scan terus` / `Potret` pada layar ≥ 576px, dan kalimat yang sama di `title` + `aria-label`.
- Di layar pemindai mode foto, satu baris kuning di bawah tombol "Potret ulang" menyebut alamat yang
  sedang dipakai (`location.origin`): *"Scan tanpa potret butuh https:// - perangkat ini membuka
  http://192.168.x.x:3000"*. Baris ini hanya muncul kalau yang menolak memang alamatnya — kalau
  halaman sudah https tetapi kameranya yang gagal, barisnya tetap kosong supaya tidak menyalahkan
  hal yang benar.

Jadi untuk pemakaian harian di HP: **buka kasir dari alamat tunnel (`https://…`), bukan dari
`http://192.168.x.x:3000`** — tidak ada yang perlu diubah di aplikasi, viewfinder langsung aktif dan
barcode masuk keranjang tanpa ketuk. Uji cepat dari satu mesin: `cloudflared tunnel --url
http://localhost:3000` (alamatnya acak, hanya untuk coba). Untuk alamat tetap, lihat bagian
*Tunneling lewat Cloudflare* di bawah. Mode foto tetap tinggal sebagai cadangan: internet toko mati,
HP lain yang belum diarahkan ke https, atau kamera yang izinnya dicabut.

**Kalau halaman sudah https tapi kamera tetap tidak mau menyala**, layar pemindai sekarang menyebut
penyebabnya dan satu langkah yang bisa dikerjakan, bukan lagi "Kamera halaman tidak bisa dibuka.
Pakai mode foto sebagai gantinya." Yang lama itu menyembunyikan sebabnya karena `html5-qrcode`
menolak dengan string generik (`Camera failed to start`) sambil membuang nama error aslinya, jadi
`cekKamera()` meminta kamera sekali sendiri lewat `navigator.mediaDevices.getUserMedia` (streamnya
langsung dilepas, +250ms supaya Chrome Android melepas kameranya rapi-rapi) dan nama error yang
terbaca di sana yang diterjemahkan `sebabKamera()`:

| Error | Yang muncul di layar |
|---|---|
| `NotAllowedError` / "permission denied" | Izin kamera belum diberikan untuk `<host>` — ketuk ikon gembok di bilah alamat Chrome > Izinkan > muat ulang |
| `NotReadableError` / `TrackStartError` / "in use" | Kamera dipegang tab atau aplikasi lain — tutup lalu ketuk **Coba lagi** |
| `NotFoundError` | Perangkat tidak punya kamera yang bisa dipakai halaman |
| `OverconstrainedError` | Kamera belakang tidak tersedia |
| sisanya | Nama + pesan error ditampilkan apa adanya |

Tombol **Coba lagi** hanya muncul sesudah kamera benar-benar gagal (`.scan-gagal` dipasang
`turunKeModeFoto()`), supaya selama viewfinder jalan tidak ada tombol yang mengundang kasir
memulai ulang kamera yang sedang dipakai. Mode foto tetap dibuka di belakang penjelasannya —
antrean tidak boleh macet gara-gara satu izin.

**Sebab yang benar-benar terjadi di HP toko** (2026-11-26, lewat screenshot layar ini):
`'facingMode' should be string or object with exact as key` — kamera dan izinnya sehat, yang salah
adalah bentuk argumen yang kita kirim ke pustaka. `createVideoConstraints()` di dalam
`html5-qrcode.min.js` menuntut **tepat satu kunci** dan `facingMode` hanya boleh string
`"user"`/`"environment"` atau `{exact: ...}`; `{facingMode: {ideal: 'environment'}}` yang dulu dipakai
ditolak sebelum browser sempat menyentuh kamera sama sekali. Yang dipakai sekarang:
`start({ facingMode: 'environment' }, ...)`. String polos dipilih justru karena paling longgar —
browser memakainya sebagai *ideal*, jadi perangkat tanpa kamera belakang (webcam laptop di kasir)
tetap dapat kamera, sedangkan `{exact: 'environment'}` akan gagal `OverconstrainedError`.
`cekKamera()` sengaja tetap memakai `{video: {facingMode: {ideal: ...}}}` karena itu panggilan
`getUserMedia` sungguhan, bukan lewat pustaka, dan di sana `ideal` memang sah. Gerbang
`cek-sintaks.js` menjaga keduanya tidak tertukar lagi. Catatan penting waktu menelusuri penyebab:
`helmet@7.2.0` **tidak** mengirim header `Permissions-Policy` (header itu baru jadi default di
helmet 8), jadi `camera=()` bukan penyebab kegagalan di stack ini — sudah diverifikasi dengan
menjalankan middlewarnya dan mencetak header yang dihasilkan.

Kalau layar yang muncul memang **"Izin kamera belum diberikan"**, langkah persisnya di Chrome
Android (bukan di aplikasinya):

1. Ketuk **ikon gembok** di bilah alamat (sebelah kiri `kasir.harapanrudijaya.my.id`) — bukan menu ⋮.
2. Di panel yang terbuka, kamera biasanya tertulis *Diblokir* atau *Tanyakan lagi*. Ketuk **Izinkan**
   untuk kamera; kalau panelnya tipis, ketuk **Pengaturan situs**/kelola izin di panel itu dulu.
3. Kembali ke halaman, ketuk **Coba lagi**. Kalau tidak berubah, muat ulang (⋮ > Muat ulang) — izin
   baru berlaku untuk pemuatan berikutnya.
4. Kalau ikon gembok tidak menawarkan apa pun, izinnya dikunci di level sistem: **Setelan HP > Aplikasi
   > Chrome > Izin > Kamera > Izinkan**. Selama di sini masih "Jangan izinkan", Chrome tidak pernah
   menampilkan permintaan izin sama sekali dan `getUserMedia` langsung balik `NotAllowedError`.
5. Alternatif lewat daftar situs: ⋮ > **Setelan > Setelan situs > Kamera**, cari host-nya di daftar
   *Diblokir* > ubah ke *Izinkan*. Untuk membersihkan semua ingatan izin: **Setelan situs > Setel
   ulang izin situs ke default**.

Pustaka: `html5-qrcode@2.3.8` (375 KB, Apache-2.0) diambil ke `public/vendor/html5-qrcode/` —
bukan CDN, tidak ada dependensi npm baru, jadi `git pull` + `npm run dev` di mesin kasir tetap
cukup dan pemindai tetap jalan saat internet mati. Berkasnya ikut didaftarkan di `SHELL`
`public/sw.js` dan penanda cache statis dinaikkan (`kasir-statis-v5`) supaya klien membuang
salinan lama. Decoder yang dipakai: `BarcodeDetector` bawaan browser bila ada, kalau tidak
decoder bawaan pustaka (`useBarCodeDetectorIfSupported: true`). iOS Safari tidak punya
`BarcodeDetector` sama sekali, jadi di iPhone yang bekerja jalur bundel — dan browser yang dipakai
mengukur di sini juga tidak punya `BarcodeDetector` (`window.BarcodeDetector` kosong), sehingga
semua hasil round-trip di bawah benar-benar melewati decoder bundel, bukan detektor bawaan.

Format yang diterima sengaja dibatasi: Code 128 (label cetakan `/barcode`), EAN-13/EAN-8/UPC-A/
UPC-E (kemasan retail), Code 39, ITF, dan QR (QRIS, kode supplier). Round-trip terukur pada
gambar PNG hasil JsBarcode + satu QRIS asli: `code128` 8990000015892, `ean13` 5901234123457,
`ean8` 96385074, `code39` "KASIR-99", `itf` 123456789012, `upca` 042100005264, dan payload QRIS
278 karakter — semuanya kembali persis. (ITF sempat gagal pada gambar tipis `width: 2.2`; dengan
modul 3.6 dan margin 30px langsung terbaca, jadi itu artefak gambar uji, bukan pustakanya.)

Hasil scan masuk lewat `prosesKode()` — **jalur yang sama persis** dengan Enter dari scanner USB,
jadi aturannya tidak bercabang: barcode sama persis menang, satu-satunya yang cocok langsung
**masuk keranjang** (tanpa konfirmasi), lebih dari satu hanya **menyaring** daftar ("89900000 cocok
dengan 28 produk - ketuk kartunya."), dan yang tidak dikenal hanya memunculkan baris status merah,
bukan alert — alert di atas layar pemindai membuat scan berikutnya terkunci. Umpan baliknya baris
status hijau `+ 1 KABLET 3M Rp 8.000` + bip 1180 Hz + `navigator.vibrate(45)`; perangkat tanpa
speaker tetap mendapat getaran.

Satu barcode yang dibiarkan di depan kamera terbaca ulang 10 kali per detik, jadi ada
`JEDA_ULANG_SCAN = 2200` ms untuk kode yang sama: tiga scan berturut-turut dari berkas yang sama
hanya menambah satu item (terukur qty 1 → 2, bukan → 4). Stok yang sudah penuh dilaporkan lewat
baris status ("Stok KABLET 3M tinggal 41."), bukan dialog.

Kamera dimatikan lewat `stop()+clear()` saat overlay ditutup (tombol X atau **Escape**) dan lewat
`pagehide` saat halaman ditinggalkan — kamera yang tertinggal menyala menguras baterai HP dan
menahan LED scanner. `escHtml()` dipasang pada nama produk di keranjang karena teks yang terbaca
dari kamera (isi QRIS, kode supplier) ikut dirender sebagai baris.

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

## Impor massal produk dari Excel
Menambah 40 barang satu-satu lewat form Data Produk itu lambat, dan restok harian pada dasarnya
hanya mengedit angka stok. Untuk itu ada kartu **Impor massal dari Excel** di `/produk`
(`isManagerOrAdmin`, sama seperti halaman produknya): unduh template, buka di Excel, unggah kembali.
Kodenya di `scripts/impor-produk.js`, rutenya `GET /produk/template` dan `POST /produk/impor`.

- **Dua langkah, satu berkas.** Template (`/produk/template`, nama berkas
  `template-produk-YYYY-MM-DD.csv` mengikuti tanggal WIB) sudah berisi semua produk yang ada
  lengkap dengan stok tiap cabang, jadi berkas yang sama dipakai untuk dua hal: koreksi harga dan
  restok harian. Baris petunjuk diawali `#` (delapan baris) dan dilewati saat impor, sehingga tidak
  mengganggu tabel di Excel.
- **Formatnya CSV, bukan .xlsx**, dengan pemisah titik-koma dan BOM UTF-8 — sama seperti ekspor di
  `/backup`, karena itu yang dikenali Excel regional Indonesia. Mengunggah `.xlsx` ditolak dengan
  pesan yang menyuruh *Save As → CSV (Pemisah Titik-Koma)*; membaca .xlsx berarti menambah pustaka
  parsing, dan deployment kasir ini sengaja tanpa dependensi baru.
- **Kolom wajib cuma `nama` dan `harga_jual`.** Kolom lain boleh kosong dan tidak menimpa nilai lama.
  Nama kolom boleh ditulis variasinya (`harga`, `jual`, `price_sell`, `stok_minimum`, ...) lewat
  peta alias `KOLOM`; stok cabang dikenali dari `stok_<kode cabang>` atau `stok_<nama_underscore>`
  dan dipetakan ke id cabang di `petakanKolom`.
- **`stok_...` adalah STOK AKHIR, bukan tambahan.** Sel kosong = stok cabang itu tidak disentuh.
  Sel terisi dihitung sebagai selisih terhadap stok sekarang, lalu ditulis lewat
  `adjustBranchStock(..., 'ADJUST', ...)` — jalur yang sama dipakai penyesuaian manual — sehingga
  `stock_movements` tetap bercerita dan tidak ada stok yang berubah tanpa jejak.
- **Barcode yang sudah ada diperbarui, tidak diduplikat.** Ini pilihan yang disengaja: kalau impor
  selalu membuat barang baru, file hasil unduh template tidak bisa dipakai restok. Produk tanpa
  barcode mendapat kode otomatis `'899' + 10 angka acak` (pola yang sama dengan form produk).
  Kategori baru dibuat otomatis sebelum produknya masuk.
- **Semua atau tidak sama sekali.** `rencanakan()` memvalidasi seluruh baris lebih dulu dan
  mengembalikan rencana kosong kalau ada satu galat pun, jadi tidak ada jalur pemanggil yang bisa
  menulis sebagian berkas; rutenya menolak sebelum menyentuh database, dan penulisannya dibungkus
  satu `db.transaction`. Baris yang jumlah kolomnya tidak sama dengan header (kerap terjadi karena
  sel kosong di ujung) dilaporkan sebagai galat parser, bukan diam-diam dilewati.
- **Aman dipakai bolak-balik.** Nilai ekspor diberi apostrof anti-rumus oleh `bersih()`; impor
  melepas apostrof itu (`lepasPengaman`) sebelum membandingkan, jadi mengunduh template lalu
  mengunggahnya kembali tidak mengubah apa pun (diverifikasi: nol baris jurnal stok baru).
  Angka masih terbaca walau ditulis `Rp 15.000` atau `15.000`.
- **Batasnya:** berkas maksimal 5 MB, dan Manager Cabang hanya bisa menyentuh kolom cabang yang
  boleh ia akses — baris yang menyinggung cabang lain ditolak, bukan diam-diam diabaikan.

## Penggajian karyawan
- Periode gaji di modal **Input Gaji** tidak lagi diketik bebas. Kolomnya `<input type='month'>`
  (`views/penggajian.ejs`) yang menghasilkan `YYYY-MM` dan sudah terisi bulan WIB berjalan saat
  halaman dibuka. Sebelumnya kolom itu `type='text'` + `required` dengan placeholder
  `Contoh: November 2026`: bubble "Please fill out this field." muncul begitu tombol Simpan ditekan
  sementara kolomnya masih kosong, dan kolom teks bebas tidak punya acuan format — `November 2026`,
  `11/2026`, dan `Nov 26` sama-sama diterima server lalu masuk ke satu kolom yang sama.
- Browser tanpa dukungan `type=month` (Safari desktop) tetap bisa memakai halaman ini. Skripnya
  memeriksa `el.type`; kalau masih `text`, input disembunyikan dan dua `<select>` (12 nama bulan
  Indonesia + tahun 6 tahun ke belakang sampai 1 tahun ke depan) menampilkannya gantinya. Keduanya
  menulis balik ke input yang sama, jadi nama field dan format kiriman tidak berubah. Diperiksa dengan
  menjalankan skrip bawaan halaman setelah `type` dipaksa `text`: input hilang dari layout, select
  muncul dan terpilih November/2026, nilai yang terkirim tetap `2026-11`.
- Server hanya menerima keluaran pemilih. `/penggajian/add` mencocokkan `^(\d{4})-(\d{2})$` dengan
  bulan 01–12, lalu ikut memeriksa **karyawan** (`user_id` harus ada di tabel `users` — kolomnya
  sengaja tidak diberi foreign key karena baris lama boleh menunjuk akun yang sudah dihapus, jadi
  tanpa cek ini id karangan masuk diam-diam dan tabel gaji menampilkan nama kosong) dan **nominal**
  (harus angka > 0, dibulatkan ke rupiah utuh supaya tabel tidak pernah menampilkan
  `Rp 1.500.000,5`). Nilai yang ditolak **tidak ditulis sama sekali** dan halaman dibuka lagi lewat
  `/penggajian?error=...` sehingga pesannya tampil sebagai alert di atas tabel, bukan hilang diam-diam.
- Yang tampil di tabel dan badge **tetap label bulan seperti biasa** (`November 2026`), bukan
  `2026-11`, jadi tidak ada dua format campuran yang harus dibaca manusia. Konversinya satu arah di
  route: angka pemilih → nama bulan dari `NAMA_BULAN`, konstanta yang sama dipakai `/laporan`
  (duplikat lokalnya di situ sudah dihapus).
- Di samping label itu ada kolom kunci `payroll.period` (`YYYY-MM`, `database/migrations/init.js`)
  yang dipakai laporan. Baris lama di-backfill dari labelnya sekali jalan; label yang tidak terbaca
  persis `NamaBulan YYYY` dibiarkan tanpa kunci dan jatuh ke perilaku lama, bukan dikarang kuncinya.
- **Laporan membebankan gaji ke periodenya**, bukan ke tanggal input: gaji berperiode
  "November 2026" yang baru diinput 3 Desember tetap masuk laba-rugi November
  (`COALESCE(period, strftime('%Y-%m', date))` pada `/laporan?filter=bulan_ini`). Untuk
  `filter=hari_ini` yang dipakai tetap tanggal input — satu bulan gaji tidak punya hari, jadi angka
  hari ini berarti "uang gaji yang keluar hari ini", dan dashboard ikut menghitungnya begitu.
  Ini perubahan angka yang terlihat: laporan bulan berjalan bisa tampak lebih kecil daripada
  sebelumnya kalau gaji bulan itu baru dibayar bulan berikutnya (dan lebih besar kalau gaji bulan
  lalu diinput sekarang).
- Kolom nominal tunggal di modal **Input Gaji** sekarang empat isian: **Gaji Pokok, Tunjangan /
  Lembur, Bonus, Potongan** (`views/penggajian.ejs`). Yang disimpan di `payroll.amount` tetap satu
  angka, yaitu **yang dibayar = pokok + tunjangan + bonus − potongan**, dihitung server — jadi
  `/laporan` dan dashboard tidak perlu diaudit ulang dan kolom lama tetap berisi uang yang benar-benar
  keluar. Kolom per komponennya (`gaji_pokok`, `tunjangan`, `bonus`, `potongan`, `REAL DEFAULT 0`)
  ditambahkan lewat `ensureColumn` dan baris lama di-backfill `gaji_pokok = amount`, sehingga slip
  baris lama tetap memperlihatkan rincian (pokoknya = angka yang dulu dibayar).
  - Isian kosong berarti 0, bukan "belum diisi": bulan yang isinya hanya bonus tetap bisa diinput.
    `required` sengaja tidak dipasang di gaji pokok supaya operator tidak dihentikan bubble browser
    saat kasusnya memang tanpa pokok.
  - Validasi per kolom: nilai yang bukan angka Rp ditolak dengan pesan yang **menyebut kolomnya**
    (`"abc" di kolom tunjangan bukan angka Rp yang boleh diisi.`), dan total ≤ 0 (mis. potongan
    1.500.000 vs pokok 1.000.000) ditolak dengan menyebutkan brutonya. Titik ribuan diterima —
    `Rp 2.000.000` dan `250.000` sama-sama dibaca 2.000.000 / 250.000; tanpa pembersihan itu,
    `Number('250.000')` menghasilkan 250 dan gaji terpotong seribu kali tanpa pesan apa pun.
  - Jalan lama tetap hidup: kiriman form versi sebelumnya (satu kolom `amount`) diterima dan angkanya
    jadi gaji pokok, jadi tidak ada curl/template lama yang tiba-tiba gagal.
  - Invariant yang dijaga tes: `amount` di semua baris selalu sama dengan jumlah rinciannya
    (`uji-gaji.js` #58). Slip tidak pernah menampilkan total yang berbeda dengan rincian di atasnya.
- **Slip gaji** dicetak dari dua tombol di kolom Aksi tiap baris: `58` untuk kertas thermal MP-58X1
  dan `A4` untuk dialog cetak/PDF. Isinya kop toko (nama, alamat, telepon dari `settings`), nama +
  posisi karyawan, periode, tanggal bayar, nomor slip, keempat rincian, total terbayar, keterangan,
  dan dua kotak tanda tangan (penerima & admin).
  - Datanya (`SLIP`, `TOKO`) dikirim bersama halaman lewat `JSON.stringify(...).replace(/</g,'\\u003c')`
    sama seperti halaman Cetak Barcode, jadi tombol tetap jalan tanpa koneksi dan angka slip persis
    angka di tabel. `<` di nama/keterangan tidak bisa menutup tag script — diuji dengan keterangan
    `<img src=x onerror=alert(1)>`: keluar sebagai teks (`&lt;img`) di slip dan halaman.
  - Versi 58 mm memakai pita cetak struk yang sama (`--lebar-struk: 44mm`, monospace 10 px) dan
    `cetakStrukThermal()`; versi A4 (`170mm`, border, tabel 12 px) sengaja memakai `window.print()`
    biasa supaya "Simpan sebagai PDF" masih bisa dipilih.
  - Diukur di browser dengan aturan `@media print` disalin ke layar (1 mm = 96/25.4 px), tiga baris
    gaji terburuk (rincian lengkap + nama akun terhapus + keterangan 82 karakter): thermal **lebar
    44,00 mm, tepi kanan terjauh 44,00 mm, luber 0,00 mm**, tiap baris uang **3,70 mm = satu baris
    tidak ada yang melingkar**, tinggi slip 78,8–89,8 mm; A4 **lebar 170,00 mm, tepi kanan terjauh
    161,73 mm, tinggi 158,1–175,2 mm** (masih satu lembar, area A4 Chrome ±277 mm). Alamat dan
    keterangan panjang memang boleh melingkar jadi 2–3 baris — tidak ada yang terpotong.
  - Baris gaji milik akun yang sudah dihapus tetap tercetak lengkap: nama keluar sebagai
    `akun sudah dihapus`, nominalnya tetap dari kolom `amount`.
  - Di HP (viewport 390 px) modalnya jadi susun 2×2: tiap isian 166×42 px dengan font 16 px (tidak
    memperbesar layar), total terbayar dihitung langsung saat mengetik (`Rp 3.450.000`; kalau
    potongan melebihi bruto angkanya jadi merah `Rp -5.250.000` tapi tetap ditolak server), dan
    tombol **Kosongkan** menolkan keempat isian.

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
- Kartu **Kertas label** disusun dua kolom: `col-xl-7` berisi semua isian (preset, ukuran custom,
  geser, jarak potong, tinggi & lebar barcode, lalu tombol penggaris + **Pakai ukuran otomatis**
  sejajar dalam satu baris), `col-xl-5` berisi **Penjelasan ukuran** (`#infoKertas` + `#infoBarcode`).
  Penjelasannya sengaja **tidak ikut masuk grid isian** lagi: dulu satu sel berisi tiga kontrol plus
  paragraf panjang di dalam baris `align-items-end`, sehingga tinggi baris ditentukan paragraf dan
  kolom di sebelahnya terlihat menggantung di tengah. Di bawah 1200px penjelasan jatuh jadi satu
  baris penuh di bawah isian. Terukur di iframe: 1280px kedua kolom sebaris (isian 291–560px,
  penjelasan mulai 853px), 1100/1000/820/390px semuanya menumpuk dan tidak ada `scrollWidth` melebihi
  viewport. `#maknaJarak` — teks "cara membaca angka jarak" yang menyebut *tombol di atas* — dipasang
  tepat di bawah baris tombol supaya rujukan itu tetap benar.
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
                            dan oleh tombol cadangan lengkap di halaman /backup
    zip.js                  penulis arsip ZIP sendiri (tanpa paket baru, lihat /backup)
    csv.js                  pembaca/penulis CSV: BOM, pemisah titik-koma, guard anti-rumus
    export-csv.js           kolom + query ekspor CSV transaksi/produk/stok/cabang
    impor-produk.js         template Excel + pentaan kolom + validasi impor produk/stok cabang
    cadangan-zip.js         merakit satu ZIP cadangan lengkap (dipakai /backup dan email)
    email-cadangan.js       gerbang "sekali sehari" + status, penjaga jadwal di server.js
    mail-smtp.js          SMTP tulis tangan di atas node:tls/node:net (STARTTLS + AUTH LOGIN)
  views/                    tampilan EJS, semuanya berkas datar (tanpa subfolder)
  public/                   aset statis; uploads/ = logo + QRIS per cabang, TIDAK ikut git
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
- **Grid dua kolom kartu** (`/pengaturan` dan kartu impor di `/produk`) memakai `col-lg-*`, bukan
  `col-md-*`. Alasannya ukurannya yang sebenarnya: di 768px sidebar masih tampil dan hanya
  menyisakan ±500px untuk isi, sehingga dua kolom jatuh jadi ±250px dan label form ikut patah.
  Diukur lewat iframe berlebar 390/768/834/991/992/1024/1280: menumpuk sampai 991px, berdampingan
  mulai 992px dengan kolom terkecil 291px, dan tidak ada `scrollWidth` melebihi viewport di semua
  lebar itu.
- **Layar kasir di ≤ 767,98px**: keranjang jadi **bilah di atas nav
  bawah**, dan ketuk gagangnya membuka keranjang **layar penuh**. Model lama mengunci `.app-main`
  setinggi `100dvh` dengan dua wilayah gulir bertumpuk; diukur pada iframe 390×844 dengan 35 kartu
  dan 5 item, grid produk (flex dengan basis 1888px) menarik hampir semua ruang sehingga panel
  keranjang cuma kebagian **27px** sementara satu baris item tingginya 59px — keranjang tidak bisa
  dibaca sama sekali. Sekarang yang menggulir hanya dokumen, bilah tertutup terukur y=628–767
  (139px) dengan `--tinggi-bilah: 148px` di `:root` — ruang gulir `.app-main` = 64px nav + 13px
  lingkaran CTA + 148px (`padding-bottom` terukur 225px) — dan saat dibuka daftar pesanan mengambil
  seluruh tinggi layar (terukur 0–844, `Escape` menutupnya lagi). Aturan bilah butuh `width: auto`
  karena `.row > *` Bootstrap memberi `width: 100%` pada anak kolom di setiap lebar, dan lebar
  eksplisit membuat `right: 0` diabaikan (terukur bilah melebar sampai x=1039 sebelum batasnya
  dipindah ke 767,98px).
- **Katalog digeser mendatar sampai ≤ 991,98px (HP dan tablet)**, bukan digulir ke bawah:
  `views/kasir.ejs` memecah produk rata 12 kartu per `.produk-slide` sejak render, dan blok
  `@media (max-width: 991.98px)` mengubah `#product-grid` menjadi `flex` dengan
  `scroll-snap-type: x mandatory` sehingga tiap usapan berpindah satu halaman penuh. Pemecahannya di
  HTML, bukan di JavaScript, jadi katalog tetap tersusun rapi walau skrip halaman gagal jalan; yang
  dihitung JavaScript hanya angka halaman (`scrollLeft / clientWidth`) yang tampil sebagai chip
  "1 / 3". Jumlah kolomnya mengikuti ruang yang tersisa: **tiga kolom × empat baris** di HP
  (kartu 112×82px pada 390×844, 97×82px pada 360×740) dan **dua kolom × enam baris** di tablet karena
  separuh lebarnya dipakai kolom keranjang (234×82px pada 768px, 256×82px pada 834px, 308×82px pada
  991px). Di ≥ 992px slider kembali `display: block`, ke-35 kartu terlihat semua tanpa geser dan chip
  disembunyikan (terukur 992×800 dan 1280×800). Nama produk boleh tiga baris (`.76rem`,
  `line-clamp: 3`) supaya kartu yang kecil tidak memotong nama — dari 35 nama uji, nol yang terpotong
  pada 360/390/412px dan pada 768/834/991px. Mode **Daftar dan tombol Grid/Daftar dihapus**
  (`mode-daftar`, `setTampilanProduk()`, `#produkTampilanBar`, kunci `kasir-tampilan-produk`): grid
  kecil sudah cukup, dan satu-satunya kontrol yang tersisa adalah pencarian. `cek-sintaks.js` menjaga
  keduanya tetap hilang — ia gagal kalau salah satu nama itu kembali muncul di `views/kasir.ejs` atau
  `public/css/style.css`, dan ia juga memeriksa **rentang media** tiap aturan (bilah harus di
  767,98px, slider di 991,98px) karena kedua batas itu pernah tertukar dan gejalanya hanya terlihat di
  tablet.
- **Tablet potret (768–991,98px) memakai tata letak PC**: `col-md-8` + `col-md-4` sehingga keranjang
  duduk di kolom kanan, bukan sebagai bilah (terukur panel 251px di x=502 pada 768×1024, 273px di
  x=546 pada 834×1112, 325px di x=651 pada 991×1112; gagang dan kepala keranjang `display:none`).
  Ruangannya sempit begitu **menu sidebar dibuka** (sidebar 220px menggerogoti kolom isi): panel
  tinggal 178px pada 768px dan 200px pada 834px, dan satu baris `Total: Rp 122.500` + BAYAR (F4) butuh
  ±225px sehingga tombolnya menjulur ke x=811 / x=856 — keluar layar, tidak bisa diketuk. Karena itu
  di rentang 768–991,98px `.total-bayar` boleh **membungkus** (`flex-wrap: wrap` + tombol
  `flex: 1 1 auto`): total di baris pertama, BAYAR satu baris penuh di bawahnya. Setelah itu
  terukur nol elemen yang melewati tepi panel dan BAYAR berhenti di x=737 (768px) / x=803 (834px)
  dengan tinggi 58px, baik sidebar tertutup maupun terbuka.
  Baris di atas pencarian (`Stok yang tampil & berkurang: <cabang>` + dropdown `/kasir?branch_id=`)
  dipadatkan jadi chip `.kasir-cabang` setinggi 24px + dropdown tanpa `style` inline: kalimat lama
  turun 2-3 baris di lebar HP sehingga grid baru mulai dari y=190, sekarang **y=161** (hemat 29px,
  ±sepertiga baris kartu) dan chip+dropdown tetap satu baris sampai 320px. Nama cabang tidak
  dihapus karena kasir biasa (non-admin) tidak punya dropdown: dari situ ia tahu stok kartu dan
  pengurangannya cabang mana — keterangannya pindah ke atribut `title`, dan `#branchSwitcher`
  (id, `form-select-sm`, opsi, dan handler yang sama seperti di `/opname` dan `/produk`) tidak
  disentuh.
  Ruang bawah bilah dihitung dengan `:has()`; di browser lama yang tidak mendukungnya halaman tetap
  dipakai, hanya sisa gulirnya kembali angka nav biasa (78px). Di ≥ 992px layout lama tidak berubah:
  panel 321px di kanan pada 992×800 dan 417px pada 1280×800. Klik kartu tetap menambah badge di
  semua lebar yang diuji (390/768/834/991/1280) dan `showPaymentModal()` membuka layar penuh.
- **Sidebar tidak lagi menambah ruang gulir kosong.** Dulu `.sidebar` hanya `min-height: 100vh`,
  sedangkan daftar menunya sendiri 1173px: pada 834×1112 `.app-shell` ikut tertarik ke **1281px**
  sementara `.app-main` sudah `100dvh` + `overflow-auto` dan menggulir di dalam dirinya — hasilnya
  dokumen masih bisa digulir ±170px (±481px pada 1280×800) dan begitu digulir ke bawah seluruh isi
  halaman naik keluar layar, yang tersisa cuma panel menu gelap. Sekarang kolomnya
  `height: 100dvh; display: flex; flex-direction: column` dan **yang menggulir hanya
  `.sidebar-menu`** (`flex: 1 1 auto; min-height: 0; overflow-y: auto`), logo + nama pengguna tinggal
  di atas. Terukur `scrollHeight` dokumen = tinggi viewport di 390/768/834/991/992/1280, baik
  sidebar tertutup maupun terbuka, dan menu tetap lengkap: 169px bisa digulir di dalam kolomnya pada
  834px, 417px pada 1280×800 (terbukti `scrollTop = 420` benar-benar memindahkan daftarnya).
  Bilah gulirnya disembunyikan (`scrollbar-width: none` + `::-webkit-scrollbar{display:none}`)
  karena `scrollbar-width: thin` sempat memakan 10px dari 218px lebar menu dan membuat
  "Transfer Antar Cabang" / "Pengeluaran Operasional" jatuh jadi dua baris (44px → 68px); dengan
  bilah tersembunyi lebar tautan kembali persis seperti dulu (218px pada 250px, 188px pada 220px) dan
  menggulir tetap bisa lewat roda tetikus, seretan, atau Tab. Di HP (≤ 767,98px) sidebar memang
  `display: none` — menggantikannya sheet "Lainnya" — jadi perubahan ini tidak menyentuh laci.
- Bar bawah tingginya ditambah `env(safe-area-inset-bottom)` (dengan `viewport-fit=cover` di
  `layout-header.ejs`) supaya tidak tertutup gesture bar; isi `.app-main` dan bilah bayar di
  `/kasir` dinaikkan setinggi bar tersebut agar tetap bisa disentuh.

- **Target sentuh ≤ 767,98px** berlaku untuk semua kontrol form, bukan hanya input angka:
  `input.form-control`, `select.form-select`, dan `textarea.form-control` sama-sama `min-height: 42px`
  dan `font-size: 16px` (16px supaya iOS tidak memaksa zoom saat input difokus). Aturan sebelumnya
  cuma menjangkau `input[type=number]`, akibatnya sebuah `<select>` 34px di samping angka 42px membuat
  satu baris formulir terlihat tidak rata — terukur 8px selisih puncaknya di `/barcode` pada lebar
  600–700px. Setelah disamakan, tinggi semua kontrol di halaman itu seragam 42px pada 390px dan 31px
  pada 1280px. Layar kasir diperiksa ulang setelah aturan ini melebar: BAYAR tetap berada di layar
  390×740 dan `scrollWidth` tidak melebar di 390 maupun 768px.

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

### Halaman Cadangan & Data (`/backup`, khusus Administrator)
Berkas di folder `backup/` hanya berisi database. Halaman `/backup` menutup dua lubang itu:

- **Cadangan lengkap (ZIP).** Tombol **Buat & unduh cadangan** menjalankan cadangan online
  yang sama (checkpoint + `integrity_check`) lalu membungkusnya menjadi satu ZIP berisi
  `database/kasir.db`, seluruh isi `public/uploads/` (logo + gambar QRIS semua cabang),
  empat ekspor CSV, dan `BACA-DULU.txt` berisi langkah pemulihan. Strukturnya sengaja
  meniru folder aplikasi supaya memulihkan = menyalin timpa. ZIP ditulis oleh
  `scripts/zip.js`, penulis arsip sendiri tanpa paket tambahan — deployment kasir ini
  cuma `git pull` lalu `npm run dev`, jadi menambah dependensi berarti semua mesin harus
  install ulang. `.env` **tidak ikut** supaya rahasia tidak tersebar lewat berkas cadangan.
- **Ekspor CSV** transaksi, produk, stok per cabang, dan cabang
  (`GET /backup/ekspor/<jenis>`). Pemisahnya titik-koma dan berkasnya bersandi UTF-8
  dengan BOM, sesuai Excel regional Indonesia. Nilai yang diawali `=`, `+`, `-` atau `@`
  diberi apostrof agar tidak dijalankan Excel sebagai rumus.
- **Daftar berkas cadangan** di server beserta tombol unduh per berkas. Nama berkas
  divalidasi dengan pola ketat (`kasir-YYYYMMDD-HHmmss.db`), jadi tidak ada jalur untuk
  membaca berkas lain di luar folder cadangan.

Cadangan ke Google Drive belum dipasang. Yang sudah otomatis keluar dari mesin kasir adalah
cadangan harian ke email — lihat di bawah. Google Drive masih harus unduh manual.

### Cadangan harian ke email (opsional)
Folder `backup/` berada di mesin kasir yang sama dengan database, jadi ia tidak menolong kalau
laptopnya hilang atau rusak. Kalau alamat email diisi, aplikasi membuat satu ZIP per hari dan
mengirimnya sebagai lampiran — isinya **sama persis** dengan tombol "Buat & unduh cadangan" karena
keduanya memakai perakit yang sama, `scripts/cadangan-zip.js`. Tidak ada dua jenis arsip yang bisa
beda isinya.

Mengaturnya ada dua tempat, dan sengaja dipisah:

| Di mana | Isi | Kenapa di sana |
| --- | --- | --- |
| `/pengaturan`, kartu **Backup ke Email** | alamat tujuan + jam kirim (0-23 WIB, bawaan 22) | pemegang kasir yang tahu kapan tokonya tutup; tersimpan di `settings.backup_email` / `settings.backup_hour` dan hanya bisa diubah Administrator (`isAdmin`) |
| `.env` | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, opsional `SMTP_SECURE` / `SMTP_CA_FILE` / `SMTP_TIMEOUT_MS` / `EMAIL_BACKUP_INTERVAL_MIN` | rahasia tidak pernah masuk database, sehingga berkas cadangan, salinan `.db`, dan ekspor CSV tidak ikut membawa kredensial |

Cara kerjanya:

- **Sekali sehari, di jam tutup.** Penjadwalnya bangun tiap `EMAIL_BACKUP_INTERVAL_MIN` menit
  (bawaan 5) tetapi hanya mengirim kalau jam WIB sudah melewati jam yang disimpan **dan** belum ada
  email terkirim pada tanggal WIB hari ini; tanggal terakhir itu disimpan di `app_state`
  (`email_cadangan_terkirim`). Aplikasi dinyalakan ulang, jamnya digeser, atau servernya mati
  setengah hari — tidak akan ada email kedua pada hari yang sama, dan tidak ada hari yang terlewat
  diam-diam.
- **Alamat tujuan kosong = fitur mati.** Tidak ada jadwal, tidak ada peringatan, dan status di kartu
  menampilkan "mati — alamat email belum diisi".
- **SMTP ditulis tangan** (`scripts/mail-smtp.js`, di atas `node:tls`/`node:net`) karena menambah
  dependensi berarti setiap mesin kasir harus `npm install` ulang. Port 465 pakai TLS langsung,
  587 naik lewat STARTTLS; kalau server tidak menawarkan STARTTLS, autentikasi **ditolak** dan
  sandi tidak pernah dikirim. Sertifikat selalu diverifikasi (`rejectUnauthorized: true`); CA privat
  dilayani lewat `SMTP_CA_FILE`, bukan dengan mematikan verifikasi.
- **Tombol "Kirim sekarang (uji")** (`POST /pengaturan/email-uji`) menembus gerbang jam dan gerbang
  "hari ini sudah terkirim", jadi konfigurasi baru bisa dipastikan hari itu juga tanpa menunggu tutup
  toko. Hasil kirim terakhir (termasuk pesan galat dari server) disimpan dan tampil di kartu, begitu
  juga tanggal terkirim terakhir — tanpa pernah menampilkan sandi.
- **Gagal kirim tidak pernah menjatuhkan kasir.** `kirim()` tidak melempar; ia mengembalikan
  `{ok, pesan}` yang hanya masuk log dan status halaman.

Catatan keamanan yang perlu dibaca sebelum fitur ini dinyalakan: lampirannya adalah **seluruh
database toko** — nota penjualan, nama pelanggan, harga beli, dan stok semua cabang. Email tersebut
hanya aman seaman kotak masuknya, jadi:

- pakai **sandi aplikasi** (Gmail: 2-Step Verification → App passwords), bukan sandi akun, supaya
  kebocorannya bisa dicabut sendiri dan tidak membuka surat-surat lain;
- kirim ke alamat pribadi, bukan alamat bersama atau grup toko;
- kalau memang tidak perlu menyimpan riwayat selama itu, pertimbangkan menyaringnya di sisi
  email (label + auto-delete) daripada menambah masa retensi di `.env` — `BACKUP_KEEP` hanya
  mengatur berkas di mesin kasir, tidak menghitung salinan yang sudah keluar.

`.env` tidak ikut masuk ZIP maupun database, dan status email hanya membaca `SMTP_HOST`/`SMTP_PORT`
untuk menampilkan tujuan — jadi halaman `/pengaturan` dan log tidak pernah membocorkan kredensial.

### Pindah ke server lain
`git clone` saja tidak cukup: `database/kasir.db`, `public/uploads/`, dan `.env` tidak
dilacak git. Urutan yang benar:

1. di server lama buka `/backup` → **Buat & unduh cadangan**;
2. di server baru install aplikasi (`npm install`, `npm run dev` sekali supaya skema
   terbentuk), lalu hentikan;
3. salin ZIP, ekstrak, dan timpa folder `database/` serta `public/uploads/` di server baru;
4. buat `.env` baru berisi `SESSION_SECRET` (nilai acak sendiri) dan `ADMIN_PASSWORD`
   bila perlu;
5. jalankan — data lama, stok semua cabang, dan gambar QRIS ikut semuanya.

## Penghapusan data bertingkat (Zona Berbahaya)
Di `/pengaturan`, kartu **Zona Berbahaya** menyediakan tiga aksi dengan cakupan berbeda,
dari yang paling aman sampai paling merusak:

| Aksi | Yang hilang | Yang tetap ada |
| --- | --- | --- |
| Kosongkan riwayat transaksi (`HAPUS TRANSAKSI`) | `sales`, `sale_items`, jurnal stok tipe `SALE`/`VOID` | produk, harga, **stok**, cabang, akun, pengaturan |
| Reset produk & stok (`HAPUS PRODUK`) | `products`, `stock_per_branch`, `stock_movements`, transfer | transaksi (karenanya diblokir selama masih ada nota), kategori, akun |
| Reset ke kondisi awal pabrik (`RESET PABRIK`) | transaksi, produk, stok, kategori, pelanggan, voucher, pengeluaran, opname, penggajian | cabang, akun, pengaturan toko, logo/QRIS, jejak audit |

Ketiganya melewati gerbang yang sama, dan urutannya sengaja begitu:

1. frasa konfirmasi harus diketik persis (huruf besar/kecil bebas, kata-katanya tidak);
2. sandi akun yang sedang login diverifikasi ulang dengan bcrypt;
3. **cadangan dibuat lebih dulu** — kalau cadangan gagal dibuat atau gagal
   `integrity_check`, penghapusan dibatalkan;
4. semua `DELETE` jalan dalam satu transaksi SQLite, jadi tidak pernah ada keadaan
   setengah terhapus.

Reset produk diblokir selama masih ada transaksi karena `sale_items.product_id` tidak
memiliki foreign key: produk yang hilang akan membuat laporan lama menampilkan barang
yang tidak pernah ada. Kalau memang mau menghapus keduanya, jalankan aksi pertama
lebih dulu.

Setiap aksi yang berhasil ditulis ke tabel `data_actions` (siapa, aksi apa, berapa baris,
dan nama berkas cadangan sebelum hapus) dan tampil di halaman `/backup`. Tabel ini **tidak
ikut terhapus** oleh aksi mana pun, termasuk reset pabrik, jadi riwayat keputusan tetap
bisa dibaca. Tidak ada tombol batal di aplikasi: jalan kembali satu-satunya adalah
memulihkan berkas cadangan yang tercatat di situ.

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
  (`sales.subtotal/discount/tax`, `sales.customer_id`, `sales.voucher_id/voucher_code`,
  `branches.qris_image`, `settings.tax_rate`, `settings.backup_email/backup_hour`,
  `payroll.period`, `payroll.gaji_pokok/tunjangan/bonus/potongan`) ditambahkan lewat
  `ensureColumn` tanpa merusak data lama.
- Sumber kebenaran stok adalah `stock_per_branch`, **bukan** `products.stock`. Setiap
  perubahan stok (penjualan, opname, koreksi, transfer) tercatat di `stock_movements`,
  sehingga total ledger selalu sama dengan posisi stok.
- `database/kasir.db` tidak dilacak git (lihat `.gitignore`), jadi sumber skema tetap
  `database/migrations/init.js` dan sumber data adalah file di mesin kasir plus folder
  `backup/`. Lihat bagian **Cadangan database** di bawah untuk cara mencadangkan dan
  memulihkan.
- Tabel `data_actions` adalah jejak penghapusan data besar (Zona Berbahaya): siapa, aksi
  apa, berapa baris dihapus, dan berkas cadangan apa yang dibuat sebelum hapus. Isinya
  sengaja tidak ikut dibersihkan oleh aksi reset mana pun.

## Aset lokal dan perilaku offline
- Seluruh CSS/JS/font Bootstrap diambil dari `public/vendor/`, jadi tidak ada satu pun
  permintaan ke internet saat halaman dibuka. Internet mati tidak lagi merusak tampilan
  atau mematikan modal pembayaran. Pemindai barcode kamera (`html5-qrcode`) dan pembuat label
  (`JsBarcode`) ikut dilokalkan dengan alasan yang sama: toko tetap bisa menjual tanpa internet.
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
- Diskon kasir tidak bisa dikarang: nominalnya dihitung server dari voucher yang dipilih, dan
  pemakaiannya dibekukan di nota (`voucher_id` + `voucher_code`) supaya bisa diaudit. Yang masih
  terbuka adalah **batas pemakaian** — voucher aktif belum punya `max_usage`, kuota per hari, atau
  tanggal berlaku, jadi satu kode bisa dipakai di setiap nota tanpa batas. Kontrol yang belum
  dipasang berikutnya: ambang persetujuan Manager (diskon di atas X% butuh PIN) dan rekonsiliasi
  laci harian, karena diskon curang ketahuan dari selisih kas, bukan dari satu nota.
- Penghapusan data massal (Zona Berbahaya di `/pengaturan`) dikunci tiga lapis: frasa
  konfirmasi, sandi login yang dicek ulang, dan cadangan yang harus berhasil sebelum satu
  baris pun dihapus. Itu semua hanya memperlambat tangan yang salah, bukan tangan yang
  punya sandi admin — jadi sandi Administrator tidak boleh dibagikan, dan kebiasaan yang
  menyelamatkan adalah mengunduh **Cadangan lengkap** di `/backup` keluar mesin sebelum
  menjalankan aksi mana pun.
- Cadangan harian ke email mengirim **seluruh isi database** sebagai lampiran (nota, nama
  pelanggan, harga beli, stok semua cabang). Keamanan datanya pindah menjadi keamanan kotak
  masuk: pakai sandi aplikasi yang bisa dicabut sendiri, kirim ke alamat pribadi, dan matikan
  alamatnya di **/pengaturan** kalau alamat itu berbagi dengan orang lain. Kredensial SMTP
  sendiri tidak pernah menyentuh database maupun berkas cadangan.
- Sebelum hostname hasil tunnel dipakai transaksi, selesaikan checklist di bagian
  **Yang wajib ditutup sebelum tunnel dipakai transaksi** — yang paling penting Access
  dan `SESSION_SECRET`.
