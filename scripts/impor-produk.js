// Impor massal produk + stok per cabang dari berkas Excel (disimpan sebagai CSV).
//
// Alur kerjanya sengaja dua tahap: rencanakan() hanya membaca dan memvalidasi, terapkan()
// baru menulis. Server memanggil rencanakan lebih dulu dan berhenti kalau ada satu baris
// pun yang salah, sehingga tidak pernah ada keadaan "sebagian file masuk".
const { angka, bacaCsv, dekode } = require('./csv');
const { bersih } = require('./export-csv');

// Nama kolom yang dikenali. Kunci = nama header sudah dinormalisasi (huruf kecil, spasi -> _).
const BOM = '\uFEFF';
const KOLOM = {
    barcode: 'barcode', sku: 'barcode',
    nama: 'nama', name: 'nama', produk: 'nama',
    kategori: 'kategori', category: 'kategori',
    harga_beli: 'harga_beli', price_buy: 'harga_beli', modal: 'harga_beli', hargabeli: 'harga_beli',
    harga_jual: 'harga_jual', price_sell: 'harga_jual', harga: 'harga_jual', jual: 'harga_jual',
    min_stok: 'min_stok', min_stock: 'min_stok', stok_minimum: 'min_stok'
};

const KOLONA_WAJIB = ['nama', 'harga_jual'];
const AWALAN_STOK = 'stok_';

// Kolom stok memakai kode cabang supaya tidak ambigu saat dua cabang bernama mirip:
// "stok_CBG-001". Nama cabang juga diterima karena template lama memakai nama.
function petakanKolom(header, cabang) {
    const kolom = {};
    const asing = [];
    for (const h of header) {
        if (h === '_nomor' || h === '') continue;
        if (KOLOM[h]) { kolom[KOLOM[h]] = h; continue; }
        if (h.startsWith(AWALAN_STOK)) {
            const kunci = h.slice(AWALAN_STOK.length);
            const temu = cabang.find(b => (b.code || '').toLowerCase() === kunci || (b.name || '').toLowerCase().replace(/\s+/g, '_') === kunci);
            if (temu) { kolom['stok_' + temu.id] = h; continue; }
        }
        asing.push(h);
    }
    return { kolom, asing };
}

function normalisasiKategori(teks) {
    return String(teks || '').trim().replace(/\s+/g, ' ');
}

// Ekspor memasang apostrof di depan nilai yang diawali = + - @ tab CR supaya Excel tidak
// mengeksekusinya sebagai rumus. File template yang diimpor balik membawa apostrof itu,
// jadi dilepas lagi di sini; kalau tidak, nama produk ikut berubah.
function lepasPengaman(teks) {
    const s = String(teks === null || teks === undefined ? '' : teks);
    return s.startsWith("'") && /^[=+\-@\t\r]/.test(s.slice(1)) ? s.slice(1) : s;
}

/**
 * Validasi seluruh baris. Mengembalikan { galat, rencana, kategoriBaru }.
 * rencana kosong kalau ada galat — pemanggil wajib memeriksa galat lebih dulu.
 */
function rencanakan({ baris, header, branches, produkByBarcode, kategoriByName, cabangBoleh }) {
    const { kolom, asing } = petakanKolom(header, branches);
    const galat = [];

    for (const w of KOLONA_WAJIB) {
        if (!kolom[w]) galat.push(`Kolom wajib "${w}" tidak ada di baris header. Unduh template dari halaman Data Produk.`);
    }
    if (asing.length) galat.push(`Kolom tidak dikenali: ${asing.join(', ')}. Hapus kolom itu atau pakai nama kolom dari template.`);
    if (galat.length) return { galat, rencana: [], kategoriBaru: [] };

    const dipakai = new Map();
    const rencana = [];
    const kategoriBaru = new Set();

    for (const b of baris) {
        for (const [k, v] of Object.entries(b)) if (k !== '_nomor') b[k] = lepasPengaman(v);
    }

    for (const b of baris) {
        const nomor = b._nomor;
        const nama = String(b[kolom.nama] || '').trim();
        if (!nama) { galat.push(`Baris ${nomor}: nama kosong.`); continue; }

        const hargaJual = angka(b[kolom.harga_jual]);
        if (hargaJual === null || hargaJual < 0) { galat.push(`Baris ${nomor}: harga jual "${b[kolom.harga_jual]}" bukan angka.`); continue; }

        let hargaBeli = 0;
        if (kolom.harga_beli && String(b[kolom.harga_beli]).trim() !== '') {
            hargaBeli = angka(b[kolom.harga_beli]);
            if (hargaBeli === null || hargaBeli < 0) { galat.push(`Baris ${nomor}: harga beli "${b[kolom.harga_beli]}" bukan angka.`); continue; }
        }

        let minStock = null;
        if (kolom.min_stok && String(b[kolom.min_stok]).trim() !== '') {
            minStock = Math.floor(angka(b[kolom.min_stok]));
            if (!Number.isFinite(minStock) || minStock < 0) { galat.push(`Baris ${nomor}: min. stok "${b[kolom.min_stok]}" bukan angka bulat.`); continue; }
        }

        const barcode = String((kolom.barcode && b[kolom.barcode]) || '').trim();
        if (barcode) {
            if (dipakai.has(barcode)) galat.push(`Baris ${nomor}: barcode ${barcode} dipakai dua kali (baris ${dipakai.get(barcode)} dan ${nomor}).`);
            else dipakai.set(barcode, nomor);
        }

        const kategoriNama = normalisasiKategori(kolom.kategori ? b[kolom.kategori] : '');
        if (kategoriNama && !kategoriByName.has(kategoriNama.toLowerCase())) kategoriBaru.add(kategoriNama);

        const stok = [];
        let cacatStok = false;
        for (const br of branches) {
            const k = kolom['stok_' + br.id];
            if (!k) continue;
            const isi = String(b[k]).trim();
            if (isi === '') continue; // kosong = jangan sentuh cabang itu
            if (!cabangBoleh(br.id)) { galat.push(`Baris ${nomor}: kolom ${k} adalah cabang yang tidak Anda kelola.`); cacatStok = true; break; }
            const target = Math.floor(angka(isi));
            if (!Number.isFinite(target) || target < 0) { galat.push(`Baris ${nomor}: stok ${br.code || br.name} "${isi}" bukan angka bulat.`); cacatStok = true; break; }
            stok.push({ branchId: br.id, target });
        }
        if (cacatStok) continue;

        const lama = barcode ? produkByBarcode.get(barcode) : null;
        rencana.push({
            nomor, barcode, nama, kategoriNama, hargaBeli, hargaJual, minStock, stok,
            mode: lama ? 'ubah' : 'baru', produkId: lama ? lama.id : null
        });
    }

    // Semua-atau-tidak-sama-sekali dijaga di sini, bukan hanya di pemanggil: satu baris salah
    // membuat rencana kosong, jadi tidak ada jalur pemanggil yang bisa menulis sebagian file.
    if (galat.length) return { galat, rencana: [], kategoriBaru: [] };
    return { galat, rencana, kategoriBaru: [...kategoriBaru] };
}

/**
 * Pintu masuk yang dipakai route: dekode -> baca CSV -> validasi. Galat dari pemisah baris
 * (jumlah kolom tidak cocok) digabung dengan galat isi, supaya pemanggil cukup melihat satu
 * daftar dan tidak mungkin melewatkan baris yang sudah dibuang parser.
 */
function bacaDanRencanakan({ isi, branches, produkByBarcode, kategoriByName, cabangBoleh }) {
    const hasil = bacaCsv(dekode(isi));
    if (hasil.header.length === 0) return { galat: hasil.galat, rencana: [], kategoriBaru: [], baris: 0 };
    const r = rencanakan({ baris: hasil.baris, header: hasil.header, branches, produkByBarcode, kategoriByName, cabangBoleh });
    return { galat: [...hasil.galat, ...r.galat], rencana: r.rencana, kategoriBaru: r.kategoriBaru, baris: hasil.baris.length };
}

/**
 * Jalankan rencana dalam satu transaksi. `ctx` berisi helper yang sudah dipakai route
 * /produk biasa, supaya impor tidak punya jalur penyimpanan stok sendiri:
 *   { user, adjustBranchStock, ensureStockRows, buatBarcode, db }
 */
function terapkan(db, ctx, hasil) {
    const { rencana, kategoriBaru } = hasil;
    const ringkas = { baru: 0, ubah: 0, stok: 0, kategori: 0, baris: rencana.length };

    db.transaction(() => {
        const kategoriId = new Map();
        db.prepare('SELECT id, name FROM categories').all().forEach(c => kategoriId.set(normalisasiKategori(c.name).toLowerCase(), c.id));
        for (const nama of kategoriBaru) {
            const info = db.prepare('INSERT INTO categories (name, description) VALUES (?, ?)').run(nama, 'Dibuat saat impor Excel');
            kategoriId.set(normalisasiKategori(nama).toLowerCase(), info.lastInsertRowid);
            ringkas.kategori++;
        }

        const insertProduk = db.prepare('INSERT INTO products (barcode, name, category_id, price_buy, price_sell, stock, min_stock) VALUES (?, ?, ?, ?, ?, 0, ?)');
        const updateProduk = db.prepare('UPDATE products SET name = ?, category_id = ?, price_buy = ?, price_sell = ?, min_stock = ? WHERE id = ?');
        const setMinCabang = db.prepare('UPDATE stock_per_branch SET min_stock = ? WHERE product_id = ?');
        const allBranchIds = db.prepare('SELECT id FROM branches').all().map(b => b.id);

        for (const r of rencana) {
            const catId = r.kategoriNama ? kategoriId.get(r.kategoriNama.toLowerCase()) : null;
            const minStock = r.minStock === null ? 5 : r.minStock;
            let id = r.produkId;

            if (r.mode === 'baru') {
                const barcode = r.barcode || ctx.buatBarcode();
                const added = insertProduk.run(barcode, r.nama, catId, r.hargaBeli, r.hargaJual, minStock);
                id = added.lastInsertRowid;
                ctx.ensureStockRows(allBranchIds, id);
                setMinCabang.run(minStock, id);
                ringkas.baru++;
            } else {
                const lama = db.prepare('SELECT min_stock FROM products WHERE id = ?').get(id);
                updateProduk.run(r.nama, catId, r.hargaBeli, r.hargaJual, r.minStock === null ? lama.min_stock : minStock, id);
                setMinCabang.run(r.minStock === null ? lama.min_stock : minStock, id);
                ringkas.ubah++;
            }

            for (const s of r.stok) {
                const sekarang = db.prepare('SELECT COALESCE(stock, 0) AS stock FROM stock_per_branch WHERE product_id = ? AND branch_id = ?').get(id, s.branchId);
                const delta = s.target - (sekarang ? sekarang.stock : 0);
                if (delta === 0) continue;
                // Lewat adjustBranchStock, bukan UPDATE langsung: setiap perubahan stok wajib
                // meninggalkan jejak di stock_movements supaya ledger tetap sama dengan posisi.
                ctx.adjustBranchStock(id, s.branchId, delta, 'ADJUST', null, 'Impor Excel produk ' + r.nama, ctx.user.id);
                ringkas.stok++;
            }
        }
    })();

    return ringkas;
}

// Template = header + isi database saat ini, supaya file yang sama bisa dipakai untuk
// mengoreksi harga atau restok: baris yang tidak diubah akan diimpor apa adanya.
function buatTemplate({ branches, products, stokByProduk, kategoriNama }) {
    const header = ['barcode', 'nama', 'kategori', 'harga_beli', 'harga_jual', 'min_stok',
        ...branches.map(b => 'stok_' + (b.code || b.name))];
    const petunjuk = [
        '# PETUNJUK IMPOR PRODUK (buka dengan Excel, simpan sebagai "CSV (Pemisah Titik-Koma)", JANGAN .xlsx)',
        '# Baris yang diawali # diabaikan, jadi petunjuk ini tidak perlu dihapus sebelum impor.',
        '# Kolom wajib: nama dan harga_jual. Kolom lain boleh dibiarkan kosong.',
        '# Barcode kosong akan diisi otomatis oleh aplikasi.',
        '# Kolom stok_* adalah STOK AKHIR di cabang itu (bukan tambahan). Sel dibiarkan kosong = stok cabang itu tidak diubah.',
        '# Kategori baru akan dibuat otomatis. Produk dengan barcode yang sama akan diperbarui, bukan diduplikat.',
        '# Satu file diimpor sekaligus: kalau ada satu baris salah, tidak ada data yang tersimpan.',
        '# Contoh baris: ;Kopi Susu 16oz;Minuman;8000;15000;5;10;0'
    ];
    const baris = products.map(p => [
        p.barcode || '', p.name, kategoriNama(p.category_id) || '',
        p.price_buy, p.price_sell, p.min_stock,
        ...branches.map(b => {
            const s = (stokByProduk[p.id] || {})[b.id];
            return s === undefined ? '' : s;
        })
    ]);
    // Petunjuk dipisah dari tabel data: tiap baris dimulai '#' dan dilewati saat impor,
    // jadi tidak boleh digabung jadi satu baris CSV.
    const isi = [header, ...baris].map(row => row.map(sel => bersih(sel)).join(';')).join('\r\n');
    return BOM + petunjuk.join('\r\n') + '\r\n' + isi + '\r\n';
}

module.exports = { rencanakan, bacaDanRencanakan, terapkan, buatTemplate, petakanKolom, KOLOM };
