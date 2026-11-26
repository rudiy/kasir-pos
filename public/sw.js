// Service worker Kasir POS.
// Prinsip: selama server masih bisa dijangkau, selalu pakai jawaban server terbaru
// (network-first). Cache hanya dipakai saat permintaan gagal, supaya saat internet
// atau server mati kasir tetap melihat halaman terakhir, dan begitu nyala kembali
// tampilannya langsung ikut versi terbaru tanpa perlu reinstall.
// Naikkan angka ini tiap kali bentuk aset berubah supaya klien membuang cache lama.
// v6: dibuang paksa karena v5 bisa menampung halaman login yang tersimpan sebagai file JS
// (lihat staleWhileRevalidate) - itu penyebab tombol scan menjawab "pustaka belum ada".
const STATIC_CACHE = 'kasir-statis-v6';
const PAGE_CACHE = 'kasir-halaman-v3';
// Hanya aset yang URL-nya tetap. style.css di-request dengan ?v=<penanda versi>,
// jadi ikut ter-cache saat pertama kali diambil, tidak perlu diprecache di sini.
const SHELL = [
    '/vendor/bootstrap/bootstrap.min.css',
    '/vendor/bootstrap/bootstrap.bundle.min.js',
    '/vendor/bootstrap-icons/bootstrap-icons.css',
    '/vendor/bootstrap-icons/fonts/bootstrap-icons.woff2',
    '/vendor/bootstrap-icons/fonts/bootstrap-icons.woff',
    '/vendor/jsbarcode/JsBarcode.all.min.js',
    // Tanpa ini pemindai kamera hilang saat halaman dibuka dari cache (internet/server mati)
    // dan tombol scan hanya menjawab "pustaka belum ada di perangkat ini".
    '/vendor/html5-qrcode/html5-qrcode.min.js',
];
const MAX_PAGES = 40;

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(STATIC_CACHE);
        await Promise.allSettled(SHELL.map((url) => cache.add(url)));
        await caches.open(PAGE_CACHE).then((c) => c.add('/login').catch(() => {}));
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keep = new Set([STATIC_CACHE, PAGE_CACHE]);
        const names = await caches.keys();
        await Promise.all(names.filter((n) => !keep.has(n)).map((n) => caches.delete(n)));
        await self.clients.claim();
    })());
});

const isStatic = (pathname) => (
    pathname.startsWith('/vendor/') || pathname.startsWith('/css/')
    || pathname.startsWith('/js/') || pathname.startsWith('/images/')
    || pathname.startsWith('/uploads/')
);

async function prunePages(cache) {
    const keys = await cache.keys();
    if (keys.length <= MAX_PAGES) return;
    const extras = keys.slice(0, keys.length - MAX_PAGES);
    await Promise.all(extras.map((req) => cache.delete(req)));
}

async function networkFirst(request, cacheName) {
    const cache = await caches.open(cacheName);
    try {
        const fresh = await fetch(request);
        if (fresh && fresh.ok && fresh.type === 'basic') {
            cache.put(request, fresh.clone()).then(() => prunePages(cache));
        }
        return fresh;
    } catch (err) {
        const saved = await cache.match(request);
        if (saved) return saved;
        if (request.mode === 'navigate') {
            const fallback = await cache.match('/login');
            if (fallback) return fallback;
        }
        return new Response('Koneksi ke server kasir terputus. '
            + 'Ini adalah salinan offline; data di layar belum tentu terbaru.',
        { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
}

// Aset statis: sajikan dari cache supaya cepat dan tetap ada saat offline,
// lalu diam-diam ambil versi terbaru untuk permintaan berikutnya.
async function staleWhileRevalidate(request) {
    const cache = await caches.open(STATIC_CACHE);
    const saved = await cache.match(request);
    const refresh = fetch(request).then((fresh) => {
        // Respons yang kena redirect berarti server tidak punya aset itu: aset pemindai yang
        // hilang dilayani sebagai halaman login (200 text/html). Kalau ikut disimpan, HP akan
        // selamanya memuat halaman login sebagai JavaScript dan tombol scan mati terus.
        if (fresh && fresh.ok && !fresh.redirected) cache.put(request, fresh.clone());
        return fresh;
    }).catch(() => null);
    return saved || await refresh || new Response('aset tidak tersedia', { status: 504 });
}

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    if (isStatic(url.pathname)) {
        event.respondWith(staleWhileRevalidate(request));
        return;
    }
    if (url.pathname.startsWith('/api/')) {
        event.respondWith((async () => {
            try {
                return await fetch(request);
            } catch (err) {
                return new Response('{"offline":true}', {
                    status: 503, headers: { 'content-type': 'application/json' },
                });
            }
        })());
        return;
    }
    event.respondWith(networkFirst(request, PAGE_CACHE));
});
