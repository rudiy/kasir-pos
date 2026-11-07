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
      voided_at DATETIME,
      voided_by INTEGER,
      void_reason TEXT,
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

    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS data_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      aksi TEXT NOT NULL,
      backup_file TEXT,
      baris_terhapus INTEGER DEFAULT 0,
      keterangan TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
  ensureColumn('sales', 'voided_at', 'DATETIME');
  ensureColumn('sales', 'voided_by', 'INTEGER');
  ensureColumn('sales', 'void_reason', 'TEXT');
  ensureColumn('sales', 'customer_id', 'INTEGER');
  ensureColumn('branches', 'qris_image', 'TEXT');
  // Jejak audit diskon: voucher_id saja tidak cukup karena voucher boleh dihapus kapan pun
  // oleh admin, jadi kodenya ikut dibekukan sebagai teks saat nota dibuat. Tanpa snapshot,
  // nota lama kehilangan penjelasan kenapa angkanya lebih kecil.
  ensureColumn('sales', 'voucher_id', 'INTEGER');
  ensureColumn('sales', 'voucher_code', 'TEXT');
  // Cadangan harian ke email. Kolomnya cuma alamat + jam; kredensial SMTP tinggal di .env
  // dan tidak pernah menyentuh database, jadi arsip maupun salinan database aman.
  ensureColumn('settings', 'backup_email', 'TEXT');
  ensureColumn('settings', 'backup_hour', 'INTEGER DEFAULT 22');
  // Kunci periode gaji. `month_year` tetap label manusia ("November 2026") untuk tampilan,
  // tapi laporan tidak punya apa pun untuk menggantung kecuali kolom itu berisi teks bebas —
  // dan sebelum kolom ini ada, gaji dibebankan ke TANGGAL INPUT, jadi gaji November yang
  // diinput 3 Desember masuk laba-rugi Desember.
  ensureColumn('payroll', 'period', 'TEXT');
  // Backfill sekali untuk baris lama. Label yang tidak terbaca persis sengaja dibiarkan NULL:
  // laporan akan jatuh ke bulan input untuk baris itu, yaitu perilaku sebelum perubahan ini,
  // daripada mengarang kunci bulan dari teks yang tidak jelas maksudnya.
  const NAMA_BULAN_LAMA = ['januari', 'februari', 'maret', 'april', 'mei', 'juni',
    'juli', 'agustus', 'september', 'oktober', 'november', 'desember'];
  for (const baris of db.prepare('SELECT id, month_year FROM payroll WHERE period IS NULL').all()) {
    const c = /^([A-Za-z]+) (\d{4})$/.exec(String(baris.month_year || '').trim());
    const ke = c ? NAMA_BULAN_LAMA.indexOf(c[1].toLowerCase()) : -1;
    if (ke >= 0) {
      db.prepare('UPDATE payroll SET period = ? WHERE id = ?')
        .run(c[2] + '-' + String(ke + 1).padStart(2, '0'), baris.id);
    }
  }

  // Rincian gaji untuk slip. `amount` TETAP jumlah yang dibayar dan tetap kolom yang
  // dijumlahkan laporan serta dashboard, jadi rincian baru ini menjelaskan angka itu,
  // bukan menggantikannya — tidak ada laporan yang harus ditinjau ulang.
  ensureColumn('payroll', 'gaji_pokok', 'REAL DEFAULT 0');
  ensureColumn('payroll', 'tunjangan', 'REAL DEFAULT 0');
  ensureColumn('payroll', 'bonus', 'REAL DEFAULT 0');
  ensureColumn('payroll', 'potongan', 'REAL DEFAULT 0');
  // Baris lama cuma punya satu angka, dan angka itu gaji pokoknya — bukan nol. `DEFAULT 0`
  // di atas membuat kolom barunya terisi 0 untuk semua baris lama, jadi pembedanya adalah
  // "pokok masih 0 sementara amount sudah ada".
  db.prepare('UPDATE payroll SET gaji_pokok = amount WHERE gaji_pokok = 0 AND amount > 0').run();

  const checkBranch = db.prepare('SELECT * FROM branches WHERE id = 1').get();
  if(!checkBranch) {
    db.prepare('INSERT INTO branches (code, name, address, phone, pic_name, is_active) VALUES (?, ?, ?, ?, ?, ?)').run('CBG-001', 'Cabang Pusat', 'Jl. Jenderal Sudirman No. 1', '08123456789', 'Super Admin', 1);
  }

  const checkSettings = db.prepare('SELECT * FROM settings LIMIT 1').get();
  if(!checkSettings) {
    db.prepare('INSERT INTO settings (store_name, address, phone, receipt_footer, receipt_note) VALUES (?, ?, ?, ?, ?)').run('KASIR POS', 'Jl. Contoh No. 123', '08123456789', 'Terima Kasih Atas Kunjungan Anda', 'NOTED: Barang yang sudah dibeli tidak dapat dikembalikan.');
  }

  // ---- sandi akun kunci boleh ditulis di .env ----
  // Operator yang lupa sandi super admin sebelumnya cuma punya satu jalan kembali: mengedit
  // database langsung. Sekarang .env yang dipakai:
  //   ADMIN_PASSWORD         → sandi akun 'admin' (Administrator)
  //   ADMIN_CABANG_USERNAME  → nama akun admin cabang, default 'admin_cabang'
  //   ADMIN_CABANG_PASSWORD  → sandinya; kosong artinya ikut ADMIN_PASSWORD
  //   ADMIN_CABANG_BRANCH    → id cabang akun itu, default 1
  // Reset baru jalan kalau kolomnya benar-benar diisi DAN isinya berubah sejak start terakhir
  // (bekas nilai yang sudah dipakai disimpan sebagai hash di app_state). Dua syarat itu yang
  // membuat upgrade dari versi lama tidak membuka lagi sandi default, dan membuat ganti sandi
  // dari halaman /ganti-sandi tidak tertimpa setiap restart. Jadi untuk memaksa reset lagi:
  // ubah dulu angkanya di .env (satu karakter pun cukup), lalu start ulang.
  const SANDI_BAWAAN = 'admin12345';
  const envBersih = (kunci) => (process.env[kunci] || '').trim();
  const sandiAdmin = envBersih('ADMIN_PASSWORD');
  const akunCabang = envBersih('ADMIN_CABANG_USERNAME') || 'admin_cabang';
  const sandiCabang = envBersih('ADMIN_CABANG_PASSWORD') || sandiAdmin;
  const cabangAdmin = Number(envBersih('ADMIN_CABANG_BRANCH')) || 1;

  const terapkanSandi = (username, password, role, nama) => {
    const hash = bcrypt.hashSync(password, 10);
    // Selama yang dipakai masih sandi default yang terdokumentasi, flag-nya tetap 1 supaya
    // login pertama diarahkan ke halaman ganti sandi seperti sebelumnya.
    const wajibGanti = password === SANDI_BAWAAN ? 1 : 0;
    const ada = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (ada) {
      db.prepare('UPDATE users SET password = ?, force_pass_change = ? WHERE id = ?').run(hash, wajibGanti, ada.id);
    } else {
      db.prepare('INSERT INTO users (username, password, role, name, branch_id, force_pass_change) VALUES (?, ?, ?, ?, ?, ?)')
        .run(username, hash, role, nama, cabangAdmin, wajibGanti);
    }
  };

  const checkAdmin = db.prepare('SELECT * FROM users WHERE username = ?').get('admin');
  if (!checkAdmin) {
    const hash = bcrypt.hashSync(sandiAdmin || SANDI_BAWAAN, 10);
    db.prepare('INSERT INTO users (username, password, role, name, branch_id) VALUES (?, ?, ?, ?, ?)').run('admin', hash, 'Administrator', 'Super Admin', 1);
    db.prepare('INSERT INTO categories (name) VALUES (?), (?)').run('Umum', 'Makanan');
  }

  if (sandiAdmin || sandiCabang) {
    const tanda = [sandiAdmin, akunCabang, sandiCabang, cabangAdmin].join('\u0000');
    const stempel = db.prepare("SELECT value FROM app_state WHERE key = 'sandi_bawaan'").get();
    if (!stempel || !bcrypt.compareSync(tanda, stempel.value)) {
      if (sandiAdmin) terapkanSandi('admin', sandiAdmin, 'Administrator', 'Super Admin');
      if (sandiCabang) terapkanSandi(akunCabang, sandiCabang, 'Manager Cabang', 'Admin Cabang');
      db.prepare("INSERT INTO app_state (key, value) VALUES ('sandi_bawaan', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(bcrypt.hashSync(tanda, 10));
    }
  }

  // Kolom force_pass_change sudah ada sejak skema awal tetapi tidak pernah dibaca.
  // Sekarang penjaga login memakainya, jadi akun lama yang sudah meninggalkan sandi
  // bawaan dibersihkan flag-nya; yang masih memakai sandi bawaan tetap dipaksa ganti.
  const flagged = db.prepare('SELECT id, password FROM users WHERE force_pass_change = 1').all();
  const clearFlag = db.prepare('UPDATE users SET force_pass_change = 0 WHERE id = ?');
  for (const row of flagged) {
    if (!bcrypt.compareSync(SANDI_BAWAAN, row.password)) clearFlag.run(row.id);
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