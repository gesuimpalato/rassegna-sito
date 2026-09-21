/* Aggregatore lato app: gemello JavaScript di aggregator.py.
 *
 * Nell'app impacchettata non c'è Python, quindi il lavoro che faceva lo script
 * (scaricare i feed, assegnare i tag, raggruppare i doppioni, ordinare) avviene
 * qui. Le regole dei tag non sono riscritte: arrivano da taxonomy.json, generato
 * da taxonomy.py, che resta l'unica fonte di verità.
 */
'use strict';

const PAROLE_VUOTE = new Set(`
a ai al alla alle allo agli an and as at che chi come con da dal dalla de del della
delle dei degli des di do du e ed el en et for from gli i il in into is it its l la
le les lo of on or per pour su sui sul sulla the to tra un una uno und with y
after over says say new first two his her their they this that be been has have
`.trim().split(/\s+/));

/* ------------------------------------------------------------- tassonomia */

/* Stesse due convenzioni di taxonomy.py:
     "war"       -> parola intera con plurale opzionale (war, wars; NON warn)
     "conflitt*" -> radice, qualsiasi proseguimento                              */
function compilaRegex(chiavi, sigle) {
  const pre = '(?<![a-zà-ÿ0-9])';
  const post = '(?![a-zà-ÿ0-9])';
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\&]/g, '\\$&');
  const modello = (k, sigla) => {
    if (k.endsWith('*')) return pre + esc(k.slice(0, -1));
    return pre + esc(k) + (sigla ? '' : '(?:s|i)?') + post;
  };
  const perLunghezza = (a, b) => b.length - a.length;
  return {
    min: chiavi?.length
      ? new RegExp([...chiavi].sort(perLunghezza).map((k) => modello(k, false)).join('|'), 'i')
      : null,
    sig: sigle?.length
      ? new RegExp([...sigle].sort(perLunghezza).map((s) => modello(s, true)).join('|'))
      : null,
  };
}

function preparaTassonomia(tax) {
  const nazioni = new Map();
  for (const [slug, v] of Object.entries(tax.nazioni)) {
    nazioni.set(slug, { ...v, regex: compilaRegex(v.chiavi, v.sigle) });
  }
  const temi = new Map();
  for (const [slug, v] of Object.entries(tax.temi)) {
    temi.set(slug, { ...v, regex: compilaRegex(v.chiavi, v.sigle) });
  }
  return { nazioni, temi, continenti: tax.continenti, categorie: tax.categorie };
}

const corrisponde = (regex, minuscolo, originale) =>
  (regex.min !== null && regex.min.test(minuscolo)) ||
  (regex.sig !== null && regex.sig.test(originale));

/* ------------------------------------------------------------ parsing XML */

const NS_ATOM = 'http://www.w3.org/2005/Atom';
const NS_RDF = 'http://purl.org/rss/1.0/';
const NS_MEDIA = 'http://search.yahoo.com/mrss/';
const NS_CONTENT = 'http://purl.org/rss/1.0/modules/content/';
const NS_DC = 'http://purl.org/dc/elements/1.1/';

function testoDi(nodo) {
  return nodo ? (nodo.textContent || '').trim() : '';
}

/* Cerca un figlio diretto per nome, con o senza namespace. */
function figlio(el, nome, ns) {
  for (const c of el.children) {
    if (c.localName === nome && (!ns || c.namespaceURI === ns || !c.namespaceURI)) return c;
  }
  return null;
}

function primoTesto(el, ...nomi) {
  for (const n of nomi) {
    const t = testoDi(figlio(el, n));
    if (t) return t;
  }
  return '';
}

function ripulisci(s) {
  if (!s) return '';
  return s
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function accorcia(s, n = 280) {
  if (s.length <= n) return s;
  return s.slice(0, n).replace(/\s+\S*$/, '').replace(/[ ,;:.\-—–]+$/, '') + '…';
}

function dataDi(el) {
  const grezza = primoTesto(el, 'pubDate', 'published', 'updated', 'date');
  if (!grezza) return null;
  const d = new Date(grezza);
  return Number.isNaN(d.getTime()) ? null : d;
}

function linkDi(el) {
  const diretto = figlio(el, 'link');
  if (diretto) {
    const href = diretto.getAttribute('href');
    if (href) return href;
    const t = testoDi(diretto);
    if (t) return t;
  }
  for (const c of el.children) {
    if (c.localName === 'link' && c.getAttribute('href')) {
      const rel = c.getAttribute('rel') || 'alternate';
      if (rel === 'alternate') return c.getAttribute('href');
    }
  }
  const guid = testoDi(figlio(el, 'guid'));
  return guid.startsWith('http') ? guid : '';
}

function immagineDi(el) {
  for (const c of el.children) {
    if ((c.localName === 'content' || c.localName === 'thumbnail') &&
        c.namespaceURI === NS_MEDIA && c.getAttribute('url')) {
      return c.getAttribute('url');
    }
  }
  const enc = figlio(el, 'enclosure');
  if (enc && (enc.getAttribute('type') || '').startsWith('image')) {
    return enc.getAttribute('url') || '';
  }
  const blob = primoTesto(el, 'encoded', 'description', 'summary', 'content');
  const m = blob.match(/<img[^>]+src=["']([^"']+)/i);
  return m ? m[1] : '';
}

function vociDi(documento) {
  const rss = documento.getElementsByTagName('item');
  if (rss.length) return [...rss];
  const rdf = documento.getElementsByTagNameNS(NS_RDF, 'item');
  if (rdf.length) return [...rdf];
  return [...documento.getElementsByTagNameNS(NS_ATOM, 'entry')];
}

/* ---------------------------------------------------------------- tagging */

function assegnaTag(titolo, sintesi, fonte, T) {
  const originale = ` ${titolo} ${sintesi} `;
  const minuscolo = originale.toLowerCase();
  const daFonte = new Set([...(fonte.tags || []), ...(fonte.categories || [])]);
  const tags = new Set();

  const continentiVisti = new Set();
  for (const [slug, n] of T.nazioni) {
    if (corrisponde(n.regex, minuscolo, originale)) {
      tags.add(slug);
      tags.add(n.continente);
      continentiVisti.add(n.continente);
    }
  }
  for (const [slug, t] of T.temi) {
    if (corrisponde(t.regex, minuscolo, originale)) {
      tags.add(slug);
      tags.add(t.categoria);
    }
  }
  // due o più nazioni di continenti diversi => rapporti fra Paesi => "mondo"
  if (continentiVisti.size >= 2) tags.add('mondo');

  const contenuto = [...tags].sort();
  for (const t of daFonte) tags.add(t);
  return { tutti: [...tags].sort(), contenuto };
}

function ambitoDi(tags, T) {
  if (tags.includes('mondo')) return 'mondo';
  if (tags.some((t) => t in T.continenti)) return 'continente';
  if (tags.some((t) => T.nazioni.has(t))) return 'nazione';
  return 'mondo';
}

/* ------------------------------------------------- raggruppa e dà i voti */

function improntaDi(titolo) {
  const parole = titolo.toLowerCase().match(/[a-zà-ÿ0-9]+/g) || [];
  return new Set(parole.filter((p) => p.length > 3 && !PAROLE_VUOTE.has(p)));
}

function somiglianza(a, b) {
  if (!a.size || !b.size) return 0;
  let comuni = 0;
  for (const x of a) if (b.has(x)) comuni += 1;
  return comuni / (a.size + b.size - comuni);
}

const SEGNALI = [
  [/(?<![a-zà-ÿ])(war|wars|guerra|guerre|invasion[ei]?)(?![a-zà-ÿ])/i, 0.30],
  [/(?<![a-zà-ÿ])(ceasefire|cessate il fuoco|tregua)(?![a-zà-ÿ])/i, 0.25],
  [/(?<![a-zà-ÿ])(crisis|crisi|collapse|crollo)(?![a-zà-ÿ])/i, 0.20],
  [/(?<![a-zà-ÿ])(sanction|sanctions|sanzion\w*)(?![a-zà-ÿ])/i, 0.18],
  [/(?<![a-zà-ÿ])(election|elections|elezion\w*)(?![a-zà-ÿ])/i, 0.18],
  [/(?<![a-zà-ÿ])(summit|vertice|vertici)(?![a-zà-ÿ])/i, 0.15],
  [/(?<![a-zà-ÿ])(emergency|emergenza)(?![a-zà-ÿ])/i, 0.22],
  [/(?<![a-zà-ÿ])(downgrade[sd]?|declassament\w*)(?![a-zà-ÿ])/i, 0.20],
  [/(?<![a-zà-ÿ])(breakthrough|svolta|record)(?![a-zà-ÿ])/i, 0.14],
  [/(?<![a-zà-ÿ])(dead|killed|morti|uccis\w*|vittime)(?![a-zà-ÿ])/i, 0.22],
];

function punteggio(art, corroborazione, adesso) {
  const ore = Math.max(0, (adesso - art._data) / 3600000);
  const freschezza = Math.pow(0.5, ore / 18);
  const copertura = Math.min(corroborazione, 6) / 6;

  let gravita = 0;
  for (const [re, v] of SEGNALI) {
    if (re.test(art.titolo) || re.test(art.sintesi)) gravita += v;
  }
  gravita = Math.min(gravita, 0.6);

  return Number((0.40 * art._peso + 0.32 * freschezza + 0.18 * copertura + 0.10 * gravita).toFixed(5));
}

/* ---------------------------------------------------------------- pipeline */

function normalizzaVoci(xml, fonte, T, maxPerFeed) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('XML non valido');

  const out = [];
  for (const el of vociDi(doc).slice(0, maxPerFeed)) {
    const titolo = ripulisci(primoTesto(el, 'title'));
    if (!titolo) continue;
    const url = linkDi(el);
    if (!url) continue;
    const sintesi = accorcia(ripulisci(primoTesto(el, 'description', 'summary', 'encoded', 'content')));
    const data = dataDi(el) || new Date();
    const { tutti, contenuto } = assegnaTag(titolo, sintesi, fonte, T);
    out.push({
      id: `${fonte.id}:${Math.abs(hash(url))}`,
      titolo, sintesi, url,
      immagine: immagineDi(el),
      fonte: fonte.publisher,
      fonte_id: fonte.id,
      lingua: fonte.lang,
      data: data.toISOString(),
      tags: tutti,
      ambito: ambitoDi(tutti, T),
      _data: data.getTime(),
      _peso: fonte.weight,
      _impronta: improntaDi(titolo),
      _contenuto: contenuto,
    });
  }
  return out;
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return h;
}

/* Gli articoli salvati in cache perdono i campi interni non serializzabili
   (l'impronta è un Set) e li riacquistano al ritorno. */
const disidrata = (a) => { const { _impronta, ...resto } = a; return resto; };

const reidrata = (a, fonte) => ({
  ...a,
  _impronta: improntaDi(a.titolo),
  _peso: fonte.weight,
  _data: new Date(a.data).getTime(),
});

/* Costruisce il feed completo. `scarica` è iniettata: cambia fra app nativa,
   sviluppo e browser, ma la logica qui sotto resta identica.

   `cache` conserva per ogni testata i validatori HTTP e gli articoli gia'
   elaborati: alla richiesta successiva si manda If-None-Match/If-Modified-Since
   e se la testata risponde 304 non si scarica niente. Su rete mobile fa la
   differenza fra 2,5 MB e poche decine di KB per aggiornamento. */
async function costruisciFeed({ scarica, sorgenti, tassonomia, maxPerFeed = 40,
                                finestraOre = 72, suProgresso = () => {},
                                cache = { leggi: () => null, scrivi: () => {} } }) {
  const T = preparaTassonomia(tassonomia);
  const adesso = Date.now();
  const articoli = [];
  const diagnostica = [];
  let fatte = 0;

  let nonModificate = 0;

  await Promise.all(sorgenti.sources.map(async (fonte) => {
    try {
      const salvato = cache.leggi(fonte.id);
      const r = await scarica(fonte.url, salvato && salvato.validatori);

      let voci;
      if (r.stato === 304 && salvato && salvato.articoli) {
        voci = salvato.articoli.map((a) => reidrata(a, fonte));
        nonModificate += 1;
      } else {
        voci = normalizzaVoci(r.testo, fonte, T, maxPerFeed);
        cache.scrivi(fonte.id, {
          validatori: { etag: r.etag, modificato: r.modificato },
          articoli: voci.map(disidrata),
        });
      }
      articoli.push(...voci);
      diagnostica.push({
        id: fonte.id, nome: fonte.name, articoli: voci.length, errore: null,
        avviso: r.stato === 304 ? 'non modificato dall\'ultima volta' : null,
      });
    } catch (err) {
      diagnostica.push({ id: fonte.id, nome: fonte.name, articoli: 0, errore: String(err.message || err).slice(0, 120) });
    } finally {
      fatte += 1;
      suProgresso(fatte, sorgenti.sources.length);
    }
  }));

  // un solo articolo per URL, tenendo la fonte più autorevole. A parità di
  // peso vince sempre lo stesso feed (id in ordine alfabetico): senza questo
  // spareggio un articolo presente in due feed della stessa testata eredita
  // tag di provenienza diversi a ogni esecuzione.
  articoli.sort((a, b) => (b._peso - a._peso) || a.fonte_id.localeCompare(b.fonte_id));
  const visti = new Set();
  const unici = [];
  for (const a of articoli) {
    const chiave = a.url.split('?')[0].replace(/\/$/, '');
    if (visti.has(chiave)) continue;
    visti.add(chiave);
    unici.push(a);
  }

  const limite = adesso - finestraOre * 3600000;
  let recenti = unici.filter((a) => a._data >= limite && a._data <= adesso + 6 * 3600000);
  if (!recenti.length) recenti = unici;

  // raggruppa le notizie uguali
  const cluster = [];
  for (const art of recenti) {
    let trovato = false;
    for (const c of cluster) {
      if (somiglianza(art._impronta, c.impronta) >= 0.45) {
        c.membri.push(art);
        for (const p of art._impronta) c.impronta.add(p);
        trovato = true;
        break;
      }
    }
    if (!trovato) cluster.push({ impronta: new Set(art._impronta), membri: [art] });
  }

  const finali = [];
  for (const c of cluster) {
    c.membri.sort((a, b) => (b._peso - a._peso) || (a._data - b._data) || a.fonte_id.localeCompare(b.fonte_id));
    const principale = c.membri[0];
    const testate = new Set(c.membri.map((m) => m.fonte));
    principale.punteggio = punteggio(principale, testate.size, adesso);

    const viste = new Set([principale.fonte]);
    principale.anche_su = [];
    for (const m of c.membri.slice(1)) {
      if (viste.has(m.fonte)) continue;          // una testata compare una volta sola
      viste.add(m.fonte);
      principale.anche_su.push({ fonte: m.fonte, url: m.url, titolo: m.titolo });
    }
    principale.anche_su = principale.anche_su.slice(0, 5);

    // i duplicati arricchiscono solo con i tag dedotti dal loro testo
    const uniti = new Set(principale.tags);
    for (const m of c.membri.slice(1)) for (const t of m._contenuto) uniti.add(t);
    principale.tags = [...uniti].sort();
    principale.ambito = ambitoDi(principale.tags, T);
    finali.push(principale);
  }

  finali.sort((a, b) => b.punteggio - a.punteggio);
  for (const a of finali) {
    delete a._data; delete a._peso; delete a._impronta; delete a._contenuto;
  }

  const conteggio = new Map();
  for (const a of finali) for (const t of a.tags) conteggio.set(t, (conteggio.get(t) || 0) + 1);

  return {
    generato: new Date(adesso).toISOString(),
    finestra_ore: finestraOre,
    non_modificate: nonModificate,
    totale: finali.length,
    articoli: finali,
    tag: elencoTag(tassonomia).map((t) => ({ ...t, n: conteggio.get(t.slug) || 0 })),
    fonti: sorgenti.sources.map((f) => ({ id: f.id, nome: f.name, editore: f.publisher, url: f.url })),
    fonti_escluse: sorgenti.disabled || [],
    diagnostica: diagnostica.sort((a, b) => b.articoli - a.articoli),
  };
}

function elencoTag(tax) {
  const out = [];
  for (const [slug, label] of Object.entries(tax.categorie)) out.push({ slug, label, gruppo: 'categoria' });
  for (const [slug, label] of Object.entries(tax.ambito_globale)) out.push({ slug, label, gruppo: 'ambito' });
  for (const [slug, label] of Object.entries(tax.continenti)) out.push({ slug, label, gruppo: 'continente' });
  for (const [slug, v] of Object.entries(tax.nazioni)) out.push({ slug, label: v.label, gruppo: 'nazione', continente: v.continente });
  for (const [slug, v] of Object.entries(tax.temi)) out.push({ slug, label: v.label, gruppo: 'tema', categoria: v.categoria });
  return out;
}

window.Aggregatore = { costruisciFeed, compilaRegex, preparaTassonomia, corrisponde, ripulisci, accorcia };
