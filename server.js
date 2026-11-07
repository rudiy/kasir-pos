const express = require('express');
const session = require('express-session');
const path = require('path');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const fs = require('fs');
const db = require('./config/database');
const SqliteSessionStore = require('./config/sessionStore');
const initDB = require('./database/migrations/init');
const { runBackup, backupDir, keepCount } = require('./scripts/backup-db');
const { csv: buatCsv, jenis: jenisEkspor } = require('./scripts/export-csv');
const { buatCadanganZip, daftarFileRekursif } = require('./scripts/cadangan-zip');
const { statusEmail, kirimCadanganEmail, jadwalkanEmailCadangan } = require('./scripts/email-cadangan');
const { buatTemplate: buatTemplateImpor, bacaDanRencanakan: imporRencanakan, terapkan: imporTerapkan } = require('./scripts/impor-produk');
require('dotenv').config();

initDB();

const app = express();
app.set('view engine', 'ejs');

// Penanda versi style.css. Service worker meng-cache berdasarkan URL penuh, jadi
// tanpa penanda ini klien bisa terus memakai CSS lama setelah file-nya diubah.
const ASSET_VER = (() => {
  try { return require('fs').statSync(path.join(__dirname, 'public/css/style.css')).mtimeMs.toString(36); }
  catch (err) { return 'dev'; }
})();
app.use((req, res, next) => { res.locals.assetVer = ASSET_VER; next(); });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(helmet({ contentSecurityPolicy: false }));
const sessionStore = new SqliteSessionStore();
app.use(session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || 'secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: sessionStore.ttlMs, httpOnly: true, sameSite: 'lax' }
}));

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, 'public/uploads')),
    filename: (req, file, cb) => cb(null, 'logo-' + Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// Gambar QRIS per cabang. Berkasnya tampil apa adanya di layar kasir dan disimpan di folder
// publik, jadi hanya gambar known-type yang diterima dan dibatasi 4 MB.
const storageQris = multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, 'public/uploads')),
    filename: (req, file, cb) => cb(null, 'qris-' + Date.now() + path.extname(file.originalname).toLowerCase())
});
const uploadQris = multer({
    storage: storageQris,
    limits: { fileSize: 4 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const boleh = /^image\/(png|jpe?g|webp)$/i.test(file.mimetype);
        if (!boleh) req.qrisDitolak = file.originalname;
        cb(null, boleh);
    }
});

// Hanya hasil upload QRIS (qris-<waktu>.<ekstensi>) di folder uploads yang boleh dihapus aplikasi.
function hapusBerkasQris(url) {
    if (!url || url.indexOf('/uploads/qris-') !== 0) return;
    fs.unlink(path.join(__dirname, 'public', url.slice(1)), () => {});
}

// Kolom tanggal ditulis dengan CURRENT_TIMESTAMP, yang nilainya UTC. Semua tampilan
// memakai helper ini supaya yang terbaca di layar/jam mesin kasir (WIB) tetap sama,
// sementara filter "hari ini" ikut dihitung dengan tanggal WIB.
const WIB_ZONE = 'Asia/Jakarta';
const formatWIB = (value, withTime = true) => {
    if (!value) return '-';
    const looksLikeUtcStamp = typeof value === 'string'
        && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(value) && !/[+z]/i.test(value);
    const date = new Date(looksLikeUtcStamp ? value.replace(' ', 'T') + 'Z' : value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString('id-ID', withTime
        ? { timeZone: WIB_ZONE, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
        : { timeZone: WIB_ZONE, day: '2-digit', month: 'short', year: 'numeric' });
};
const todayWIB = () => new Date().toLocaleDateString('en-CA', { timeZone: WIB_ZONE });
// Nama bulan Indonesia. Dipakai label periode gaji dan judul periode di laporan, supaya
// "2026-11" dari pemilih bulan tidak pernah tampil mentah di muka pemilik toko.
const NAMA_BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

const { isAuthenticated } = require('./middleware/auth');

// MIDDLEWARE AKSES ROLE
const isAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'Administrator') return next();
    res.status(403).send('<h1>Akses Ditolak</h1><p>Hanya Super Admin yang dapat mengakses fitur ini.</p><a href="/">Kembali</a>');
};

const isManagerOrAdmin = (req, res, next) => {
    if (req.session.user && (req.session.user.role === 'Administrator' || req.session.user.role === 'Manager Cabang')) return next();
    res.status(403).send('<h1>Akses Ditolak</h1><p>Hanya Manager Cabang / Admin yang dapat mengakses fitur ini.</p><a href="/">Kembali</a>');
};

app.get('/login', (req, res) => res.render('login', { error: null }));
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT u.*, b.name as branch_name, b.is_active as branch_active FROM users u LEFT JOIN branches b ON u.branch_id = b.id WHERE u.username = ? AND u.is_active = 1').get(username);
  if (user && bcrypt.compareSync(password, user.password)) {
    if (user.role !== 'Administrator' && user.branch_active === 0) {
        return res.render('login', { error: 'Cabang toko Anda saat ini NONAKTIF/OFF. Silakan hubungi Super Admin.' });
    }
    req.session.user = user;
    res.redirect('/');
  } else {
    res.render('login', { error: 'Username/Password salah atau akun nonaktif' });
  }
});
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });

app.use(isAuthenticated);
app.use((req, res, next) => { 
    res.locals.path = req.path; 
    res.locals.user = req.session.user; 
    res.locals.isAdmin = req.session.user && req.session.user.role === 'Administrator';
    res.locals.isManager = req.session.user && req.session.user.role === 'Manager Cabang';
    res.locals.isManagerOrAdmin = res.locals.isAdmin || res.locals.isManager;
    res.locals.settings = db.prepare('SELECT * FROM settings LIMIT 1').get() || {};
    res.locals.canUseBranch = (branchId) => canAccessBranch(req.session.user, branchId);
    res.locals.fmtWIB = formatWIB;
    next(); 
});

// Akun yang masih membawa sandi bawaan tidak diberi akses ke halaman apa pun
// selain mengganti sandinya sendiri (atau keluar).
app.use((req, res, next) => {
    if (!req.session.user.force_pass_change) return next();
    if (req.path === '/ganti-sandi' || req.path === '/logout') return next();
    res.redirect('/ganti-sandi');
});

app.get('/ganti-sandi', (req, res) => {
    res.render('ganti-sandi', {
        error: req.query.error || null,
        saved: req.query.saved === '1',
        wajib: !!req.session.user.force_pass_change,
    });
});

app.post('/ganti-sandi', (req, res) => {
    const oldPassword = req.body.old_password || '';
    const newPassword = req.body.new_password || '';
    const row = db.prepare('SELECT password FROM users WHERE id = ?').get(req.session.user.id);
    if (!row || !bcrypt.compareSync(oldPassword, row.password)) {
        return res.redirect('/ganti-sandi?error=' + encodeURIComponent('Sandi lama tidak cocok.'));
    }
    if (newPassword.length < 8) {
        return res.redirect('/ganti-sandi?error=' + encodeURIComponent('Sandi baru minimal 8 karakter.'));
    }
    if (newPassword === oldPassword) {
        return res.redirect('/ganti-sandi?error=' + encodeURIComponent('Sandi baru tidak boleh sama dengan sandi lama.'));
    }
    if (newPassword !== req.body.confirm_password) {
        return res.redirect('/ganti-sandi?error=' + encodeURIComponent('Konfirmasi sandi tidak sama dengan sandi baru.'));
    }
    db.prepare('UPDATE users SET password = ?, force_pass_change = 0 WHERE id = ?')
        .run(bcrypt.hashSync(newPassword, 10), req.session.user.id);
    req.session.user.force_pass_change = 0;
    res.redirect('/ganti-sandi?saved=1');
});

// HELPER KONTEKS CABANG
const insertStockMovement = db.prepare('INSERT INTO stock_movements (product_id, branch_id, type, qty_delta, ref_id, note, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)');

const getBranchScope = (req) => {
    const user = req.session.user;
    if (user.role !== 'Administrator') return user.branch_id || 1;
    const requested = Number(req.query.branch_id ?? req.body.branch_id);
    if (!Number.isInteger(requested)) return user.branch_id || 1;
    const found = db.prepare('SELECT id FROM branches WHERE id = ?').get(requested);
    return found ? found.id : (user.branch_id || 1);
};

const canAccessBranch = (user, branchId) => user.role === 'Administrator' || user.branch_id === Number(branchId);

const adjustBranchStock = (productId, branchId, delta, type, refId, note, userId) => {
    const result = delta >= 0
        ? db.prepare('UPDATE stock_per_branch SET stock = stock + ?, updated_at = CURRENT_TIMESTAMP WHERE product_id = ? AND branch_id = ?').run(delta, productId, branchId)
        : db.prepare('UPDATE stock_per_branch SET stock = stock + ?, updated_at = CURRENT_TIMESTAMP WHERE product_id = ? AND branch_id = ? AND stock >= ?').run(delta, productId, branchId, -delta);
    if (result.changes === 0) throw new Error('Stok produk ID ' + productId + ' di cabang ini tidak cukup.');
    insertStockMovement.run(productId, branchId, type, delta, refId, note, userId);
};

// FUNGSI STATISTIK MULTI-CABANG REAL-TIME
function getTodayStats(user, selectedBranchId) {
    const today = todayWIB();
    const isAdminUser = user.role === 'Administrator';
    const requested = parseInt(selectedBranchId, 10);
    const scopedBranchId = isAdminUser
        ? (selectedBranchId === 'all' || !Number.isInteger(requested) ? null : requested)
        : (user.branch_id || 1);

    const branchFilterSales = scopedBranchId ? " AND s.branch_id = ?" : "";
    const branchFilterPlain = scopedBranchId ? " AND branch_id = ?" : "";
    const branchParams = scopedBranchId ? [scopedBranchId] : [];

    const notVoid = " AND COALESCE(s.status, '') <> 'VOID'";
    const salesToday = db.prepare("SELECT SUM(total) as total, COUNT(id) as count FROM sales s WHERE date(s.date, 'localtime') = ?" + notVoid + branchFilterSales).get(today, ...branchParams) || {total:0, count:0};
    const productCount = db.prepare('SELECT COUNT(*) as count FROM products').get() || {count:0};

    let expToday = 0;
    let payToday = 0;
    let cogsToday = 0;
    let profitToday = 0;

    if (isAdminUser || user.role === 'Manager Cabang') {
        expToday = db.prepare("SELECT SUM(amount) as total FROM expenses WHERE date(date, 'localtime') = ?" + branchFilterPlain).get(today, ...branchParams).total || 0;
        if (isAdminUser) {
            payToday = db.prepare("SELECT SUM(amount) as total FROM payroll WHERE date(date, 'localtime') = ?").get(today).total || 0;
        }

        const cogsRow = db.prepare("SELECT SUM(COALESCE(NULLIF(si.cogs, 0), p.price_buy, 0) * si.qty) as total"
            + " FROM sale_items si JOIN sales s ON s.id = si.sale_id"
            + " LEFT JOIN products p ON p.id = si.product_id"
            + " WHERE date(s.date, 'localtime') = ?" + notVoid + branchFilterSales
        ).get(today, ...branchParams);
        cogsToday = cogsRow.total || 0;

        profitToday = (salesToday.total || 0) - cogsToday - expToday - payToday;
    }

    return { salesToday, productCount, expToday, payToday, totalExpPay: (expToday + payToday), cogsToday, profitToday };
}

app.get('/api/dashboard-stats', (req, res) => {
    const selectedBranch = req.query.branch_id;
    const stats = getTodayStats(req.session.user, selectedBranch);
    res.json(stats);
});

app.get('/', (req, res) => {
    const selectedBranch = req.query.branch_id || 'all';
    const stats = getTodayStats(req.session.user, selectedBranch);
    const branches = db.prepare('SELECT * FROM branches WHERE is_active = 1').all();
    
    res.render('dashboard', { 
        salesToday: stats.salesToday, 
        productCount: stats.productCount, 
        expToday: stats.totalExpPay, 
        profitToday: stats.profitToday,
        branches,
        selectedBranch
    });
});

// MANAJEMEN CABANG (Admin Only)
app.get('/cabang', isAdmin, (req, res) => {
    const branches = db.prepare('SELECT b.*, (SELECT COUNT(*) FROM users u WHERE u.branch_id = b.id) as user_count FROM branches b ORDER BY b.id ASC').all();
    res.render('cabang', { branches });
});
app.post('/cabang/add', isAdmin, (req, res) => {
    try {
        const { code, name, address, phone, pic_name } = req.body;
        const added = db.prepare('INSERT INTO branches (code, name, address, phone, pic_name, is_active) VALUES (?, ?, ?, ?, ?, 1)').run(code, name, address, phone, pic_name);
        initDB.ensureStockRows(added.lastInsertRowid, db.prepare('SELECT id FROM products').all().map(p => p.id));
        res.redirect('/cabang');
    } catch(err) { res.status(500).send("Gagal: Kode Cabang sudah digunakan."); }
});
app.post('/cabang/toggle-status', isAdmin, (req, res) => {
    try {
        db.prepare('UPDATE branches SET is_active = ? WHERE id = ?').run(req.body.is_active, req.body.id);
        res.redirect('/cabang');
    } catch(err) { res.status(500).send(err.message); }
});
app.post('/cabang/edit', isAdmin, uploadQris.single('qris'), (req, res) => {
    try {
        if (req.qrisDitolak) {
            return res.status(400).send('Gagal: gambar QR harus PNG, JPG, atau WebP maksimal 4 MB.');
        }
        db.prepare('UPDATE branches SET code=?, name=?, address=?, phone=?, pic_name=? WHERE id=?').run(req.body.code, req.body.name, req.body.address, req.body.phone, req.body.pic_name, req.body.id);
        if (req.file) {
            const lama = db.prepare('SELECT qris_image FROM branches WHERE id=?').get(req.body.id).qris_image;
            db.prepare('UPDATE branches SET qris_image=? WHERE id=?').run('/uploads/' + req.file.filename, req.body.id);
            hapusBerkasQris(lama);
        }
        res.redirect('/cabang');
    } catch(err) { res.status(500).send(err.message); }
});
app.post('/cabang/qris/delete', isAdmin, (req, res) => {
    const cabang = db.prepare('SELECT qris_image FROM branches WHERE id=?').get(req.body.id);
    if (cabang && cabang.qris_image) {
        hapusBerkasQris(cabang.qris_image);
        db.prepare('UPDATE branches SET qris_image = NULL WHERE id=?').run(req.body.id);
    }
    res.redirect('/cabang');
});

// POS KASIR
app.get('/kasir', (req, res) => {
  if (req.session.user.role !== 'Administrator') {
     const branch = db.prepare('SELECT is_active FROM branches WHERE id=?').get(req.session.user.branch_id);
     if (!branch || branch.is_active === 0) {
         return res.status(403).send("<h1>Akses Ditolak</h1><p>Cabang Anda sedang NONAKTIF/OFF.</p><a href='/'>Kembali</a>");
     }
  }
  const branchId = getBranchScope(req);
  const products = db.prepare(`SELECT p.id, p.barcode, p.name, p.category_id, p.price_buy, p.price_sell, p.is_active, spb.stock, spb.min_stock
      FROM products p
      JOIN stock_per_branch spb ON spb.product_id = p.id AND spb.branch_id = ?
      WHERE p.is_active = 1 AND spb.stock > 0
      ORDER BY p.name ASC`).all(branchId);
  const settings = db.prepare('SELECT * FROM settings LIMIT 1').get();
  const vouchers = db.prepare('SELECT * FROM vouchers WHERE is_active = 1').all();
  const customers = db.prepare('SELECT id, code, name, phone FROM customers ORDER BY name COLLATE NOCASE ASC').all();
  const branch = db.prepare('SELECT id, name, qris_image FROM branches WHERE id = ?').get(branchId);
  const branches = db.prepare('SELECT id, name FROM branches WHERE is_active = 1 ORDER BY id ASC').all();
  res.render('kasir', { products, settings, vouchers, customers, branch, branches });
});

// Hanya dua metode yang dilayani; daftar ini divalidasi lagi di server supaya
// pembayaran yang tersimpan tidak bisa diisi nilai sembarang lewat request langsung.
const METODE_BAYAR = ['TUNAI', 'QRIS'];

app.post('/api/checkout', (req, res) => {
  const { cart, paymentMethod, paymentAmount, voucherId } = req.body;
  if (!Array.isArray(cart) || cart.length === 0) {
    return res.status(400).json({ success: false, error: 'Keranjang kosong.' });
  }

  const invoiceNo = 'INV-' + Date.now();
  const user = req.session.user;
  const requestedBranch = Number(req.body.branchId);
  const branchId = Number.isInteger(requestedBranch) && canAccessBranch(user, requestedBranch) ? requestedBranch : getBranchScope(req);
  const branch = db.prepare('SELECT id, name, is_active FROM branches WHERE id = ?').get(branchId);
  if (!branch || branch.is_active === 0) {
    return res.status(400).json({ success: false, error: 'Cabang tidak ditemukan atau sedang NONAKTIF.' });
  }
  const taxRate = Number((db.prepare('SELECT tax_rate FROM settings WHERE id = 1').get() || {}).tax_rate) || 0;
  const metode = String(paymentMethod || '').toUpperCase();
  if (METODE_BAYAR.indexOf(metode) === -1) {
    return res.status(400).json({ success: false, error: 'Metode pembayaran hanya TUNAI atau QRIS.' });
  }
  const customerId = Number(req.body.customerId) || 0;
  const pelanggan = customerId > 0 ? db.prepare('SELECT id, name, code FROM customers WHERE id = ?').get(customerId) : null;
  if (customerId > 0 && !pelanggan) {
    return res.status(400).json({ success: false, error: 'Pelanggan tidak ditemukan, muat ulang halaman kasir.' });
  }
  const amount = Number(paymentAmount) || 0;

  const transaction = db.transaction(() => {
    const getProduct = db.prepare(`SELECT p.id, p.name, p.price_buy, p.price_sell, p.is_active, spb.stock
        FROM products p JOIN stock_per_branch spb ON spb.product_id = p.id AND spb.branch_id = ? WHERE p.id = ?`);
    const getVoucher = db.prepare('SELECT * FROM vouchers WHERE id = ? AND is_active = 1');

    let subtotal = 0;
    const lines = [];
    for (const item of cart) {
      const product = getProduct.get(branchId, item.id);
      if (!product || product.is_active !== 1) throw new Error('Produk tidak dijual di cabang ini (ID ' + item.id + ').');
      const qty = Math.floor(Number(item.qty));
      if (!Number.isFinite(qty) || qty <= 0) throw new Error('Jumlah "' + product.name + '" tidak valid.');
      if (product.stock < qty) throw new Error('Stok ' + product.name + ' di ' + branch.name + ' tersisa ' + product.stock + '.');
      subtotal += qty * (product.price_sell || 0);
      lines.push({ product, qty });
    }

    let discount = 0;
    let voucherDipakai = null;
    if (voucherId && Number(voucherId) > 0) {
      const voucher = getVoucher.get(Number(voucherId));
      if (!voucher) throw new Error('Voucher tidak ditemukan atau sudah tidak aktif.');
      if (subtotal < (voucher.min_transaction || 0)) throw new Error('Minimal transaksi voucher ' + voucher.code + ' adalah Rp ' + (voucher.min_transaction || 0).toLocaleString('id-ID') + '.');
      discount = Math.min(voucher.value || 0, subtotal);
      voucherDipakai = voucher;
    }

    const tax = Math.round((subtotal - discount) * taxRate / 100);
    const total = subtotal - discount + tax;
    // QRIS tidak menerima uang fisik di kasir, jadi jumlah yang dicatat selalu sama dengan total.
    const dibayar = metode === 'QRIS' ? total : amount;
    if (dibayar < total) throw new Error('Uang pembayaran kurang Rp ' + (total - dibayar).toLocaleString('id-ID') + '.');

    const sale = db.prepare('INSERT INTO sales (invoice_no, user_id, branch_id, subtotal, discount, tax, total, payment_method, payment_amount, return_amount, customer_id, status, voucher_id, voucher_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(invoiceNo, user.id, branchId, subtotal, discount, tax, total, metode, dibayar, dibayar - total, pelanggan ? pelanggan.id : null, 'LUNAS',
        voucherDipakai ? voucherDipakai.id : null, voucherDipakai ? voucherDipakai.code : null);

    const insertItem = db.prepare('INSERT INTO sale_items (sale_id, product_id, qty, price, cogs, subtotal) VALUES (?, ?, ?, ?, ?, ?)');

    for (const line of lines) {
      insertItem.run(sale.lastInsertRowid, line.product.id, line.qty, line.product.price_sell, line.product.price_buy || 0, line.qty * line.product.price_sell);
      adjustBranchStock(line.product.id, branchId, -line.qty, 'SALE', sale.lastInsertRowid, invoiceNo, user.id);
    }
    return { subtotal, discount, tax, total, branchName: branch.name,
      voucherCode: voucherDipakai ? voucherDipakai.code : null,
      customerName: pelanggan ? pelanggan.name : null, customerCode: pelanggan ? pelanggan.code : null };
  });
  try {
    const result = transaction();
    res.json({ success: true, invoiceNo, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// PRODUK CRUD
app.get('/produk', isManagerOrAdmin, (req, res) => {
  const branchId = getBranchScope(req);
  const products = db.prepare(`SELECT p.id, p.barcode, p.name, p.category_id, p.price_buy, p.price_sell, p.min_stock, p.is_active,
        c.name AS category,
        COALESCE(SUM(spb.stock), 0) AS total_stock,
        COALESCE(MAX(CASE WHEN spb.branch_id = ? THEN spb.stock END), 0) AS branch_stock
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN stock_per_branch spb ON spb.product_id = p.id
      GROUP BY p.id
      ORDER BY p.name ASC`).all(branchId);
  const stocks = db.prepare(`SELECT spb.product_id, spb.branch_id, spb.stock, spb.min_stock, b.name AS branch_name
      FROM stock_per_branch spb JOIN branches b ON b.id = spb.branch_id ORDER BY b.id ASC`).all();
  const categories = db.prepare('SELECT * FROM categories').all();
  const branches = db.prepare('SELECT * FROM branches ORDER BY id ASC').all();
  res.render('produk', { products, categories, stocks, branches, branchId, imporPesan: req.query.impor || '', error: req.query.error || '' });
});

// Impor massal dari Excel. Berkasnya hanya dibaca di memori (tidak pernah ditulis ke disk
// server) dan dibatasi 5 MB — cukup untuk ribuan baris produk.
const uploadCsv = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

app.get('/produk/template', isManagerOrAdmin, (req, res) => {
  const branches = db.prepare('SELECT * FROM branches ORDER BY id ASC').all();
  const products = db.prepare('SELECT id, barcode, name, category_id, price_buy, price_sell, min_stock FROM products ORDER BY name ASC').all();
  const stokByProduk = {};
  db.prepare('SELECT product_id, branch_id, stock FROM stock_per_branch').all().forEach(s => {
    (stokByProduk[s.product_id] = stokByProduk[s.product_id] || {})[s.branch_id] = s.stock;
  });
  const kategoriNama = (id) => { const c = db.prepare('SELECT name FROM categories WHERE id = ?').get(id); return c ? c.name : ''; };
  const namaBerkas = 'template-produk-' + todayWIB() + '.csv';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="' + namaBerkas + '"');
  res.send(buatTemplateImpor({ branches, products, stokByProduk, kategoriNama }));
});

app.post('/produk/impor', isManagerOrAdmin, uploadCsv.single('berkas'), (req, res) => {
  const gagal = (pesan) => res.redirect('/produk?error=' + encodeURIComponent(pesan));
  const user = req.session.user;
  if (!req.file) return gagal('Pilih berkas CSV dulu. Di Excel pakai menu Save As lalu pilih "CSV (Pemisah Titik-Koma) (*.csv)" — file .xlsx tidak bisa dibaca.');
  if (!/\.csv$/i.test(req.file.originalname || '')) return gagal('Format berkas harus .csv, bukan .' + String(req.file.originalname).split('.').pop());

  try {
    const branches = db.prepare('SELECT * FROM branches ORDER BY id ASC').all();
    const produkByBarcode = new Map(db.prepare("SELECT id, barcode FROM products WHERE IFNULL(barcode,'') <> ''").all().map(p => [String(p.barcode), p]));
    const kategoriByName = new Map(db.prepare('SELECT id, name FROM categories').all().map(c => [String(c.name).trim().toLowerCase(), c.id]));
    const hasil = imporRencanakan({
      isi: req.file.buffer, branches, produkByBarcode, kategoriByName,
      cabangBoleh: (branchId) => canAccessBranch(user, branchId)
    });
    // Semua-atau-tidak-sama-sekali: satu baris salah saja, tidak ada yang ditulis.
    if (hasil.galat.length) {
      const tampil = hasil.galat.slice(0, 15).join(' ');
      const sisa = hasil.galat.length - Math.min(15, hasil.galat.length);
      return gagal('Berkas tidak disimpan sama sekali. ' + tampil + (sisa > 0 ? ' ... ' + sisa + ' masalah lainnya.' : ''));
    }
    if (hasil.rencana.length === 0) return gagal('Berkas tidak punya baris data (baris yang diawali # dianggap petunjuk).');

    const ringkas = imporTerapkan(db, {
      user,
      adjustBranchStock,
      ensureStockRows: initDB.ensureStockRows,
      buatBarcode: () => '899' + Math.floor(1000000000 + Math.random() * 9000000000)
    }, hasil);
    console.log('[impor-produk] ' + user.username + ': baru=' + ringkas.baru + ' ubah=' + ringkas.ubah + ' stok=' + ringkas.stok + ' kategori=' + ringkas.kategori);
    const pesan = [
      ringkas.baru ? ringkas.baru + ' produk baru' : '',
      ringkas.ubah ? ringkas.ubah + ' produk diperbarui' : '',
      ringkas.stok ? ringkas.stok + ' penyesuaian stok' : '',
      ringkas.kategori ? ringkas.kategori + ' kategori baru' : ''
    ].filter(Boolean).join(', ');
    res.redirect('/produk?impor=' + encodeURIComponent(pesan || 'tidak ada yang berubah'));
  } catch (err) {
    console.error('[impor-produk] gagal', err);
    res.status(500).send('Gagal membaca berkas: ' + err.message);
  }
});
app.post('/produk/add', isManagerOrAdmin, (req, res) => {
    try {
        const user = req.session.user;
        let { barcode, name, category_id, price_buy, price_sell } = req.body;
        if (!barcode || barcode.trim() === '') barcode = '899' + Math.floor(1000000000 + Math.random() * 9000000000);

        const requestedBranch = Number(req.body.branch_id) || user.branch_id || 1;
        if (!canAccessBranch(user, requestedBranch)) return res.status(403).send('Cabang tujuan bukan cabang Anda.');
        const branch = db.prepare('SELECT id FROM branches WHERE id = ?').get(requestedBranch);
        if (!branch) return res.status(400).send('Cabang tujuan tidak ditemukan.');

        const minStock = Math.max(0, Math.floor(Number(req.body.min_stock) || 5));
        const openingStock = Math.max(0, Math.floor(Number(req.body.stock) || 0));

        const added = db.prepare('INSERT INTO products (barcode, name, category_id, price_buy, price_sell, stock, min_stock) VALUES (?, ?, ?, ?, ?, 0, ?)')
          .run(barcode, name, category_id, price_buy, price_sell, minStock);

        const allBranchIds = db.prepare('SELECT id FROM branches').all().map(b => b.id);
        initDB.ensureStockRows(allBranchIds, added.lastInsertRowid);
        db.prepare('UPDATE stock_per_branch SET min_stock = ? WHERE product_id = ?').run(minStock, added.lastInsertRowid);
        if (openingStock > 0) adjustBranchStock(added.lastInsertRowid, branch.id, openingStock, 'OPENING', null, 'Stok awal produk baru', user.id);
        res.redirect('/produk');
    } catch (err) { res.status(500).send("Gagal: Barcode sudah digunakan!"); }
});
app.post('/produk/edit', isManagerOrAdmin, (req, res) => {
    try {
        db.prepare('UPDATE products SET barcode=?, name=?, category_id=?, price_buy=?, price_sell=? WHERE id=?')
          .run(req.body.barcode, req.body.name, req.body.category_id, req.body.price_buy, req.body.price_sell, req.body.id);
        res.redirect('/produk');
    } catch (err) { res.status(500).send(err.message); }
});
app.post('/produk/delete', isManagerOrAdmin, (req, res) => {
    try {
        const sold = db.prepare('SELECT COUNT(*) AS c FROM sale_items WHERE product_id = ?').get(req.body.id).c;
        if (sold > 0) return res.status(400).send('Produk tidak bisa dihapus karena sudah pernah terjual. Nonaktifkan saja lewat status.');
        db.prepare('DELETE FROM stock_movements WHERE product_id = ?').run(req.body.id);
        db.prepare('DELETE FROM stock_per_branch WHERE product_id = ?').run(req.body.id);
        db.prepare('DELETE FROM products WHERE id=?').run(req.body.id);
        res.redirect('/produk');
    } catch (err) { res.status(500).send(err.message); }
});
app.post('/produk/toggle-status', isManagerOrAdmin, (req, res) => {
    try {
        db.prepare('UPDATE products SET is_active = ? WHERE id = ?').run(req.body.is_active, req.body.id);
        res.redirect('/produk');
    } catch (err) { res.status(500).send(err.message); }
});

// KATEGORI PRODUK (Admin & Manager Cabang)
// Dulu isinya cuma dua baris hasil seed di init.js dan tidak pernah ada halamannya,
// padahal aplikasi ini dipakai untuk jenis usaha apa pun — daftarnya harus bisa
// tumbuh dari layar, bukan dari migration.
const bersihkanNamaKategori = (mentah) => String(mentah || '').trim().replace(/\s+/g, ' ').slice(0, 60);
const bersihkanDeskripsiKategori = (mentah) => String(mentah || '').trim().slice(0, 200);
const gagalKategori = (res, pesan) => res.redirect('/kategori?err=' + encodeURIComponent(pesan));

app.get('/kategori', isManagerOrAdmin, (req, res) => {
  const categories = db.prepare(`SELECT c.id, c.name, c.description,
        (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count,
        (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND COALESCE(p.is_active, 1) = 1) AS active_count
        FROM categories c ORDER BY c.name COLLATE NOCASE ASC`).all();
  const pesan = typeof req.query.err === 'string' ? req.query.err.slice(0, 300) : '';
  const sukses = typeof req.query.ok === 'string' ? req.query.ok.slice(0, 300) : '';
  // ?terpakai=<id> berarti hapus ditolak; produk yang menahannya ikut dikirim supaya
  // operator melihat penyebabnya di halaman yang sama, bukan cuma angka.
  const penahanId = Number(req.query.terpakai) || 0;
  const penahan = penahanId
    ? db.prepare(`SELECT p.id, p.barcode, p.name, p.price_sell, COALESCE(p.is_active, 1) AS is_active
        FROM products p WHERE p.category_id = ? ORDER BY p.name ASC LIMIT 200`).all(penahanId)
    : [];
  const penahanJumlah = penahanId
    ? db.prepare('SELECT COUNT(*) AS n FROM products WHERE category_id = ?').get(penahanId).n
    : 0;
  const penahanNama = penahanId ? (db.prepare('SELECT name FROM categories WHERE id = ?').get(penahanId) || {}).name : '';
  res.render('kategori', { categories, pesan, sukses, penahan, penahanJumlah, penahanNama });
});
app.post('/kategori/add', isManagerOrAdmin, (req, res) => {
  const nama = bersihkanNamaKategori(req.body.name);
  if (!nama) return gagalKategori(res, 'Nama kategori tidak boleh kosong.');
  if (db.prepare('SELECT id FROM categories WHERE name = ? COLLATE NOCASE').get(nama)) {
    return gagalKategori(res, 'Kategori "' + nama + '" sudah ada. Pakai namanya yang sudah ada atau buat nama lain.');
  }
  try {
    db.prepare('INSERT INTO categories (name, description) VALUES (?, ?)').run(nama, bersihkanDeskripsiKategori(req.body.description));
    res.redirect('/kategori?ok=' + encodeURIComponent('Kategori "' + nama + '" ditambahkan dan langsung muncul di dropdown Data Produk.'));
  } catch (err) { res.status(500).send(err.message); }
});
app.post('/kategori/edit', isManagerOrAdmin, (req, res) => {
  const id = Number(req.body.id);
  const lama = db.prepare('SELECT id, name FROM categories WHERE id = ?').get(id);
  if (!lama) return gagalKategori(res, 'Kategori tidak ditemukan.');
  const nama = bersihkanNamaKategori(req.body.name);
  if (!nama) return gagalKategori(res, 'Nama kategori tidak boleh kosong.');
  if (db.prepare('SELECT id FROM categories WHERE name = ? COLLATE NOCASE AND id <> ?').get(nama, id)) {
    return gagalKategori(res, 'Nama "' + nama + '" sudah dipakai kategori lain.');
  }
  try {
    db.prepare('UPDATE categories SET name = ?, description = ? WHERE id = ?').run(nama, bersihkanDeskripsiKategori(req.body.description), id);
    // Produk menyimpan category_id, jadi mengganti nama tidak menyentuh baris produk
    // sama sekali — label, laporan, dan grid kasir ikut berubah sendiri.
    res.redirect('/kategori?ok=' + encodeURIComponent('Kategori "' + lama.name + '" diganti menjadi "' + nama + '".'));
  } catch (err) { res.status(500).send(err.message); }
});
app.post('/kategori/delete', isManagerOrAdmin, (req, res) => {
  const id = Number(req.body.id);
  const kat = db.prepare('SELECT name FROM categories WHERE id = ?').get(id);
  if (!kat) return gagalKategori(res, 'Kategori tidak ditemukan.');
  const dipakai = db.prepare('SELECT COUNT(*) AS n FROM products WHERE category_id = ?').get(id).n;
  if (dipakai > 0) {
    return res.redirect('/kategori?terpakai=' + id);
  }
  try {
    db.prepare('DELETE FROM categories WHERE id = ?').run(id);
    res.redirect('/kategori?ok=' + encodeURIComponent('Kategori "' + kat.name + '" dihapus.'));
  } catch (err) { res.status(500).send(err.message); }
});

// CETAK BARCODE (label untuk kemasan yang belum ada barcode-nya)
app.get('/barcode', isManagerOrAdmin, (req, res) => {
  // Produk global, bukan per cabang: label ditempel di kemasannya, dan kemasan yang sama
  // berpindah antar cabang. Hanya produk aktif, supaya label tidak dicetak untuk barang
  // yang sudah tidak dijual.
  const products = db.prepare(`SELECT p.id, p.barcode, p.name, p.price_sell, c.name AS category
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE COALESCE(p.is_active, 1) = 1
      ORDER BY p.name ASC`).all();
  res.render('barcode', { products });
});

// STOK OPNAME (per cabang)
app.get('/opname', isManagerOrAdmin, (req, res) => {
    const user = req.session.user;
    const isAdminUser = user.role === 'Administrator';
    const branchId = getBranchScope(req);
    const products = db.prepare(`SELECT p.id, p.name, p.barcode, spb.stock, spb.min_stock
        FROM products p JOIN stock_per_branch spb ON spb.product_id = p.id AND spb.branch_id = ?
        WHERE p.is_active = 1 ORDER BY p.name ASC`).all(branchId);
    const opnames = db.prepare(`SELECT o.*, p.name AS product_name, u.name AS user_name, b.name AS branch_name
        FROM stock_opnames o
        LEFT JOIN products p ON o.product_id = p.id
        LEFT JOIN users u ON o.user_id = u.id
        LEFT JOIN branches b ON b.id = o.branch_id` + (isAdminUser ? '' : ' WHERE o.branch_id = ?') + ' ORDER BY o.id DESC LIMIT 100')
        .all(...(isAdminUser ? [] : [user.branch_id || 1]));
    const branches = db.prepare('SELECT * FROM branches WHERE is_active = 1 ORDER BY id ASC').all();
    const branch = db.prepare('SELECT id, name FROM branches WHERE id = ?').get(branchId);
    res.render('opname', { products, opnames, branches, branchId, branch });
});
app.post('/opname/add', isManagerOrAdmin, (req, res) => {
    try {
        const user = req.session.user;
        const requestedBranch = Number(req.body.branch_id) || user.branch_id || 1;
        if (!canAccessBranch(user, requestedBranch)) return res.status(403).send('Cabang opname bukan cabang Anda.');
        const branchId = requestedBranch;

        const productId = Number(req.body.product_id);
        const stockReal = Math.floor(Number(req.body.stock_real));
        if (!Number.isInteger(stockReal) || stockReal < 0) return res.status(400).send('Stok fisik harus angka bulat minimal 0.');

        const systemRow = db.prepare('SELECT stock FROM stock_per_branch WHERE product_id = ? AND branch_id = ?').get(productId, branchId);
        if (!systemRow) return res.status(400).send('Produk belum punya baris stok untuk cabang ini.');
        const stockSystem = systemRow.stock;
        const diff = stockReal - stockSystem;

        db.transaction(() => {
            const opname = db.prepare('INSERT INTO stock_opnames (product_id, stock_system, stock_real, difference, notes, user_id, branch_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
              .run(productId, stockSystem, stockReal, diff, req.body.notes, user.id, branchId);
            if (diff !== 0) adjustBranchStock(productId, branchId, diff, 'OPNAME', opname.lastInsertRowid, 'Koreksi opname', user.id);
        })();
        res.redirect('/opname' + (user.role === 'Administrator' ? '?branch_id=' + branchId : ''));
    } catch (err) { res.status(500).send(err.message); }
});

// LAPORAN & KOREKSI STOK
app.get('/stok', isManagerOrAdmin, (req, res) => {
    const user = req.session.user;
    const isAdminUser = user.role === 'Administrator';
    const branchId = getBranchScope(req);
    const branches = db.prepare('SELECT * FROM branches ORDER BY id ASC').all();

    // Posisi stok dan riwayat selalu satu cabang saja, termasuk untuk Administrator:
    // satu produk yang sama muncul dua kali dengan angka berbeda bikin kolom koreksi
    // mudah salah isi. Cabang lain cukup dipilih lewat switcher di atas.
    const rows = db.prepare(`SELECT spb.product_id, spb.branch_id, spb.stock, spb.min_stock, spb.updated_at,
          p.name AS product_name, p.barcode, p.price_buy, p.price_sell, b.name AS branch_name,
          (CASE WHEN spb.stock <= spb.min_stock THEN 1 ELSE 0 END) AS is_low
        FROM stock_per_branch spb
        JOIN products p ON p.id = spb.product_id
        JOIN branches b ON b.id = spb.branch_id
        WHERE p.is_active = 1 AND spb.branch_id = ? ORDER BY is_low DESC, p.name ASC`)
        .all(branchId);

    const movements = db.prepare(`SELECT m.*, p.name AS product_name, b.name AS branch_name, u.name AS user_name
        FROM stock_movements m
        JOIN products p ON p.id = m.product_id
        JOIN branches b ON b.id = m.branch_id
        LEFT JOIN users u ON u.id = m.user_id
        WHERE m.branch_id = ? ORDER BY m.id DESC LIMIT 60`)
        .all(branchId);

    const ringkasan = rows.reduce((acc, r) => {
        acc.totalUnits += r.stock;
        acc.stockValue += r.stock * (r.price_buy || 0);
        if (r.is_low) acc.lowStock++;
        return acc;
    }, { totalUnits: 0, stockValue: 0, lowStock: 0 });

    res.render('stok', { rows, movements, branches, branchId, ringkasan, isAdminUser });
});
app.post('/stok/adjust', isManagerOrAdmin, (req, res) => {
    const backTo = req.body.return_to === 'produk' ? '/produk' : '/stok';
    try {
        const user = req.session.user;
        const branchId = Number(req.body.branch_id) || user.branch_id || 1;
        if (!canAccessBranch(user, branchId)) return res.status(403).send('Cabang bukan milik Anda.');

        const productId = Number(req.body.product_id);
        const stockReal = Math.floor(Number(req.body.stock_real));
        if (!Number.isInteger(stockReal) || stockReal < 0) return res.status(400).send('Stok fisik harus angka bulat minimal 0.');

        const current = db.prepare('SELECT stock FROM stock_per_branch WHERE product_id = ? AND branch_id = ?').get(productId, branchId);
        if (!current) return res.status(400).send('Baris stok produk pada cabang ini belum ada.');

        const note = req.body.note ? String(req.body.note) : 'Koreksi stok manual';
        db.transaction(() => {
            initDB.ensureStockRows([branchId], [productId]);
            const delta = stockReal - current.stock;
            if (delta !== 0) adjustBranchStock(productId, branchId, delta, 'ADJUST', null, note, user.id);
        })();
        res.redirect(backTo + '?branch_id=' + branchId);
    } catch (err) { res.status(500).send(err.message); }
});
app.post('/stok/min', isManagerOrAdmin, (req, res) => {
    try {
        const user = req.session.user;
        const branchId = Number(req.body.branch_id) || user.branch_id || 1;
        if (!canAccessBranch(user, branchId)) return res.status(403).send('Cabang bukan milik Anda.');
        const minStock = Math.floor(Number(req.body.min_stock));
        if (!Number.isInteger(minStock) || minStock < 0) return res.status(400).send('Batas stok tidak valid.');
        db.prepare('UPDATE stock_per_branch SET min_stock = ? WHERE product_id = ? AND branch_id = ?')
          .run(minStock, Number(req.body.product_id), branchId);
        res.redirect('/stok?branch_id=' + branchId);
    } catch (err) { res.status(500).send(err.message); }
});

// TRANSFER STOK ANTAR CABANG
app.get('/transfer', isManagerOrAdmin, (req, res) => {
    const user = req.session.user;
    const isAdminUser = user.role === 'Administrator';
    const visibleBranchId = user.branch_id || 1;
    const transfers = db.prepare(`SELECT t.*, fb.name AS from_branch_name, tb.name AS to_branch_name, u.name AS created_by_name
        FROM stock_transfers t
        LEFT JOIN branches fb ON fb.id = t.from_branch_id
        LEFT JOIN branches tb ON tb.id = t.to_branch_id
        LEFT JOIN users u ON u.id = t.created_by
        ` + (isAdminUser ? '' : 'WHERE t.from_branch_id = ? OR t.to_branch_id = ?') + ' ORDER BY t.id DESC LIMIT 100')
        .all(...(isAdminUser ? [] : [visibleBranchId, visibleBranchId]));

    const itemsStmt = db.prepare('SELECT ti.*, p.name AS product_name FROM stock_transfer_items ti JOIN products p ON p.id = ti.product_id WHERE ti.transfer_id = ?');
    const detail = transfers.map(t => ({ ...t, items: itemsStmt.all(t.id) }));

    const pendingForMe = isAdminUser ? [] : db.prepare(`SELECT t.*, b.name AS from_branch_name FROM stock_transfers t
        LEFT JOIN branches b ON b.id = t.from_branch_id
        WHERE t.status = 'PENDING' AND t.to_branch_id = ?`).all(visibleBranchId);

    const products = db.prepare(`SELECT p.id, p.name, spb.stock FROM products p
        JOIN stock_per_branch spb ON spb.product_id = p.id AND spb.branch_id = ?
        WHERE p.is_active = 1 AND spb.stock > 0 ORDER BY p.name ASC`).all(getBranchScope(req));
    const branches = db.prepare('SELECT * FROM branches WHERE is_active = 1 ORDER BY id ASC').all();

    res.render('transfer', { detail, pendingForMe, products, branches, branchId: getBranchScope(req), isAdminUser });
});
app.post('/transfer/create', isManagerOrAdmin, (req, res) => {
    try {
        const user = req.session.user;
        const fromBranchId = Number(req.body.from_branch_id) || user.branch_id || 1;
        const toBranchId = Number(req.body.to_branch_id);
        if (!canAccessBranch(user, fromBranchId)) return res.status(403).send('Cabang asal bukan cabang Anda.');
        if (!Number.isInteger(toBranchId) || toBranchId === fromBranchId) return res.status(400).send('Pilih cabang tujuan yang berbeda.');

        const toBranch = db.prepare('SELECT id, is_active FROM branches WHERE id = ?').get(toBranchId);
        if (!toBranch || toBranch.is_active === 0) return res.status(400).send('Cabang tujuan tidak ditemukan atau sedang NONAKTIF.');

        const rawIds = [].concat(req.body.product_id || []);
        const rawQtys = [].concat(req.body.qty || []);
        if (rawIds.length === 0) return res.status(400).send('Belum ada produk yang dipilih.');

        const items = rawIds.map((id, index) => ({ productId: Number(id), qty: Math.floor(Number(rawQtys[index])) }))
            .filter(i => Number.isInteger(i.productId) && Number.isInteger(i.qty) && i.qty > 0);
        if (items.length === 0) return res.status(400).send('Jumlah transfer harus lebih dari 0.');
        if (new Set(items.map(i => i.productId)).size !== items.length) return res.status(400).send('Produk yang sama tidak boleh dua kali dalam satu transfer, gabungkan jumlahnya.');

        const code = 'TRF-' + Date.now();
        db.transaction(() => {
            const transfer = db.prepare('INSERT INTO stock_transfers (code, from_branch_id, to_branch_id, status, note, created_by) VALUES (?, ?, ?, ?, ?, ?)')
              .run(code, fromBranchId, toBranchId, 'PENDING', req.body.note, user.id);
            const insertItem = db.prepare('INSERT INTO stock_transfer_items (transfer_id, product_id, qty) VALUES (?, ?, ?)');
            for (const item of items) {
                insertItem.run(transfer.lastInsertRowid, item.productId, item.qty);
                adjustBranchStock(item.productId, fromBranchId, -item.qty, 'TRANSFER_OUT', transfer.lastInsertRowid, 'Keluar ke cabang tujuan: ' + code, user.id);
            }
        })();
        res.redirect('/transfer');
    } catch (err) { res.status(400).send('<h1>Transfer Gagal</h1><p>' + err.message + '</p><a href="/transfer">Kembali</a>'); }
});
app.post('/transfer/receive', isManagerOrAdmin, (req, res) => {
    try {
        const user = req.session.user;
        const transfer = db.prepare('SELECT * FROM stock_transfers WHERE id = ?').get(Number(req.body.id));
        if (!transfer) return res.status(400).send('Transfer tidak ditemukan.');
        if (transfer.status !== 'PENDING') return res.status(400).send('Transfer ini sudah diproses sebelumnya.');
        if (!canAccessBranch(user, transfer.to_branch_id)) return res.status(403).send('Hanya Manager cabang tujuan atau Super Admin yang boleh menerima.');

        db.transaction(() => {
            const items = db.prepare('SELECT * FROM stock_transfer_items WHERE transfer_id = ?').all(transfer.id);
            for (const item of items) {
                initDB.ensureStockRows([transfer.to_branch_id], [item.product_id]);
                adjustBranchStock(item.product_id, transfer.to_branch_id, item.qty, 'TRANSFER_IN', transfer.id, 'Barang diterima dari ' + transfer.code, user.id);
            }
            db.prepare("UPDATE stock_transfers SET status = 'RECEIVED', received_by = ?, received_at = CURRENT_TIMESTAMP WHERE id = ?")
              .run(user.id, transfer.id);
        })();
        res.redirect('/transfer');
    } catch (err) { res.status(400).send(err.message); }
});
app.post('/transfer/cancel', isManagerOrAdmin, (req, res) => {
    try {
        const user = req.session.user;
        const transfer = db.prepare('SELECT * FROM stock_transfers WHERE id = ?').get(Number(req.body.id));
        if (!transfer) return res.status(400).send('Transfer tidak ditemukan.');
        if (transfer.status !== 'PENDING') return res.status(400).send('Hanya transfer berstatus PENDING yang bisa dibatalkan.');
        if (!canAccessBranch(user, transfer.from_branch_id)) return res.status(403).send('Hanya Manager cabang asal atau Super Admin yang boleh membatalkan.');

        db.transaction(() => {
            const items = db.prepare('SELECT * FROM stock_transfer_items WHERE transfer_id = ?').all(transfer.id);
            for (const item of items) {
                adjustBranchStock(item.product_id, transfer.from_branch_id, item.qty, 'TRANSFER_CANCEL', transfer.id, 'Transfer dibatalkan, stok kembali', user.id);
            }
            db.prepare("UPDATE stock_transfers SET status = 'CANCELLED' WHERE id = ?").run(transfer.id);
        })();
        res.redirect('/transfer');
    } catch (err) { res.status(400).send(err.message); }
});

// PELANGGAN CRUD
app.get('/pelanggan', (req, res) => {
  const customers = db.prepare('SELECT * FROM customers ORDER BY id DESC').all();
  res.render('pelanggan', { customers });
});
app.post('/pelanggan/add', (req, res) => {
    try {
        let { code, name, phone, address } = req.body;
        if (!code || code.trim() === '') code = 'PLG-' + Math.floor(1000 + Math.random() * 9000);
        db.prepare('INSERT INTO customers (code, name, phone, address) VALUES (?, ?, ?, ?)').run(code, name, phone, address);
        res.redirect('/pelanggan');
    } catch (err) { res.status(500).send("Gagal: Kode Pelanggan sudah digunakan!"); }
});
app.post('/pelanggan/edit', (req, res) => {
    try { db.prepare('UPDATE customers SET code=?, name=?, phone=?, address=? WHERE id=?').run(req.body.code, req.body.name, req.body.phone, req.body.address, req.body.id); res.redirect('/pelanggan'); } catch (err) { res.status(500).send(err.message); }
});
app.post('/pelanggan/delete', (req, res) => {
    // sales menyimpan customer_id, jadi pelanggan yang sudah pernah belanja tidak boleh
    // dihapus — kalau boleh, nama di laporan dan jejak struk kehilangan pasangannya.
    const dipakai = db.prepare('SELECT COUNT(*) AS n FROM sales WHERE customer_id = ?').get(req.body.id).n;
    if (dipakai > 0) {
        return res.status(400).send('Gagal: pelanggan ini tercatat sudah ' + dipakai + ' kali belanja. Biarkan datanya agar laporan tetap nyambung.');
    }
    try { db.prepare('DELETE FROM customers WHERE id=?').run(req.body.id); res.redirect('/pelanggan'); } catch (err) { res.status(500).send(err.message); }
});

// PENGELUARAN (Admin & Manager Cabang)
app.get('/pengeluaran', isManagerOrAdmin, (req, res) => {
    const user = req.session.user;
    let query = 'SELECT e.*, u.name as user_name, b.name as branch_name FROM expenses e LEFT JOIN users u ON e.user_id = u.id LEFT JOIN branches b ON e.branch_id = b.id ';
    const params = [];
    if (user.role === 'Manager Cabang') {
        query += 'WHERE e.branch_id = ? ';
        params.push(user.branch_id);
    }
    query += 'ORDER BY e.id DESC';
    const expenses = db.prepare(query).all(...params);
    res.render('pengeluaran', { expenses });
});
app.post('/pengeluaran/add', isManagerOrAdmin, (req, res) => {
    try {
        const branchId = req.session.user.role === 'Administrator' ? (req.body.branch_id || req.session.user.branch_id) : req.session.user.branch_id;
        db.prepare('INSERT INTO expenses (title, amount, notes, user_id, branch_id) VALUES (?, ?, ?, ?, ?)').run(req.body.title, req.body.amount, req.body.notes, req.session.user.id, branchId);
        res.redirect('/pengeluaran');
    } catch (err) { res.status(500).send(err.message); }
});
app.post('/pengeluaran/delete', isManagerOrAdmin, (req, res) => {
    try { db.prepare('DELETE FROM expenses WHERE id=?').run(req.body.id); res.redirect('/pengeluaran'); } catch (err) { res.status(500).send(err.message); }
});

// PENGGAJIAN (Admin Only)
app.get('/penggajian', isAdmin, (req, res) => {
    const users = db.prepare('SELECT id, name, role FROM users').all();
    // Nama kasir ikut diambil lewat LEFT JOIN karena akun bisa dihapus sementara baris gaji
    //nya harus tetap terbaca; user_role dipakai slip, dan settings untuk kop slip.
    const payrolls = db.prepare('SELECT p.*, u.name as user_name, u.role as user_role FROM payroll p LEFT JOIN users u ON p.user_id = u.id ORDER BY p.id DESC').all();
    const settings = db.prepare('SELECT store_name, address, phone FROM settings LIMIT 1').get();
    const bulanIni = todayWIB().slice(0, 7);
    res.render('penggajian', { users, payrolls, settings, bulanIni, namaBulan: NAMA_BULAN, error: req.query.error || '' });
});
app.post('/penggajian/add', isAdmin, (req, res) => {
    const salah = (pesan) => res.redirect('/penggajian?error=' + encodeURIComponent(pesan));
    try {
        // Pemilih bulan mengirim 'YYYY-MM'; yang tersimpan tetap label manusia seperti baris-baris
        // lama, jadi tidak ada dua format periode yang bercampur di tabel.
        const m = /^(\d{4})-(\d{2})$/.exec(String(req.body.month_year || '').trim());
        if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) {
            return salah('Periode gaji belum dipilih. Pakai pemilih Bulan & Tahun, jangan diketik.');
        }
        // payroll.user_id tidak punya foreign key (dan tidak boleh ditambah sekarang: baris lama
        // bisa menunjuk akun yang sudah dihapus), jadi tanpa cek ini id karangan dari curl
        // masuk diam-diam dan tabel gaji menampilkan nama kosong.
        const karyawan = db.prepare('SELECT id FROM users WHERE id = ?').get(req.body.user_id);
        if (!karyawan) return salah('Karyawan tidak ada di daftar. Pilih namanya, jangan kirim sendiri.');

        // Rincian gaji. Kolom kosong berarti 0, bukan "belum diisi": yang wajib hanya jumlahnya
        // (terbayar > 0), jadi bulan yang hanya berisi bonus tetap bisa diinput. Negatif ditolak —
        // potongan punya kolomnya sendiri, jadi "-50000" di kolom bonus hanya membuat slip
        // sulit dibaca.
        const kolom = ['gaji_pokok', 'tunjangan', 'bonus', 'potongan'];
        const rincian = [];
        for (const nama of kolom) {
            const teks = String(req.body[nama] === undefined || req.body[nama] === null ? '' : req.body[nama]).trim();
            if (teks === '') { rincian.push(0); continue; }
            // "2.000.000" adalah cara operator menulis rupiah, jadi pola titik-ribuan
            // (dengan atau tanpa "Rp") dibersihkan dulu. Selain itu Number() dipakai apa adanya,
            // sehingga "1500.50" tetap 1500,5 dan bukan tergeser seratus kali.
            const polos = /^(?:Rp\s*)?\d{1,3}(?:\.\d{3})+$/i.test(teks) ? teks.replace(/^Rp\s*/i, '').replace(/\./g, '') : teks.replace(/^Rp\s*/i, '');
            const n = Number(polos);
            if (polos.trim() === '' || !Number.isFinite(n) || n < 0) {
                return salah('"' + teks + '" di kolom ' + nama.replace('_', ' ') + ' bukan angka Rp yang boleh diisi.');
            }
            // Rupiah utuh: slip dan tabel tidak pernah memperlihatkan "Rp 1.500.000,5".
            rincian.push(Math.round(n));
        }
        const [pokok, tunjangan, bonus, potongan] = rincian;
        let terbayar = pokok + tunjangan + bonus - potongan;
        const lama = String(req.body.amount === undefined || req.body.amount === null ? '' : req.body.amount).trim();
        if (pokok + tunjangan + bonus + potongan === 0 && lama !== '') {
            // Jalan lama (form versi sebelumnya, atau kiriman manual): satu angka = gaji pokok.
            const n = Number(lama);
            if (!Number.isFinite(n) || n <= 0) {
                return salah('Nominal gaji harus angka lebih dari 0, bukan "' + lama + '".');
            }
            rincian[0] = Math.round(n);
            terbayar = rincian[0];
        }
        if (terbayar <= 0) {
            return salah('Yang dibayar harus lebih dari 0. Pokok + tunjangan + bonus sekarang ' +
                (pokok + tunjangan + bonus) + ', potongan ' + potongan + '.');
        }
        const periode = NAMA_BULAN[Number(m[2]) - 1] + ' ' + m[1];
        db.prepare('INSERT INTO payroll (user_id, amount, month_year, period, gaji_pokok, tunjangan, bonus, potongan, notes) '
            + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(karyawan.id, terbayar, periode, m[1] + '-' + m[2], ...rincian, req.body.notes);
        res.redirect('/penggajian');
    } catch (err) { res.status(500).send(err.message); }
});
app.post('/penggajian/delete', isAdmin, (req, res) => {
    try { db.prepare('DELETE FROM payroll WHERE id=?').run(req.body.id); res.redirect('/penggajian'); } catch (err) { res.status(500).send(err.message); }
});

// VOUCHER (Admin Only)
app.get('/voucher', isAdmin, (req, res) => {
    const vouchers = db.prepare('SELECT * FROM vouchers ORDER BY id DESC').all();
    // Pemakaian dihitung sekali untuk semua voucher (bukan query per baris) supaya halaman ini
    // tidak melambat mengikuti jumlah nota. Nota yang dibatalkan tidak dihitung.
    const pemakaian = db.prepare("SELECT voucher_id, COUNT(*) AS tx, COALESCE(SUM(discount), 0) AS diskon FROM sales WHERE voucher_id IS NOT NULL AND COALESCE(status, '') <> 'VOID' GROUP BY voucher_id").all();
    const peta = new Map(pemakaian.map(p => [p.voucher_id, p]));
    vouchers.forEach(v => {
        const p = peta.get(v.id) || {};
        v.dipakai = p.tx || 0;
        v.total_diskon = p.diskon || 0;
    });
    res.render('voucher', { vouchers });
});
app.post('/voucher/add', isAdmin, (req, res) => {
    try {
        db.prepare('INSERT INTO vouchers (code, value, min_transaction) VALUES (?, ?, ?)').run(req.body.code, req.body.value, req.body.min_transaction);
        res.redirect('/voucher');
    } catch (err) { res.status(500).send("Kode voucher sudah ada!"); }
});
app.post('/voucher/delete', isAdmin, (req, res) => {
    try { db.prepare('DELETE FROM vouchers WHERE id=?').run(req.body.id); res.redirect('/voucher'); } catch (err) { res.status(500).send(err.message); }
});

// LAPORAN (Manager Cabang Bisa Lihat Laba Bersih Khusus Cabangnya)
app.get('/laporan', (req, res) => {
    const filter = req.query.filter || 'hari_ini';
    const member = Number(req.query.member) || 0;
    const user = req.session.user;
    
    let whereConditions = [];
    const whereParams = [];
    if (filter === 'hari_ini') {
        whereConditions.push("date(s.date, 'localtime') = date('now', 'localtime')");
    } else if (filter === 'bulan_ini') {
        whereConditions.push("strftime('%Y-%m', s.date, 'localtime') = strftime('%Y-%m', 'now', 'localtime')");
    }

    if (user.role !== 'Administrator') {
        whereConditions.push("s.branch_id = ?");
        whereParams.push(user.branch_id);
    }

    // Filter member: transaksi tanpa pelanggan (customer_id NULL) sengaja tidak ikut
    // saat satu nama dipilih, jadi angkanya konsisten dengan tabel yang tampil.
    if (member > 0) {
        whereConditions.push('s.customer_id = ?');
        whereParams.push(member);
    }

    const whereClause = whereConditions.length > 0 ? "WHERE " + whereConditions.join(" AND ") : "";
    const whereAktif = "WHERE " + whereConditions.concat("COALESCE(s.status, '') <> 'VOID'").join(" AND ");

    const PAGE_SIZE = 50;
    // Ringkasan dihitung dengan agregasi atas SELURUH baris yang cocok filter, bukan dari
    // baris yang kebagian tampil di halaman ini saja. ORDER BY ditambah s.date DESC supaya
    // halaman tetap identik saat ada beberapa transaksi pada detik yang sama.
    const jumlahBaris = db.prepare("SELECT COUNT(*) AS n FROM sales s " + whereClause).get(...whereParams).n;
    const totalPages = Math.max(1, Math.ceil(jumlahBaris / PAGE_SIZE));
    const page = Math.min(Math.max(Number(req.query.page) || 1, 1), totalPages);

    const ringkasan = db.prepare("SELECT COUNT(*) AS jumlah, COALESCE(SUM(s.total), 0) AS omzet, COALESCE(SUM(s.tax), 0) AS pajak, COALESCE(SUM(s.discount), 0) AS diskon, SUM(CASE WHEN COALESCE(s.discount, 0) > 0 THEN 1 ELSE 0 END) AS nota_diskon FROM sales s " + whereAktif).get(...whereParams);
    const hpp = db.prepare(`SELECT COALESCE(SUM(COALESCE(NULLIF(si.cogs, 0), p.price_buy, 0) * si.qty), 0) AS cogs
        FROM sale_items si
        LEFT JOIN products p ON p.id = si.product_id
        JOIN sales s ON s.id = si.sale_id ` + whereAktif).get(...whereParams);

    const sales = db.prepare("SELECT s.*, u.name as kasir, b.name as branch_name, vu.name as voided_by_name, c.name as customer_name, c.code as customer_code FROM sales s LEFT JOIN users u ON s.user_id = u.id LEFT JOIN branches b ON b.id = s.branch_id LEFT JOIN users vu ON s.voided_by = vu.id LEFT JOIN customers c ON c.id = s.customer_id " + whereClause + " ORDER BY s.date DESC, s.id DESC LIMIT ? OFFSET ?")
        .all(...whereParams, PAGE_SIZE, (page - 1) * PAGE_SIZE);

    // Baris VOID tetap ditampilkan di tabel sebagai jejak audit, tetapi tidak dihitung
    // dalam omzet, HPP, maupun jumlah transaksi.
    const totalRp = ringkasan.omzet;
    const totalTx = ringkasan.jumlah;
    const totalCogs = hpp.cogs;
    const labaKotor = totalRp - totalCogs;
    // Omset yang tercatat di kasir masih memuat PPN/pajak yang harus disetor, jadi belum
    // semuanya milik toko. Baris ini menghitung omset setelah pajak periode itu.
    const totalPajak = ringkasan.pajak;
    const omsetBersihPajak = totalRp - totalPajak;
    const totalDiskon = ringkasan.diskon;
    const notaDiskon = ringkasan.nota_diskon || 0;

    // Rekap diskon per kasir/cabang dan per kode voucher. Ini alat deteksinya: diskon yang
    // dipakai curang biasanya pola, bukan satu nota — misalnya satu kasir memberi potongan
    // di hampir setiap nota. Transaksi VOID dikecualikan supaya tidak dihitung dua kali.
    const rekapKasir = db.prepare(`SELECT COALESCE(u.name, 'Admin') AS kasir, COALESCE(b.name, '-') AS cabang,
            COUNT(*) AS tx, COALESCE(SUM(s.subtotal), 0) AS subtotal,
            SUM(CASE WHEN COALESCE(s.discount, 0) > 0 THEN 1 ELSE 0 END) AS tx_diskon,
            COALESCE(SUM(s.discount), 0) AS diskon
        FROM sales s
        LEFT JOIN users u ON s.user_id = u.id
        LEFT JOIN branches b ON s.branch_id = b.id ` + whereAktif + `
        GROUP BY s.user_id, s.branch_id
        HAVING diskon > 0
        ORDER BY diskon DESC`).all(...whereParams);
    const rekapVoucher = db.prepare(`SELECT COALESCE(s.voucher_code, '(tanpa kode voucher)') AS kode,
            COUNT(*) AS tx, COALESCE(SUM(s.discount), 0) AS diskon
        FROM sales s ` + whereAktif + ` AND COALESCE(s.discount, 0) > 0
        GROUP BY kode
        ORDER BY diskon DESC`).all(...whereParams);

    let expWhereConditions = [];
    const expParams = [];
    if (filter === 'hari_ini') expWhereConditions.push("date(date, 'localtime') = date('now', 'localtime')");
    else if (filter === 'bulan_ini') expWhereConditions.push("strftime('%Y-%m', date, 'localtime') = strftime('%Y-%m', 'now', 'localtime')");
    
    if (user.role !== 'Administrator') {
        expWhereConditions.push("branch_id = ?");
        expParams.push(user.branch_id);
    }

    const expWhere = expWhereConditions.length > 0 ? "WHERE " + expWhereConditions.join(" AND ") : "";
    const expTotal = db.prepare("SELECT SUM(amount) as total FROM expenses " + expWhere).get(...expParams).total || 0;
    
    let payTotal = 0;
    if (user.role === 'Administrator') {
        // Gaji dibebankan ke PERIODE yang dipilih, bukan ke tanggal input: gaji "November 2026"
        // yang baru diinput 3 Desember tetap milik November. Baris lama tanpa kunci periode
        // (period NULL) jatuh ke bulan input, yaitu perilaku yang pemilik toko sudah kenal.
        // Untuk filter "hari ini" tanggal input tetap dipakai — sebuah bulan gaji tidak punya
        // hari, jadi angka hari ini memang berarti "uang gaji yang keluar hari ini".
        let payWhere = filter === 'hari_ini'
            ? "WHERE date(date, 'localtime') = date('now', 'localtime')"
            : (filter === 'bulan_ini'
                ? "WHERE COALESCE(period, strftime('%Y-%m', date, 'localtime')) = strftime('%Y-%m', 'now', 'localtime')"
                : "");
        payTotal = db.prepare("SELECT SUM(amount) as total FROM payroll " + payWhere).get().total || 0;
    }
    
    const labaBersih = labaKotor - expTotal - payTotal;
    const settings = db.prepare('SELECT * FROM settings LIMIT 1').get();

    // Struk tidak boleh berisi token filter (BULAN_INI) karena pemilik toko harus menebak
    // maksudnya. Tanggal diambil dari sumber yang sama dengan WHERE di atas (WIB).
    const hariIni = todayWIB();
    const tglPendek = (stamp) => stamp.slice(8, 10) + '/' + stamp.slice(5, 7);
    const tglPanjang = (stamp) => stamp.slice(8, 10) + '/' + stamp.slice(5, 7) + '/' + stamp.slice(0, 4);
    let periodeLabel, kunciPeriode, judulRincian;
    if (filter === 'hari_ini') {
        periodeLabel = tglPanjang(hariIni);
        kunciPeriode = "date(s.date, 'localtime')";
        judulRincian = 'RINCIAN PER HARI';
    } else if (filter === 'bulan_ini') {
        periodeLabel = NAMA_BULAN[Number(hariIni.slice(5, 7)) - 1] + ' ' + hariIni.slice(0, 4);
        kunciPeriode = "date(s.date, 'localtime')";
        judulRincian = 'RINCIAN PER HARI';
    } else {
        periodeLabel = 'Semua Periode';
        kunciPeriode = "strftime('%Y-%m', s.date, 'localtime')";
        judulRincian = 'RINCIAN PER BULAN';
    }

    // Rincian per periode: hanya tanggal/bulan yang punya transaksi aktif. "Barang keluar"
    // diambil dari sale_items (jumlah pcs), bukan dari jumlah nota, dan ikut exclude VOID
    // karena whereAktif sudah memfilter status.
    const perPeriode = db.prepare("SELECT " + kunciPeriode + " AS kunci, COUNT(*) AS tx, COALESCE(SUM(s.total), 0) AS omzet FROM sales s " + whereAktif + " GROUP BY kunci ORDER BY kunci").all(...whereParams);
    const pcsPerKunci = new Map(db.prepare("SELECT " + kunciPeriode + " AS kunci, COALESCE(SUM(si.qty), 0) AS pcs FROM sale_items si JOIN sales s ON s.id = si.sale_id " + whereAktif + " GROUP BY kunci").all(...whereParams).map(r => [r.kunci, r.pcs]));
    const harian = perPeriode.map(r => ({
        label: filter === 'semua' ? r.kunci.slice(5, 7) + '/' + r.kunci.slice(0, 4) : tglPendek(r.kunci),
        tx: r.tx,
        pcs: pcsPerKunci.get(r.kunci) || 0,
        omzet: r.omzet
    }));
    const totalPcs = harian.reduce((acc, r) => acc + r.pcs, 0);

    const customers = db.prepare('SELECT id, code, name FROM customers ORDER BY name COLLATE NOCASE ASC').all();
    res.render('laporan', { sales, filter, member, customers, totalRp, totalTx, totalCogs, totalPcs, totalPajak, omsetBersihPajak, totalDiskon, notaDiskon, rekapKasir, rekapVoucher, labaKotor, expTotal, payTotal, labaBersih, settings, page, totalPages, jumlahBaris, pageSize: PAGE_SIZE, periodeLabel, harian, judulRincian });
});

// PEMBATALAN / RETUR PENJUALAN
app.post('/laporan/void', isManagerOrAdmin, (req, res) => {
    try {
        const user = req.session.user;
        const saleId = Number(req.body.id);
        const reason = String(req.body.reason || '').trim();
        const q = [];
        if (req.body.filter) q.push('filter=' + encodeURIComponent(req.body.filter));
        if (req.body.member) q.push('member=' + encodeURIComponent(req.body.member));
        const backTo = '/laporan' + (q.length ? '?' + q.join('&') : '');
        if (!Number.isInteger(saleId) || saleId <= 0) return res.status(400).send('ID transaksi tidak valid.');
        if (reason.length < 3) return res.status(400).send('Alasan pembatalan wajib diisi minimal 3 karakter.');

        const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId);
        if (!sale) return res.status(404).send('Transaksi tidak ditemukan.');
        if (!canAccessBranch(user, sale.branch_id)) return res.status(403).send('Transaksi bukan dari cabang Anda.');
        if (sale.status === 'VOID') return res.status(409).send('Transaksi ' + sale.invoice_no + ' sudah dibatalkan sebelumnya.');

        const items = db.prepare('SELECT product_id, qty FROM sale_items WHERE sale_id = ?').all(saleId);

        db.transaction(() => {
            const mark = db.prepare("UPDATE sales SET status = 'VOID', voided_at = CURRENT_TIMESTAMP, voided_by = ?, void_reason = ? WHERE id = ? AND COALESCE(status, '') <> 'VOID'")
                .run(user.id, reason, saleId);
            if (mark.changes === 0) throw new Error('Transaksi sudah dibatalkan sebelumnya.');
            if (items.length === 0) throw new Error('Transaksi tidak memiliki item, tidak ada stok yang bisa dikembalikan.');

            initDB.ensureStockRows([sale.branch_id], items.map(i => i.product_id));
            items.forEach(i => adjustBranchStock(i.product_id, sale.branch_id, i.qty, 'VOID', saleId,
                'Retur ' + sale.invoice_no + ': ' + reason, user.id));
        })();

        res.redirect(backTo);
    } catch (err) { res.status(500).send(err.message); }
});

// PENGGUNA (Manager Cabang Bisa Buat Akun Kasir Cabangnya)
app.get('/pengguna', isManagerOrAdmin, (req, res) => {
    const user = req.session.user;
    let query = 'SELECT u.id, u.username, u.name, u.role, u.branch_id, u.is_active, b.name as branch_name FROM users u LEFT JOIN branches b ON u.branch_id = b.id ';
    const params = [];
    if (user.role === 'Manager Cabang') {
        query += 'WHERE u.branch_id = ? ';
        params.push(user.branch_id);
    }
    query += 'ORDER BY u.id ASC';
    const users = db.prepare(query).all(...params);
    const branches = db.prepare('SELECT * FROM branches WHERE is_active = 1').all();
    res.render('pengguna', { users, branches });
});

app.post('/pengguna/add', isManagerOrAdmin, (req, res) => {
    try {
        const user = req.session.user;
        const branchId = user.role === 'Administrator' ? (req.body.branch_id || 1) : user.branch_id;
        const role = user.role === 'Administrator' ? req.body.role : 'Kasir';

        const hash = bcrypt.hashSync(req.body.password, 10);
        db.prepare('INSERT INTO users (username, password, name, role, branch_id, force_pass_change) VALUES (?, ?, ?, ?, ?, 1)').run(req.body.username, hash, req.body.name, role, branchId);
        res.redirect('/pengguna');
    } catch (err) { res.status(500).send("Gagal: Username mungkin sudah digunakan."); }
});

app.post('/pengguna/edit', isManagerOrAdmin, (req, res) => {
    try {
        const user = req.session.user;
        const branchId = user.role === 'Administrator' ? (req.body.branch_id || 1) : user.branch_id;
        const role = user.role === 'Administrator' ? req.body.role : 'Kasir';

        if(req.body.password) {
            const hash = bcrypt.hashSync(req.body.password, 10);
            const wajibGanti = Number(req.body.id) === req.session.user.id ? 0 : 1;
            db.prepare('UPDATE users SET username=?, name=?, role=?, branch_id=?, password=?, force_pass_change=? WHERE id=?')
                .run(req.body.username, req.body.name, role, branchId, hash, wajibGanti, req.body.id);
        } else {
            db.prepare('UPDATE users SET username=?, name=?, role=?, branch_id=? WHERE id=?').run(req.body.username, req.body.name, role, branchId, req.body.id);
        }
        res.redirect('/pengguna');
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/pengguna/delete', isManagerOrAdmin, (req, res) => {
    try {
        if(req.body.id == req.session.user.id) return res.send("Tidak bisa menghapus akun sendiri!");
        db.prepare('DELETE FROM users WHERE id=?').run(req.body.id); res.redirect('/pengguna');
    } catch (err) { res.status(500).send(err.message); }
});

// PENGATURAN TOKO
app.get('/pengaturan', isAdmin, (req, res) => {
    const settings = db.prepare('SELECT * FROM settings LIMIT 1').get();
    res.render('pengaturan', {
        settings,
        email: statusEmail(db),
        error: req.query.error || null,
        info: req.query.info || null
    });
});

// Pengaturan cadangan harian ke email. Sengaja formulir sendiri, bukan ikut
// /pengaturan/update: kolom ini boleh dikosongkan (mati), dan pola COALESCE pada
// formulir toko justru membuat nilai null tidak pernah bisa disimpan.
app.post('/pengaturan/email', isAdmin, (req, res) => {
    try {
        const alamat = String(req.body.backup_email || '').trim();
        if (alamat && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(alamat)) {
            return res.redirect('/pengaturan?error=' + encodeURIComponent('Alamat email "' + alamat + '" tidak layak, jadi tidak disimpan.'));
        }
        const jamRaw = Number.parseInt(req.body.backup_hour, 10);
        const jam = Number.isInteger(jamRaw) && jamRaw >= 0 && jamRaw <= 23 ? jamRaw : 22;
        db.prepare('UPDATE settings SET backup_email = ?, backup_hour = ? WHERE id = 1').run(alamat || null, jam);
        res.redirect('/pengaturan?info=' + encodeURIComponent(alamat
            ? 'Cadangan harian aktif: tiap hari pukul ' + String(jam).padStart(2, '0') + ' WIB ke ' + alamat + '.'
            : 'Cadangan harian ke email dimatikan.'));
    } catch (err) { res.status(500).send(err.message); }
});

// Kirim sekarang juga, tanpa menunggu jam. Kegagalan dikirim sebagai pesan, bukan
// halaman error, karena server email pihak ketiga memang sering menolak sesaat.
app.post('/pengaturan/email-uji', isAdmin, async (req, res) => {
    const kembali = (key, pesan) => res.redirect('/pengaturan?' + key + '=' + encodeURIComponent(pesan));
    try {
        const hasil = await kirimCadanganEmail({
            db, formatWIB, uploadsDir, paksa: true,
            ke: String(req.body.backup_email || '').trim() || undefined
        });
        if (!hasil.ok && hasil.dilewati) return kembali('error', hasil.pesan);
        return kembali(hasil.ok ? 'info' : 'error', hasil.ok
            ? 'Uji kirim berhasil: ' + hasil.pesan + ' (' + hasil.ukuranMb + ' MB).'
            : 'Uji kirim gagal: ' + hasil.pesan);
    } catch (err) {
        return kembali('error', 'Uji kirim gagal: ' + err.message);
    }
});

app.post('/pengaturan/update', isAdmin, upload.single('logo'), (req, res) => {
    try {
        const blank = (value) => (value === undefined || value === null || String(value).trim() === '') ? null : value;
        const logoPath = req.file ? '/uploads/' + req.file.filename : null;
        db.prepare(`UPDATE settings SET
            store_name = COALESCE(?, store_name),
            phone = COALESCE(?, phone),
            address = COALESCE(?, address),
            receipt_footer = COALESCE(?, receipt_footer),
            receipt_note = COALESCE(?, receipt_note),
            logo = COALESCE(?, logo)
          WHERE id = ?`)
          .run(blank(req.body.store_name), blank(req.body.phone), blank(req.body.address), blank(req.body.receipt_footer), blank(req.body.receipt_note), logoPath, req.body.id);
        res.redirect('/pengaturan');
    } catch (err) { res.status(500).send(err.message); }
});

// ZONA BERBAHAYA — penghapusan data bertingkat, khusus Administrator.
//
// Tiga aksi dari yang paling aman sampai paling merusak. Syaratnya identik untuk
// ketiganya dan memang sengaja dibuat melelahkan: cadangan harus berhasil lebih dulu,
// frasa konfirmasi diketik persis, dan sandi login dicek ulang. Semua DELETE dibungkus
// satu transaksi supaya tidak pernah ada keadaan "setengah terhapus".
const HAPUS_DATA = {
    transaksi: {
        frasa: 'HAPUS TRANSAKSI',
        ringkas: 'Riwayat penjualan dikosongkan; produk, harga, stok, cabang, dan pengguna tetap utuh.',
        jalan: () => ({
            sale_items: db.prepare('DELETE FROM sale_items').run().changes,
            sales: db.prepare('DELETE FROM sales').run().changes,
            // Jurnal stok yang murni akibat nota ikut dihapus karena tidak lagi punya
            // rujukan; opname, penyesuaian manual, dan transfer tetap tersimpan.
            stock_movements: db.prepare("DELETE FROM stock_movements WHERE type IN ('SALE','VOID')").run().changes
        })
    },
    produk: {
        frasa: 'HAPUS PRODUK',
        ringkas: 'Daftar produk, stok per cabang, dan jurnal stok dihapus; transaksi lama dibiarkan.',
        // sale_items.product_id tidak punya foreign key, jadi kalau produk dihapus sementara
        // nota masih ada, laporan lama akan menampilkan baris barang yang tidak pernah ada.
        prasyarat: () => {
            const n = db.prepare('SELECT COUNT(*) AS c FROM sales').get().c;
            return n === 0 ? null
                : `Masih ada ${n} transaksi. Jalankan "Kosongkan riwayat transaksi" lebih dulu, atau biarkan datanya.`;
        },
        jalan: () => ({
            stock_transfer_items: db.prepare('DELETE FROM stock_transfer_items').run().changes,
            stock_transfers: db.prepare('DELETE FROM stock_transfers').run().changes,
            stock_movements: db.prepare('DELETE FROM stock_movements').run().changes,
            stock_per_branch: db.prepare('DELETE FROM stock_per_branch').run().changes,
            products: db.prepare('DELETE FROM products').run().changes
        })
    },
    pabrik: {
        frasa: 'RESET PABRIK',
        ringkas: 'Seluruh data operasional dihapus; cabang, akun pengguna, pengaturan toko, dan jejak audit tetap ada.',
        // Cabang dan pengguna sengaja tidak disentuh: tanpanya aplikasi tidak bisa login
        // lagi dan satu-satunya jalan kembali adalah mengedit database dengan tangan.
        jalan: () => ({
            sale_items: db.prepare('DELETE FROM sale_items').run().changes,
            sales: db.prepare('DELETE FROM sales').run().changes,
            stock_transfer_items: db.prepare('DELETE FROM stock_transfer_items').run().changes,
            stock_transfers: db.prepare('DELETE FROM stock_transfers').run().changes,
            stock_movements: db.prepare('DELETE FROM stock_movements').run().changes,
            stock_per_branch: db.prepare('DELETE FROM stock_per_branch').run().changes,
            products: db.prepare('DELETE FROM products').run().changes,
            categories: db.prepare('DELETE FROM categories').run().changes,
            customers: db.prepare('DELETE FROM customers').run().changes,
            vouchers: db.prepare('DELETE FROM vouchers').run().changes,
            expenses: db.prepare('DELETE FROM expenses').run().changes,
            stock_opnames: db.prepare('DELETE FROM stock_opnames').run().changes,
            payroll: db.prepare('DELETE FROM payroll').run().changes
        })
    }
};

app.post('/pengaturan/hapus-data', isAdmin, async (req, res) => {
    const kembali = (key, pesan) => res.redirect(`/pengaturan?${key}=` + encodeURIComponent(pesan));
    const def = HAPUS_DATA[req.body.aksi];
    if (!def) return kembali('error', 'Aksi penghapusan tidak dikenali.');

    const keberatan = [];
    // Cap letters tidak ikut dihitung; yang harus persis adalah kata-katanya.
    if (String(req.body.konfirmasi || '').trim().toUpperCase() !== def.frasa) {
        keberatan.push(`Frasa konfirmasi harus diketik persis: ${def.frasa}.`);
    }
    const akun = db.prepare('SELECT password FROM users WHERE id = ?').get(req.session.user.id);
    if (!akun || !bcrypt.compareSync(String(req.body.password || ''), akun.password)) {
        // Sandi akun yang sedang login, bukan sandi baru.
        keberatan.push('Sandi akun Anda tidak cocok.');
    }
    if (def.prasyarat) {
        const halang = def.prasyarat();
        if (halang) keberatan.push(halang);
    }
    if (keberatan.length > 0) return kembali('error', 'Penghapusan dibatalkan. ' + keberatan.join(' '));

    const hasil = await runBackup();
    if (!hasil.ok) {
        return kembali('error', 'Penghapusan dibatalkan karena cadangan gagal dibuat: '
            + (hasil.skipped ? 'cadangan otomatis masih berjalan, ulangi sebentar lagi.'
                : (hasil.error || 'pemeriksaan integritas menghasilkan ' + hasil.integrity)));
    }

    try {
        const rincian = db.transaction(() => def.jalan())();
        const baris = Object.values(rincian).reduce((a, b) => a + b, 0);
        db.prepare(`INSERT INTO data_actions (user_id, aksi, backup_file, baris_terhapus, keterangan)
            VALUES (?, ?, ?, ?, ?)`)
            .run(req.session.user.id, req.body.aksi, path.basename(hasil.file), baris, def.ringkas);
        console.log(`[hapus-data] ${req.body.aksi} oleh user ${req.session.user.id}: ${baris} baris, cadangan ${path.basename(hasil.file)}`);
        return kembali('info', `Selesai: ${baris} baris dihapus (${Object.entries(rincian).map(([t, n]) => `${t} ${n}`).join(', ')}). `
            + `Salinan sebelum hapus tersimpan di ${path.basename(hasil.file)}.`);
    } catch (err) {
        return kembali('error', 'Penghapusan gagal dan seluruh perubahan dibatalkan: ' + err.message);
    }
});

app.get('/pengaturan/voucher', isAdmin, (req, res) => {
    const settings = db.prepare('SELECT * FROM settings LIMIT 1').get();
    res.render('pengaturan-voucher', { settings, error: req.query.error || null, saved: req.query.saved === '1' });
});

app.post('/pengaturan/voucher/update', isAdmin, (req, res) => {
    const taxRate = Number(req.body.tax_rate);
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
        return res.redirect('/pengaturan/voucher?error=' + encodeURIComponent('Tarif pajak harus berupa angka antara 0 sampai 100.'));
    }
    try {
        db.prepare('UPDATE settings SET tax_rate=? WHERE id=?').run(taxRate, req.body.id);
        res.redirect('/pengaturan/voucher?saved=1');
    } catch (err) { res.status(500).send(err.message); }
});

// CADANGAN & DATA
//
// Semua jalur di blok ini khusus Administrator dan tidak mengubah apa pun: yang ZIP
// hanya membaca snapshot hasil backup(), sisanya ekspor baca-saja.
const uploadsDir = path.join(__dirname, 'public', 'uploads');

const formatUkuran = (byte) => {
    if (!Number.isFinite(byte) || byte <= 0) return '0 KB';
    const satuan = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(Math.floor(Math.log(byte) / Math.log(1024)), satuan.length - 1);
    return (byte / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + satuan[i];
};

// Nama tabel ditulis di sini, bukan datang dari input pengguna, jadi string SQLnya aman.
const TABEL_CADANGAN = ['sales', 'sale_items', 'products', 'stock_per_branch', 'stock_movements',
    'branches', 'users', 'categories', 'customers', 'vouchers', 'expenses', 'stock_opnames', 'payroll'];

app.get('/backup', isAdmin, (req, res) => {
    const jumlah = {};
    for (const t of TABEL_CADANGAN) jumlah[t] = db.prepare('SELECT COUNT(*) AS c FROM ' + t).get().c;

    const berkas = fs.existsSync(backupDir)
        ? fs.readdirSync(backupDir)
            .filter((f) => /^kasir-\d{8}-\d{6}\.db$/.test(f))
            .map((f) => {
                const stat = fs.statSync(path.join(backupDir, f));
                return { nama: f, ukuran: formatUkuran(stat.size), waktu: formatWIB(stat.mtime) };
            })
            .sort((a, b) => b.nama.localeCompare(a.nama))
        : [];

    const berkasUpload = daftarFileRekursif(uploadsDir);
    const ukuranUpload = berkasUpload.reduce((acc, f) => acc + fs.statSync(f.penuh).size, 0);

    const aksi = db.prepare(`SELECT da.*, u.name AS pelaksana FROM data_actions da
        LEFT JOIN users u ON u.id = da.user_id ORDER BY da.id DESC LIMIT 5`).all();

    res.render('backup', {
        jumlah, berkas, aksi,
        jumlahUpload: berkasUpload.length,
        ukuranUpload: formatUkuran(ukuranUpload),
        retensi: keepCount,
        error: req.query.error || null,
        info: req.query.info || null
    });
});

// Satu tombol untuk semua: snapshot database (checkpoint + integrity_check), gambar
// logo/QRIS di uploads, dan ekspor CSV. Perakitan arsipnya ada di scripts/cadangan-zip.js
// karena cadangan harian ke email mengirim arsip yang persis sama.
app.post('/backup/unduh-zip', isAdmin, async (req, res) => {
    try {
        const arsip = await buatCadanganZip({ db, formatWIB, uploadsDir });
        if (!arsip.ok) return res.redirect('/backup?error=' + encodeURIComponent(arsip.pesan));
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${arsip.namaBerkas}"`);
        res.send(arsip.buffer);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// Ekspor CSV baca-saja. Nama jenis divalidasi lewat kunci objek, jadi tidak ada jalur
// input bebas yang masuk ke query.
app.get('/backup/ekspor/:nama', isAdmin, (req, res) => {
    const j = jenisEkspor[req.params.nama];
    if (!j) return res.status(404).send('Jenis ekspor tidak dikenal.');
    const isi = buatCsv(j.kolom, j.ambil(db, formatWIB));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${j.nama}.csv"`);
    res.send(isi);
});

// Berkas .db hasil backup otomatis. Pola namanya ketat: siapa pun yang mengirim nama
// lain (termasuk ../) langsung ditolak sebelum ada satu pun pemanggilan fs.
app.get('/backup/berkas/:nama', isAdmin, (req, res) => {
    const nama = req.params.nama;
    if (!/^kasir-\d{8}-\d{6}\.db$/.test(nama)) return res.status(400).send('Nama berkas tidak valid.');
    const penuh = path.join(backupDir, nama);
    if (!fs.existsSync(penuh)) return res.status(404).send('Berkas cadangan tidak ditemukan.');
    res.download(penuh, nama);
});


const PORT = process.env.PORT || 3000;
const BACKUP_INTERVAL_MIN = Number(process.env.BACKUP_INTERVAL_MIN ?? 60);
const EMAIL_CEK_MIN = Number(process.env.EMAIL_BACKUP_INTERVAL_MIN ?? 5);

app.listen(PORT, () => {
    console.log('[SERVER] KASIR POS berjalan di http://localhost:' + PORT);
    if (BACKUP_INTERVAL_MIN > 0) {
        runBackup();
        setInterval(runBackup, BACKUP_INTERVAL_MIN * 60000).unref();
        console.log(`[backup] otomatis tiap ${BACKUP_INTERVAL_MIN} menit, simpan ${keepCount} terbaru di ${backupDir} (BACKUP_INTERVAL_MIN=0 untuk mematikan)`);
    }
    if (EMAIL_CEK_MIN > 0) {
        jadwalkanEmailCadangan({ db, formatWIB, uploadsDir, intervalMenit: EMAIL_CEK_MIN });
        const s = statusEmail(db);
        console.log('[email-cadangan] dicek tiap ' + EMAIL_CEK_MIN + ' menit; tujuan '
            + (s.aktif ? s.email + ' pukul ' + String(s.jam).padStart(2, '0') + ' WIB' : 'belum diisi')
            + '; SMTP ' + (s.smtpSiap ? 'terkonfigurasi (' + s.smtpHost + ':' + s.smtpPort + ', ' + s.smtpMetode + ')' : 'belum ada di .env'));
    }
});