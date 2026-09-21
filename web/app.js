/* Rassegna — logica dell'applicazione. Nessun framework, nessuna build. */
'use strict';

const PAGINA = 24;          // articoli per "pagina" nel feed

const stato = {
  dati: null,
  etichette: new Map(),     // slug -> {label, gruppo}
  categoria: 'tutte',
  query: '',
  tag: new Set(),
  modo: 'tutti',            // 'tutti' = AND fra i tag, 'qualsiasi' = OR
  mostrati: PAGINA,
  risultati: [],
};

const $ = (s) => document.querySelector(s);
const el = (tag, attrs = {}, ...figli) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const f of figli) if (f) n.append(f);
  return n;
};

/* ------------------------------------------------------------------ tema */
const temaSalvato = () => { try { return localStorage.getItem('tema'); } catch { return null; } };
function applicaTema(t) {
  document.documentElement.dataset.tema = t;
  try { localStorage.setItem('tema', t); } catch { /* modalità privata */ }
}
applicaTema(temaSalvato() || (matchMedia('(prefers-color-scheme: dark)').matches ? 'scuro' : 'chiaro'));
$('#btn-tema').addEventListener('click', () => {
  applicaTema(document.documentElement.dataset.tema === 'scuro' ? 'chiaro' : 'scuro');
});

/* ------------------------------------------------------------- utilities */
function quandoTesto(iso) {
  const d = new Date(iso);
  const min = Math.round((Date.now() - d.getTime()) / 60000);
  if (min < 1) return 'ora';
  if (min < 60) return `${min} min fa`;
  const ore = Math.round(min / 60);
  if (ore < 24) return `${ore} h fa`;
  const gg = Math.round(ore / 24);
  if (gg === 1) return 'ieri';
  if (gg < 7) return `${gg} giorni fa`;
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
}

/* Normalizza per la ricerca: minuscolo e senza accenti, così "perche"
   trova "perché" e "citta" trova "città". */
const normalizza = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function etichetta(slug) {
  const t = stato.etichette.get(slug);
  return t ? t.label : slug;
}

/* Testo dei tag di un articolo, per la ricerca: memorizzato al primo uso.
   Permette di trovare gli articoli inglesi su "Ukraine" cercando "ucraina",
   perché entrambi portano il tag la cui etichetta è "Ucraina". */
const cacheTag = new Map();
function testoTag(art) {
  let t = cacheTag.get(art.id);
  if (t === undefined) {
    t = normalizza(art.tags.map(etichetta).join(' '));
    cacheTag.set(art.id, t);
  }
  return t;
}

/* Punteggio di attinenza rispetto alla query.
   Serve a "navigare tra articoli con titoli simili": chi ha più parole
   della query nel titolo, e più vicine all'inizio, viene prima. Il titolo
   pesa molto più della sintesi, e la sintesi più dei tag. */
function attinenza(art, parole) {
  const titolo = normalizza(art.titolo);
  const sintesi = normalizza(art.sintesi || '');
  const tag = testoTag(art);
  let p = 0;
  for (const w of parole) {
    const i = titolo.indexOf(w);
    if (i === 0) p += 12;
    else if (i > 0) p += titolo[i - 1] === ' ' ? 9 : 5;   // inizio di parola
    else if (sintesi.includes(w)) p += 2;
    else if (tag.includes(w)) p += 1;                     // corrispondenza per argomento
    else return -1;                                       // parola assente: scarta
  }
  return p + art.punteggio;
}

/* ------------------------------------------------------------- filtraggio */
function calcola() {
  const dati = stato.dati;
  if (!dati) return [];
  let out = dati.articoli;

  if (stato.categoria !== 'tutte') {
    out = out.filter((a) => a.tags.includes(stato.categoria));
  }

  if (stato.tag.size) {
    const tag = [...stato.tag];
    out = stato.modo === 'tutti'
      ? out.filter((a) => tag.every((t) => a.tags.includes(t)))
      : out.filter((a) => tag.some((t) => a.tags.includes(t)));
  }

  const q = normalizza(stato.query).trim();
  if (q) {
    const parole = q.split(/\s+/).filter(Boolean);
    out = out
      .map((a) => ({ a, p: attinenza(a, parole) }))
      .filter((x) => x.p >= 0)
      .sort((x, y) => y.p - x.p)
      .map((x) => x.a);
  }
  return out;
}

function aggiorna() {
  stato.risultati = calcola();
  stato.mostrati = PAGINA;
  disegnaFeed();
  disegnaChip();
}

/* ------------------------------------------------------------- rendering */
function cartaArticolo(art, principale) {
  const meta = el('div', { class: 'carta-meta' },
    el('span', { class: 'fonte-nome', text: art.fonte }),
    el('span', { class: 'punto', text: '·' }),
    el('span', { text: quandoTesto(art.data) }));

  const tagRiga = el('div', { class: 'tag-riga' });
  const ordinati = [...art.tags].sort((a, b) => {
    const ga = stato.etichette.get(a)?.gruppo, gb = stato.etichette.get(b)?.gruppo;
    return (ga === 'categoria' ? 0 : 1) - (gb === 'categoria' ? 0 : 1);
  });
  for (const t of ordinati.slice(0, principale ? 6 : 4)) {
    const g = stato.etichette.get(t)?.gruppo;
    tagRiga.append(el('button', {
      class: 'tag' + (g === 'categoria' ? ' t-categoria' : ''),
      text: etichetta(t),
      onclick: (e) => { e.stopPropagation(); attivaTag(t); },
    }));
  }

  // il testo sta in un blocco unico: così la carta in evidenza può affiancare
  // immagine e testo senza che l'impaginazione riordini i singoli elementi
  const testo = el('div', { class: 'carta-testo' }, meta, el('h3', { text: art.titolo }));
  if (art.sintesi) testo.append(el('p', { text: art.sintesi }));
  testo.append(tagRiga);
  if (art.anche_su?.length) {
    testo.append(el('div', { class: 'anche-su', text: 'Anche su ' + art.anche_su.map((x) => x.fonte).join(', ') }));
  }

  const carta = el('button', {
    class: 'carta' + (principale ? ' principale' : ''),
    onclick: () => { location.hash = '#/articolo/' + encodeURIComponent(art.id); },
  });
  if (art.immagine) {
    carta.append(el('img', {
      class: 'miniatura', src: art.immagine, alt: '', loading: 'lazy', decoding: 'async',
      onerror: (e) => e.target.remove(),
    }));
  }
  carta.append(testo);
  return carta;
}

function disegnaFeed() {
  const feed = $('#feed');
  const statoEl = $('#stato');
  feed.textContent = '';

  const lista = stato.risultati;
  if (!lista.length) {
    statoEl.hidden = false;
    statoEl.textContent = stato.query
      ? `Nessun articolo per “${stato.query}”.`
      : 'Nessun articolo con questi filtri.';
    $('#carica-altro').hidden = true;
    return;
  }
  statoEl.hidden = true;

  const fetta = lista.slice(0, stato.mostrati);
  fetta.forEach((art, i) => {
    // la prima carta è in evidenza solo nel feed non filtrato per ricerca
    feed.append(cartaArticolo(art, i === 0 && !stato.query));
  });

  const altro = $('#carica-altro');
  altro.hidden = stato.mostrati >= lista.length;
  altro.textContent = `Carica altre notizie (${lista.length - stato.mostrati})`;

  const n = stato.dati.non_modificate;
  const risparmio = n ? ` · ${n} testate invariate` : '';
  $('#pie-info').textContent =
    `${lista.length} notizie · aggiornate ${quandoTesto(stato.dati.generato)}${risparmio}`;
}

function disegnaChip() {
  const box = $('#chip-attivi');
  box.textContent = '';
  for (const t of stato.tag) {
    box.append(el('span', { class: 'chip' },
      el('span', { text: etichetta(t) }),
      el('button', { 'aria-label': 'Togli ' + etichetta(t), text: '×', onclick: () => attivaTag(t) })));
  }
  const n = stato.tag.size;
  const conta = $('#conta-filtri');
  conta.hidden = !n;
  conta.textContent = n;
}

function attivaTag(slug) {
  if (stato.tag.has(slug)) stato.tag.delete(slug); else stato.tag.add(slug);
  sincronizzaPannello();
  aggiorna();
}

/* --------------------------------------------------------- pannello tag */
const GRUPPI = [
  ['categoria', 'Categoria'],
  ['ambito', 'Ambito'],
  ['continente', 'Continente'],
  ['nazione', 'Nazione'],
  ['tema', 'Tema'],
];

function costruisciPannello() {
  const box = $('#gruppi-tag');
  box.textContent = '';
  for (const [gruppo, titolo] of GRUPPI) {
    const voci = stato.dati.tag.filter((t) => t.gruppo === gruppo && t.n > 0)
      .sort((a, b) => b.n - a.n);
    if (!voci.length) continue;
    const riga = el('div', { class: 'gruppo-tag' });
    for (const t of voci) {
      riga.append(el('button', {
        class: 'tag-sel',
        'data-slug': t.slug,
        'aria-pressed': stato.tag.has(t.slug) ? 'true' : 'false',
        onclick: () => attivaTag(t.slug),
      }, el('span', { text: t.label }), el('span', { class: 'n', text: String(t.n) })));
    }
    box.append(el('div', { class: 'gruppo' }, el('h3', { text: titolo }), riga));
  }
}

function sincronizzaPannello() {
  for (const b of document.querySelectorAll('.tag-sel')) {
    b.setAttribute('aria-pressed', stato.tag.has(b.dataset.slug) ? 'true' : 'false');
  }
}

function apriPannello(apri) {
  $('#pannello').hidden = !apri;
  $('#velo').hidden = !apri;
  document.body.classList.toggle('bloccato', apri);
  $('#apri-filtri').setAttribute('aria-expanded', String(apri));
}

/* ------------------------------------------------------------- categorie */
function costruisciCategorie() {
  const nav = $('#categorie');
  nav.textContent = '';
  const voci = [['tutte', 'In evidenza'], ['geopolitica', 'Geopolitica'], ['economia', 'Economia'], ['informatica', 'Informatica']];
  for (const [slug, label] of voci) {
    nav.append(el('button', {
      text: label,
      role: 'tab',
      'aria-selected': stato.categoria === slug ? 'true' : 'false',
      onclick: () => {
        stato.categoria = slug;
        for (const b of nav.children) b.setAttribute('aria-selected', 'false');
        nav.children[voci.findIndex((v) => v[0] === slug)].setAttribute('aria-selected', 'true');
        aggiorna();
        scrollTo({ top: 0, behavior: 'smooth' });
      },
    }));
  }
}

/* --------------------------------------------------------------- lettore */
function apriLettore(id) {
  const art = stato.dati?.articoli.find((a) => a.id === id);
  if (!art) { location.hash = '#/'; return; }

  $('#lettore-fonte').textContent = art.fonte;
  const corpo = $('#lettore-corpo');
  corpo.textContent = '';

  const tagRiga = el('div', { class: 'tag-riga' });
  for (const t of art.tags) {
    const g = stato.etichette.get(t)?.gruppo;
    tagRiga.append(el('button', {
      class: 'tag' + (g === 'categoria' ? ' t-categoria' : ''),
      text: etichetta(t),
      onclick: () => { stato.tag.clear(); attivaTag(t); location.hash = '#/'; },
    }));
  }

  corpo.append(
    el('div', { class: 'occhiello', text: `${art.fonte} · ${quandoTesto(art.data)}` }),
    el('h1', { text: art.titolo }),
    tagRiga);

  if (art.immagine) {
    corpo.append(el('img', { src: art.immagine, alt: '', onerror: (e) => e.target.remove() }));
  }
  if (art.sintesi) corpo.append(el('p', { class: 'sommario', text: art.sintesi }));

  corpo.append(
    el('div', { class: 'avviso-fonte' },
      el('span', { text: 'Questa è l’anteprima pubblicata dalla testata nel suo feed. Il testo integrale resta sul sito della fonte, che lo ospita e ne detiene i diritti: il pulsante qui sotto ti porta all’articolo completo.' })),
    el('a', { class: 'btn-apri', href: art.url, target: '_blank', rel: 'noopener noreferrer',
              text: `Leggi l’articolo completo su ${art.fonte} →` }));

  if (art.anche_su?.length) {
    const ul = el('ul');
    for (const x of art.anche_su) {
      ul.append(el('li', {}, el('a', { href: x.url, target: '_blank', rel: 'noopener noreferrer', text: `${x.fonte} — ${x.titolo}` })));
    }
    corpo.append(el('div', { class: 'altre-fonti' }, el('h2', { text: 'La stessa notizia su altre testate' }), ul));
  }

  $('#lettore').hidden = false;
  document.body.classList.add('bloccato');
  $('#lettore').scrollTop = 0;
}

function apriFonti() {
  const corpo = $('#lettore-corpo');
  $('#lettore-fonte').textContent = 'Fonti';
  corpo.textContent = '';
  corpo.append(el('h1', { text: 'Fonti' }));

  const tab = el('table', { class: 'tabella-fonti' });
  tab.append(el('thead', {}, el('tr', {},
    el('th', { text: 'Testata' }), el('th', { text: 'Feed' }), el('th', { text: 'Articoli' }))));
  const tb = el('tbody');
  for (const d of stato.dati.diagnostica) {
    tb.append(el('tr', {},
      el('td', { text: d.nome }),
      el('td', {}, d.errore
        ? el('span', { class: 'no', text: d.errore })
        : el('span', { text: d.avviso ? 'copia in cache' : 'ok' })),
      el('td', { text: String(d.articoli) })));
  }
  tab.append(tb);
  corpo.append(tab);

  if (stato.dati.fonti_escluse?.length) {
    corpo.append(el('h2', { text: 'Fonti richieste ma non disponibili' }));
    const ul = el('ul');
    for (const f of stato.dati.fonti_escluse) {
      ul.append(el('li', {}, el('strong', { text: f.name + ' — ' }), el('span', { text: f.reason })));
    }
    corpo.append(ul);
  }

  $('#lettore').hidden = false;
  document.body.classList.add('bloccato');
  $('#lettore').scrollTop = 0;
}

function chiudiLettore() {
  $('#lettore').hidden = true;
  document.body.classList.remove('bloccato');
}

/* --------------------------------------------------------------- routing */
function instrada() {
  const h = location.hash;
  if (h.startsWith('#/articolo/')) apriLettore(decodeURIComponent(h.slice('#/articolo/'.length)));
  else if (h === '#/fonti') apriFonti();
  else chiudiLettore();
}

/* ----------------------------------------------------------------- avvio */
let timerRicerca;
$('#ricerca').addEventListener('input', (e) => {
  const v = e.target.value;
  $('#pulisci-ricerca').hidden = !v;
  clearTimeout(timerRicerca);
  timerRicerca = setTimeout(() => { stato.query = v; aggiorna(); }, 140);
});
$('#pulisci-ricerca').addEventListener('click', () => {
  $('#ricerca').value = '';
  $('#pulisci-ricerca').hidden = true;
  stato.query = '';
  aggiorna();
  $('#ricerca').focus();
});
$('#apri-filtri').addEventListener('click', () => apriPannello(true));
$('#chiudi-filtri').addEventListener('click', () => apriPannello(false));
$('#applica-filtri').addEventListener('click', () => apriPannello(false));
$('#velo').addEventListener('click', () => apriPannello(false));
$('#azzera-filtri').addEventListener('click', () => {
  stato.tag.clear(); sincronizzaPannello(); aggiorna();
});
for (const r of document.querySelectorAll('input[name="modo"]')) {
  r.addEventListener('change', (e) => { stato.modo = e.target.value; aggiorna(); });
}
$('#carica-altro').addEventListener('click', () => { stato.mostrati += PAGINA; disegnaFeed(); });
$('#chiudi-lettore').addEventListener('click', () => history.back());
addEventListener('hashchange', instrada);
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!$('#pannello').hidden) apriPannello(false);
    else if (!$('#lettore').hidden) history.back();
  }
  if (e.key === '/' && document.activeElement !== $('#ricerca')) {
    e.preventDefault(); $('#ricerca').focus();
  }
});

/* Avanzamento dell'aggiornamento: un filo sotto la testata. */
function mostraAvanzamento(fatte, totale) {
  let barra = $('.avanzamento');
  if (!barra) {
    barra = el('div', { class: 'avanzamento' });
    $('#testata').append(barra);
  }
  barra.style.opacity = '1';
  barra.style.transform = `scaleX(${fatte / totale})`;
  if (fatte >= totale) {
    setTimeout(() => { barra.style.opacity = '0'; }, 400);
  }
}

function applicaFeed(feed) {
  stato.dati = feed;
  stato.etichette.clear();
  for (const t of feed.tag) stato.etichette.set(t.slug, t);
  cacheTag.clear();
  costruisciCategorie();
  costruisciPannello();
  aggiorna();
}

const SOGLIA_AVVIO = 15;     // minuti: all'apertura si aggiorna se è più vecchio
const SOGLIA_RIENTRO = 30;   // minuti: tornando sull'app si è più cauti, costa dati

/* Su telefono si riapre l'app dallo switcher, non da zero: senza questo
   l'app resterebbe ferma alle notizie di ore prima finché non premi aggiorna.
   La soglia evita di riscaricare a ogni sbirciata; le richieste condizionali
   fanno il resto, perché le testate immutate rispondono 304 e non costano. */
function collegaRientro() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (window.Dati.etaMinuti(stato.dati) > SOGLIA_RIENTRO) {
      aggiornaNotizie({ silenzioso: true });
    }
  });
}

let aggiornamentoInCorso = false;

async function aggiornaNotizie({ silenzioso = false } = {}) {
  if (aggiornamentoInCorso || !window.Dati.puoAggiornare()) return;
  aggiornamentoInCorso = true;
  const bottone = $('#btn-aggiorna');
  bottone.classList.add('in-corso');
  bottone.disabled = true;
  try {
    const feed = await window.Dati.aggiorna({ suProgresso: mostraAvanzamento });
    if (feed) applicaFeed(feed);
  } catch (err) {
    console.error('aggiornamento fallito', err);
    if (!silenzioso) {
      $('#pie-info').textContent = 'Aggiornamento non riuscito: controlla la connessione.';
    }
  } finally {
    aggiornamentoInCorso = false;
    bottone.classList.remove('in-corso');
    bottone.disabled = false;
  }
}

async function avvia() {
  window.Dati.collegaAperturaEsterna();

  // 1. si parte da quel che c'è già: apertura immediata, funziona anche offline
  let iniziale = null;
  try {
    iniziale = await window.Dati.feedIniziale();
  } catch (err) {
    console.error(err);
  }

  if (iniziale) {
    applicaFeed(iniziale);
    instrada();
  } else if (!window.Dati.puoAggiornare()) {
    $('#stato').innerHTML =
      '<strong>Non riesco a caricare le notizie.</strong><br>' +
      'Genera il feed con <code>python3 aggregator.py</code> e riavvia il server.';
    return;
  } else {
    $('#stato').textContent = 'Scarico le notizie dalle testate…';
  }

  // 2. se qui si può aggregare dal vivo, si aggiorna in sottofondo
  if (window.Dati.puoAggiornare()) {
    $('#btn-aggiorna').hidden = false;
    $('#btn-aggiorna').addEventListener('click', () => aggiornaNotizie());
    if (window.Dati.etaMinuti(iniziale) > SOGLIA_AVVIO) {
      aggiornaNotizie({ silenzioso: Boolean(iniziale) });
    }
    collegaRientro();
  }

  // Il service worker serve solo alla versione web/PWA. Nell'app impacchettata
  // su Windows la pagina è servita via http://tauri.localhost, quindi passerebbe
  // il controllo sul protocollo e si metterebbe a fare cache per conto suo,
  // entrando in conflitto con la cache dell'app.
  if ('serviceWorker' in navigator &&
      location.protocol.startsWith('http') &&
      window.Dati.modalita() !== 'nativa') {
    navigator.serviceWorker.register('sw.js').catch(() => { /* non bloccante */ });
  }
}

avvia();
