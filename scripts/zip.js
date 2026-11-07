// Penulis arsip ZIP tanpa dependensi baru. Kenapa tidak pakai modul jadi: deployment
// kasir ini cuma "git pull lalu npm run dev", jadi menambah paket berarti setiap mesin
// kasir harus install ulang. Isi arsipnya kecil (database + beberapa gambar), dan
// format ZIP cukup untuk ditulis sendiri dengan benar.
//
// Yang didukung: file biasa, deflate (method 8) kalau ternyata lebih kecil dari
// stored (method 0), nama berkas UTF-8, dan satu waktu modifikasi untuk semua entry.
const zlib = require('zlib');

const TABEL_CRC = (() => {
  const tabel = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    tabel[i] = c;
  }
  return tabel;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ TABEL_CRC[(c ^ buf[i]) & 0xFF];
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ZIP menyimpan waktu dalam format DOS (detik hanya sampai resolution 2 detik).
function waktuDos(tanggal) {
  const jam = tanggal.getHours(), menit = tanggal.getMinutes(), detik = tanggal.getSeconds();
  const tahun = Math.max(1980, tanggal.getFullYear());
  return {
    waktu: (jam << 11) | (menit << 5) | Math.floor(detik / 2),
    tanggal: ((tahun - 1980) << 9) | ((tanggal.getMonth() + 1) << 5) | tanggal.getDate()
  };
}

const BATANG_NAMA = (nama) => Buffer.from(String(nama).replace(/\\/g, '/').replace(/^\/+/, ''), 'utf8');

/**
 * entries: [{ nama: 'isi/kasir.db', data: Buffer|string }]
 * Mengembalikan Buffer berisi arsip ZIP utuh.
 */
function buatZip(entries, waktu = new Date()) {
  const { waktu: wDos, tanggal: tDos } = waktuDos(waktu);
  const potongan = [];
  const direktori = [];
  let offset = 0;
  let ukuranTotal = 0;

  for (const entri of entries) {
    if (!entri || entri.data === undefined || entri.data === null) continue;
    const nama = BATANG_NAMA(entri.nama);
    const isi = Buffer.isBuffer(entri.data) ? entri.data : Buffer.from(String(entri.data), 'utf8');
    const deflated = zlib.deflateRawSync(isi, { level: 6 });
    const pakaiDeflate = deflated.length < isi.length;
    const data = pakaiDeflate ? deflated : isi;
    const method = pakaiDeflate ? 8 : 0;
    const crc = crc32(isi);

    const kepala = Buffer.alloc(30);
    kepala.writeUInt32LE(0x04034b50, 0);
    kepala.writeUInt16LE(20, 4);              // versi butuh: 2.0
    kepala.writeUInt16LE(0x0800, 6);          // bit 11: nama berkas UTF-8
    kepala.writeUInt16LE(method, 8);
    kepala.writeUInt16LE(wDos, 10);
    kepala.writeUInt16LE(tDos, 12);
    kepala.writeUInt32LE(crc, 14);
    kepala.writeUInt32LE(data.length, 18);
    kepala.writeUInt32LE(isi.length, 22);
    kepala.writeUInt16LE(nama.length, 26);
    kepala.writeUInt16LE(0, 28);              // extra field
    potongan.push(kepala, nama, data);

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4);                 // dibuat oleh ZIP 2.0
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(0x0800, 8);
    cdh.writeUInt16LE(method, 10);
    cdh.writeUInt16LE(wDos, 12);
    cdh.writeUInt16LE(tDos, 14);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(data.length, 20);
    cdh.writeUInt32LE(isi.length, 24);
    cdh.writeUInt16LE(nama.length, 28);
    cdh.writeUInt16LE(0, 30);                 // extra
    cdh.writeUInt16LE(0, 32);                 // comment
    cdh.writeUInt16LE(0, 34);                 // disk awal
    cdh.writeUInt16LE(0, 36);                 // atribut internal
    cdh.writeUInt32LE(0, 38);                 // atribut eksternal
    cdh.writeUInt32LE(offset, 42);
    direktori.push(cdh, nama);

    offset += kepala.length + nama.length + data.length;
    ukuranTotal += isi.length;
  }

  const indeks = Buffer.concat(direktori);
  const eocd = Buffer.alloc(22);
  const jumlah = Math.min(entries.length, 0xFFFF);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(jumlah, 8);
  eocd.writeUInt16LE(jumlah, 10);
  eocd.writeUInt32LE(indeks.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return { buffer: Buffer.concat([...potongan, indeks, eocd]), jumlahEntry: entries.length, ukuranTotal };
}

module.exports = { buatZip, crc32 };
