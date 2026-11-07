// Cadangan harian yang dikirim ke email pemilik toko.
//
// Sengaja opsional dan mati secara bawaan: fitur ini baru jalan kalau alamat email diisi
// di halaman Pengaturan Toko DAN kredensial SMTP ada di berkas .env. Arsip yang dikirim
// adalah arsip yang sama dengan tombol "Buat & unduh cadangan" di halaman Cadangan & Data
// (dirakit oleh scripts/cadangan-zip.js), jadi tidak ada dua varian cadangan.
const { konfigurasi: cfgSmtp, kirim } = require('./mail-smtp');
const { buatCadanganZip } = require('./cadangan-zip');

const KUNCI_TERKIRIM = 'email_cadangan_terkirim';   // tanggal WIB yang terakhir berhasil
const KUNCI_STATUS = 'email_cadangan_status';        // pesan hasil kirim terakhir
const KUNCI_WAKTU = 'email_cadangan_waktu';           // kapan status itu tercatat (ISO)

const JAM_BAWAAN = 22;

const parteWIB = (date) => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
}).formatToParts(date).reduce((acc, p) => (acc[p.type] = p.value, acc), {});

const tanggalWIB = (date) => { const p = parteWIB(date); return `${p.year}-${p.month}-${p.day}`; };
const jamWIB = (date) => { const p = parteWIB(date); return Number(p.hour === '24' ? '0' : p.hour); };

const bacaState = (db, kunci) => { const r = db.prepare('SELECT value FROM app_state WHERE key = ?').get(kunci); return r ? r.value : null; };
const tulisState = (db, kunci, nilai) => db.prepare(
    'INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
).run(kunci, nilai);

function pengaturanEmail(db) {
    const baris = db.prepare('SELECT backup_email, backup_hour FROM settings WHERE id = 1').get() || {};
    const jam = Number.parseInt(baris.backup_hour, 10);
    return {
        email: String(baris.backup_email || '').trim(),
        jam: Number.isInteger(jam) && jam >= 0 && jam <= 23 ? jam : JAM_BAWAAN,
        aktif: String(baris.backup_email || '').trim() !== ''
    };
}

// Ditampilkan di halaman pengaturan. Sandi SMTP tidak pernah ikut — hanya host/port dan
// apakah kredensialnya sudah ada, supaya cukup untuk mendiagnosis "kenapa tidak kirim".
function statusEmail(db) {
    const cfg = cfgSmtp();
    const p = pengaturanEmail(db);
    return {
        ...p,
        smtpSiap: cfg.siap,
        smtpHost: cfg.host,
        smtpPort: cfg.port,
        smtpMetode: cfg.aman ? 'SSL (465)' : 'STARTTLS',
        terkirimTerakhir: bacaState(db, KUNCI_TERKIRIM),
        statusTerakhir: bacaState(db, KUNCI_STATUS),
        waktuStatus: bacaState(db, KUNCI_WAKTU)
    };
}

/**
 * Dipanggil oleh penjadwal dan oleh buton "kirim sekarang".
 * `paksa` dipakai buton uji: tanggal dikirim tidak diperiksa, jadi bisa dites kapan saja.
 * Tidak ada email yang dikirim dua kali pada hari WIB yang sama tanpa paksa.
 */
async function kirimCadanganEmail({ db, formatWIB, uploadsDir, ke, paksa = false, sekarang = new Date() }) {
    const p = pengaturanEmail(db);
    const tujuan = String(ke || p.email).trim();
    if (!tujuan) return { ok: false, dilewati: true, pesan: 'Alamat email cadangan belum diisi.' };

    const cfg = cfgSmtp();
    if (!cfg.siap) {
        return { ok: false, pesan: 'Server email belum dikonfigurasi: isi SMTP_HOST, SMTP_USER, SMTP_PASS (dan SMTP_FROM bila perlu) di berkas .env.' };
    }

    if (!paksa) {
        if (jamWIB(sekarang) < p.jam) return { ok: false, dilewati: true, pesan: 'Belum jam kirim.' };
        if (bacaState(db, KUNCI_TERKIRIM) === tanggalWIB(sekarang)) {
            return { ok: true, dilewati: true, pesan: 'Cadangan hari ini sudah terkirim.' };
        }
    }

    const arsip = await buatCadanganZip({ db, formatWIB, uploadsDir });
    if (!arsip.ok) return { ok: false, pesan: arsip.pesan };

    const store = db.prepare('SELECT store_name FROM settings WHERE id = 1').get() || {};
    const subjek = `Cadangan kasir ${store.store_name || 'KASIR POS'} ${tanggalWIB(sekarang)}`;
    const teks = [
        'Halo,',
        '',
        'Ini cadangan otomatis ' + (store.store_name || 'KASIR POS') + ' untuk tanggal ' + formatWIB(sekarang) + '.',
        'Berkas lampirannya berisi seluruh database (transaksi, produk, stok per cabang, cabang, pengguna, pengaturan),',
        'gambar logo/QRIS di public/uploads, dan ekspor CSV dalam format Excel.',
        'Cara memulihkannya ada di berkas BACA-DULU.txt di dalam arsip.',
        '',
        'Ukuran arsip: ' + arsip.ukuranMb + ' MB, jumlah berkas di dalamnya: ' + arsip.jumlahEntry + '.',
        'Pemeriksaan integritas database: ' + arsip.integritas + '.',
        '',
        'Dikirim otomatis oleh aplikasi kasir. Tidak perlu dibalas.'
    ].join('\r\n');

    const hasil = await kirim({ ke: tujuan, subjek, teks, lampiran: { nama: arsip.namaBerkas, isi: arsip.buffer } }, cfg);
    tulisState(db, KUNCI_STATUS, (hasil.ok ? 'Terkirim' : 'Gagal') + ': ' + hasil.pesan);
    tulisState(db, KUNCI_WAKTU, new Date().toISOString());
    if (hasil.ok) tulisState(db, KUNCI_TERKIRIM, tanggalWIB(sekarang));
    console.log('[email-cadangan] ' + (hasil.ok ? 'ok ' : 'gagal ') + tujuan + ' - ' + hasil.pesan);
    return { ...hasil, ukuranMb: arsip.ukuranMb, namaBerkas: arsip.namaBerkas };
}

// Cukup dicek tiap beberapa menit: aturan "satu kali per hari" dipegang oleh tanggal WIB
// yang disimpan di app_state, jadi server yang di-restart atau jam yang meleset tidak
// menyebabkan kirim ganda. Interval tidak menahan proses keluar (unref).
function jadwalkanEmailCadangan({ db, formatWIB, uploadsDir, intervalMenit = 5 }) {
    const timer = setInterval(() => {
        const p = pengaturanEmail(db);
        if (!p.aktif) return;
        kirimCadanganEmail({ db, formatWIB, uploadsDir }).catch((err) => {
            console.error('[email-cadangan] tak terduga:', err.message);
        });
    }, intervalMenit * 60000);
    if (timer.unref) timer.unref();
    return timer;
}

module.exports = {
    kirimCadanganEmail,
    jadwalkanEmailCadangan,
    statusEmail,
    pengaturanEmail,
    tanggalWIB,
    jamWIB,
    JAM_BAWAAN
};
