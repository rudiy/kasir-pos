// Dipakai tiap habis `git pull` atau reinstall di server: membandingkan berkas aset yang
// SEHARUSNYA ada (daftar pre-cache di public/sw.js + yang direferensikan halaman) dengan yang
// benar-benar ada di disk, dan dengan ukuran yang dicatat git.
// Kenapa perlu: `git pull` tidak mengembalikan berkas yang terhapus di folder kerja selama
// isinya tidak berubah di commit mana pun — persis cara file pemindai hilang pada 26-11-2026,
// dan tidak ada yang sadar sampai scan di HP gagal.
// Jalankan: npm run cek-aset
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const AKAR = path.join(__dirname, '..');
const PUBLIC = path.join(AKAR, 'public');

// 1. Kumpulkan daftar aset yang dipakai halaman/service worker.
const daftar = new Set();
const swSrc = fs.readFileSync(path.join(PUBLIC, 'sw.js'), 'utf8');
for (const m of swSrc.matchAll(/'(\/vendor\/[^']+|\/css\/[^']+|\/js\/[^']+)'/g)) daftar.add(m[1].split('?')[0]);
for (const berkas of fs.readdirSync(path.join(AKAR, 'views'))) {
    if (!berkas.endsWith('.ejs')) continue;
    const isi = fs.readFileSync(path.join(AKAR, 'views', berkas), 'utf8');
    for (const m of isi.matchAll(/(?:src|href)=['"](\/(?:vendor|css|js)\/[^'"?]+)/g)) daftar.add(m[1]);
}

// 2. Penilaian git sendiri atas folder publik: ` D` = hilang dari folder kerja, ` M` = isinya
//    beda dari yang dicatat commit. Sengaja tidak membandingkan jumlah byte dengan blob git:
//    di Windows berkas teks di disk bisa lebih besar beberapa byte daripada aslinya (CRLF),
//    dan itu bukan kerusakan — tadi itu yang membuat lima berkas sehat ikut dituduh rusak.
const tanda = new Map();
try {
    const keluaran = execFileSync('git', ['-C', AKAR, 'status', '--porcelain', '--', 'public'], { encoding: 'utf8' });
    for (const baris of keluaran.split('\n')) {
        const m = baris.match(/^(.)(.) (.+)$/);
        if (!m) continue;
        // Dua kolom status: kolom pertama = isi yang sudah di-stage, kolom kedua = isi di
        // folder kerja. Yang kita cari justru kolom kedua, jadi jangan hanya membaca yang pertama.
        const [, diStage, diFolder, jalur] = m;
        const kunci = '/' + jalur.replace(/^public\//, '');
        if (diStage === 'D' || diFolder === 'D') tanda.set(kunci, 'hilang dari folder kerja');
        else if (diStage === 'M' || diFolder === 'M') tanda.set(kunci, 'isinya beda dari commit');
    }
} catch (err) {
    console.log('[cek-aset] git tidak bisa dibaca (' + err.message.split('\n')[0] + ') — hanya memeriksa ada/tidaknya berkas.');
}

// 3. Periksa satu per satu.
const masalah = [];
let baik = 0;
for (const url of [...daftar].sort()) {
    const penuh = path.join(PUBLIC, url);
    if (!fs.existsSync(penuh)) {
        masalah.push({ url, sebab: 'tidak ada di disk', folder: path.posix.dirname('public' + url) });
        continue;
    }
    if (fs.statSync(penuh).size === 0) {
        masalah.push({ url, sebab: 'berkas kosong', folder: path.posix.dirname('public' + url) });
        continue;
    }
    // Isi dibandingkan hanya untuk berkas pustaka. style.css dan JS halaman memang sering
    // kamu ubah tangan, jadi "beda dari commit" di sana bukan kerusakan.
    const capaian = url.startsWith('/vendor/') ? tanda.get(url) : '';
    if (capaian) {
        masalah.push({ url, sebab: capaian + ' — kemungkinan tertimpa atau terpotong', folder: path.posix.dirname('public' + url) });
        continue;
    }
    baik++;
}

console.log('[cek-aset] ' + baik + ' aset cocok' + (masalah.length ? ', ' + masalah.length + ' bermasalah:' : ', semuanya ada.'));
for (const m of masalah) console.log('  HILANG/RUSAK  ' + m.url + '  — ' + m.sebab);

if (masalah.length) {
    const folder = [...new Set(masalah.map((m) => m.folder))].join(' ');
    console.log('\nTempel satu baris ini di server untuk memulihkan:\n\n  git checkout HEAD -- ' + folder + '\n');
    process.exit(1);
}
