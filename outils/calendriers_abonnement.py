# -*- coding: utf-8 -*-
"""
Calendriers d'abonnement (webcal) : un fichier .ics par médecin, régénéré par GitHub toutes les heures
à partir du planning publié dans Firestore. L'iPhone (ou Android, Outlook…) abonné se met à jour tout seul.

- Lecture : API REST Firestore, sans compte (les règles autorisent la lecture à qui connaît le code d'équipe).
- Le code d'équipe vient du secret GitHub CODE_EQUIPE (jamais dans le dépôt).
- Adresse de chaque calendrier : dist/cal/<jeton>.ics, jeton = HMAC-SHA256(code d'équipe, "cal:" + initiales),
  24 premiers caractères hexadécimaux. La page calcule le même jeton (calToken dans src/online_core.js).
- Sans secret, sans configuration Firebase ou sans planning publié : rien n'est produit (le site reste construit).

Usage : CODE_EQUIPE=... python outils/calendriers_abonnement.py
Test  : FIRESTORE_JSON=fichier.json (réponse REST enregistrée) remplace l'appel réseau.
"""
import datetime as dt
import hashlib
import hmac
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(RACINE, "dist")
CONFIG = os.path.join(RACINE, "config", "firebase.json")
HALF = {"M": "matin", "AM": "après-midi"}


def jeton(code, ini):
    return hmac.new(code.encode(), ("cal:" + ini).encode(), hashlib.sha256).hexdigest()[:24]


def decode(v):
    """Valeur typée de l'API REST Firestore → valeur Python."""
    if "stringValue" in v: return v["stringValue"]
    if "integerValue" in v: return int(v["integerValue"])
    if "doubleValue" in v: return float(v["doubleValue"])
    if "booleanValue" in v: return v["booleanValue"]
    if "nullValue" in v: return None
    if "timestampValue" in v: return v["timestampValue"]
    if "mapValue" in v: return {k: decode(x) for k, x in v["mapValue"].get("fields", {}).items()}
    if "arrayValue" in v: return [decode(x) for x in v["arrayValue"].get("values", [])]
    return None


def lire_planning(cfg, code):
    if os.environ.get("FIRESTORE_JSON"):
        with open(os.environ["FIRESTORE_JSON"], encoding="utf-8") as f:
            brut = json.load(f)
    else:
        chemin = f"espaces/{urllib.parse.quote(code)}/planning/publie"
        url = (f"https://firestore.googleapis.com/v1/projects/{cfg['projectId']}/databases/(default)/documents/"
               f"{chemin}?key={urllib.parse.quote(cfg['apiKey'])}")
        # Aucune erreur ici ne doit bloquer la publication du site : on avertit et on continue.
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                brut = json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                print("Aucun planning publié : pas de calendrier à produire.")
            elif e.code == 403:
                print("::warning::Accès refusé par Firestore : le secret CODE_EQUIPE ne correspond pas au code "
                      "des règles de sécurité. Calendriers d'abonnement non mis à jour.")
            else:
                print(f"::warning::Firestore a répondu {e.code} : calendriers d'abonnement non mis à jour.")
            return None
        except Exception as e:  # réseau indisponible, etc.
            print(f"::warning::Firestore injoignable ({e}) : calendriers d'abonnement non mis à jour.")
            return None
    return {k: decode(v) for k, v in brut.get("fields", {}).items()}


def jour_date(d):
    return dt.date(1970, 1, 1) + dt.timedelta(days=int(d))


def hhmm(minutes):
    return f"{int(minutes) // 60:02d}{int(minutes) % 60:02d}00"


def esc(s):
    return str(s).replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def plier(ligne):
    b = ligne.encode("utf-8")
    if len(b) <= 75:
        return ligne
    morceaux, cur, n = [], "", 0
    for ch in ligne:
        l = len(ch.encode("utf-8"))
        if n + l > (74 if morceaux else 75):
            morceaux.append(cur); cur, n = "", 0
        cur += ch; n += l
    morceaux.append(cur)
    return "\r\n ".join(morceaux)


VTZ = ["BEGIN:VTIMEZONE", "TZID:Europe/Paris", "BEGIN:DAYLIGHT", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0200", "TZNAME:CEST",
       "DTSTART:19700329T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU", "END:DAYLIGHT", "BEGIN:STANDARD",
       "TZOFFSETFROM:+0200", "TZOFFSETTO:+0100", "TZNAME:CET", "DTSTART:19701025T030000",
       "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "END:STANDARD", "END:VTIMEZONE"]


def calendriers(pub):
    """{ini: texte .ics} — mêmes événements et mêmes UID que les fichiers téléchargés depuis la page."""
    par_medecin = {}
    for cle, val in pub.get("cases", {}).items():
        d, h, code = cle.split("_", 2)
        for ini in [x.strip().upper() for x in str(val or "").split("/") if x.strip()]:
            par_medecin.setdefault(ini, {}).setdefault(int(d), {})[h] = code
    postes = pub.get("postes", {})
    titre = pub.get("titre", "Planning radiologie")
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = {}
    for ini in sorted(set(par_medecin) | set(pub.get("medecins", []))):
        L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Service de radiologie//Planning//FR", "CALSCALE:GREGORIAN",
             "METHOD:PUBLISH", f"X-WR-CALNAME:{esc('Planning radio ' + ini)}", "X-WR-TIMEZONE:Europe/Paris",
             "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H", *VTZ]
        for d in sorted(par_medecin.get(ini, {})):
            hs = par_medecin[ini][d]
            if hs.get("M") and hs.get("M") == hs.get("AM"):
                blocs = [(hs["M"], "M", "AM", "journée")]
            else:
                blocs = [(hs[h], h, h, HALF[h]) for h in ("M", "AM") if hs.get(h)]
            for code, h1, h2, lab in blocs:
                p = postes.get(code) or {"label": code, "site": "", "adresse": "", "M": [510, 780], "AM": [810, 1080]}
                jour = jour_date(d)
                lieu = p.get("site", "") + (f", {p['adresse']}" if p.get("adresse") else "")
                L += ["BEGIN:VEVENT", f"UID:{ini}-{jour:%Y%m%d}-{h1}{h2}-{code}@planning-radiologie", f"DTSTAMP:{stamp}",
                      f"DTSTART;TZID=Europe/Paris:{jour:%Y%m%d}T{hhmm(p[h1][0])}",
                      f"DTEND;TZID=Europe/Paris:{jour:%Y%m%d}T{hhmm(p[h2][1])}",
                      f"SUMMARY:{esc(p.get('label', code) + ' — ' + p.get('site', ''))}", f"LOCATION:{esc(lieu)}",
                      f"DESCRIPTION:{esc(f'{titre}. Vacation du {lab} ({code}).')}", "TRANSP:OPAQUE", "END:VEVENT"]
        L.append("END:VCALENDAR")
        out[ini] = "\r\n".join(plier(l) for l in L) + "\r\n"
    return out


def main():
    code = os.environ.get("CODE_EQUIPE", "").strip()
    if not code:
        print("Secret CODE_EQUIPE absent : calendriers d'abonnement non produits.")
        return
    if not os.path.exists(CONFIG):
        print("config/firebase.json absent : calendriers d'abonnement non produits.")
        return
    with open(CONFIG, encoding="utf-8") as f:
        cfg = json.load(f)
    pub = lire_planning(cfg, code)
    if not pub:
        return
    dossier = os.path.join(DIST, "cal")
    os.makedirs(dossier, exist_ok=True)
    cals = calendriers(pub)
    for ini, txt in cals.items():
        with open(os.path.join(dossier, jeton(code, ini) + ".ics"), "w", encoding="utf-8", newline="") as f:
            f.write(txt)
    # page vide : empêche de lister le dossier
    with open(os.path.join(dossier, "index.html"), "w", encoding="utf-8") as f:
        f.write("<!doctype html><title>Planning radio</title>")
    print(f"{len(cals)} calendriers d'abonnement produits ({pub.get('titre', '')}).")


if __name__ == "__main__":
    main()
