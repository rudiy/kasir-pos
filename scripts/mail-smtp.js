// Kurir SMTP tanpa dependensi untuk mengirim arsip cadangan ke email pemilik toko.
//
// Sengaja ditulis di atas node:tls / node:net dan bukan memakai nodemailer: setiap mesin
// kasir hanya melakukan "git pull" lalu "npm run dev", jadi menambah paket baru berarti
// satu langkah install ekstra di tiap kasir. Yang dibutuhkan di sini cuma mengirim satu
// berkas ZIP ke satu alamat, dan SMTP untuk itu hanyalah urutan perintah yang tetap.
//
// Kredensial HANYA dibaca dari environment (.env): SMTP_HOST, SMTP_PORT, SMTP_USER,
// SMTP_PASS, SMTP_FROM. Tidak pernah disimpan di database, tidak ikut terkemas dalam
// arsip, dan tidak pernah ditampilkan di halaman mana pun.
const tls = require('node:tls');
const net = require('node:net');
const os = require('node:os');
const fs = require('node:fs');

const WAKTU_HUBUNG_MS = Number(process.env.SMTP_TIMEOUT_MS || 25000);

function konfigurasi() {
    const host = String(process.env.SMTP_HOST || '').trim();
    const port = Number(process.env.SMTP_PORT || (String(process.env.SMTP_SECURE || '') === 'false' ? 587 : 465));
    const user = String(process.env.SMTP_USER || '').trim();
    const pass = process.env.SMTP_PASS === undefined ? '' : String(process.env.SMTP_PASS);
    const from = String(process.env.SMTP_FROM || user).trim();
    // 465 = SSL sejak awal koneksi; 587/25 = mulai polos lalu dinaikkan dengan STARTTLS.
    const aman = port === 465 || String(process.env.SMTP_SECURE || '') === 'true';
    // Sertifikat server selalu diverifikasi. SMTP_CA_FILE hanya untuk server email dengan
    // CA privat (kantor/pemda) — bukan untuk mematikan verifikasi.
    const caFile = String(process.env.SMTP_CA_FILE || '').trim();
    const ca = caFile && fs.existsSync(caFile) ? fs.readFileSync(caFile) : undefined;
    return { host, port, user, pass, from, aman, ca, siap: !!host && !!user && !!pass && !!from };
}

// Satu-satunya pemegang socket pada satu waktu. Saat STARTTLS naik ke lapisan TLS,
// pegangan ini dipindahkan ke koneksi hasil upgrade supaya tidak ada dua pembaca
// yang berebut byte yang sama.
function buatSaluran(socketAwal) {
    let socket = socketAwal;
    let penyangga = '';
    const antrean = [];
    let penunggu = null;

    const pasang = (baru) => {
        socket = baru;
        penyangga = '';
        antrean.length = 0;
        penunggu = null;
        socket.setTimeout(WAKTU_HUBUNG_MS);
        socket.on('timeout', () => socket.destroy(new Error('Waktu tunggu ke server email habis (' + WAKTU_HUBUNG_MS + 'ms).')));
        socket.on('data', (potong) => {
            penyangga += potong.toString('latin1');
            let i;
            while ((i = penyangga.indexOf('\r\n')) !== -1) {
                const baris = penyangga.slice(0, i);
                penyangga = penyangga.slice(i + 2);
                if (penunggu) { const lanjut = penunggu; penunggu = null; lanjut(baris); }
                else antrean.push(baris);
            }
        });
        const putus = () => { if (penunggu) { const bangunkan = penunggu; penunggu = null; bangunkan(null); } };
        socket.on('close', putus);
        socket.on('error', putus);
    };
    pasang(socketAwal);

    const ambilBaris = () => new Promise((resolve) => {
        if (antrean.length) return resolve(antrean.shift());
        if (socket.destroyed) return resolve(null);
        penunggu = resolve;
    });

    // Baris "250-..." masih bersambung; respons baru selesai pada baris "250 ...".
    const baca = async (harap) => {
        const baris = [];
        for (;;) {
            const b = await ambilBaris();
            if (b === null) throw new Error('Koneksi ke server email terputus sebelum menjawab'
                + (baris.length ? ': ' + baris.join(' / ') : ''));
            baris.push(b);
            if (!/^\d{3}-/.test(b)) break;
        }
        const kode = Number(String(baris[0]).slice(0, 3));
        if (harap && !harap.includes(kode)) {
            throw new Error(`Server email menjawab ${kode}: ${baris.join(' / ')} (diharapkan ${harap.join('/')})`);
        }
        return { kode, teks: baris.join(' / ') };
    };

    const tulis = (isi) => new Promise((resolve, reject) => {
        if (socket.destroyed) return reject(new Error('Koneksi email sudah tertutup.'));
        socket.write(isi, 'latin1', (err) => err ? reject(err) : resolve());
    });

    return {
        baca, tulis, pasang,
        // Melepas pendengar dari socket polos sebelum lapisan TLS mengambil alih, supaya
        // byte jabat tangan tidak ikut tertelan ke penyangga baris pembaca lama.
        lepas: () => { socket.removeAllListeners('data'); socket.removeAllListeners('close'); socket.removeAllListeners('error'); },
        tutup: () => { try { socket.destroy(); } catch (e) { } },
        mentah: () => socket
    };
}

function hubung(cfg) {
    return new Promise((resolve, reject) => {
        if (cfg.aman) {
            const s = tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host, rejectUnauthorized: true, ca: cfg.ca });
            s.once('secureConnect', () => { s.setTimeout(0); resolve(s); });
            s.once('error', (e) => reject(new Error('TLS ke ' + cfg.host + ':' + cfg.port + ' gagal: ' + e.message)));
        } else {
            const s = net.connect({ host: cfg.host, port: cfg.port });
            s.once('connect', () => { s.setTimeout(0); resolve(s); });
            s.once('error', (e) => reject(new Error('Sambungan ke ' + cfg.host + ':' + cfg.port + ' gagal: ' + e.message)));
        }
    });
}

const kutip = (teks) => String(teks).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const enkodeBase64 = (teks) => Buffer.from(String(teks), 'utf8').toString('base64');

// Subjek dan isi arsip boleh berisi huruf non-ASCII (nama toko Indonesia), jadi header
// dikodekan sebagai MIME encoded-word alih-alih dikirim mentah.
function enkodeHeader(teks) {
    const s = String(teks);
    if (!/[^\x20-\x7E]/.test(s) && s.length <= 62) return s;
    return `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
}

// RFC 5321: baris body yang diawali titik harus digandakan, kalau tidak server menutup
// DATA lebih awal dan arsipnya potong di tengah.
const sisipTitik = (teks) => teks.split('\r\n').map((b) => (b.startsWith('.') ? '.' + b : b)).join('\r\n');

const barisBase64 = (buffer) => (buffer.toString('base64').match(/.{1,76}/g) || []).join('\r\n');

const namaMesin = () => (os.hostname() || 'kasir-pos').replace(/[^\w.-]/g, '-');

function rakitPesan({ dari, ke, subjek, teks, lampiran }) {
    const batas = 'kasirpos' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    const kepala = [
        'From: ' + dari,
        'To: ' + ke,
        'Subject: ' + enkodeHeader(subjek),
        'Date: ' + new Date().toUTCString(),
        'Message-ID: <' + Date.now() + '.' + Math.random().toString(36).slice(2) + '@kasir-pos>',
        'MIME-Version: 1.0',
        'Content-Type: multipart/mixed; boundary="' + batas + '"'
    ].join('\r\n');

    const bagian = [[
        '--' + batas,
        'Content-Type: text/plain; charset="utf-8"',
        'Content-Transfer-Encoding: 8bit',
        '',
        sisipTitik(String(teks).replace(/\r?\n/g, '\r\n'))
    ].join('\r\n')];

    if (lampiran) {
        bagian.push([
            '--' + batas,
            'Content-Type: application/zip; name="' + kutip(lampiran.nama) + '"',
            'Content-Transfer-Encoding: base64',
            'Content-Disposition: attachment; filename="' + kutip(lampiran.nama) + '"',
            '',
            barisBase64(lampiran.isi)
        ].join('\r\n'));
    }
    bagian.push('--' + batas + '--');
    return kepala + '\r\n\r\n' + bagian.join('\r\n') + '\r\n';
}

/**
 * Kirim satu email. `isi` = { ke, subjek, teks, lampiran: {nama, isi: Buffer} }.
 * Mengembalikan { ok, pesan } dan tidak pernah melempar, supaya pemanggilnya (buton uji di
 * halaman pengaturan dan penjadwal harian) cukup menampilkan pesannya.
 */
async function kirim(isi, cfgOverride) {
    const cfg = cfgOverride || konfigurasi();
    if (!cfg.host) return { ok: false, pesan: 'SMTP_HOST belum diisi di berkas .env.' };
    if (!cfg.siap) return { ok: false, pesan: 'SMTP_USER / SMTP_PASS / SMTP_FROM belum lengkap di .env.' };
    if (!isi || !isi.ke) return { ok: false, pesan: 'Alamat tujuan email kosong.' };

    let kanal = null;
    try {
        kanal = buatSaluran(await hubung(cfg));
        await kanal.baca([220]);
        await kanal.tulis('EHLO ' + namaMesin() + '\r\n');
        const ehlo = await kanal.baca([250]);

        if (!cfg.aman) {
            // Kalau server tidak menawarkan STARTTLS, berhenti: mengirim sandi lewat
            // koneksi yang tidak terenkripsi bukan sesuatu yang mau dilakukan aplikasi ini.
            if (!/STARTTLS/i.test(ehlo.teks)) {
                throw new Error('Server ' + cfg.host + ':' + cfg.port + ' tidak menawarkan STARTTLS. '
                    + 'Isi SMTP_PORT=465 (SSL) atau aktifkan STARTTLS di server email.');
            }
            await kanal.tulis('STARTTLS\r\n');
            await kanal.baca([220]);
            const socket = kanal.mentah();
            const ditingkatkan = await new Promise((resolve, reject) => {
                const t = tls.connect({ socket, servername: cfg.host, rejectUnauthorized: true, ca: cfg.ca });
                // Pendengar lama dilepas segera setelah lapisan TLS mengambil alih socket,
                // supaya byte jabat tangan tidak tertelan ke penyangga baris pembaca polos.
                kanal.lepas();
                t.once('secureConnect', () => resolve(t));
                t.once('error', (e) => reject(new Error('Peningkatan STARTTLS gagal: ' + e.message)));
            });
            kanal.pasang(ditingkatkan);
            await kanal.tulis('EHLO ' + namaMesin() + '\r\n');
            await kanal.baca([250]);
        }

        if (cfg.user) {
            await kanal.tulis('AUTH LOGIN\r\n');
            await kanal.baca([334]);
            await kanal.tulis(enkodeBase64(cfg.user) + '\r\n');
            await kanal.baca([334]);
            await kanal.tulis(enkodeBase64(cfg.pass) + '\r\n');
            await kanal.baca([235]);
        }

        await kanal.tulis('MAIL FROM:<' + cfg.from + '>\r\n');
        await kanal.baca([250]);
        await kanal.tulis('RCPT TO:<' + isi.ke + '>\r\n');
        await kanal.baca([250, 251]);

        await kanal.tulis('DATA\r\n');
        await kanal.baca([354]);
        await kanal.tulis(rakitPesan({ dari: cfg.from, ke: isi.ke, subjek: isi.subjek, teks: isi.teks, lampiran: isi.lampiran }) + '.\r\n');
        await kanal.baca([250]);

        try { await kanal.tulis('QUIT\r\n'); } catch (e) { /* banyak server langsung menutup */ }
        return { ok: true, pesan: 'Terkirim ke ' + isi.ke + (isi.lampiran ? ' dengan lampiran ' + isi.lampiran.nama : '') + '.' };
    } catch (err) {
        return { ok: false, pesan: err.message };
    } finally {
        if (kanal) kanal.tutup();
    }
}

module.exports = { kirim, konfigurasi, rakitPesan, enkodeHeader, sisipTitik, buatSaluran };
