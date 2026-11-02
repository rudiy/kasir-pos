const fs = require('fs');
const path = require('path');

console.log("Memulai proses update Fase 7 (Hak Akses Finansial Kasir & Sinkronisasi HPP)...");

const files = {};

// 1. UPDATE SERVER.JS (Sinkronisasi HPP & Otorisasi Dashboard / Laporan per Role)
files['server.js'] = `
const express = require('express');
const session = require('express-session');
const path = require('path');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
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

const { isAuthenticated } = require('./middleware/auth');
const isAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'Administrator') return next();
    res.status(403).send('<h1>Akses Ditolak</h1><p>Hanya Administrator / Pemilik Toko yang dapat mengakses halaman ini.</p><a href="/">Kembali</a>');
};

app.get('/login', (req, res) => res.render('auth/login', { error: null }));
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username);
  if (user && bcrypt.compareSync(password, user.password)) {
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
    next(); 
});

// DASHBOARD (Disesuaikan Per Role)
app.get('/', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const salesToday = db.prepare("SELECT SUM(total) as total, COUNT(id) as count FROM sales WHERE date(date, 'localtime') = ?").get(today) || {total:0, count:0};
  const productCount = db.prepare('SELECT COUNT(*) as count FROM products').get();
  
  // Data Khusus Admin
  let expToday = 0;
  let profitToday = 0;
  if (req.session.user.role === 'Administrator') {
      expToday = db.prepare("SELECT SUM(amount) as total FROM expenses WHERE date(date, 'localtime') = ?").get(today).total || 0;
      
      const salesTodayItems = db.prepare("SELECT s.id, s.total FROM sales s WHERE date(s.date, 'localtime') = ?").all(today);
      let cogsToday = 0;
      salesTodayItems.forEach(s => {
          const itemCogs = db.prepare("SELECT SUM(COALESCE(NULLIF(si.cogs, 0), p.price_buy, 0) * si.qty) as total FROM sale_items si LEFT JOIN products p ON si.product_id = p.id WHERE si.sale_id = ?").get(s.id);
          cogsToday += (itemCogs ? (itemCogs.total || 0) : 0);
      });
      profitToday = (salesToday.total || 0) - cogsToday - expToday;
  }

  res.render('dashboard/index', { salesToday, productCount, expToday, profitToday });
});

// POS / KASIR
app.get('/kasir', (req, res) => {
  const products = db.prepare('SELECT * FROM products WHERE is_active = 1 AND stock > 0').all();
  const settings = db.prepare('SELECT * FROM settings LIMIT 1').get();
  const vouchers = db.prepare('SELECT * FROM vouchers WHERE is_active = 1').all();
  res.render('kasir/index', { products, settings, vouchers });
});

app.post('/api/checkout', (req, res) => {
  const { cart, paymentMethod, paymentAmount, total } = req.body;
  const invoiceNo = 'INV-' + Date.now();
  const transaction = db.transaction(() => {
    const returnAmount = paymentAmount - total;
    const sale = db.prepare('INSERT INTO sales (invoice_no, user_id, total, payment_method, payment_amount, return_amount, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(invoiceNo, req.session.user.id, total, paymentMethod, paymentAmount, returnAmount, 'LUNAS');
    
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
            db.prepare('INSERT INTO stock_opnames (product_id, stock_system, stock_real, difference, notes, user_id) VALUES (?, ?, ?, ?, ?, ?)')
              .run(product_id, stock_system, stock_real, diff, notes, req.session.user.id);
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

// PENGELUARAN (Admin Only)
app.get('/pengeluaran', isAdmin, (req, res) => {
    const expenses = db.prepare('SELECT e.*, u.name as user_name FROM expenses e LEFT JOIN users u ON e.user_id = u.id ORDER BY e.id DESC').all();
    res.render('pengeluaran/index', { expenses });
});
app.post('/pengeluaran/add', isAdmin, (req, res) => {
    try {
        db.prepare('INSERT INTO expenses (title, amount, notes, user_id) VALUES (?, ?, ?, ?)').run(req.body.title, req.body.amount, req.body.notes, req.session.user.id);
        res.redirect('/pengeluaran');
    } catch (err) { res.status(500).send(err.message); }
});
app.post('/pengeluaran/delete', isAdmin, (req, res) => {
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

// VOUCHER / DISKON (Admin Only)
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

// LAPORAN (Perhitungan HPP Ter-sinkronisasi)
app.get('/laporan', (req, res) => {
    const filter = req.query.filter || 'hari_ini';
    let whereClause = "";
    if (filter === 'hari_ini') {
        whereClause = "WHERE date(s.date, 'localtime') = date('now', 'localtime')";
    } else if (filter === 'bulan_ini') {
        whereClause = "WHERE strftime('%Y-%m', s.date, 'localtime') = strftime('%Y-%m', 'now', 'localtime')";
    }

    const sales = db.prepare(\`SELECT s.*, u.name as kasir FROM sales s LEFT JOIN users u ON s.user_id = u.id \${whereClause} ORDER BY s.date DESC LIMIT 500\`).all();
    
    // Perhitungan Sinkronisasi HPP (Menggunakan Fallback price_buy dari tabel products jika cogs di sale_items bernilai 0/null)
    let totalCogs = 0;
    sales.forEach(s => {
        const items = db.prepare(\`
            SELECT SUM(COALESCE(NULLIF(si.cogs, 0), p.price_buy, 0) * si.qty) as cogs_total 
            FROM sale_items si 
            LEFT JOIN products p ON si.product_id = p.id 
            WHERE si.sale_id = ?
        \`).get(s.id);
        totalCogs += (items ? (items.cogs_total || 0) : 0);
    });

    const totalRp = sales.reduce((sum, item) => sum + (item.total || 0), 0);
    const labaKotor = totalRp - totalCogs;

    let expWhere = "", payWhere = "";
    if (filter === 'hari_ini') {
        expWhere = "WHERE date(date, 'localtime') = date('now', 'localtime')";
        payWhere = "WHERE date(date, 'localtime') = date('now', 'localtime')";
    } else if (filter === 'bulan_ini') {
        expWhere = "WHERE strftime('%Y-%m', date, 'localtime') = strftime('%Y-%m', 'now', 'localtime')";
        payWhere = "WHERE strftime('%Y-%m', date, 'localtime') = strftime('%Y-%m', 'now', 'localtime')";
    }

    const expTotal = db.prepare(\`SELECT SUM(amount) as total FROM expenses \${expWhere}\`).get().total || 0;
    const payTotal = db.prepare(\`SELECT SUM(amount) as total FROM payroll \${payWhere}\`).get().total || 0;
    
    const labaBersih = labaKotor - expTotal - payTotal;
    const settings = db.prepare('SELECT store_name FROM settings LIMIT 1').get();

    res.render('laporan/index', { sales, filter, totalRp, totalTx: sales.length, totalCogs, labaKotor, expTotal, payTotal, labaBersih, settings });
});

// MANAJEMEN PENGGUNA & PENGATURAN
app.get('/pengguna', isAdmin, (req, res) => {
    const users = db.prepare('SELECT id, username, name, role, is_active FROM users ORDER BY id ASC').all();
    res.render('pengguna/index', { users });
});
app.post('/pengguna/add', isAdmin, (req, res) => {
    try {
        const hash = bcrypt.hashSync(req.body.password, 10);
        db.prepare('INSERT INTO users (username, password, name, role) VALUES (?, ?, ?, ?)').run(req.body.username, hash, req.body.name, req.body.role);
        res.redirect('/pengguna');
    } catch (err) { res.status(500).send("Gagal: Username mungkin sudah digunakan."); }
});
app.post('/pengguna/edit', isAdmin, (req, res) => {
    try {
        if(req.body.password) {
            const hash = bcrypt.hashSync(req.body.password, 10);
            db.prepare('UPDATE users SET username=?, name=?, role=?, password=? WHERE id=?').run(req.body.username, req.body.name, req.body.role, hash, req.body.id);
        } else {
            db.prepare('UPDATE users SET username=?, name=?, role=? WHERE id=?').run(req.body.username, req.body.name, req.body.role, req.body.id);
        }
        res.redirect('/pengguna');
    } catch (err) { res.status(500).send(err.message); }
});
app.post('/pengguna/delete', isAdmin, (req, res) => {
    try {
        if(req.body.id == req.session.user.id) return res.send("Tidak bisa menghapus akun sendiri!");
        db.prepare('DELETE FROM users WHERE id=?').run(req.body.id); res.redirect('/pengguna');
    } catch (err) { res.status(500).send(err.message); }
});

app.get('/pengaturan', isAdmin, (req, res) => {
    const settings = db.prepare('SELECT * FROM settings LIMIT 1').get();
    res.render('pengaturan/index', { settings });
});
app.post('/pengaturan/update', isAdmin, (req, res) => {
    try {
        db.prepare('UPDATE settings SET store_name=?, phone=?, address=?, receipt_footer=? WHERE id=?').run(req.body.store_name, req.body.phone, req.body.address, req.body.receipt_footer, req.body.id);
        res.redirect('/pengaturan');
    } catch (err) { res.status(500).send(err.message); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(\`[SERVER] KASIR POS berjalan di http://localhost:\${PORT}\`));
`;

// 2. UPDATE DASHBOARD (Disesuaikan dengan Role User)
files['views/dashboard/index.ejs'] = `
<%- include('../layouts/header') %>
<div class='p-4'>
  <h2>Dashboard Overview</h2>
  <p class='text-muted'>Selamat datang kembali, <strong><%= user.name %></strong> (<%= user.role %>)</p>
  
  <div class='row mt-4'>
    <div class='col-md-4 mb-3'>
      <div class='card bg-primary text-white shadow-sm h-100'>
        <div class='card-body'>
          <h5>Penjualan Hari Ini</h5>
          <h3>Rp <%= salesToday.total ? salesToday.total.toLocaleString('id-ID') : 0 %></h3>
          <small><%= salesToday.count %> Transaksi Terproses</small>
        </div>
      </div>
    </div>

    <% if(isAdmin) { %>
    <!-- Kartu Khusus Super Admin / Pemilik -->
    <div class='col-md-4 mb-3'>
      <div class='card bg-danger text-white shadow-sm h-100'>
        <div class='card-body'>
          <h5>Pengeluaran Hari Ini</h5>
          <h3>Rp <%= expToday.toLocaleString('id-ID') %></h3>
          <small>Operasional Toko</small>
        </div>
      </div>
    </div>
    <div class='col-md-4 mb-3'>
      <div class='card bg-success text-white shadow-sm h-100'>
        <div class='card-body'>
          <h5>Estimasi Laba Hari Ini</h5>
          <h3>Rp <%= profitToday.toLocaleString('id-ID') %></h3>
          <small>Omset - HPP - Pengeluaran</small>
        </div>
      </div>
    </div>
    <% } else { %>
    <!-- Kartu Tambahan Kasir -->
    <div class='col-md-4 mb-3'>
      <div class='card bg-info text-dark shadow-sm h-100'>
        <div class='card-body'>
          <h5>Total Transaksi Kasir</h5>
          <h3><%= salesToday.count %></h3>
          <small>Transaksi sukses hari ini</small>
        </div>
      </div>
    </div>
    <% } %>

    <div class='col-md-4 mb-3'>
      <div class='card bg-dark text-white shadow-sm h-100'>
        <div class='card-body'>
          <h5>Jumlah Produk Aktif</h5>
          <h3><%= productCount.count %> SKU</h3>
          <small>Master Data Produk</small>
        </div>
      </div>
    </div>
  </div>
</div>
<%- include('../layouts/footer') %>
`;

// 3. UPDATE LAPORAN (Privasi Finansial per Role & HPP Ter-sinkronisasi)
files['views/laporan/index.ejs'] = `
<%- include('../layouts/header') %>
<div class='p-4'>
  <div class='d-flex justify-content-between align-items-center mb-3 no-print'>
    <h2>Laporan Penjualan <%= isAdmin ? "& Laba Bersih" : "" %></h2>
    <div>
        <button class='btn btn-outline-dark me-2' onclick='printThermalReport()'><i class='bi bi-receipt'></i> Cetak Struk Thermal (58mm)</button>
        <button class='btn btn-outline-success' onclick='window.print()'><i class='bi bi-file-earmark-pdf'></i> Cetak PDF / A4</button>
    </div>
  </div>

  <div class='btn-group mb-4 no-print' role='group'>
    <a href='/laporan?filter=hari_ini' class='btn <%= filter === "hari_ini" ? "btn-primary" : "btn-outline-primary" %>'>Hari Ini</a>
    <a href='/laporan?filter=bulan_ini' class='btn <%= filter === "bulan_ini" ? "btn-primary" : "btn-outline-primary" %>'>Bulan Ini</a>
    <a href='/laporan?filter=semua' class='btn <%= filter === "semua" ? "btn-primary" : "btn-outline-primary" %>'>Semua Transaksi</a>
  </div>

  <% if(isAdmin) { %>
  <!-- Kartu Finansial Khusus Super Admin / Pemilik Toko -->
  <div class='row mb-4'>
    <div class='col-md-3 mb-2'>
        <div class='card bg-light border-0 shadow-sm'>
            <div class='card-body'>
                <h6 class='text-muted small'>Omset Penjualan</h6>
                <h4 class='fw-bold text-primary mb-0'>Rp <%= totalRp.toLocaleString('id-ID') %></h4>
            </div>
        </div>
    </div>
    <div class='col-md-3 mb-2'>
        <div class='card bg-light border-0 shadow-sm'>
            <div class='card-body'>
                <h6 class='text-muted small'>Total HPP (Modal Beli)</h6>
                <h4 class='fw-bold text-secondary mb-0'>Rp <%= totalCogs.toLocaleString('id-ID') %></h4>
            </div>
        </div>
    </div>
    <div class='col-md-3 mb-2'>
        <div class='card bg-light border-0 shadow-sm'>
            <div class='card-body'>
                <h6 class='text-muted small'>Pengeluaran + Gaji</h6>
                <h4 class='fw-bold text-danger mb-0'>Rp <%= (expTotal + payTotal).toLocaleString('id-ID') %></h4>
            </div>
        </div>
    </div>
    <div class='col-md-3 mb-2'>
        <div class='card bg-success text-white border-0 shadow-sm'>
            <div class='card-body'>
                <h6 class='small'>LABA BERSIH</h6>
                <h3 class='fw-bold mb-0'>Rp <%= labaBersih.toLocaleString('id-ID') %></h3>
            </div>
        </div>
    </div>
  </div>
  <% } else { %>
  <!-- Kartu Ringkasan Operasional untuk Role Kasir -->
  <div class='row mb-4'>
    <div class='col-md-6 mb-2'>
        <div class='card bg-primary text-white border-0 shadow-sm'>
            <div class='card-body'>
                <h6>Total Omset Penjualan</h6>
                <h3 class='fw-bold mb-0'>Rp <%= totalRp.toLocaleString('id-ID') %></h3>
            </div>
        </div>
    </div>
    <div class='col-md-6 mb-2'>
        <div class='card bg-light border-0 shadow-sm'>
            <div class='card-body'>
                <h6 class='text-muted'>Jumlah Transaksi Terproses</h6>
                <h3 class='fw-bold mb-0'><%= totalTx %> Transaksi</h3>
            </div>
        </div>
    </div>
  </div>
  <% } %>

  <!-- Data Tabel Laporan -->
  <div class='card shadow-sm'>
    <div class='card-body table-responsive p-0'>
      <table class='table table-hover align-middle mb-0'>
        <thead class='table-dark'>
          <tr>
            <th>Tgl / Waktu</th>
            <th>No. Nota</th>
            <th>Kasir</th>
            <th>Metode</th>
            <th class='text-end'>Total Transaksi</th>
          </tr>
        </thead>
        <tbody>
          <% if(sales.length > 0) { sales.forEach(s => { %>
            <tr>
              <td><%= new Date(s.date).toLocaleString('id-ID') %></td>
              <td><strong><%= s.invoice_no %></strong></td>
              <td><%= s.kasir || 'Admin' %></td>
              <td><span class='badge bg-secondary'><%= s.payment_method %></span></td>
              <td class='text-end fw-bold'>Rp <%= s.total.toLocaleString('id-ID') %></td>
            </tr>
          <% }) } else { %>
            <tr><td colspan='5' class='text-center p-4 text-muted'>Tidak ada transaksi pada periode ini.</td></tr>
          <% } %>
        </tbody>
      </table>
    </div>
  </div>
</div>

<div id='print-area' style='display:none;'></div>

<script>
function printThermalReport() {
  const pa = document.getElementById('print-area');
  pa.style.display = 'block';
  const now = new Date();
  const isAdminUser = <%= isAdmin ? 'true' : 'false' %>;

  let h = \`<div style='text-align:center;'><strong><%= settings.store_name %></strong><br>LAPORAN REKAP (<%= filter.toUpperCase() %>)<br><small>\${now.toLocaleString('id-ID')}</small></div><hr style='border-top:1px dashed #000;'>\`;
  h += \`<div style='display:flex; justify-content:space-between;'><span>Total Tx</span><span><%= totalTx %></span></div>\`;
  h += \`<div style='display:flex; justify-content:space-between;'><span>Omset</span><span>Rp <%= totalRp.toLocaleString('id-ID') %></span></div>\`;
  
  if (isAdminUser) {
    h += \`<div style='display:flex; justify-content:space-between;'><span>HPP</span><span>Rp <%= totalCogs.toLocaleString('id-ID') %></span></div>\`;
    h += \`<div style='display:flex; justify-content:space-between;'><span>Laba Kotor</span><span>Rp <%= labaKotor.toLocaleString('id-ID') %></span></div>\`;
    h += \`<div style='display:flex; justify-content:space-between;'><span>Pengeluaran</span><span>Rp <%= expTotal.toLocaleString('id-ID') %></span></div>\`;
    h += \`<div style='display:flex; justify-content:space-between;'><span>Gaji</span><span>Rp <%= payTotal.toLocaleString('id-ID') %></span></div>\`;
    h += \`<hr style='border-top:1px dashed #000;'><div style='display:flex; justify-content:space-between;'><strong>LABA BERSIH</strong><strong>Rp <%= labaBersih.toLocaleString('id-ID') %></strong></div>\`;
  }

  h += \`<hr style='border-top:1px dashed #000;'><div style='text-align:center;'>--- SELESAI ---</div>\`;
  pa.innerHTML = h;
  document.body.classList.add('print-receipt-mode');
  window.print();
  document.body.classList.remove('print-receipt-mode');
  pa.style.display = 'none';
}
</script>
<%- include('../layouts/footer') %>
`;

// EKSEKUSI PENULISAN FILE
for (const [filepath, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(__dirname, filepath), content.trim(), 'utf8');
    console.log(`[UPDATE] File diperbarui: ${filepath}`);
}

console.log("\n========================================================");
console.log(" UPDATE FASE 7 BERHASIL: HAK AKSES FINANSIAL & HPP FIX ");
console.log("========================================================");
console.log("Silakan jalankan ulang server Anda dengan perintah: npm start");