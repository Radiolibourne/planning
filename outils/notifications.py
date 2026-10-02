# -*- coding: utf-8 -*-
"""
Notifications sur les téléphones (Web Push), envoyées par GitHub toutes les heures.

Événements :
  1. un planning est publié (ou republié)             -> tous les abonnés ;
  2. date limite de dépôt des absences dans 3 jours, puis la veille
     -> seulement les médecins qui n'ont encore rien déclaré pour la période (ni absence, ni « aucune absence »).

Données (Firestore, lues avec la clé de compte de service FIREBASE_CLE, qui contourne les règles) :
  abonnements/{uid}_{n}                        {uid, ini, endpoint, p256dh, auth, majLe}   (écrits par le site)
  espaces/{code}/planning/publie, config/saisie, indispos/*, declarations/*
  espaces/{code}/config/notifications          état : ce qui a déjà été envoyé (écrit ici)

Clés VAPID (identité de l'expéditeur) : dérivées de FIREBASE_CLE, rien à configurer.
  --cle-publique   écrit la clé publique (dist/notifications.json, lue par le site)

Sans FIREBASE_CLE ou sans CODE_EQUIPE : rien n'est fait.
Chiffrement : RFC 8291 (aes128gcm) et RFC 8292 (VAPID), avec la bibliothèque cryptography seulement.
"""
import base64
import datetime as dt
import hashlib
import hmac
import json
import os
import struct
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JOUR_MS = 86400000
RAPPELS = (3, 1)          # jours avant la date limite


def b64u(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def unb64u(s):
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


# ------------------------------------------------------------------ clés VAPID (dérivées de la clé de service)
def cle_vapid(firebase_cle_json):
    from cryptography.hazmat.primitives.asymmetric import ec
    cle = json.loads(firebase_cle_json)
    graine = hmac.new(cle["private_key"].encode(), b"planning-radio-vapid-v1", hashlib.sha256).digest()
    n = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551
    d = int.from_bytes(graine, "big") % (n - 1) + 1
    return ec.derive_private_key(d, ec.SECP256R1())


def publique_brute(cle_privee):
    from cryptography.hazmat.primitives import serialization
    return cle_privee.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)


# ------------------------------------------------------------------ Web Push : chiffrement et en-têtes
def _hkdf(sel, ikm, info, n):
    prk = hmac.new(sel, ikm, hashlib.sha256).digest()
    return hmac.new(prk, info + b"\x01", hashlib.sha256).digest()[:n]


def chiffrer(message, p256dh_b64, auth_b64, sel=None, ephemere=None):
    """Corps chiffré aes128gcm (RFC 8291) pour l'abonnement (p256dh, auth)."""
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    ua_pub = unb64u(p256dh_b64)
    secret = unb64u(auth_b64)
    ephemere = ephemere or ec.generate_private_key(ec.SECP256R1())
    as_pub = publique_brute(ephemere)
    partage = ephemere.exchange(ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_pub))
    ikm = _hkdf(secret, partage, b"WebPush: info\x00" + ua_pub + as_pub, 32)
    sel = sel or os.urandom(16)
    cek = _hkdf(sel, ikm, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = _hkdf(sel, ikm, b"Content-Encoding: nonce\x00", 12)
    chiffre = AESGCM(cek).encrypt(nonce, message + b"\x02", None)
    return sel + struct.pack(">I", 4096) + bytes([len(as_pub)]) + as_pub + chiffre


def jeton_vapid(endpoint, cle_privee, sujet, maintenant=None):
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
    u = urllib.parse.urlsplit(endpoint)
    entete = b64u(json.dumps({"typ": "JWT", "alg": "ES256"}, separators=(",", ":")).encode())
    corps = b64u(json.dumps({"aud": f"{u.scheme}://{u.netloc}", "exp": int((maintenant or time.time()) + 12 * 3600),
                             "sub": sujet}, separators=(",", ":")).encode())
    signe = f"{entete}.{corps}".encode()
    r, s = decode_dss_signature(cle_privee.sign(signe, ec.ECDSA(hashes.SHA256())))
    return f"{entete}.{corps}.{b64u(r.to_bytes(32, 'big') + s.to_bytes(32, 'big'))}"


def envoyer(abonnement, charge, cle_privee, sujet, ouvrir=urllib.request.urlopen):
    """Envoie une notification. Renvoie le code HTTP (201 = reçu ; 404 / 410 = abonnement expiré)."""
    corps = chiffrer(json.dumps(charge, ensure_ascii=False).encode(), abonnement["p256dh"], abonnement["auth"])
    req = urllib.request.Request(abonnement["endpoint"], data=corps, method="POST", headers={
        "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", "TTL": "86400", "Urgency": "normal",
        "Authorization": f"vapid t={jeton_vapid(abonnement['endpoint'], cle_privee, sujet)}, k={b64u(publique_brute(cle_privee))}",
    })
    try:
        with ouvrir(req, timeout=20) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception:            # réseau : on réessaiera à l'heure suivante
        return 0


# ------------------------------------------------------------------ ce qu'il faut envoyer (sans réseau : testable)
def fmt_jour(d):
    x = dt.date(1970, 1, 1) + dt.timedelta(days=int(d))
    return f"{x:%d/%m}"


def heure_paris(maintenant_ms):
    from zoneinfo import ZoneInfo
    return dt.datetime.fromtimestamp(maintenant_ms / 1000, ZoneInfo("Europe/Paris"))


def planifier(publie, saisie, indispos, declarations, abonnements, etat, maintenant_ms):
    """-> (envois [(abonnement, charge)], nouvel état).
    Premier passage : mémorise sans rien envoyer. Rien n'est envoyé la nuit (avant 8 h, après 20 h, heure de Paris) :
    l'envoi attend le premier passage du matin."""
    etat = dict(etat or {})
    envois = []
    premier = "publieLe" not in etat
    paris = heure_paris(maintenant_ms)
    if not premier and not (8 <= paris.hour < 20):
        return [], etat
    aujourdhui = (paris.date() - dt.date(1970, 1, 1)).days
    # 1. publication
    pl = (publie or {}).get("publieLe") or 0
    if pl and not premier and pl > etat.get("publieLe", 0):
        titre = str(publie.get("titre", "")).replace("Planning du service de radiologie — ", "").strip()
        charge = {"title": "Planning publié", "body": f"Le planning {titre} est en ligne. Touchez pour voir vos vacations.",
                  "url": "./#mon", "tag": "publication"}
        envois += [(a, charge) for a in abonnements]
    etat["publieLe"] = max(pl, etat.get("publieLe", 0))
    # 2. dates limites de dépôt : 3 jours avant, puis la veille (date limite = dernier jour pour déclarer)
    faits = dict(etat.get("rappels", {}))
    for c in (saisie or {}).get("clotures", []) or []:
        if c.get("limite") is None or (c.get("finMs") or 0) <= maintenant_ms:
            continue
        reste = int(c["limite"]) - aujourdhui          # jours avant la date limite
        cle = f"{c.get('du')}_{c.get('au')}"
        for j in RAPPELS:
            k = f"{cle}:J{j}"
            if reste > j or k in faits:
                continue
            faits[k] = maintenant_ms
            if premier or (j == RAPPELS[0] and reste <= RAPPELS[1]):   # rappel dépassé : on n'envoie que le plus récent
                continue
            avec = {str(x.get("ini", "")).upper() for x in indispos if x.get("d2", 0) >= c["du"] and x.get("d1", 0) <= c["au"]}
            aucune = {str(x.get("ini", "")).upper() for x in declarations if (x.get("aucune") or {}).get(cle)}
            quand = "ce soir" if reste <= 0 else "demain soir" if reste == 1 else f"le {fmt_jour(c['limite'])}"
            charge = {"title": "Absences à déclarer",
                      "body": f"Déclarez vos absences du {fmt_jour(c['du'])} au {fmt_jour(c['au'])} avant {quand}, ou indiquez que vous n'en avez aucune.",
                      "url": "./#indispos", "tag": f"relance-{cle}"}
            envois += [(a, charge) for a in abonnements if str(a.get("ini", "")).upper() not in avec | aucune]
    # on ne garde que les rappels récents (état compact)
    etat["rappels"] = {k: v for k, v in faits.items() if maintenant_ms - v < 120 * JOUR_MS}
    return envois, etat


# ------------------------------------------------------------------ Firestore (REST)
def decode(v):
    if "stringValue" in v: return v["stringValue"]
    if "integerValue" in v: return int(v["integerValue"])
    if "doubleValue" in v: return float(v["doubleValue"])
    if "booleanValue" in v: return v["booleanValue"]
    if "nullValue" in v: return None
    if "timestampValue" in v: return v["timestampValue"]
    if "mapValue" in v: return {k: decode(x) for k, x in v["mapValue"].get("fields", {}).items()}
    if "arrayValue" in v: return [decode(x) for x in v["arrayValue"].get("values", [])]
    return None


def encode(v):
    if isinstance(v, bool): return {"booleanValue": v}
    if isinstance(v, int): return {"integerValue": str(v)}
    if isinstance(v, float): return {"doubleValue": v}
    if isinstance(v, str): return {"stringValue": v}
    if v is None: return {"nullValue": None}
    if isinstance(v, list): return {"arrayValue": {"values": [encode(x) for x in v]}}
    return {"mapValue": {"fields": {str(k): encode(x) for k, x in v.items()}}}


class Firestore:
    def __init__(self, cle_json, projet):
        from google.oauth2 import service_account
        from google.auth.transport.requests import AuthorizedSession
        cred = service_account.Credentials.from_service_account_info(
            json.loads(cle_json), scopes=["https://www.googleapis.com/auth/datastore"])
        self.s = AuthorizedSession(cred)
        self.base = f"https://firestore.googleapis.com/v1/projects/{projet}/databases/(default)/documents"

    def doc(self, chemin):
        r = self.s.get(f"{self.base}/{chemin}")
        if r.status_code == 404:
            return None
        r.raise_for_status()
        return {k: decode(v) for k, v in r.json().get("fields", {}).items()}

    def coll(self, chemin):
        out, jeton = [], None
        while True:
            r = self.s.get(f"{self.base}/{chemin}", params={"pageSize": 300, **({"pageToken": jeton} if jeton else {})})
            if r.status_code == 404:
                return out
            r.raise_for_status()
            j = r.json()
            for d in j.get("documents", []):
                out.append({"_id": d["name"].rsplit("/", 1)[1], **{k: decode(v) for k, v in d.get("fields", {}).items()}})
            jeton = j.get("nextPageToken")
            if not jeton:
                return out

    def ecrire(self, chemin, data):
        self.s.patch(f"{self.base}/{chemin}", json={"fields": {k: encode(v) for k, v in data.items()}}).raise_for_status()

    def supprimer(self, chemin):
        self.s.delete(f"{self.base}/{chemin}")


def sujet_vapid():
    depot = os.environ.get("GITHUB_REPOSITORY", "")
    if "/" in depot:
        p, n = depot.split("/", 1)
        return f"https://{p.lower()}.github.io/{n}/"
    return "https://github.com/"


def main():
    cle = os.environ.get("FIREBASE_CLE", "").strip()
    if "--cle-publique" in sys.argv:
        sortie = os.path.join(RACINE, "dist", "notifications.json")
        if not cle:
            print("::notice::Secret FIREBASE_CLE absent : notifications indisponibles sur le site.")
            return
        with open(sortie, "w", encoding="utf-8") as f:
            json.dump({"cle": b64u(publique_brute(cle_vapid(cle)))}, f)
        print("Clé publique des notifications écrite.")
        return
    code = os.environ.get("CODE_EQUIPE", "").strip()
    if not cle or not code:
        print("::notice::FIREBASE_CLE ou CODE_EQUIPE absent : pas de notifications.")
        return
    with open(os.path.join(RACINE, "config", "firebase.json"), encoding="utf-8") as f:
        projet = json.load(f)["projectId"]
    fs = Firestore(cle, projet)
    esp = f"espaces/{code}"
    membres = {m["_id"]: m for m in fs.coll("membres")}
    abonnements = []
    for a in fs.coll("abonnements"):
        m = membres.get(a.get("uid"))
        if not (m and a.get("endpoint") and a.get("p256dh") and a.get("auth")):
            continue                                   # compte retiré : plus de notifications
        abonnements.append({**a, "ini": m.get("ini") or a.get("ini", "")})
    etat = fs.doc(f"{esp}/config/notifications") or {}
    envois, etat2 = planifier(fs.doc(f"{esp}/planning/publie"), fs.doc(f"{esp}/config/saisie"), fs.coll(f"{esp}/indispos"),
                              fs.coll("declarations"), abonnements, etat, int(time.time() * 1000))
    prive, sujet = cle_vapid(cle), sujet_vapid()
    ok = expires = echecs = 0
    for a, charge in envois:
        code_http = envoyer(a, charge, prive, sujet)
        if code_http in (200, 201, 202):
            ok += 1
        elif code_http in (404, 410):
            expires += 1
            fs.supprimer(f"abonnements/{a['_id']}")
        else:
            echecs += 1
            print(f"::warning::Notification refusée ({code_http}) pour {a.get('ini', '?')}.")
    if etat2 != etat:
        fs.ecrire(f"{esp}/config/notifications", etat2)
    print(f"::notice::Notifications : {len(abonnements)} téléphone(s) abonné(s), {ok} envoyée(s)"
          + (f", {expires} abonnement(s) expiré(s) retiré(s)" if expires else "") + (f", {echecs} échec(s)" if echecs else "") + ".")


if __name__ == "__main__":
    main()
