const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, '..', 'database', 'kasir.db');
const db = new Database(dbPath);
const result = db.pragma('wal_checkpoint(TRUNCATE)');
db.close();

const [row] = result;
console.log('[checkpoint] busy=' + row.busy + ' log=' + row.log + ' checkpointed=' + row.checkpointed);
if (row.busy === 1) {
    console.error('Gagal: database masih dipakai proses lain. Matikan server/nodemon dulu, lalu ulangi.');
    process.exit(1);
}
console.log('[checkpoint] isi kasir.db-wal sudah dipindah ke database/kasir.db');
