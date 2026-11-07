// Ekspor CSV untuk halaman Cadangan & Data.
//
// Dua keputusan yang bikin berkasnya benar-benar terpakai di toko, bukan cuma "bisa diunduh":
//  - Pemisah ";" dan BOM UTF-8. Excel dengan regional Indonesia menolak koma sebagai
//    pemisah kolom dan menampilkan teks tanpa BOM sebagai karakter rusak.
//  - Nilai yang diawali = + - @ tab atau CR diberi apostrof. Nama produk dan nama pelanggan
//    diketik operator, jadi tanpa penangkal ini satu nama "=CMD(...)" bisa dieksekusi Excel.
const BOM = '\uFEFF';

function bersih(nilai) {
  if (nilai === null || nilai === undefined) return '';
  let s = String(nilai);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[;\r\n"]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function csv(kolom, baris) {
  const kepala = kolom.map(k => bersih(k.judul)).join(';');
  const isi = baris.map(b => kolom.map(k => {
    const nilai = typeof k.nilai === 'function' ? k.nilai(b) : b[k.key];
    return bersih(nilai);
  }).join(';'));
  return BOM + [kepala, ...isi].join('\r\n') + '\r\n';
}

const yaTidak = (v) => (Number(v) === 1 ? 'Aktif' : 'Nonaktif');

// Satu sumber untuk semua laporan ekspor: nama berkas, kolom, dan querynya.
const jenis = {
  transaksi: {
    label: 'Transaksi penjualan',
    nama: 'transaksi',
    kolom: [
      { judul: 'No. Nota', key: 'invoice_no' },
      { judul: 'Tanggal (WIB)', key: 'tanggal' },
      { judul: 'Kasir', key: 'kasir' },
      { judul: 'Cabang', key: 'cabang' },
      { judul: 'Member', key: 'member' },
      { judul: 'Kode Member', key: 'member_code' },
      { judul: 'Metode', key: 'payment_method' },
      { judul: 'Subtotal', key: 'subtotal' },
      { judul: 'Diskon', key: 'discount' },
      { judul: 'Kode Voucher', key: 'voucher_code' },
      { judul: 'Pajak', key: 'tax' },
      { judul: 'Total', key: 'total' },
      { judul: 'Dibayar', key: 'payment_amount' },
      { judul: 'Kembalian', key: 'return_amount' },
      { judul: 'Status', key: 'status' },
      { judul: 'Dibatalkan Oleh', key: 'voided_by_name' },
      { judul: 'Dibatalkan Pada', key: 'voided_at' },
      { judul: 'Alasan Pembatalan', key: 'void_reason' }
    ],
    ambil: (db, formatWIB) => db.prepare(`SELECT s.*,
            COALESCE(u.name, 'Admin') AS kasir, b.name AS cabang,
            c.name AS member, c.code AS member_code, vu.name AS voided_by_name
        FROM sales s
        LEFT JOIN users u ON s.user_id = u.id
        LEFT JOIN branches b ON s.branch_id = b.id
        LEFT JOIN users vu ON s.voided_by = vu.id
        LEFT JOIN customers c ON s.customer_id = c.id
        ORDER BY s.date DESC, s.id DESC`).all()
      .map(s => Object.assign({}, s, { tanggal: formatWIB(s.date) }))
  },
  produk: {
    label: 'Semua produk',
    nama: 'produk',
    kolom: [
      { judul: 'Barcode', key: 'barcode' },
      { judul: 'Nama Produk', key: 'name' },
      { judul: 'Kategori', key: 'category' },
      { judul: 'Harga Beli', key: 'price_buy' },
      { judul: 'Harga Jual', key: 'price_sell' },
      { judul: 'Stok Semua Cabang', key: 'total_stock' },
      { judul: 'Min. Stok', key: 'min_stock' },
      { judul: 'Status', key: 'status' }
    ],
    ambil: (db) => db.prepare(`SELECT p.*, cat.name AS category,
            COALESCE(SUM(spb.stock), 0) AS total_stock
        FROM products p
        LEFT JOIN categories cat ON p.category_id = cat.id
        LEFT JOIN stock_per_branch spb ON spb.product_id = p.id
        GROUP BY p.id ORDER BY p.name COLLATE NOCASE ASC`).all()
      .map(p => Object.assign({}, p, { status: yaTidak(p.is_active) }))
  },
  stok: {
    label: 'Stok per cabang',
    nama: 'stok-per-cabang',
    kolom: [
      { judul: 'Barcode', key: 'barcode' },
      { judul: 'Nama Produk', key: 'produk' },
      { judul: 'Cabang', key: 'cabang' },
      { judul: 'Stok', key: 'stock' },
      { judul: 'Min. Stok', key: 'min_stock' },
      { judul: 'Terakhir Diubah', key: 'berubah' }
    ],
    ambil: (db, formatWIB) => db.prepare(`SELECT p.barcode, p.name AS produk, b.name AS cabang,
            spb.stock, spb.min_stock, spb.updated_at
        FROM stock_per_branch spb
        JOIN products p ON p.id = spb.product_id
        JOIN branches b ON b.id = spb.branch_id
        ORDER BY b.name COLLATE NOCASE ASC, p.name COLLATE NOCASE ASC`).all()
      .map(r => Object.assign({}, r, { berubah: formatWIB(r.updated_at) }))
  },
  cabang: {
    label: 'Semua cabang',
    nama: 'cabang',
    kolom: [
      { judul: 'Kode', key: 'code' },
      { judul: 'Nama Cabang', key: 'name' },
      { judul: 'Alamat', key: 'address' },
      { judul: 'Telepon', key: 'phone' },
      { judul: 'PIC', key: 'pic_name' },
      { judul: 'Status', key: 'status' },
      { judul: 'Punya QRIS', key: 'qris' }
    ],
    ambil: (db) => db.prepare('SELECT * FROM branches ORDER BY id ASC').all()
      .map(b => Object.assign({}, b, { status: yaTidak(b.is_active), qris: b.qris_image ? 'Ya' : 'Belum' }))
  }
};

module.exports = { csv, bersih, jenis };
