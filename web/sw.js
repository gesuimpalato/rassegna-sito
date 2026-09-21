/* Service worker: guscio dell'app in cache, notizie sempre fresche quando c'è rete.
   Senza rete si mostra l'ultimo feed scaricato, così l'app resta leggibile offline. */
const VERSIONE = 'rassegna-v1';
const GUSCIO = [
  './', './index.html', './styles.css', './app.js',
  './manifest.webmanifest', './icona.svg', './icona-192.png', './icona-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSIONE).then((c) => c.addAll(GUSCIO)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((chiavi) => Promise.all(chiavi.filter((k) => k !== VERSIONE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()));
});

const IN_SVILUPPO = ['localhost', '127.0.0.1'].includes(location.hostname);

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (IN_SVILUPPO) return;                            // niente cache mentre si sviluppa
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;         // immagini delle testate: niente cache

  // il feed: prima la rete, poi la copia salvata
  if (url.pathname.endsWith('/data/feed.json')) {
    e.respondWith(
      fetch(req)
        .then((r) => {
          const copia = r.clone();
          caches.open(VERSIONE).then((c) => c.put(req, copia));
          return r;
        })
        .catch(() => caches.match(req)));
    return;
  }

  // il resto del guscio: si risponde subito con la copia salvata e intanto
  // si riscarica per la volta successiva ("stale-while-revalidate"). Con la
  // sola cache un aggiornamento di app.js non sarebbe mai arrivato all'utente.
  e.respondWith(
    caches.match(req).then((salvata) => {
      const rete = fetch(req).then((r) => {
        if (r && r.ok) {
          const copia = r.clone();
          caches.open(VERSIONE).then((c) => c.put(req, copia));
        }
        return r;
      }).catch(() => salvata);
      return salvata || rete;
    }));
});
