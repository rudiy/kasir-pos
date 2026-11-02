const db = require('../../config/database');
const bcrypt = require('bcryptjs');

const ensureStockRows = (branchIds, productIds) => {
  const toList = (value) => (Array.isArray(value) ? value : [value]).map(Number).filter(Number.isInteger);
  const branches = toList(branchIds);
  const products = toList(productIds);
  if (branches.length === 0 || products.length === 0) return 0;

  const insert = db.prepare('INSERT OR IGNORE INTO stock_per_branch (product_id, branch_id, stock, min_stock) VALUES (?, ?, 0, COALESCE((SELECT min_stock FROM products WHERE id = ?), 5))');
  const before = db.prepare('SELECT COUNT(*) AS c FROM stock_per_branch').get().c;
  db.transaction(() => {
    for (const productId of products) {
      for (const branchId of branches) insert.run(productId, branchId, productId);
    }
  })();
  return db.prepare('SELECT COUNT(*) AS c FROM stock_per_branch').get().c - before;
};

const initDB = () => {
  const schema = `
    CREATE TABLE IF NOT EXISTS branches (
      id INTEGER PRIMARY KEY AUTOINCREMENT, 
      code TEXT UNIQUE, 
      name TEXT, 
      address TEXT, 
      phone TEXT, 
      pic_name TEXT, 
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, 
      username TEXT UNIQUE, 
      password TEXT, 
      role TEXT, 
      name TEXT, 
      branch_id INTEGER DEFAULT 1, 
      is_active INTEGER DEFAULT 1, 
      force_pass_change INTEGER DEFAULT 1,
      FOREIGN KEY(branch_id) REFERENCES branches(id)
    );

    CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, description TEXT);
    
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT, 
      barcode TEXT UNIQUE, 
      name TEXT, 
      category_id INTEGER, 
      unit_id INTEGER, 
      price_buy REAL, 
      price_sell REAL, 
      stock INTEGER DEFAULT 0, 
      min_stock INTEGER DEFAULT 5,  
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS customers (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE, name TEXT, phone TEXT, address TEXT);
    
    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT, 
      invoice_no TEXT UNIQUE, 
      date DATETIME DEFAULT CURRENT_TIMESTAMP, 
      user_id INTEGER, 
      branch_id INTEGER DEFAULT 1,
      subtotal REAL DEFAULT 0,
      discount REAL DEFAULT 0,
      tax REAL DEFAULT 0,
      total REAL, 
      payment_method TEXT, 
      payment_amount REAL, 
      return_amount REAL, 
      status TEXT,
      FOREIGN KEY(branch_id) REFERENCES branches(id)
    );

    CREATE TABLE IF NOT EXISTS sale_items (id INTEGER PRIMARY KEY AUTOINCREMENT, sale_id INTEGER, product_id INTEGER, qty INTEGER, price REAL, cogs REAL, subtotal REAL);
    
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT, 
      store_name TEXT, 
      address TEXT, 
      phone TEXT, 
      receipt_footer TEXT, 
      receipt_note TEXT,
      logo TEXT,
      tax_rate REAL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS stock_opnames (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER, stock_system INTEGER, stock_real INTEGER, difference INTEGER, notes TEXT, date DATETIME DEFAULT CURRENT_TIMESTAMP, user_id INTEGER, branch_id INTEGER DEFAULT 1);
    CREATE TABLE IF NOT EXISTS expenses (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, amount REAL, date DATETIME DEFAULT CURRENT_TIMESTAMP, user_id INTEGER, branch_id INTEGER DEFAULT 1, notes TEXT);
    CREATE TABLE IF NOT EXISTS payroll (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount REAL, month_year TEXT, date DATETIME DEFAULT CURRENT_TIMESTAMP, notes TEXT);
    CREATE TABLE IF NOT EXISTS vouchers (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE, value REAL, min_transaction REAL DEFAULT 0, is_active INTEGER DEFAULT 1);

    CREATE TABLE IF NOT EXISTS stock_per_branch (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      branch_id INTEGER NOT NULL,
      stock INTEGER DEFAULT 0,
      min_stock INTEGER DEFAULT 5,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(product_id, branch_id),
      FOREIGN KEY(product_id) REFERENCES products(id),
      FOREIGN KEY(branch_id) REFERENCES branches(id)
    );

    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      branch_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      qty_delta INTEGER NOT NULL,
      ref_id INTEGER,
      note TEXT,
      user_id INTEGER,
      date DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS stock_transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE,
      from_branch_id INTEGER NOT NULL,
      to_branch_id INTEGER NOT NULL,
      status TEXT DEFAULT 'PENDING',
      note TEXT,
      created_by INTEGER,
      received_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      received_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS stock_transfer_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transfer_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      qty INTEGER NOT NULL
    );
  `;
  db.exec(schema);

  const ensureColumn = (table, column, definition) => {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!columns.some(c => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  };

  ensureColumn('sales', 'subtotal', 'REAL DEFAULT 0');
  ensureColumn('sales', 'discount', 'REAL DEFAULT 0');
  ensureColumn('sales', 'tax', 'REAL DEFAULT 0');
  ensureColumn('settings', 'tax_rate', 'REAL DEFAULT 0');

  const checkBranch = db.prepare('SELECT * FROM branches WHERE id = 1').get();
  if(!checkBranch) {
    db.prepare('INSERT INTO branches (code, name, address, phone, pic_name, is_active) VALUES (?, ?, ?, ?, ?, ?)').run('CBG-001', 'Cabang Pusat', 'Jl. Jenderal Sudirman No. 1', '08123456789', 'Super Admin', 1);
  }

  const checkSettings = db.prepare('SELECT * FROM settings LIMIT 1').get();
  if(!checkSettings) {
    db.prepare('INSERT INTO settings (store_name, address, phone, receipt_footer, receipt_note) VALUES (?, ?, ?, ?, ?)').run('KASIR POS', 'Jl. Contoh No. 123', '08123456789', 'Terima Kasih Atas Kunjungan Anda', 'NOTED: Barang yang sudah dibeli tidak dapat dikembalikan.');
  }

  const checkAdmin = db.prepare('SELECT * FROM users WHERE username = ?').get('admin');
  if (!checkAdmin) {
    const hash = bcrypt.hashSync('admin12345', 10);
    db.prepare('INSERT INTO users (username, password, role, name, branch_id) VALUES (?, ?, ?, ?, ?)').run('admin', hash, 'Administrator', 'Super Admin', 1);
    db.prepare('INSERT INTO categories (name) VALUES (?), (?)').run('Umum', 'Makanan');
  }
  const branchIds = db.prepare('SELECT id FROM branches').all().map(b => b.id);
  const productIds = db.prepare('SELECT id FROM products').all().map(p => p.id);
  const isFirstMigration = db.prepare('SELECT COUNT(*) AS c FROM stock_movements').get().c === 0;

  ensureStockRows(branchIds, productIds);

  if (isFirstMigration && branchIds.length > 0 && productIds.length > 0) {
    const homeBranchId = Math.min(...branchIds);
    const legacy = db.prepare('SELECT id, stock FROM products WHERE stock > 0').all();
    const setStock = db.prepare('UPDATE stock_per_branch SET stock = ?, updated_at = CURRENT_TIMESTAMP WHERE product_id = ? AND branch_id = ?');
    const addMovement = db.prepare('INSERT INTO stock_movements (product_id, branch_id, type, qty_delta, ref_id, note, user_id) VALUES (?, ?, ?, ?, NULL, ?, NULL)');
    db.transaction(() => {
      for (const row of legacy) {
        setStock.run(row.stock, row.id, homeBranchId);
        addMovement.run(row.id, homeBranchId, 'OPENING', row.stock, 'Stok awal dipindah dari data lama (cabang lain mulai dari 0, silakan opname).');
        db.prepare('UPDATE products SET stock = 0 WHERE id = ?').run(row.id);
      }
    })();
  }
};

module.exports = initDB;
module.exports.ensureStockRows = ensureStockRows;