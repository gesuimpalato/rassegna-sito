/* Da dove arrivano le notizie, a seconda di dove gira l'app.
 *
 *  app impacchettata (Tauri)  -> rete nativa: scarica i feed da sé, niente CORS
 *  sviluppo su localhost      -> proxy di serve.py, per provare la stessa logica
 *  pagina web / PWA           -> data/feed.json generato da aggregator.py
 *
 * In tutti i casi si parte dall'ultimo risultato salvato, così l'app mostra
 * qualcosa subito e anche senza rete, e poi si aggiorna in sottofondo.
 */
'use strict';

const CHIAVE_CACHE = 'rassegna:feed';

const inTauri = () => typeof window.__TAURI__ !== 'undefined';
const inSviluppo = () => ['localhost', '127.0.0.1'].includes(location.hostname);

function modalita() {
  if (inTauri()) return 'nativa';
  if (inSviluppo()) return 'sviluppo';
  return 'statica';
}

/* Intestazioni condizionali: chiedono alla testata di rispondere solo se il
   feed e' cambiato davvero. */
function condizionali(validatori) {
  const h = { 'User-Agent': 'Rassegna/1.0' };
  if (validatori && validatori.etag) h['If-None-Match'] = validatori.etag;
  if (validatori && validatori.modificato) h['If-Modified-Since'] = validatori.modificato;
  return h;
}

async function esito(r) {
  if (r.status === 304) return { stato: 304 };
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return {
    stato: 200,
    testo: await r.text(),
    etag: r.headers.get('ETag'),
    modificato: r.headers.get('Last-Modified'),
  };
}

/* Scaricatore di feed adatto all'ambiente, oppure null se qui non si può
   aggregare dal vivo (pagina web servita da un dominio qualsiasi). */
function scaricatore() {
  if (inTauri()) {
    const { fetch: fetchNativo } = window.__TAURI__.http;
    return async (url, validatori) =>
      esito(await fetchNativo(url, { method: 'GET', headers: condizionali(validatori) }));
  }
  if (inSviluppo()) {
    return async (url, validatori) =>
      esito(await fetch('/proxy?url=' + encodeURIComponent(url), { headers: condizionali(validatori) }));
  }
  return null;
}

/* Cache per testata: validatori HTTP e articoli gia' elaborati. Sta in
   localStorage, che e' limitato: se si riempie si rinuncia alla cache invece
   di far fallire l'aggiornamento. */
const CHIAVE_FEED = 'rassegna:testate';

function cacheTestate() {
  let mappa = null;
  const carica = () => {
    if (mappa) return mappa;
    try { mappa = JSON.parse(localStorage.getItem(CHIAVE_FEED) || '{}'); }
    catch { mappa = {}; }
    return mappa;
  };
  return {
    leggi: (id) => carica()[id] || null,
    scrivi: (id, dati) => { carica()[id] = dati; },
    salva: () => {
      if (!mappa) return;
      try {
        localStorage.setItem(CHIAVE_FEED, JSON.stringify(mappa));
      } catch {
        // quota esaurita: si riparte pulito, al massimo si riscarica tutto
        try { localStorage.removeItem(CHIAVE_FEED); } catch { /* ignora */ }
      }
    },
  };
}

function leggiCache() {
  try {
    const grezzo = localStorage.getItem(CHIAVE_CACHE);
    return grezzo ? JSON.parse(grezzo) : null;
  } catch {
    return null;                      // quota piena, modalità privata, JSON rotto
  }
}

function scriviCache(feed) {
  try {
    localStorage.setItem(CHIAVE_CACHE, JSON.stringify(feed));
  } catch {
    /* non essenziale: alla peggio il prossimo avvio riparte da data/feed.json */
  }
}

async function feedImpacchettato() {
  const r = await fetch('data/feed.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return await r.json();
}

/* Il feed da mostrare all'avvio: il più fresco fra copia salvata e copia
   inclusa nell'app. Alla prima apertura esiste solo la seconda. */
async function feedIniziale() {
  const salvato = leggiCache();
  let incluso = null;
  try {
    incluso = await feedImpacchettato();
  } catch {
    /* nell'app nativa il file incluso può mancare: si userà solo la cache */
  }
  if (salvato && incluso) {
    return new Date(salvato.generato) >= new Date(incluso.generato) ? salvato : incluso;
  }
  return salvato || incluso;
}

/* Riscarica tutto dalle testate. Ritorna null se qui non si può. */
async function aggiornaDalVivo({ suProgresso } = {}) {
  const scarica = scaricatore();
  if (!scarica) return null;
  const [sorgenti, tassonomia] = await Promise.all([
    fetch('sources.json').then((r) => r.json()),
    fetch('taxonomy.json').then((r) => r.json()),
  ]);
  const cache = cacheTestate();
  const feed = await window.Aggregatore.costruisciFeed({
    scarica, sorgenti, tassonomia, suProgresso, cache,
  });
  cache.salva();
  scriviCache(feed);
  return feed;
}

/* Aggiornamento, qualunque sia l'ambiente.

   Dove si puo' aggregare (app impacchettata, sviluppo) si riscaricano i feed
   dalle testate. Sul sito pubblicato non si puo' — il browser non supera il
   CORS — ma il feed viene rigenerato a monte ogni mezz'ora, quindi basta
   rileggere il file: 118 KB invece di 2,5 MB. */
async function aggiorna({ suProgresso } = {}) {
  const dalVivo = await aggiornaDalVivo({ suProgresso });
  if (dalVivo) return dalVivo;
  return await feedImpacchettato();
}

/* Quanto e' vecchio il feed mostrato, in minuti. */
function etaMinuti(feed) {
  if (!feed || !feed.generato) return Infinity;
  return (Date.now() - new Date(feed.generato).getTime()) / 60000;
}

/* Nell'app impacchettata un <a target="_blank"> non apre nulla: la webview non
   ha schede e non c'è un browser attorno. Gli articoli vanno consegnati al
   browser di sistema, altrimenti il pulsante "Leggi l'articolo completo"
   sembrerebbe rotto. */
function collegaAperturaEsterna() {
  if (!inTauri()) return;
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="http"]');
    if (!a) return;
    e.preventDefault();
    window.__TAURI__.opener.openUrl(a.href).catch((err) => console.error('apertura fallita', err));
  });
}

window.Dati = {
  modalita,
  feedIniziale,
  aggiornaDalVivo,
  collegaAperturaEsterna,
  etaMinuti,
  aggiorna,
  aggregaDalVivo: () => scaricatore() !== null,
  puoAggiornare: () => true,
};
