const db = require('../../config/database');
const bcrypt = require('bcryptjs');

const initDB = () => {
  const schema = `
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, role TEXT, name TEXT, is_active INTEGER DEFAULT 1, force_pass_change INTEGER DEFAULT 1);
    CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, description TEXT);
    CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, barcode TEXT UNIQUE, name TEXT, category_id INTEGER, unit_id INTEGER, price_buy REAL, price_sell REAL, stock INTEGER DEFAULT 0, min_stock INTEGER DEFAULT 5, is_active INTEGER DEFAULT 1);
    CREATE TABLE IF NOT EXISTS customers (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE, name TEXT, phone TEXT, address TEXT);
    CREATE TABLE IF NOT EXISTS sales (id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_no TEXT UNIQUE, date DATETIME DEFAULT CURRENT_TIMESTAMP, user_id INTEGER, total REAL, payment_method TEXT, payment_amount REAL, return_amount REAL, status TEXT);
    CREATE TABLE IF NOT EXISTS sale_items (id INTEGER PRIMARY KEY AUTOINCREMENT, sale_id INTEGER, product_id INTEGER, qty INTEGER, price REAL, cogs REAL, subtotal REAL);
    CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY AUTOINCREMENT, store_name TEXT, address TEXT, phone TEXT, receipt_footer TEXT, tax_rate REAL DEFAULT 0);
    
    -- TABEL BARU FASE 6 --
    CREATE TABLE IF NOT EXISTS stock_opnames (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER, stock_system INTEGER, stock_real INTEGER, difference INTEGER, notes TEXT, date DATETIME DEFAULT CURRENT_TIMESTAMP, user_id INTEGER);
    CREATE TABLE IF NOT EXISTS expenses (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, amount REAL, date DATETIME DEFAULT CURRENT_TIMESTAMP, user_id INTEGER, notes TEXT);
    CREATE TABLE IF NOT EXISTS payroll (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount REAL, month_year TEXT, date DATETIME DEFAULT CURRENT_TIMESTAMP, notes TEXT);
    CREATE TABLE IF NOT EXISTS vouchers (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE, value REAL, min_transaction REAL DEFAULT 0, is_active INTEGER DEFAULT 1);
  `;
  db.exec(schema);
  const checkAdmin = db.prepare('SELECT * FROM users WHERE username = ?').get('admin');
  if (!checkAdmin) {
    const hash = bcrypt.hashSync('admin12345', 10);
    db.prepare('INSERT INTO users (username, password, role, name) VALUES (?, ?, ?, ?)').run('admin', hash, 'Administrator', 'Super Admin');
    db.prepare('INSERT INTO settings (store_name, address, phone) VALUES (?, ?, ?)').run('KASIR POS', 'Jl. Contoh No. 123', '08123456789');
    db.prepare('INSERT INTO categories (name) VALUES (?), (?)').run('Umum', 'Makanan');
  }
};
module.exports = initDB;