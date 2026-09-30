# -*- coding: utf-8 -*-
"""
Site en ligne contre un Firebase SIMULÉ (aucun accès aux serveurs de Google) :
les modules Firebase sont remplacés par des doublures qui appliquent la même logique que les règles de sécurité.
Utilise la page configurée et les règles produites par test_demo.py.
"""
import copy, itertools, json, os, re
from playwright.sync_api import sync_playwright
from commun import Bilan, EXEMPLE, SORTIE, chromium, jours_ouvres, mois_suivant

B = Bilan("Site en ligne (Firebase simulé)")
d1, d2 = mois_suivant()
ouvres = jours_ouvres(d1, d2)
mardis = [d for d in ouvres if d.weekday() == 1]
html = open(os.path.join(SORTIE, "index_configure.html"), encoding="utf-8").read()
rules = open(os.path.join(SORTIE, "regles.txt"), encoding="utf-8").read()
TEAM = re.search(r"return code == '([^']+)'", rules).group(1)
ADMINS = re.findall(r"'([A-Za-z0-9]{20,})'", rules.split('request.auth.uid in [')[1].split(']')[0])
USERS = {'admin@chl.fr': ('secret', ADMINS[0]), 'intrus@x.fr': ('pw', 'SomeOtherUid000000000000')}
DB, ver, ids = {}, [0], itertools.count(1)
fails = []
ok = B.ok
# ---------------- « serveur » Firestore simulé : applique la même logique que les règles générées
def denied(): return {'error': 'permission-denied'}
def seg(path): return path.split('/')
def can_read(path): s = seg(path); return len(s) >= 2 and s[0] == 'espaces' and s[1] == TEAM
def is_admin(uid): return uid in ADMINS
def valid_indispo(d):
    keys = {'ini', 'd1', 'd2', 'periode', 'motif', 'creeLe'}
    return (set(d) == keys and isinstance(d['ini'], str) and len(d['ini']) <= 10 and isinstance(d['d1'], (int, float))
            and isinstance(d['d2'], (int, float)) and d['d2'] >= d['d1'] and d['d2'] - d['d1'] <= 366
            and d['periode'] in ('Journée', 'Matin', 'Après-midi') and isinstance(d['motif'], str) and len(d['motif']) <= 100)
def server(op, a):
    uid = a.get('uid')
    p = a.get('path')
    if op == 'poll': return {'v': ver[0]}
    if op == 'signin':
        u = USERS.get(a['email'])
        return {'uid': u[1], 'email': a['email']} if u and u[0] == a['pw'] else {'error': 'auth/invalid-credential'}
    if op in ('get', 'list'):
        if not can_read(p): return denied()
        if op == 'get': return {'data': copy.deepcopy(DB.get(p))}
        n = len(seg(p)) + 1
        return {'docs': [dict(id=k.split('/')[-1], **v) for k, v in DB.items() if k.startswith(p + '/') and len(seg(k)) == n]}
    s = seg(p)
    in_ind = len(s) >= 3 and s[2] == 'indispos'
    if not can_read(p): return denied()
    if op == 'add':
        if not (valid_indispo(a['data']) if in_ind else is_admin(uid)): return denied()
        p = p + '/' + f'id{next(ids)}'
    elif op == 'set':
        if not (is_admin(uid) or (in_ind and valid_indispo(a['data']))): return denied()
    elif op == 'del':
        if not (is_admin(uid) or in_ind): return denied()
        DB.pop(p, None); ver[0] += 1; return {}
    DB[p] = copy.deepcopy(a['data']); ver[0] += 1
    return {'id': s[-1] if op == 'set' else p.split('/')[-1]}
# ---------------- modules Firebase simulés (mêmes noms de fonctions que le SDK officiel)
APP = "export function initializeApp(cfg){ globalThis.__cfg = cfg; return {cfg}; }"
FS = r"""
const call = async (op, a) => { const r = await window.__fb(op, JSON.stringify({ ...a, uid: globalThis.__uid || null })); const o = JSON.parse(r);
  if (o && o.error) { const e = new Error(o.error); e.code = o.error; throw e; } return o; };
export function getFirestore(app){ return { app }; }
export function doc(fs, path){ if (path.split('/').length % 2) throw new Error('doc path must have even segments: ' + path); return { type: 'doc', path, id: path.split('/').pop() }; }
export function collection(fs, path){ if (path.split('/').length % 2 === 0) throw new Error('collection path must have odd segments: ' + path); return { type: 'coll', path }; }
const snap = (ref, data) => ({ id: ref.id, exists: () => data != null, data: () => data == null ? undefined : JSON.parse(JSON.stringify(data)) });
export async function getDoc(ref){ const r = await call('get', { path: ref.path }); return snap(ref, r.data); }
export async function setDoc(ref, data){ if (JSON.stringify(data).includes('undefined')) throw new Error('undefined value'); await call('set', { path: ref.path, data }); }
export async function addDoc(ref, data){ const r = await call('add', { path: ref.path, data }); return { id: r.id }; }
export async function deleteDoc(ref){ await call('del', { path: ref.path }); }
export function onSnapshot(ref, next, error){
  let last = -1, stop = false;
  const tick = async () => { if (stop) return;
    try { const v = (await call('poll', {})).v;
      if (v !== last) { last = v;
        if (ref.type === 'doc') { const r = await call('get', { path: ref.path }); next(snap(ref, r.data)); }
        else { const r = await call('list', { path: ref.path }); next({ docs: r.docs.map((d) => { const { id, ...rest } = d; return snap({ id }, rest); }) }); } }
    } catch (e) { stop = true; error && error(e); return; }
    setTimeout(tick, 250); };
  tick(); return () => { stop = true; };
}
"""
AUTH = r"""
const L = new Set(); let user = null;
export function getAuth(){ return {}; }
export async function signInWithEmailAndPassword(auth, email, pw){ const o = JSON.parse(await window.__fb('signin', JSON.stringify({ email, pw })));
  if (o.error) { const e = new Error(o.error); e.code = o.error; throw e; } user = { uid: o.uid, email: o.email }; globalThis.__uid = o.uid; L.forEach((f) => f(user)); return { user }; }
export async function signOut(){ user = null; globalThis.__uid = null; L.forEach((f) => f(null)); }
export function onAuthStateChanged(auth, cb){ L.add(cb); setTimeout(() => cb(user), 0); return () => L.delete(cb); }
"""
MODS = {'firebase-app.js': APP, 'firebase-firestore.js': FS, 'firebase-auth.js': AUTH}
seen_urls = []
def handle(route):
    u = route.request.url; seen_urls.append(u)
    if u.startswith('https://planning.test/'):
        return route.fulfill(status=200, body=html, headers={'content-type': 'text/html; charset=utf-8'})
    m = re.match(r'https://www\.gstatic\.com/firebasejs/10\.14\.1/(firebase-[a-z]+\.js)$', u)
    if m: return route.fulfill(status=200, body=MODS[m.group(1)], headers={'content-type': 'application/javascript', 'access-control-allow-origin': '*'})
    route.abort()
with sync_playwright() as pw:
    b = chromium(pw)
    def page(ctx):
        pg = ctx.new_page()
        pg.expose_function('__fb', lambda op, a: json.dumps(server(op, json.loads(a))))
        pg.on('pageerror', lambda e: fails.append('JS ' + str(e))); pg.on('dialog', lambda d: d.accept())
        return pg
    cA = b.new_context(accept_downloads=True); cA.route('**/*', handle)
    cD = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True); cD.route('**/*', handle)
    adm, doc = page(cA), page(cD)
    # --- médecin : mauvais code puis bon code
    doc.goto('https://planning.test/index.html')
    doc.wait_for_selector('#vCode:not([hidden])')
    ok(doc.is_hidden('#demoBanner'), 'pas de bandeau démonstration en mode en ligne')
    doc.fill('#codeInput', 'RADIO-FAUX-CODE-0000'); doc.click('#codeForm button')
    doc.wait_for_function("document.querySelector('#codeMsg').innerText.includes('incorrect')")
    ok(True, 'mauvais code d\'équipe refusé')
    doc.fill('#codeInput', TEAM); doc.click('#codeForm button')
    doc.wait_for_selector('#vMon:not([hidden])')
    ok('Aucun planning publié' in doc.inner_text('#vMon') or 'Choisissez' in doc.inner_text('#vMon'), 'accès avec le bon code')
    # --- admin : code + connexion (mauvais mot de passe, intrus, admin)
    adm.goto('https://planning.test/index.html#admin'); adm.fill('#codeInput', TEAM); adm.click('#codeForm button')
    adm.wait_for_selector('#loginCard:not([hidden])')
    adm.fill('#loginEmail', 'admin@chl.fr'); adm.fill('#loginPw', 'mauvais'); adm.click('#loginForm button')
    adm.wait_for_function("document.querySelector('#loginMsg').innerText.includes('incorrect')"); ok(True, 'mauvais mot de passe refusé')
    adm.fill('#loginEmail', 'intrus@x.fr'); adm.fill('#loginPw', 'pw'); adm.click('#loginForm button')
    adm.wait_for_selector('#adminBody:not([hidden])')
    ok(adm.is_hidden('#useDefault'), 'aucune donnée de service embarquée dans la page en ligne')
    adm.set_input_files('#upParams', EXEMPLE)
    adm.wait_for_function("document.querySelector('#paramMsg').innerText.includes('refusé')")
    ok('Accès refusé' in adm.inner_text('#paramMsg'), 'compte non administrateur : écriture refusée par les règles')
    adm.click('#logoutBtn'); adm.wait_for_selector('#loginCard:not([hidden])')
    adm.fill('#loginEmail', 'admin@chl.fr'); adm.fill('#loginPw', 'secret'); adm.click('#loginForm button')
    adm.wait_for_selector('#adminBody:not([hidden])')
    adm.set_input_files('#upParams', EXEMPLE)
    adm.wait_for_function("document.querySelector('#paramInfo').innerText.includes('11 médecins')", timeout=10000)
    ok(True, 'administrateur : classeur de paramètres enregistré')
    # --- médecin : initiales + indisponibilité, et tentatives interdites
    doc.click('#meBtn'); doc.wait_for_selector('#whoGrid button[data-ini=DA]', timeout=5000); doc.click('#whoGrid button[data-ini=DA]')
    doc.click('a[data-tab=indispos]')
    doc.fill('#indD1', mardis[1].isoformat()); doc.fill('#indD2', (mardis[1]).isoformat()); doc.click('#indSubmit')
    doc.wait_for_function("document.querySelector('#indMsg').innerText.includes('enregistrée')")
    doc.wait_for_function(f"document.querySelector('#myInd').innerText.includes('{mardis[1]:%d/%m}')", timeout=5000)
    ok(any(v.get('ini') == 'DA' for k, v in DB.items() if '/indispos/' in k), 'médecin : indisponibilité enregistrée en ligne')
    r = doc.evaluate("""async () => { try { await window.__fb('set', JSON.stringify({path: 'espaces/' + %s + '/planning/publie', data: {x: 1}})).then(x => { if (JSON.parse(x).error) throw new Error(JSON.parse(x).error); }); return 'écrit'; } catch (e) { return e.message; } }""" % json.dumps(TEAM))
    ok(r == 'permission-denied', 'médecin non connecté : ne peut pas modifier le planning publié')
    r = doc.evaluate("""async () => JSON.parse(await window.__fb('add', JSON.stringify({path: 'espaces/' + %s + '/indispos', data: {ini: 'DA', d1: 1, d2: 0, periode: 'Journée', motif: '', creeLe: 1}}))).error || 'accepté'""" % json.dumps(TEAM))
    ok(r == 'permission-denied', 'indisponibilité mal formée refusée par les règles')
    # --- admin : génération + publication
    adm.wait_for_function("document.querySelector('#admInd').innerText.includes('DA')", timeout=5000)
    adm.fill('#gStart', d1.isoformat()); adm.fill('#gEnd', d2.isoformat())
    adm.select_option('#gQual', '10'); adm.click('#gBtn')
    adm.wait_for_function("document.querySelector('#gMsg').innerText.startsWith('Planning généré')", timeout=90000)
    ok('Erreur' not in adm.inner_text('#dChecks'), 'génération sans erreur (indisponibilité en ligne prise en compte)')
    adm.click('#publishBtn'); adm.wait_for_function("document.querySelector('#gMsg').innerText.startsWith('Planning publié')", timeout=10000)
    stored = DB.get(f'espaces/{TEAM}/planning/publie')
    ok(stored and stored.get('publiePar') == 'admin@chl.fr' and len(json.dumps(stored)) < 1_000_000, f'planning publié en base ({len(json.dumps(stored))//1024} Ko, limite Firestore 1 024 Ko)')
    ok(all(v != 'ABS' or True for v in []) and 'ABS' in json.dumps(stored['statuts'].get('DA', {})), 'absence de DA enregistrée dans le planning publié')
    # --- médecin : reçoit le planning en temps réel
    doc.click('a[data-tab=mon]'); doc.wait_for_selector('#icsMe', timeout=8000)
    ok(doc.locator('#vMon .day').count() == len(ouvres), 'médecin : planning reçu en temps réel')
    # --- persistance du code sur l'appareil
    doc.reload(); doc.wait_for_selector('#vMon:not([hidden])'); doc.wait_for_selector('#icsMe', timeout=8000)
    ok(True, 'code et initiales mémorisés après rechargement')
    b.close()
ext = [u for u in seen_urls if not u.startswith(('https://planning.test/', 'https://www.gstatic.com/firebasejs/'))]
ok(not ext, 'aucune autre adresse contactée')
ok(not fails, 'aucune erreur JavaScript' + (f' : {fails[:3]}' if fails else ''))
raise SystemExit(0 if B.fin() else 1)
