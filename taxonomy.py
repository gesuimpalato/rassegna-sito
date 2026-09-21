# -*- coding: utf-8 -*-
"""Tassonomia dei tag e regole di assegnazione automatica.

Il documento di progetto lasciava vuota la sezione "I tag per gli articoli
saranno:". Questa e' la proposta: tre livelli ortogonali, cosi' un articolo
puo' portare piu' tag contemporaneamente (come richiesto dalla specifica).

  1. CATEGORIA  -> geopolitica | economia | informatica
  2. AMBITO     -> mondo | <continente> | <nazione>   (la gerarchia della specifica)
  3. TEMA       -> sottotemi trasversali (ai, quantum-computing, mercati, ...)

Ogni voce ha due liste di parole chiave:
  chiavi   -> confrontate sul testo minuscolo, senza distinzione di maiuscole
  sigle    -> confrontate sul testo originale RISPETTANDO le maiuscole, perche'
              sigle come AI, UE, UK coincidono con parole comuni ("ai" in
              italiano, "uk"...) e in minuscolo produrrebbero falsi positivi.

Il confronto avviene sempre su parola intera (vedi compila_regex): senza
confini di parola "war" catturerebbe "warn" e "us" catturerebbe "bonus".
"""
import re

CATEGORIE = {
    "geopolitica": "Geopolitica",
    "economia": "Economia",
    "informatica": "Informatica",
}

CONTINENTI = {
    "europa": "Europa",
    "americhe": "Americhe",
    "asia": "Asia",
    "africa": "Africa",
    "oceania": "Oceania",
    "medio-oriente": "Medio Oriente",
}

AMBITO_GLOBALE = {"mondo": "Mondo"}

# slug -> (etichetta, continente, chiavi minuscole, sigle maiuscole)
NAZIONI = {
    "italia":       ("Italia", "europa", ["italia", "italy", "italie", "italian", "italiano", "italiana", "roma", "meloni"], []),
    "usa":          ("Stati Uniti", "americhe", ["united states", "america", "american", "americana", "washington", "stati uniti", "etats-unis", "trump", "white house", "casa bianca", "pentagon", "congress"], ["US", "U.S.", "USA"]),
    "cina":         ("Cina", "asia", ["china", "chinese", "cina", "chine", "cinese", "cinesi", "pechino", "beijing", "xi jinping", "shanghai"], []),
    "russia":       ("Russia", "europa", ["russia", "russian", "russie", "russo", "russa", "mosca", "moscow", "putin", "cremlino", "kremlin"], []),
    "ucraina":      ("Ucraina", "europa", ["ukraine", "ukrainian", "ucraina", "ucraino", "kyiv", "kiev", "zelensky", "zelenskyy"], []),
    "israele":      ("Israele", "medio-oriente", ["israel", "israeli", "israele", "israeliano", "netanyahu", "tel aviv", "gerusalemme", "jerusalem"], ["IDF"]),
    "palestina":    ("Palestina", "medio-oriente", ["palestina", "palestine", "palestinian", "palestinese", "palestinesi", "gaza", "west bank", "cisgiordania", "hamas"], []),
    "iran":         ("Iran", "medio-oriente", ["iran", "iranian", "iraniano", "teheran", "tehran", "khamenei"], []),
    "arabia-saudita": ("Arabia Saudita", "medio-oriente", ["saudi", "arabia saudita", "riyadh", "ryad"], []),
    "francia":      ("Francia", "europa", ["france", "french", "francia", "francese", "parigi", "paris", "macron", "francais"], []),
    "germania":     ("Germania", "europa", ["germany", "german", "germania", "tedesc*", "allemagne", "berlino", "berlin", "merz", "scholz", "bundesbank"], []),
    "regno-unito":  ("Regno Unito", "europa", ["britain", "british", "regno unito", "britannico", "britannica", "royaume-uni", "london", "londra", "westminster", "starmer"], ["UK", "U.K."]),
    "spagna":       ("Spagna", "europa", ["spain", "spanish", "spagna", "spagnolo", "espagne", "madrid", "sanchez"], []),
    "india":        ("India", "asia", ["india", "indian", "indiano", "inde", "new delhi", "modi"], []),
    "giappone":     ("Giappone", "asia", ["japan", "japanese", "giappone", "giapponese", "japon", "tokyo"], []),
    "corea-del-sud":("Corea del Sud", "asia", ["south korea", "corea del sud", "seoul", "coree du sud"], []),
    "corea-del-nord":("Corea del Nord", "asia", ["north korea", "corea del nord", "pyongyang", "kim jong"], []),
    "taiwan":       ("Taiwan", "asia", ["taiwan", "taipei", "taiwanese"], []),
    "brasile":      ("Brasile", "americhe", ["brazil", "brasile", "brasiliano", "bresil", "brasilia", "lula"], []),
    "messico":      ("Messico", "americhe", ["mexico", "messico", "mexique", "messicano", "sheinbaum"], []),
    "canada":       ("Canada", "americhe", ["canada", "canadian", "canadese", "ottawa", "carney", "canadien"], []),
    "argentina":    ("Argentina", "americhe", ["argentina", "argentino", "buenos aires", "milei"], []),
    "venezuela":    ("Venezuela", "americhe", ["venezuela", "venezuelano", "caracas", "maduro"], []),
    "turchia":      ("Turchia", "asia", ["turkey", "turchia", "turco", "turquie", "ankara", "erdogan", "istanbul"], []),
    "egitto":       ("Egitto", "africa", ["egypt", "egitto", "egiziano", "egypte", "cairo"], []),
    "nigeria":      ("Nigeria", "africa", ["nigeria", "nigeriano", "abuja", "lagos"], []),
    "sudafrica":    ("Sudafrica", "africa", ["south africa", "sudafrica", "afrique du sud", "johannesburg", "pretoria"], []),
    "australia":    ("Australia", "oceania", ["australia", "australian", "australiano", "canberra", "sydney"], []),
    "unione-europea": ("Unione Europea", "europa", ["european union", "unione europea", "union europeenne", "bruxelles", "brussels", "european commission", "commissione europea", "eurozona", "eurozone"], ["UE", "EU", "BCE", "ECB"]),
}

# slug -> (etichetta, categoria, chiavi minuscole, sigle maiuscole)
TEMI = {
    # --- Informatica: i sottotemi elencati nella specifica ---
    "ai":                ("Intelligenza artificiale", "informatica", ["artificial intelligence", "intelligenza artificiale", "intelligence artificielle", "machine learning", "deep learning", "large language model", "chatgpt", "openai", "anthropic", "gemini", "deepseek", "neural network", "rete neurale", "transformer", "generative ai", "chatbot", "copilot"], ["AI", "A.I.", "LLM", "LLMs", "GPT", "AGI"]),
    "quantum-computing": ("Quantum computing", "informatica", ["quantum comput*", "quantum bit", "qubit", "quantistic*", "quantum advantage", "quantum supremacy", "informatica quantistica", "calcolo quantistico", "ordinateur quantique"], []),
    "bioinformatica":    ("Bioinformatica", "informatica", ["bioinformatic*", "bioinformatica", "genomic", "genoma", "genome", "dna sequencing", "sequenziament*", "protein folding", "alphafold", "computational biolog*", "biologia computazionale", "crispr", "proteomic*"], []),
    "morphing":          ("Morphing e media sintetici", "informatica", ["morphing", "deepfake", "deep fake", "face swap", "synthetic media", "media sintetici", "image synthesis", "generative video", "video generativo", "text-to-video", "text-to-image", "diffusion model", "modello di diffusione*"], []),
    "videogiochi":       ("Videogiochi", "informatica", ["video game", "videogame", "videogioc*", "gaming", "playstation", "xbox", "nintendo", "steam deck", "esport", "game studio", "game developer"], []),
    "cybersecurity":     ("Cybersicurezza", "informatica", ["cybersecurity", "cyberattack", "cyberattacc*", "cybersicurezza", "ransomware", "malware", "data breach", "vulnerabilit*", "hacker", "exploit", "zero-day", "phishing", "spyware"], []),
    "hardware":          ("Hardware e chip", "informatica", ["chip", "semiconductor", "semicondutt*", "processor*", "nvidia", "tsmc", "asml", "intel", "data center", "datacenter", "scheda grafica"], ["GPU", "CPU", "AMD", "RAM"]),
    "software":          ("Software e piattaforme", "informatica", ["software", "operating system", "sistema operativo", "open source", "programming language", "linguaggio di programmazione", "developer", "sviluppator*", "cloud comput*", "kubernetes", "linux", "windows 11"], ["API", "SDK"]),
    "ricerca":           ("Ricerca", "informatica", ["peer-review", "algorithm", "algoritm*", "theorem", "teorem*", "mathematician", "matematic*", "mathematics", "matematica", "scientific study", "studio scientifico", "researchers", "ricercatori"], []),

    # --- Economia ---
    "mercati":           ("Mercati", "economia", ["stock market", "stocks", "borsa", "mercati", "listino", "wall street", "nasdaq", "dow jones", "ftse", "azioni", "bond", "obbligazion*", "yield", "rendiment*", "share price", "sell-off", "rally"], ["S&P", "MIB"]),
    "banche-centrali":   ("Banche centrali", "economia", ["central bank", "banca centrale", "federal reserve", "bank of england", "bank of japan", "interest rate", "tasso di interesse", "tassi di interesse", "monetary policy", "politica monetaria", "inflation", "inflazion*", "quantitative easing", "lagarde", "powell"], ["BCE", "ECB", "Fed", "BoE"]),
    "rating":            ("Agenzie di rating", "economia", ["rating agency", "agenzia di rating", "moody", "standard & poor", "s&p global", "fitch ratings", "downgrade", "declassament*", "credit rating", "merito creditizio", "outlook negativo"], []),
    "commercio":         ("Commercio e dazi", "economia", ["trade deal", "accordo commerciale", "tariff", "dazi", "trade war", "guerra commerciale", "export", "import", "sanction", "sanzion*", "embargo", "supply chain", "catena di fornitura", "free trade"], ["WTO", "OMC"]),
    "energia":           ("Energia", "economia", ["oil", "petrolio", "gas", "opec", "energy price", "prezzo dell'energia", "pipeline", "gasdott*", "renewable", "rinnovabil*", "nuclear plant", "centrale nucleare", "electricity", "elettricit*"], ["LNG", "OPEC"]),
    "lavoro":            ("Lavoro", "economia", ["unemployment", "disoccupazion*", "jobs report", "occupazione", "layoff", "licenziament*", "wages", "salari", "strike", "scioper*", "labour market", "mercato del lavoro"], []),

    # --- Geopolitica ---
    "conflitti":         ("Conflitti", "geopolitica", ["war", "guerra", "conflict", "conflitt", "military", "militar*", "missil*", "dron*", "airstrike", "raid", "troops", "truppe", "ceasefire", "cessate il fuoco", "offensive", "offensiva", "invasion", "invasione", "armi", "weapons", "battle", "battagli*"], []),
    "diplomazia":        ("Diplomazia", "geopolitica", ["summit", "vertic*", "treaty", "trattat*", "diplomat*", "diplomazia", "negotiation", "negoziat*", "talks", "colloqui", "alliance", "alleanz*", "united nations", "nazioni unite", "bilateral"], ["NATO", "ONU", "UN", "G7", "G20"]),
    "elezioni":          ("Elezioni", "geopolitica", ["election", "elezion*", "voters", "elettori", "ballot", "referendum", "sondagg", "candidate", "candidat*", "parliament", "parlament*", "coalition", "coalizion*", "primaries", "primarie"], []),
    "migrazioni":        ("Migrazioni", "geopolitica", ["migrant", "migrante", "migranti", "immigration", "immigrazion*", "refugee", "rifugiat*", "asylum", "asilo", "deport*", "border control", "frontier*"], []),
    "clima":             ("Clima e ambiente", "geopolitica", ["climate", "clima", "emission*", "emissioni", "global warming", "riscaldamento globale", "carbon", "carbonio", "wildfire", "incendi*", "flood", "alluvion*", "drought", "siccit*"], ["COP29", "COP30", "COP31"]),
}


def compila_regex(chiavi, sigle):
    """Compila le parole chiave in un'unica regex a confine di parola.

    Due convenzioni:
      "war"        -> parola intera, con plurale opzionale: war, wars (NON warn)
      "conflitt*"  -> radice: qualsiasi proseguimento (conflitto, conflitti, ...)

    I confini sono lookaround su [a-za-y0-9] invece di \\b, perche' \\b si
    comporta in modo inatteso con chiavi che finiscono per punteggiatura
    ("u.s.", "a.i.", "s&p").
    """
    pre, post = r"(?<![a-za-y0-9])", r"(?![a-za-y0-9])"
    pre = pre.replace("a-za-y", "a-za-\u00ff")
    post = post.replace("a-za-y", "a-za-\u00ff")

    def pattern(k, sigla=False):
        if k.endswith("*"):
            return pre + re.escape(k[:-1])
        suffisso = "" if sigla else r"(?:s|i)?"
        return pre + re.escape(k) + suffisso + post

    r_min = None
    if chiavi:
        parti = [pattern(k) for k in sorted(chiavi, key=len, reverse=True)]
        r_min = re.compile("|".join(parti), re.IGNORECASE)
    r_sig = None
    if sigle:
        parti = [pattern(s, sigla=True) for s in sorted(sigle, key=len, reverse=True)]
        r_sig = re.compile("|".join(parti))
    return r_min, r_sig


def _indicizza(d):
    return {slug: compila_regex(v[2], v[3]) for slug, v in d.items()}


REGEX_NAZIONI = _indicizza(NAZIONI)
REGEX_TEMI = _indicizza(TEMI)


def corrisponde(regexes, testo_minuscolo, testo_originale) -> bool:
    r_min, r_sig = regexes
    if r_min is not None and r_min.search(testo_minuscolo):
        return True
    if r_sig is not None and r_sig.search(testo_originale):
        return True
    return False


def tutti_i_tag():
    """Ritorna il vocabolario completo dei tag, per la UI dei filtri."""
    out = []
    for slug, label in CATEGORIE.items():
        out.append({"slug": slug, "label": label, "gruppo": "categoria"})
    for slug, label in AMBITO_GLOBALE.items():
        out.append({"slug": slug, "label": label, "gruppo": "ambito"})
    for slug, label in CONTINENTI.items():
        out.append({"slug": slug, "label": label, "gruppo": "continente"})
    for slug, (label, cont, _k, _s) in NAZIONI.items():
        out.append({"slug": slug, "label": label, "gruppo": "nazione", "continente": cont})
    for slug, (label, cat, _k, _s) in TEMI.items():
        out.append({"slug": slug, "label": label, "gruppo": "tema", "categoria": cat})
    return out


def esporta() -> dict:
    """Tassonomia in forma di dati puri, per il gemello JavaScript.

    L'app impacchettata aggrega le notizie da sola, quindi le regole dei tag
    servono anche in JS: invece di riscriverle (e farle divergere) si esportano
    da qui, che resta l'unica fonte di verita'.
    """
    return {
        "categorie": CATEGORIE,
        "continenti": CONTINENTI,
        "ambito_globale": AMBITO_GLOBALE,
        "nazioni": {s: {"label": v[0], "continente": v[1], "chiavi": v[2], "sigle": v[3]}
                    for s, v in NAZIONI.items()},
        "temi": {s: {"label": v[0], "categoria": v[1], "chiavi": v[2], "sigle": v[3]}
                 for s, v in TEMI.items()},
    }


if __name__ == "__main__":
    import json as _json
    import os as _os
    dati = esporta()
    percorso = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "web", "taxonomy.json")
    with open(percorso, "w", encoding="utf-8") as f:
        _json.dump(dati, f, ensure_ascii=False, indent=1)
    print(f"{len(dati['nazioni'])} nazioni, {len(dati['temi'])} temi -> {percorso}")
