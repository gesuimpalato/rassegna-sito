# -*- coding: utf-8 -*-
"""Test di regressione sull'assegnazione dei tag.

Uso: python3 test_taxonomy.py
Servono a bloccare i falsi positivi da sottostringa: senza confini di parola
"war" catturava "warn" e "us" catturava "bonus"/"virus"/"campus".
"""
import sys
import taxonomy as tax

CASI = [
    # (testo, tag, atteso)
    ("Labour MPs warn against mansion tax change in Budget", "conflitti", False),
    ("Russia launches new war in Ukraine", "conflitti", True),
    ("Two wars escalate in the region", "conflitti", True),
    ("Conflitto armato e truppe al confine", "conflitti", True),
    ("Droni russi sopra la Polonia", "conflitti", True),
    ("Missili e missile difensivo", "conflitti", True),
    ("Software warehouse logistics", "conflitti", False),
    ("Company reports bonus for all staff", "usa", False),
    ("Virus spreads across campus", "usa", False),
    ("Trump meets US officials in Washington", "usa", True),
    ("Gli Stati Uniti hanno annunciato nuovi dazi", "usa", True),
    ("Ho parlato ai mercati italiani", "ai", False),
    ("OpenAI releases new AI model", "ai", True),
    ("Un nuovo modello di intelligenza artificiale", "ai", True),
    ("Le elezioni regionali tedesche", "elezioni", True),
    ("Nuova vulnerabilita' critica scoperta", "cybersecurity", True),
    ("Researchers build a quantum computer with 1000 qubits", "quantum-computing", True),
    ("Deepfake video used in fraud", "morphing", True),
    ("Moody's downgrades the sovereign rating", "rating", True),
    ("La BCE alza i tassi di interesse", "banche-centrali", True),
]


def main():
    falliti = []
    for testo, tag, atteso in CASI:
        regex = tax.REGEX_TEMI.get(tag) or tax.REGEX_NAZIONI.get(tag)
        if regex is None:
            falliti.append((testo, tag, "tag inesistente"))
            continue
        ottenuto = tax.corrisponde(regex, testo.lower(), testo)
        esito = "ok " if ottenuto == atteso else "XX "
        print(f"{esito} {tag:18s} atteso={str(atteso):5s} ottenuto={str(ottenuto):5s} | {testo}")
        if ottenuto != atteso:
            falliti.append((testo, tag, f"atteso {atteso}, ottenuto {ottenuto}"))

    print()
    if falliti:
        print(f"{len(falliti)}/{len(CASI)} CASI FALLITI")
        for t, tag, why in falliti:
            print(f"  - [{tag}] {t}  ({why})")
        return 1
    print(f"Tutti i {len(CASI)} casi passati.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
