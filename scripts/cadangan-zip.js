// Merakit satu arsip cadangan lengkap: snapshot database + gambar uploads + ekspor CSV.
//
// Dulu rangkaiannya ada di dalam route /backup/unduh-zip. Dipisah ke sini karena
// cadangan harian lewat email butuh arsip yang persis sama — kalau dua tempat merakit
// sendiri, isinya bisa berbeda dan cadangan email tidak lagi setara dengan yang diunduh.
const fs = require('fs');
const path = require('path');
const { runBackup } = require('./backup-db');
const { buatZip } = require('./zip');
const { csv: buatCsv, jenis: jenisEkspor } = require('./export-csv');

const ROOT = path.join(__dirname, '..');

function daftarFileRekursif(dir, akar = dir, keluaran = []) {
    if (!fs.existsSync(dir)) return keluaran;
    for (const nama of fs.readdirSync(dir)) {
        const penuh = path.join(dir, nama);
        const stat = fs.statSync(penuh);
        if (stat.isDirectory()) daftarFileRekursif(penuh, akar, keluaran);
        else if (stat.isFile()) keluaran.push({ penuh, relatif: path.relative(akar, penuh) });
    }
    return keluaran;
}

/**
 * Membuat cadangan baru (bukan memakai arsip lama), jadi hasilnya selalu mencerminkan
 * isi database saat ini. Gagal membuat/memeriksa snapshot -> { ok: false }.
 */
async function buatCadanganZip({ db, formatWIB, uploadsDir = path.join(ROOT, 'public/uploads') }) {
    const hasil = await runBackup();
    if (!hasil.ok) {
        return {
            ok: false,
            skipped: !!hasil.skipped,
            pesan: hasil.skipped ? 'Cadangan otomatis masih berjalan, coba lagi sebentar.'
                : 'Berkas cadangan gagal dibuat atau gagal diperiksa: ' + (hasil.error || hasil.integrity)
        };
    }

    // Cap waktunya saja; nama berkas hasil runBackup sudah diawali "kasir-" dan arsip ini
    // memakai prefiks yang sama, jadi jangan sampai terbaca "kasir-cadangan-kasir-...".
    const cap = path.basename(hasil.file, '.db').replace(/^kasir-/, '');

    const entri = [
        { nama: 'database/kasir.db', data: fs.readFileSync(hasil.file) },
        {
            nama: 'BACA-DULU.txt', data: [
                'CADANGAN KASIR POS - dibuat ' + formatWIB(new Date()),
                '',
                'Isi:',
                '  database/kasir.db   : seluruh transaksi, produk, stok per cabang, cabang, pengguna, pengaturan.',
                '  public/uploads/     : logo toko dan gambar QRIS per cabang.',
                '  csv/                : transaksi, produk, stok per cabang, dan cabang dalam format Excel.',
                '',
                'Cara memulihkan di mesin lain:',
                '  1. Hentikan aplikasi kasir di mesin tujuan.',
                '  2. Salin folder database/ dan public/uploads/ dari arsip ini ke folder aplikasi (timpa).',
                '  3. Buat salinan .env berisi SESSION_SECRET dan (bila dipakai) ADMIN_PASSWORD.',
                '  4. Jalankan npm run dev; struktur tabel dibuat otomatis saat start.',
                '',
                '.env sengaja TIDAK diikutkan agar rahasia tidak ikut tersebar lewat berkas ini.',
                `Integritas database pada arsip ini: ${hasil.integrity}`
            ].join('\r\n')
        }
    ];

    for (const f of daftarFileRekursif(uploadsDir)) {
        entri.push({ nama: 'public/uploads/' + f.relatif.replace(/\\/g, '/'), data: fs.readFileSync(f.penuh) });
    }
    for (const kunci of Object.keys(jenisEkspor)) {
        const j = jenisEkspor[kunci];
        entri.push({ nama: `csv/${cap}-${j.nama}.csv`, data: buatCsv(j.kolom, j.ambil(db, formatWIB)) });
    }

    const { buffer, jumlahEntry } = buatZip(entri);
    return {
        ok: true,
        cap,
        namaBerkas: `kasir-cadangan-${cap}.zip`,
        buffer,
        jumlahEntry,
        ukuranMb: (buffer.length / 1048576).toFixed(2),
        integritas: hasil.integrity
    };
}

module.exports = { buatCadanganZip, daftarFileRekursif };
