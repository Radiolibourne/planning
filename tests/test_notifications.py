# -*- coding: utf-8 -*-
"""
Notifications (outils/notifications.py), sans réseau :
- chiffrement Web Push (RFC 8291) vérifié en le déchiffrant comme le ferait le téléphone ;
- jeton VAPID (RFC 8292) signé avec la clé dérivée, vérifiable avec la clé publique du site ;
- ce qui est envoyé : publication, rappels J-3 et veille aux seuls médecins sans déclaration, pas la nuit, pas de doublon.
"""
import base64, datetime as dt, hashlib, hmac, json, os, struct, subprocess, sys, tempfile, urllib.error
from zoneinfo import ZoneInfo
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from commun import Bilan

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RACINE, "outils"))
import notifications as N

B = Bilan("Notifications")
FAUSSE_CLE = json.dumps({"type": "service_account", "project_id": "test", "private_key": "-----BEGIN PRIVATE KEY-----\nTEST\n-----END PRIVATE KEY-----\n"})


def hk(sel, ikm, info, n):
    prk = hmac.new(sel, ikm, hashlib.sha256).digest()
    return hmac.new(prk, info + b"\x01", hashlib.sha256).digest()[:n]


def dechiffrer(corps, ua_priv, auth):
    """Côté téléphone (RFC 8291), écrit indépendamment de l'émetteur."""
    sel, rs, idlen = corps[:16], struct.unpack(">I", corps[16:20])[0], corps[20]
    as_pub = corps[21:21 + idlen]
    ua_pub = ua_priv.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    partage = ua_priv.exchange(ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), as_pub))
    ikm = hk(auth, partage, b"WebPush: info\x00" + ua_pub + as_pub, 32)
    clair = AESGCM(hk(sel, ikm, b"Content-Encoding: aes128gcm\x00", 16)).decrypt(hk(sel, ikm, b"Content-Encoding: nonce\x00", 12), corps[21 + idlen:], None)
    assert rs == 4096 and clair.endswith(b"\x02")
    return clair[:-1]


# 1. chiffrement
ua_priv = ec.generate_private_key(ec.SECP256R1())
ua_pub = ua_priv.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
auth = os.urandom(16)
msg = json.dumps({"title": "Planning publié", "body": "Le planning de novembre est en ligne."}, ensure_ascii=False).encode()
corps = N.chiffrer(msg, N.b64u(ua_pub), N.b64u(auth))
B.ok(dechiffrer(corps, ua_priv, auth) == msg, "chiffrement : message déchiffré à l'identique par le téléphone")

# 2. clés VAPID dérivées et jeton
k1, k2 = N.cle_vapid(FAUSSE_CLE), N.cle_vapid(FAUSSE_CLE)
B.ok(N.publique_brute(k1) == N.publique_brute(k2) and len(N.publique_brute(k1)) == 65, "clé VAPID : stable (dérivée de la clé de service)")
jwt = N.jeton_vapid("https://web.push.apple.com/abc", k1, "https://exemple.github.io/planning/")
h, c, sig = jwt.split(".")
raw = N.unb64u(sig)
k1.public_key().verify(encode_dss_signature(int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big")),
                       f"{h}.{c}".encode(), ec.ECDSA(hashes.SHA256()))
corps_jwt = json.loads(N.unb64u(c))
B.ok(corps_jwt["aud"] == "https://web.push.apple.com" and corps_jwt["sub"].startswith("https://"), "jeton VAPID : signé, destinataire = service de notifications")

# 3. envoi (réseau simulé) : en-têtes, abonnement expiré
reçu = {}
class Rep:
    status = 201
    def __enter__(self): return self
    def __exit__(self, *a): return False
def ouvrir(req, timeout=0):
    reçu["url"], reçu["h"], reçu["data"] = req.full_url, dict(req.header_items()), req.data
    return Rep()
abo = {"endpoint": "https://fcm.googleapis.com/fcm/send/xyz", "p256dh": N.b64u(ua_pub), "auth": N.b64u(auth)}
code = N.envoyer(abo, {"title": "T", "body": "B"}, k1, "https://exemple.github.io/planning/", ouvrir=ouvrir)
B.ok(code == 201 and reçu["h"].get("Content-encoding") == "aes128gcm" and reçu["h"].get("Authorization", "").startswith("vapid t="),
     "envoi : requête Web Push conforme")
B.ok(json.loads(dechiffrer(reçu["data"], ua_priv, auth)) == {"title": "T", "body": "B"}, "envoi : contenu lisible par le téléphone")
def expire(req, timeout=0):
    raise urllib.error.HTTPError(req.full_url, 410, "Gone", {}, None)
B.ok(N.envoyer(abo, {"title": "T"}, k1, "x", ouvrir=expire) == 410, "envoi : abonnement expiré détecté (410)")

# 4. que faut-il envoyer ?
paris = ZoneInfo("Europe/Paris")
def ms(y, m, d, h): return int(dt.datetime(y, m, d, h, 0, tzinfo=paris).timestamp() * 1000)
def jour(y, m, d): return (dt.date(y, m, d) - dt.date(1970, 1, 1)).days
abos = [{"_id": "u1_a", "ini": "DA"}, {"_id": "u2_b", "ini": "DB"}, {"_id": "u3_c", "ini": "DC"}]
lim = jour(2026, 10, 20)
saisie = {"clotures": [{"du": jour(2026, 12, 1), "au": jour(2026, 12, 31), "limite": lim, "finMs": ms(2026, 10, 20, 23) + 59 * 60000}]}
indispos = [{"ini": "DA", "d1": jour(2026, 12, 10), "d2": jour(2026, 12, 12)}]
decl = [{"ini": "DB", "aucune": {f"{jour(2026, 12, 1)}_{jour(2026, 12, 31)}": True}}]
pub = {"publieLe": 1000, "titre": "Planning du service de radiologie — novembre 2026"}

env, etat = N.planifier(pub, saisie, indispos, decl, abos, {}, ms(2026, 10, 10, 10))
B.ok(env == [] and etat["publieLe"] == 1000, "premier passage : état mémorisé, rien envoyé")
env, etat2 = N.planifier({**pub, "publieLe": 2000}, saisie, indispos, decl, abos, etat, ms(2026, 10, 10, 23))
B.ok(env == [] and etat2 == etat, "la nuit : rien envoyé, rien perdu")
env, etat = N.planifier({**pub, "publieLe": 2000}, saisie, indispos, decl, abos, etat, ms(2026, 10, 11, 8))
B.ok(len(env) == 3 and "novembre 2026" in env[0][1]["body"] and env[0][1]["url"] == "./#mon", "publication : tout le monde prévenu le matin")
env, etat = N.planifier({**pub, "publieLe": 2000}, saisie, indispos, decl, abos, etat, ms(2026, 10, 11, 9))
B.ok(env == [], "publication : pas de doublon")
env, etat = N.planifier({**pub, "publieLe": 2000}, saisie, indispos, decl, abos, etat, ms(2026, 10, 17, 9))
B.ok([a["ini"] for a, _ in env] == ["DC"] and "le 20/10" in env[0][1]["body"], "J-3 : seul le médecin sans déclaration est relancé")
env, etat = N.planifier({**pub, "publieLe": 2000}, saisie, indispos, decl, abos, etat, ms(2026, 10, 17, 15))
B.ok(env == [], "J-3 : un seul rappel")
env, etat = N.planifier({**pub, "publieLe": 2000}, saisie, indispos, decl, abos, etat, ms(2026, 10, 19, 9))
B.ok([a["ini"] for a, _ in env] == ["DC"] and "demain soir" in env[0][1]["body"], "veille : dernier rappel")
env, etat = N.planifier({**pub, "publieLe": 2000}, saisie, indispos, decl, abos, etat, ms(2026, 10, 21, 9))
B.ok(env == [], "date limite passée : plus de rappel")
# rappel J-3 manqué (site arrêté) : seul celui de la veille part
e0 = {"publieLe": 2000}
env, _ = N.planifier({**pub, "publieLe": 2000}, saisie, indispos, decl, abos, e0, ms(2026, 10, 19, 9))
B.ok(len(env) == 1 and "demain soir" in env[0][1]["body"], "rappel en retard : seul le plus récent est envoyé")

# 5. clé publique pour le site
with tempfile.TemporaryDirectory() as t:
    r = subprocess.run([sys.executable, os.path.join(RACINE, "outils", "notifications.py"), "--cle-publique"],
                       env={**os.environ, "FIREBASE_CLE": FAUSSE_CLE}, capture_output=True, text=True)
    f = os.path.join(RACINE, "dist", "notifications.json")
    ok = r.returncode == 0 and os.path.exists(f) and json.load(open(f))["cle"] == N.b64u(N.publique_brute(k1))
    B.ok(ok, "clé publique écrite pour le site (dist/notifications.json)")
    if os.path.exists(f): os.remove(f)
r = subprocess.run([sys.executable, os.path.join(RACINE, "outils", "notifications.py")], env={k: v for k, v in os.environ.items() if k != "FIREBASE_CLE"},
                   capture_output=True, text=True)
B.ok(r.returncode == 0 and "absent" in r.stdout, "sans clé Firebase : rien n'est fait, sans erreur")
raise SystemExit(0 if B.fin() else 1)
