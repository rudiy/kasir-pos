// Pembaca CSV untuk impor massal. Ditulis sendiri (tanpa paket) karena deployment kasir
// ini cuma "git pull lalu npm run dev": menambah dependensi berarti setiap mesin kasir
// harus install ulang, dan yang dibutuhkan di sini hanya memisahkan teks jadi sel.
//
// Yang harus ditoleransi karena sumbernya Excel:
//  - pemisah titik-koma (regional Indonesia), koma (regional Inggris), atau tab;
//  - baris CRLF, LF, atau CR saja;
//  - penanda UTF-8 di depan; kalau berkasnya ternyata bukan UTF-8 (Excel lama menyimpan
//    "CSV" sebagai windows-1252) tidak boleh pecah jadi karakter asing;
//  - baris komentar yang diawali '#' — dipakai template untuk petunjuk, jadi tidak perlu
//    menghapusnya sebelum impor.

const BOM = '\uFEFF';

// Teks mentah -> string. Berkas dari Excel lama tidak punya penanda UTF-8 sama sekali,
// jadi kegagalan dekode UTF-8 diperlakukan sebagai latin-1, bukan sebagai error.
function dekode(buf) {
    if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
        return buf.slice(3).toString('utf8');
    }
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch (err) {
        return buf.toString('latin1');
    }
}

function pisahBaris(teks, pemisah) {
    const keluaran = [];
    let sel = '';
    let baris = [];
    let dalamKutip = false;
    for (let i = 0; i < teks.length; i++) {
        const c = teks[i];
        if (dalamKutip) {
            if (c === '"') {
                if (teks[i + 1] === '"') { sel += '"'; i++; }
                else dalamKutip = false;
            } else sel += c;
            continue;
        }
        if (c === '"') { dalamKutip = true; continue; }
        if (c === pemisah) { baris.push(sel.trim()); sel = ''; continue; }
        if (c === '\r' || c === '\n') {
            if (c === '\r' && teks[i + 1] === '\n') i++;
            baris.push(sel.trim());
            keluaran.push(baris);
            baris = []; sel = '';
            continue;
        }
        sel += c;
    }
    baris.push(sel.trim());
    keluaran.push(baris);
    return keluaran;
}

// Pemisah dipilih dari baris pertama yang bukan komentar: berkas Excel Indonesia memakai
// ';', berkas yang disave dengan regional Inggris memakai ','.
function pilihPemisah(teks) {
    const baris = teks.split(/\r?\n/).find((b) => b.trim() !== '' && !b.trim().startsWith('#')) || '';
    const hitung = { ';': 0, ',': 0, '\t': 0 };
    let dalamKutip = false;
    for (const ch of baris) {
        if (ch === '"') dalamKutip = !dalamKutip;
        else if (!dalamKutip && ch in hitung) hitung[ch]++;
    }
    const terbaik = Object.entries(hitung).sort((a, b) => b[1] - a[1])[0];
    return terbaik[1] > 0 ? terbaik[0] : ';';
}

/**
 * Teks CSV -> { header, baris, komentar, galat }
 * Baris yang jumlah selnya tidak sama dengan header dilaporkan, bukan dibungkam.
 */
function bacaCsv(teks) {
    const mentah = pisahBaris(String(teks).replace(BOM, ''), pilihPemisah(String(teks).replace(BOM, '')));
    const isi = mentah.filter(b => b.some(sel => sel !== ''));
    const komentar = [];
    const data = [];
    for (const b of isi) {
        if (b[0] && b[0].startsWith('#')) { komentar.push(b[0].replace(/^#\s?/, '')); continue; }
        data.push(b);
    }
    if (data.length === 0) return { header: [], baris: [], komentar, galat: ['Berkas kosong, tidak ada baris data.'] };

    const header = data[0].map(h => h.toLowerCase().replace(/\s+/g, '_'));
    const galat = [];
    const baris = [];
    for (let i = 1; i < data.length; i++) {
        const sel = data[i];
        if (sel.length !== header.length) {
            galat.push(`Baris ${i + 1}: punya ${sel.length} kolom, header punya ${header.length}. Periksa sel yang tersisa di ujung kanan.`);
            continue;
        }
        const obj = {};
        header.forEach((h, k) => { obj[h] = sel[k]; });
        obj._nomor = i + 1;
        baris.push(obj);
    }
    return { header, baris, komentar, galat };
}

// Excel Indonesia menulis angka berformat sebagai teks: "Rp 15.000" atau "1.500,50".
// Diambil angkanya saja; kalau memang tidak bisa dibaca, kembalikan null supaya pemanggil
// bisa melaporkan barisnya, bukan menyimpan NaN diam-diam.
function angka(teks) {
    if (teks === null || teks === undefined) return null;
    const bersih = String(teks).replace(/\s/g, '').replace(/^Rp\.?/i, '').replace(/Rp\.?$/i, '');
    if (bersih === '') return null;
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(bersih)) return Number(bersih.replace(/\./g, '').replace(',', '.'));
    if (/^-?\d+,\d+$/.test(bersih)) return Number(bersih.replace(',', '.'));
    const n = Number(bersih);
    return Number.isFinite(n) ? n : null;
}

module.exports = { dekode, bacaCsv, angka, pisahBaris, pilihPemisah };
