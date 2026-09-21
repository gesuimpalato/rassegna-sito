# -*- coding: utf-8 -*-
"""Aggregatore di notizie: scarica i feed RSS/Atom, assegna i tag,
raggruppa le notizie duplicate e calcola l'ordine di importanza.

Output: data/feed.json, consumato dall'app in web/.

Nota sul copyright: si salvano solo titolo, sintesi breve fornita dal feed
e link alla fonte. Il testo integrale resta sul sito dell'editore, dove
l'utente viene mandato al tocco sulla card.

Uso:  python3 aggregator.py [--max-per-feed 40] [--out data/feed.json]
"""
from __future__ import annotations

import argparse
import concurrent.futures
import html
import json
import os
import re
import sys
import time
import urllib.request
import urllib.error
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime

import taxonomy as tax

HERE = os.path.dirname(os.path.abspath(__file__))
UA = "Mozilla/5.0 (compatible; BlogTommaso/1.0; aggregatore RSS personale)"

NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "rdf": "http://purl.org/rss/1.0/",
    "content": "http://purl.org/rss/1.0/modules/content/",
    "dc": "http://purl.org/dc/elements/1.1/",
    "media": "http://search.yahoo.com/mrss/",
}

# parole che non aiutano a distinguere due titoli
STOPWORDS = set("""
a ai al alla alle allo agli an and as at che chi come con da dal dalla de del della
delle dei degli des di do du e ed el en et for from gli i il in into is it its l la
le les lo of on or per che pour su sui sul sulla the to tra un una uno und with y
after over says say new first two his her their they this that as be been has have
""".split())


# --------------------------------------------------------------------------
# scaricamento e parsing
# --------------------------------------------------------------------------

CACHE_DIR = os.path.join(HERE, ".cache")


def _file_cache(url: str) -> str:
    nome = re.sub(r"[^a-zA-Z0-9]+", "_", url)[:120]
    return os.path.join(CACHE_DIR, nome + ".xml")


def scarica(url: str, timeout: int = 25, tentativi: int = 2) -> tuple:
    """Scarica un feed. Ritorna (contenuto, da_cache).

    Alcune testate (p.es. CACM) rispondono 403 a intermittenza: in quel caso
    si riusa l'ultima risposta valida salvata su disco, cosi' una notizia gia'
    acquisita non sparisce dal feed per un errore temporaneo della fonte.
    """
    ultimo_errore = None
    for n in range(tentativi):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": UA,
                "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
            })
            with urllib.request.urlopen(req, timeout=timeout) as r:
                raw = r.read()
            os.makedirs(CACHE_DIR, exist_ok=True)
            with open(_file_cache(url), "wb") as f:
                f.write(raw)
            return raw, False
        except Exception as ex:
            ultimo_errore = ex
            if n + 1 < tentativi:
                time.sleep(1.5)

    percorso = _file_cache(url)
    if os.path.exists(percorso):
        with open(percorso, "rb") as f:
            return f.read(), True
    raise ultimo_errore


def _testo(el) -> str:
    if el is None:
        return ""
    txt = "".join(el.itertext()) if len(el) else (el.text or "")
    return txt.strip()


def _primo(entry, *percorsi) -> str:
    for p in percorsi:
        el = entry.find(p, NS)
        if el is not None:
            t = _testo(el)
            if t:
                return t
    return ""


def pulisci_html(s: str) -> str:
    """Rimuove i tag e normalizza gli spazi della sintesi fornita dal feed."""
    s = re.sub(r"(?is)<(script|style).*?</\1>", " ", s)
    s = re.sub(r"(?s)<[^>]+>", " ", s)
    s = html.unescape(s)
    s = s.replace(" ", " ")
    s = re.sub(r"\s+", " ", s).strip()
    return s


def taglia(s: str, n: int = 280) -> str:
    """Accorcia la sintesi a un'anteprima breve, troncando a fine parola."""
    if len(s) <= n:
        return s
    tronco = s[:n].rsplit(" ", 1)[0].rstrip(" ,;:.-—–")
    return tronco + "…"


def _data(entry) -> datetime | None:
    grezza = _primo(entry, "pubDate", "atom:published", "atom:updated", "dc:date", "{http://purl.org/dc/elements/1.1/}date")
    if not grezza:
        return None
    try:
        d = parsedate_to_datetime(grezza)
    except Exception:
        try:
            d = datetime.fromisoformat(grezza.replace("Z", "+00:00"))
        except Exception:
            return None
    if d is None:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc)


def _link(entry) -> str:
    el = entry.find("link", NS)
    if el is not None and _testo(el):
        return _testo(el)
    for el in entry.findall("atom:link", NS):
        rel = el.get("rel") or "alternate"
        if rel == "alternate" and el.get("href"):
            return el.get("href")
    el = entry.find("atom:link", NS)
    if el is not None and el.get("href"):
        return el.get("href")
    el = entry.find("{http://purl.org/rss/1.0/}link")
    if el is not None and _testo(el):
        return _testo(el)
    el = entry.find("guid", NS)
    g = _testo(el)
    return g if g.startswith("http") else ""


def _immagine(entry) -> str:
    for el in entry.findall("media:content", NS) + entry.findall("media:thumbnail", NS):
        if el.get("url"):
            return el.get("url")
    el = entry.find("enclosure", NS)
    if el is not None and (el.get("type") or "").startswith("image") and el.get("url"):
        return el.get("url")
    blob = _primo(entry, "content:encoded", "description")
    m = re.search(r'<img[^>]+src=["\']([^"\']+)', blob or "")
    return m.group(1) if m else ""


def parse_feed(raw: bytes) -> list:
    root = ET.fromstring(raw)
    entries = (root.findall(".//item")
               or root.findall(".//{http://purl.org/rss/1.0/}item")
               or root.findall(".//atom:entry", NS))
    return entries


# --------------------------------------------------------------------------
# tagging
# --------------------------------------------------------------------------

def assegna_tag(titolo: str, sintesi: str, fonte: dict) -> tuple:
    """Tag dell'articolo.

    Ritorna (tutti, da_contenuto): i primi includono i tag ereditati dalla
    fonte (p.es. France 24 -> "europa"), i secondi solo quelli dedotti dal
    testo. La distinzione serve quando si fondono notizie duplicate: i tag
    di provenienza di una testata non devono finire su una notizia che parla
    d'altro.
    """
    originale = f" {titolo} {sintesi} "
    minuscolo = originale.lower()
    da_fonte = set(fonte.get("tags", [])) | set(fonte.get("categories", []))
    tags = set()

    nazioni_trovate = set()
    for slug, regex in tax.REGEX_NAZIONI.items():
        if tax.corrisponde(regex, minuscolo, originale):
            nazioni_trovate.add(slug)
            tags.add(slug)
            tags.add(tax.NAZIONI[slug][1])          # il continente della nazione

    for slug, regex in tax.REGEX_TEMI.items():
        if tax.corrisponde(regex, minuscolo, originale):
            tags.add(slug)
            tags.add(tax.TEMI[slug][1])             # la categoria del tema

    # gerarchia della specifica: due o piu' nazioni di continenti diversi
    # => la notizia riguarda i rapporti fra Paesi, quindi e' "mondo"
    continenti = {tax.NAZIONI[n][1] for n in nazioni_trovate}
    if len(continenti) >= 2:
        tags.add("mondo")

    return sorted(tags | da_fonte), sorted(tags)


def ambito(tags: list) -> str:
    """Livello gerarchico dominante: mondo > continente > nazione."""
    if "mondo" in tags:
        return "mondo"
    if any(t in tax.CONTINENTI for t in tags):
        return "continente"
    if any(t in tax.NAZIONI for t in tags):
        return "nazione"
    return "mondo"


# --------------------------------------------------------------------------
# deduplica e punteggio
# --------------------------------------------------------------------------

def impronta(titolo: str) -> frozenset:
    parole = re.findall(r"[a-zà-ÿ0-9]+", titolo.lower())
    utili = {p for p in parole if len(p) > 3 and p not in STOPWORDS}
    return frozenset(utili)


def simili(a: frozenset, b: frozenset) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def raggruppa(articoli: list) -> list:
    """Raggruppa gli articoli che raccontano la stessa notizia.

    Ritorna una lista di cluster; il primo elemento di ogni cluster e'
    l'articolo della fonte piu' autorevole, gli altri diventano 'anche_su'.
    """
    cluster = []
    for art in articoli:
        imp = art["_impronta"]
        for c in cluster:
            if simili(imp, c["impronta"]) >= 0.45:
                c["membri"].append(art)
                c["impronta"] = c["impronta"] | imp
                break
        else:
            cluster.append({"impronta": imp, "membri": [art]})
    return cluster


SEGNALI = [
    (re.compile(p, re.IGNORECASE), v) for p, v in (
        (r"(?<![a-zà-ÿ])(war|wars|guerra|guerre|invasion[ei]?)(?![a-zà-ÿ])", .30),
        (r"(?<![a-zà-ÿ])(ceasefire|cessate il fuoco|tregua)(?![a-zà-ÿ])", .25),
        (r"(?<![a-zà-ÿ])(crisis|crisi|collapse|crollo)(?![a-zà-ÿ])", .20),
        (r"(?<![a-zà-ÿ])(sanction|sanctions|sanzion\w*)(?![a-zà-ÿ])", .18),
        (r"(?<![a-zà-ÿ])(election|elections|elezion\w*)(?![a-zà-ÿ])", .18),
        (r"(?<![a-zà-ÿ])(summit|vertice|vertici)(?![a-zà-ÿ])", .15),
        (r"(?<![a-zà-ÿ])(emergency|emergenza)(?![a-zà-ÿ])", .22),
        (r"(?<![a-zà-ÿ])(downgrade[sd]?|declassament\w*)(?![a-zà-ÿ])", .20),
        (r"(?<![a-zà-ÿ])(breakthrough|svolta|record)(?![a-zà-ÿ])", .14),
        (r"(?<![a-zà-ÿ])(dead|killed|morti|uccis\w*|vittime)(?![a-zà-ÿ])", .22),
    )
]


def punteggio(art: dict, corroborazione: int, adesso: datetime) -> float:
    """Importanza = autorevolezza + freschezza + copertura multipla + segnali."""
    peso_fonte = art["_peso"]

    ore = max(0.0, (adesso - art["_dt"]).total_seconds() / 3600.0)
    freschezza = 0.5 ** (ore / 18.0)          # dimezza ogni 18 ore

    # quante testate distinte raccontano la stessa notizia
    copertura = min(corroborazione, 6) / 6.0

    gravita = 0.0
    for regex, valore in SEGNALI:
        if regex.search(art["titolo"]) or regex.search(art["sintesi"]):
            gravita += valore
    gravita = min(gravita, 0.6)

    return round(0.40 * peso_fonte + 0.32 * freschezza + 0.18 * copertura + 0.10 * gravita, 5)


# --------------------------------------------------------------------------
# pipeline
# --------------------------------------------------------------------------

def raccogli_fonte(fonte: dict, max_per_feed: int) -> tuple:
    """Scarica e normalizza una singola fonte. Ritorna (articoli, errore)."""
    try:
        raw, da_cache = scarica(fonte["url"])
        entries = parse_feed(raw)
    except Exception as ex:
        return [], f"{type(ex).__name__}: {str(ex)[:120]}"
    avviso = "fonte non raggiungibile: uso l'ultima copia in cache" if da_cache else None

    out = []
    for e in entries[:max_per_feed]:
        titolo = pulisci_html(_primo(e, "title", "atom:title", "{http://purl.org/rss/1.0/}title"))
        if not titolo:
            continue
        link = _link(e)
        if not link:
            continue
        grezza = _primo(e, "description", "atom:summary", "{http://purl.org/rss/1.0/}description", "content:encoded", "atom:content")
        sintesi = taglia(pulisci_html(grezza))
        dt = _data(e) or datetime.now(timezone.utc)
        tags, tags_contenuto = assegna_tag(titolo, sintesi, fonte)
        out.append({
            "id": f"{fonte['id']}:{abs(hash(link)) % (10 ** 12)}",
            "titolo": titolo,
            "sintesi": sintesi,
            "url": link,
            "immagine": _immagine(e),
            "fonte": fonte["publisher"],
            "fonte_id": fonte["id"],
            "lingua": fonte["lang"],
            "data": dt.isoformat(),
            "tags": tags,
            "ambito": ambito(tags),
            "_tags_contenuto": tags_contenuto,
            "_dt": dt,
            "_peso": fonte["weight"],
            "_impronta": impronta(titolo),
        })
    return out, avviso


def costruisci(max_per_feed: int, finestra_ore: int) -> dict:
    with open(os.path.join(HERE, "web", "sources.json"), encoding="utf-8") as f:
        catalogo = json.load(f)
    fonti = catalogo["sources"]

    adesso = datetime.now(timezone.utc)
    limite = adesso - timedelta(hours=finestra_ore)

    articoli, diagnostica = [], []
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
        futuri = {pool.submit(raccogli_fonte, f, max_per_feed): f for f in fonti}
        for fut in concurrent.futures.as_completed(futuri):
            f = futuri[fut]
            arts, err = fut.result()
            da_cache = bool(err) and "cache" in err
            diagnostica.append({"id": f["id"], "nome": f["name"], "articoli": len(arts),
                                "errore": None if da_cache else err,
                                "avviso": err if da_cache else None})
            if err:
                print(f"  ! {f['name']}: {err}", file=sys.stderr)
            articoli.extend(arts)

    # deduplica per URL
    visti, unici = set(), []
    # a parità di peso vince sempre lo stesso feed (id in ordine alfabetico):
    # senza questo spareggio un articolo presente in due feed della stessa
    # testata eredita tag di provenienza diversi a ogni esecuzione
    for a in sorted(articoli, key=lambda x: (-x["_peso"], x["fonte_id"])):
        chiave = a["url"].split("?")[0].rstrip("/")
        if chiave in visti:
            continue
        visti.add(chiave)
        unici.append(a)

    # finestra temporale (scarta articoli datati e date nel futuro)
    recenti = [a for a in unici if limite <= a["_dt"] <= adesso + timedelta(hours=6)]
    if not recenti:                       # fallback: feed tutti vecchi
        recenti = unici

    # raggruppa le notizie uguali e calcola il punteggio
    finali = []
    for c in raggruppa(recenti):
        membri = sorted(c["membri"], key=lambda x: (-x["_peso"], x["_dt"], x["fonte_id"]))
        principale = membri[0]
        testate = {m["fonte"] for m in membri}
        principale["punteggio"] = punteggio(principale, len(testate), adesso)
        altre, viste = [], {principale["fonte"]}
        for m in membri[1:]:
            if m["fonte"] in viste:            # una testata compare una volta sola
                continue
            viste.add(m["fonte"])
            altre.append({"fonte": m["fonte"], "url": m["url"], "titolo": m["titolo"]})
        principale["anche_su"] = altre[:5]
        # i duplicati arricchiscono la notizia principale, ma solo con i tag
        # dedotti dal loro testo: quelli di provenienza restano alla fonte
        uniti = set(principale["tags"])
        for m in membri[1:]:
            uniti.update(m["_tags_contenuto"])
        principale["tags"] = sorted(uniti)
        principale["ambito"] = ambito(principale["tags"])
        finali.append(principale)

    finali.sort(key=lambda x: -x["punteggio"])
    for a in finali:
        for k in ("_dt", "_peso", "_impronta", "_tags_contenuto"):
            a.pop(k, None)

    conteggio = {}
    for a in finali:
        for t in a["tags"]:
            conteggio[t] = conteggio.get(t, 0) + 1

    return {
        "generato": adesso.isoformat(),
        "finestra_ore": finestra_ore,
        "totale": len(finali),
        "articoli": finali,
        "tag": [dict(t, n=conteggio.get(t["slug"], 0)) for t in tax.tutti_i_tag()],
        "fonti": [{"id": f["id"], "nome": f["name"], "editore": f["publisher"], "url": f["url"]} for f in fonti],
        "fonti_escluse": catalogo.get("disabled", []),
        "diagnostica": sorted(diagnostica, key=lambda d: -d["articoli"]),
    }


def main():
    ap = argparse.ArgumentParser(description="Aggregatore RSS per l'app Blog Tommaso")
    ap.add_argument("--max-per-feed", type=int, default=40)
    ap.add_argument("--finestra-ore", type=int, default=72, help="scarta gli articoli piu' vecchi di N ore")
    ap.add_argument("--out", default=os.path.join(HERE, "web", "data", "feed.json"))
    args = ap.parse_args()

    t0 = time.time()
    print(f"Scarico {len(json.load(open(os.path.join(HERE,'web','sources.json'),encoding='utf-8'))['sources'])} fonti…", file=sys.stderr)
    feed = costruisci(args.max_per_feed, args.finestra_ore)
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(feed, f, ensure_ascii=False, indent=1)
    ok = sum(1 for d in feed["diagnostica"] if not d["errore"])
    print(f"OK  {feed['totale']} notizie da {ok}/{len(feed['diagnostica'])} fonti "
          f"in {time.time()-t0:.1f}s -> {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
