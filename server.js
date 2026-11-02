const express = require('express');
const session = require('express-session');
const path = require('path');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const db = require('./config/database');
const SqliteSessionStore = require('./config/sessionStore');
const initDB = require('./database/migrations/init');
require('dotenv').config();

initDB();

const app = express();
app.set('view engine', 'ejs');
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

        const salesTodayItems = db.prepare("SELECT s.id FROM sales s WHERE date(s.date, 'localtime') = ?" + notVoid + branchFilterSales).all(today, ...branchParams);
        const cogsPerSale = db.prepare("SELECT SUM(COALESCE(NULLIF(si.cogs, 0), p.price_buy, 0) * si.qty) as total FROM sale_items si LEFT JOIN products p ON si.product_id = p.id WHERE si.sale_id = ?");
        salesTodayItems.forEach(s => {
            const itemCogs = cogsPerSale.get(s.id);
            cogsToday += (itemCogs ? (itemCogs.total || 0) : 0);
        });

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
app.post('/cabang/edit', isAdmin, (req, res) => {
    try {
        db.prepare('UPDATE branches SET code=?, name=?, address=?, phone=?, pic_name=? WHERE id=?').run(req.body.code, req.body.name, req.body.address, req.body.phone, req.body.pic_name, req.body.id);
        res.redirect('/cabang');
    } catch(err) { res.status(500).send(err.message); }
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
  const branch = db.prepare('SELECT id, name FROM branches WHERE id = ?').get(branchId);
  const branches = db.prepare('SELECT id, name FROM branches WHERE is_active = 1 ORDER BY id ASC').all();
  res.render('kasir', { products, settings, vouchers, branch, branches });
});

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
    if (voucherId && Number(voucherId) > 0) {
      const voucher = getVoucher.get(Number(voucherId));
      if (!voucher) throw new Error('Voucher tidak ditemukan atau sudah tidak aktif.');
      if (subtotal < (voucher.min_transaction || 0)) throw new Error('Minimal transaksi voucher ' + voucher.code + ' adalah Rp ' + (voucher.min_transaction || 0).toLocaleString('id-ID') + '.');
      discount = Math.min(voucher.value || 0, subtotal);
    }

    const tax = Math.round((subtotal - discount) * taxRate / 100);
    const total = subtotal - discount + tax;
    if (amount < total) throw new Error('Uang pembayaran kurang Rp ' + (total - amount).toLocaleString('id-ID') + '.');

    const sale = db.prepare('INSERT INTO sales (invoice_no, user_id, branch_id, subtotal, discount, tax, total, payment_method, payment_amount, return_amount, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(invoiceNo, user.id, branchId, subtotal, discount, tax, total, paymentMethod, amount, amount - total, 'LUNAS');

    const insertItem = db.prepare('INSERT INTO sale_items (sale_id, product_id, qty, price, cogs, subtotal) VALUES (?, ?, ?, ?, ?, ?)');

    for (const line of lines) {
      insertItem.run(sale.lastInsertRowid, line.product.id, line.qty, line.product.price_sell, line.product.price_buy || 0, line.qty * line.product.price_sell);
      adjustBranchStock(line.product.id, branchId, -line.qty, 'SALE', sale.lastInsertRowid, invoiceNo, user.id);
    }
    return { subtotal, discount, tax, total, branchName: branch.name };
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
  res.render('produk', { products, categories, stocks, branches, branchId });
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

    const rows = db.prepare(`SELECT spb.product_id, spb.branch_id, spb.stock, spb.min_stock, spb.updated_at,
          p.name AS product_name, p.barcode, p.price_buy, p.price_sell, b.name AS branch_name,
          (CASE WHEN spb.stock <= spb.min_stock THEN 1 ELSE 0 END) AS is_low
        FROM stock_per_branch spb
        JOIN products p ON p.id = spb.product_id
        JOIN branches b ON b.id = spb.branch_id
        WHERE p.is_active = 1` + (isAdminUser ? '' : ' AND spb.branch_id = ?') + ' ORDER BY is_low DESC, p.name ASC')
        .all(...(isAdminUser ? [] : [user.branch_id || 1]));

    const movements = db.prepare(`SELECT m.*, p.name AS product_name, b.name AS branch_name, u.name AS user_name
        FROM stock_movements m
        JOIN products p ON p.id = m.product_id
        JOIN branches b ON b.id = m.branch_id
        LEFT JOIN users u ON u.id = m.user_id` + (isAdminUser ? '' : ' WHERE m.branch_id = ?') + ' ORDER BY m.id DESC LIMIT 60')
        .all(...(isAdminUser ? [] : [user.branch_id || 1]));

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
    const payrolls = db.prepare('SELECT p.*, u.name as user_name FROM payroll p LEFT JOIN users u ON p.user_id = u.id ORDER BY p.id DESC').all();
    res.render('penggajian', { users, payrolls });
});
app.post('/penggajian/add', isAdmin, (req, res) => {
    try {
        db.prepare('INSERT INTO payroll (user_id, amount, month_year, notes) VALUES (?, ?, ?, ?)').run(req.body.user_id, req.body.amount, req.body.month_year, req.body.notes);
        res.redirect('/penggajian');
    } catch (err) { res.status(500).send(err.message); }
});
app.post('/penggajian/delete', isAdmin, (req, res) => {
    try { db.prepare('DELETE FROM payroll WHERE id=?').run(req.body.id); res.redirect('/penggajian'); } catch (err) { res.status(500).send(err.message); }
});

// VOUCHER (Admin Only)
app.get('/voucher', isAdmin, (req, res) => {
    const vouchers = db.prepare('SELECT * FROM vouchers ORDER BY id DESC').all();
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

    const whereClause = whereConditions.length > 0 ? "WHERE " + whereConditions.join(" AND ") : "";
    const sales = db.prepare("SELECT s.*, u.name as kasir, b.name as branch_name, vu.name as voided_by_name FROM sales s LEFT JOIN users u ON s.user_id = u.id LEFT JOIN branches b ON s.branch_id = b.id LEFT JOIN users vu ON s.voided_by = vu.id " + whereClause + " ORDER BY s.date DESC LIMIT 500").all(...whereParams);
    
    // Baris VOID tetap ditampilkan di tabel sebagai jejak audit, tetapi tidak dihitung
    // dalam omzet, HPP, maupun jumlah transaksi.
    const aktif = sales.filter(s => s.status !== 'VOID');

    let totalCogs = 0;
    aktif.forEach(s => {
        const items = db.prepare("SELECT SUM(COALESCE(NULLIF(si.cogs, 0), p.price_buy, 0) * si.qty) as cogs_total FROM sale_items si LEFT JOIN products p ON si.product_id = p.id WHERE si.sale_id = ?").get(s.id);
        totalCogs += (items ? (items.cogs_total || 0) : 0);
    });

    const totalRp = aktif.reduce((sum, item) => sum + (item.total || 0), 0);
    const labaKotor = totalRp - totalCogs;

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
        let payWhere = filter === 'hari_ini' ? "WHERE date(date, 'localtime') = date('now', 'localtime')" : (filter === 'bulan_ini' ? "WHERE strftime('%Y-%m', date, 'localtime') = strftime('%Y-%m', 'now', 'localtime')" : "");
        payTotal = db.prepare("SELECT SUM(amount) as total FROM payroll " + payWhere).get().total || 0;
    }
    
    const labaBersih = labaKotor - expTotal - payTotal;
    const settings = db.prepare('SELECT * FROM settings LIMIT 1').get();

    res.render('laporan', { sales, filter, totalRp, totalTx: aktif.length, totalCogs, labaKotor, expTotal, payTotal, labaBersih, settings });
});

// PEMBATALAN / RETUR PENJUALAN
app.post('/laporan/void', isManagerOrAdmin, (req, res) => {
    try {
        const user = req.session.user;
        const saleId = Number(req.body.id);
        const reason = String(req.body.reason || '').trim();
        const backTo = '/laporan' + (req.body.filter ? '?filter=' + encodeURIComponent(req.body.filter) : '');
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
        db.prepare('INSERT INTO users (username, password, name, role, branch_id) VALUES (?, ?, ?, ?, ?)').run(req.body.username, hash, req.body.name, role, branchId);
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
            db.prepare('UPDATE users SET username=?, name=?, role=?, branch_id=?, password=? WHERE id=?').run(req.body.username, req.body.name, role, branchId, hash, req.body.id);
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
    res.render('pengaturan', { settings });
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


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('[SERVER] KASIR POS berjalan di http://localhost:' + PORT));