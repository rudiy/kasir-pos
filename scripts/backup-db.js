const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..');
const backupDir = process.env.BACKUP_DIR
    ? path.resolve(process.env.BACKUP_DIR)
    : path.join(ROOT, 'backup');
const keepCount = (() => {
    const raw = Number(process.env.BACKUP_KEEP ?? 14);
    return Number.isInteger(raw) && raw >= 1 ? raw : 14;
})();

// Nama file pakai waktu WIB supaya sama dengan tanggal yang terbaca di laporan.
function stampWIB(date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jakarta', hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).formatToParts(date).reduce((acc, p) => (acc[p.type] = p.value, acc), {});
    return `${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}`;
}

let running = false;

// backup() memakai API SQLite online backup, jadi boleh dipanggil saat server kasir
// tetap berjalan dan transaksi sedang masuk; tidak perlu menyalin file manual.
async function runBackup() {
    if (running) return { skipped: true, reason: 'backup sebelumnya masih berjalan' };
    running = true;
    const db = require('../config/database');
    try {
        fs.mkdirSync(backupDir, { recursive: true });
        const dest = path.join(backupDir, `kasir-${stampWIB(new Date())}.db`);
        await db.backup(dest);

        // Salinan dari db.backup() masih ber-status WAL; dibuka read-write lalu dikonversi
        // ke journal_mode=DELETE supaya isinya ter-checkpoint ke satu berkas .db dan tidak
        // meninggalkan sidecar -wal/-shm di folder backup.
        const copy = new Database(dest);
        let integrity;
        try {
            copy.pragma('journal_mode = DELETE');
            integrity = copy.pragma('integrity_check', { simple: true });
        } finally {
            copy.close();
        }

        const removed = [];
        const existing = fs.readdirSync(backupDir)
            .filter((f) => /^kasir-\d{8}-\d{6}\.db$/.test(f))
            .map((f) => ({ f, mtime: fs.statSync(path.join(backupDir, f)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime);
        existing.slice(keepCount).forEach(({ f }) => {
            fs.unlinkSync(path.join(backupDir, f));
            removed.push(f);
        });

        const sizeMb = (fs.statSync(dest).size / 1048576).toFixed(2);
        console.log(`[backup] ${path.basename(dest)} (${sizeMb} MB, integritas ${integrity})`
            + (removed.length ? ` - hapus lama: ${removed.join(', ')}` : ''));
        return { ok: integrity === 'ok', file: dest, integrity, sizeMb, removed };
    } catch (err) {
        console.error('[backup] GAGAL:', err.message);
        return { ok: false, error: err.message };
    } finally {
        running = false;
    }
}

if (require.main === module) {
    runBackup().then((result) => {
        if (result.skipped) {
            console.error('[backup] ' + result.reason);
            process.exitCode = 1;
        } else {
            process.exitCode = result.ok ? 0 : 1;
        }
        require('../config/database').close();
    });
}

module.exports = { runBackup, backupDir, keepCount };
