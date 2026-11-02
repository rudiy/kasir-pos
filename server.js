const express = require('express');
const session = require('express-session');
const path = require('path');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const db = require('./config/database');
const initDB = require('./database/migrations/init');
require('dotenv').config();

initDB();

const app = express();
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(session({ secret: process.env.SESSION_SECRET || 'secret', resave: false, saveUninitialized: false }));

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, 'public/uploads')),
    filename: (req, file, cb) => cb(null, 'logo-' + Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

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

app.get('/login', (req, res) => res.render('auth/login', { error: null }));
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT u.*, b.name as branch_name, b.is_active as branch_active FROM users u LEFT JOIN branches b ON u.branch_id = b.id WHERE u.username = ? AND u.is_active = 1').get(username);
  if (user && bcrypt.compareSync(password, user.password)) {
    if (user.role !== 'Administrator' && user.branch_active === 0) {
        return res.render('auth/login', { error: 'Cabang toko Anda saat ini NONAKTIF/OFF. Silakan hubungi Super Admin.' });
    }
    req.session.user = user;
    res.redirect('/');
  } else {
    res.render('auth/login', { error: 'Username/Password salah atau akun nonaktif' });
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
    next(); 
});

// FUNGSI STATISTIK MULTI-CABANG REAL-TIME
function getTodayStats(user, selectedBranchId) {
    const today = new Date().toISOString().split('T')[0];
    let branchFilterSales = "";
    let expWhere = "WHERE date(date, 'localtime') = '" + today + "'";
    let payWhere = "WHERE date(date, 'localtime') = '" + today + "'";

    let activeBranchId = user.branch_id || 1;
    if (user.role === 'Administrator') {
        if (selectedBranchId && selectedBranchId !== 'all') {
            activeBranchId = parseInt(selectedBranchId);
            branchFilterSales = " AND s.branch_id = " + activeBranchId + " ";
            expWhere += " AND branch_id = " + activeBranchId;
        }
    } else {
        branchFilterSales = " AND s.branch_id = " + activeBranchId + " ";
        expWhere += " AND branch_id = " + activeBranchId;
    }

    const salesToday = db.prepare("SELECT SUM(total) as total, COUNT(id) as count FROM sales s WHERE date(s.date, 'localtime') = ?" + branchFilterSales).get(today) || {total:0, count:0};
    const productCount = db.prepare('SELECT COUNT(*) as count FROM products').get() || {count:0};

    let expToday = 0;
    let payToday = 0;
    let cogsToday = 0;
    let profitToday = 0;

    if (user.role === 'Administrator' || user.role === 'Manager Cabang') {
        expToday = db.prepare("SELECT SUM(amount) as total FROM expenses " + expWhere).get().total || 0;
        if (user.role === 'Administrator') {
            payToday = db.prepare("SELECT SUM(amount) as total FROM payroll " + payWhere).get().total || 0;
        }
        
        let salesQuery = "SELECT s.id FROM sales s WHERE date(s.date, 'localtime') = '" + today + "'" + branchFilterSales;
        const salesTodayItems = db.prepare(salesQuery).all();
        salesTodayItems.forEach(s => {
            const itemCogs = db.prepare("SELECT SUM(COALESCE(NULLIF(si.cogs, 0), p.price_buy, 0) * si.qty) as total FROM sale_items si LEFT JOIN products p ON si.product_id = p.id WHERE si.sale_id = ?").get(s.id);
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
    
    res.render('dashboard/index', { 
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
    res.render('cabang/index', { branches });
});
app.post('/cabang/add', isAdmin, (req, res) => {
    try {
        const { code, name, address, phone, pic_name } = req.body;
        db.prepare('INSERT INTO branches (code, name, address, phone, pic_name, is_active) VALUES (?, ?, ?, ?, ?, 1)').run(code, name, address, phone, pic_name);
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
  const products = db.prepare('SELECT * FROM products WHERE is_active = 1 AND stock > 0').all();
  const settings = db.prepare('SELECT * FROM settings LIMIT 1').get();
  const vouchers = db.prepare('SELECT * FROM vouchers WHERE is_active = 1').all();
  res.render('kasir/index', { products, settings, vouchers });
});

app.post('/api/checkout', (req, res) => {
  const { cart, paymentMethod, paymentAmount, total } = req.body;
  const invoiceNo = 'INV-' + Date.now();
  const branchId = req.session.user.branch_id || 1;

  const transaction = db.transaction(() => {
    const returnAmount = paymentAmount - total;
    const sale = db.prepare('INSERT INTO sales (invoice_no, user_id, branch_id, total, payment_method, payment_amount, return_amount, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(invoiceNo, req.session.user.id, branchId, total, paymentMethod, paymentAmount, returnAmount, 'LUNAS');
    
    const insertItem = db.prepare('INSERT INTO sale_items (sale_id, product_id, qty, price, cogs, subtotal) VALUES (?, ?, ?, ?, ?, ?)');
    const updateStock = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?');
    const getProduct = db.prepare('SELECT price_buy FROM products WHERE id = ?');

    for (let item of cart) {
      const p = getProduct.get(item.id);
      const cogs = p ? (p.price_buy || 0) : 0;
      insertItem.run(sale.lastInsertRowid, item.id, item.qty, item.price, cogs, item.qty * item.price);
      updateStock.run(item.qty, item.id);
    }
    return sale.lastInsertRowid;
  });
  try { transaction(); res.json({ success: true, invoiceNo }); } 
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// PRODUK CRUD
app.get('/produk', (req, res) => {
  const products = db.prepare('SELECT p.*, c.name as category FROM products p LEFT JOIN categories c ON p.category_id = c.id ORDER BY p.id DESC').all();
  const categories = db.prepare('SELECT * FROM categories').all();
  res.render('produk/index', { products, categories });
});
app.post('/produk/add', (req, res) => {
    try {
        let { barcode, name, category_id, price_buy, price_sell, stock } = req.body;
        if (!barcode || barcode.trim() === '') barcode = '899' + Math.floor(1000000000 + Math.random() * 9000000000);
        db.prepare('INSERT INTO products (barcode, name, category_id, price_buy, price_sell, stock) VALUES (?, ?, ?, ?, ?, ?)').run(barcode, name, category_id, price_buy, price_sell, stock);
        res.redirect('/produk');
    } catch (err) { res.status(500).send("Gagal: Barcode sudah digunakan!"); }
});
app.post('/produk/edit', (req, res) => {
    try { db.prepare('UPDATE products SET barcode=?, name=?, category_id=?, price_buy=?, price_sell=?, stock=? WHERE id=?').run(req.body.barcode, req.body.name, req.body.category_id, req.body.price_buy, req.body.price_sell, req.body.stock, req.body.id); res.redirect('/produk'); } catch (err) { res.status(500).send(err.message); }
});
app.post('/produk/delete', (req, res) => {
    try { db.prepare('DELETE FROM products WHERE id=?').run(req.body.id); res.redirect('/produk'); } catch (err) { res.status(500).send(err.message); }
});

// STOK OPNAME
app.get('/opname', (req, res) => {
    const products = db.prepare('SELECT * FROM products ORDER BY name ASC').all();
    const opnames = db.prepare('SELECT o.*, p.name as product_name, u.name as user_name FROM stock_opnames o LEFT JOIN products p ON o.product_id = p.id LEFT JOIN users u ON o.user_id = u.id ORDER BY o.id DESC LIMIT 100').all();
    res.render('opname/index', { products, opnames });
});
app.post('/opname/add', (req, res) => {
    try {
        const { product_id, stock_real, notes } = req.body;
        const p = db.prepare('SELECT stock FROM products WHERE id=?').get(product_id);
        const stock_system = p ? p.stock : 0;
        const diff = parseInt(stock_real) - stock_system;

        const transaction = db.transaction(() => {
            db.prepare('INSERT INTO stock_opnames (product_id, stock_system, stock_real, difference, notes, user_id, branch_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
              .run(product_id, stock_system, stock_real, diff, notes, req.session.user.id, req.session.user.branch_id || 1);
            db.prepare('UPDATE products SET stock = ? WHERE id = ?').run(stock_real, product_id);
        });
        transaction();
        res.redirect('/opname');
    } catch (err) { res.status(500).send(err.message); }
});

// PELANGGAN CRUD
app.get('/pelanggan', (req, res) => {
  const customers = db.prepare('SELECT * FROM customers ORDER BY id DESC').all();
  res.render('pelanggan/index', { customers });
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
    if (user.role === 'Manager Cabang') {
        query += 'WHERE e.branch_id = ' + user.branch_id + ' ';
    }
    query += 'ORDER BY e.id DESC';
    const expenses = db.prepare(query).all();
    res.render('pengeluaran/index', { expenses });
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
    res.render('penggajian/index', { users, payrolls });
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
    res.render('voucher/index', { vouchers });
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
    if (filter === 'hari_ini') {
        whereConditions.push("date(s.date, 'localtime') = date('now', 'localtime')");
    } else if (filter === 'bulan_ini') {
        whereConditions.push("strftime('%Y-%m', s.date, 'localtime') = strftime('%Y-%m', 'now', 'localtime')");
    }

    if (user.role !== 'Administrator') {
        whereConditions.push("s.branch_id = " + user.branch_id);
    }

    const whereClause = whereConditions.length > 0 ? "WHERE " + whereConditions.join(" AND ") : "";
    const sales = db.prepare("SELECT s.*, u.name as kasir, b.name as branch_name FROM sales s LEFT JOIN users u ON s.user_id = u.id LEFT JOIN branches b ON s.branch_id = b.id " + whereClause + " ORDER BY s.date DESC LIMIT 500").all();
    
    let totalCogs = 0;
    sales.forEach(s => {
        const items = db.prepare("SELECT SUM(COALESCE(NULLIF(si.cogs, 0), p.price_buy, 0) * si.qty) as cogs_total FROM sale_items si LEFT JOIN products p ON si.product_id = p.id WHERE si.sale_id = ?").get(s.id);
        totalCogs += (items ? (items.cogs_total || 0) : 0);
    });

    const totalRp = sales.reduce((sum, item) => sum + (item.total || 0), 0);
    const labaKotor = totalRp - totalCogs;

    let expWhereConditions = [];
    if (filter === 'hari_ini') expWhereConditions.push("date(date, 'localtime') = date('now', 'localtime')");
    else if (filter === 'bulan_ini') expWhereConditions.push("strftime('%Y-%m', date, 'localtime') = strftime('%Y-%m', 'now', 'localtime')");
    
    if (user.role !== 'Administrator') {
        expWhereConditions.push("branch_id = " + user.branch_id);
    }

    const expWhere = expWhereConditions.length > 0 ? "WHERE " + expWhereConditions.join(" AND ") : "";
    const expTotal = db.prepare("SELECT SUM(amount) as total FROM expenses " + expWhere).get().total || 0;
    
    let payTotal = 0;
    if (user.role === 'Administrator') {
        let payWhere = filter === 'hari_ini' ? "WHERE date(date, 'localtime') = date('now', 'localtime')" : (filter === 'bulan_ini' ? "WHERE strftime('%Y-%m', date, 'localtime') = strftime('%Y-%m', 'now', 'localtime')" : "");
        payTotal = db.prepare("SELECT SUM(amount) as total FROM payroll " + payWhere).get().total || 0;
    }
    
    const labaBersih = labaKotor - expTotal - payTotal;
    const settings = db.prepare('SELECT * FROM settings LIMIT 1').get();

    res.render('laporan/index', { sales, filter, totalRp, totalTx: sales.length, totalCogs, labaKotor, expTotal, payTotal, labaBersih, settings });
});

// PENGGUNA (Manager Cabang Bisa Buat Akun Kasir Cabangnya)
app.get('/pengguna', isManagerOrAdmin, (req, res) => {
    const user = req.session.user;
    let query = 'SELECT u.*, b.name as branch_name FROM users u LEFT JOIN branches b ON u.branch_id = b.id ';
    if (user.role === 'Manager Cabang') {
        query += 'WHERE u.branch_id = ' + user.branch_id + ' ';
    }
    query += 'ORDER BY u.id ASC';
    const users = db.prepare(query).all();
    const branches = db.prepare('SELECT * FROM branches WHERE is_active = 1').all();
    res.render('pengguna/index', { users, branches });
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
    res.render('pengaturan/index', { settings });
});

app.post('/pengaturan/update', isAdmin, upload.single('logo'), (req, res) => {
    try {
        const { store_name, phone, address, receipt_footer, receipt_note, id } = req.body;
        if (req.file) {
            const logoPath = '/uploads/' + req.file.filename;
            db.prepare('UPDATE settings SET store_name=?, phone=?, address=?, receipt_footer=?, receipt_note=?, logo=? WHERE id=?')
              .run(store_name, phone, address, receipt_footer, receipt_note, logoPath, id);
        } else {
            db.prepare('UPDATE settings SET store_name=?, phone=?, address=?, receipt_footer=?, receipt_note=? WHERE id=?')
              .run(store_name, phone, address, receipt_footer, receipt_note, id);
        }
        res.redirect('/pengaturan');
    } catch (err) { res.status(500).send(err.message); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('[SERVER] KASIR POS berjalan di http://localhost:' + PORT));