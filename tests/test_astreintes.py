# -*- coding: utf-8 -*-
"""
Générateur d'astreintes (médecins fictifs) : ouverture de la saisie, calendrier d'indisponibilités du médecin,
saisie par l'administrateur pour un interne, génération (équité semaine / week-end / férié au prorata de la quotité,
écart minimum, pas le lundi après son week-end), enregistrement dans l'onglet Astreintes du classeur, liste du mois.
"""
import datetime as dt, os
from playwright.sync_api import sync_playwright
from commun import Bilan, DIST, chromium

B = Bilan("Générateur d'astreintes")
with sync_playwright() as p:
    b = chromium(p)
    ctx = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("dialog", lambda d: d.accept())
    pg.goto("file://" + os.path.join(DIST, "demo.html") + "#admin")
    pg.wait_for_selector("#loginCard:not([hidden])")
    pg.fill("#loginEmail", "a@b.fr"); pg.fill("#loginPw", "x"); pg.click("#loginForm button[type=submit]")
    pg.wait_for_selector("#adminBody:not([hidden])")
    pg.click("#useDefault"); pg.wait_for_function("document.querySelector('#paramInfo').innerText.includes('médecins')")
    # fonctions pures
    f = pg.evaluate("""() => { const F = feriesFrance(2027); const u = unitesAstreinte(dayFromYMD(2027, 1, 1), dayFromYMD(2027, 1, 11), feriesPeriode(dayFromYMD(2027, 1, 1), dayFromYMD(2027, 1, 11)));
        return { paques: F.get(dayFromYMD(2027, 3, 29)), pentecote: F.get(dayFromYMD(2027, 5, 17)), u: u.map((x) => x.type + x.jours.length) }; }""")
    B.ok(f["paques"] == "Lundi de Pâques" and f["pentecote"] == "Lundi de Pentecôte", "jours fériés calculés (Pâques, Pentecôte)")
    B.ok(f["u"] == ["W3", "S1", "S1", "S1", "S1", "W3", "S1"], f"unités : week-end du vendredi au dimanche, 1er janvier un vendredi non compté férié ({f['u']})")
    # 1. ouverture de la saisie (déc. 2026 → mai 2027 par défaut), avec un interne
    auj = dt.date.today(); m1 = (auj.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
    B.ok(pg.input_value("#asDu") == m1.isoformat(), "période proposée : à partir du mois suivant")
    pg.fill("#asDu", "2027-01-01"); pg.fill("#asAu", "2027-06-30"); pg.fill("#asLim", (auj + dt.timedelta(days=10)).isoformat())
    pg.fill("#asNouv", "Rayann"); pg.click("#asAjout")
    pg.locator('#asParts tr[data-id="SD"] [data-part]').uncheck()
    pg.fill('#asParts tr[data-id="DB"] [data-q]', "0.5")
    pg.click("#asOuvrir"); pg.wait_for_function("S.astrCfg && S.astrCfg.participants", timeout=8000)
    cfg = pg.evaluate("S.astrCfg")
    ids = [x["id"] for x in cfg["participants"]]
    B.ok("RAYANN" in ids and "SD" not in ids and {"id": "DB", "quotite": 0.5} in cfg["participants"], f"saisie ouverte, participants et quotités ({ids})")
    # 2. le médecin coche ses jours dans l'onglet Astreintes
    pg.evaluate("S.me = 'DA'; location.hash = '#astreintes'"); pg.wait_for_selector("#astSaisieCard:not([hidden]) .cj", timeout=8000)
    B.ok("à remplir avant le" in pg.inner_text("#astSaisieSub"), "onglet Astreintes : calendrier de saisie affiché")
    noel = pg.evaluate("[dayFromYMD(2027, 2, 12), dayFromYMD(2027, 2, 13), dayFromYMD(2027, 3, 1), dayFromYMD(2027, 3, 2)]")
    for d in noel: pg.click(f'#astSaisie .cj[data-j="{d}"]')
    B.ok("modifications non enregistrées" in pg.inner_text("#astSaisie") and pg.locator("#astSaisie .cj.ind").count() == 4, "jours touchés passés en rouge")
    pg.click("#astSaisie [data-astr-save]"); pg.wait_for_function("S.astrInd.some((x) => x.id === 'DA')", timeout=8000)
    B.ok(sorted(pg.evaluate("S.astrInd.find((x) => x.id === 'DA').jours")) == sorted(noel), "indisponibilités enregistrées")
    pg.click(f'#astSaisie .cj[data-j="{noel[3]}"]'); pg.click("#astSaisie [data-astr-save]")
    pg.wait_for_function("S.astrInd.find((x) => x.id === 'DA').jours.length === 3", timeout=8000)
    B.ok(True, "un jour retiré puis réenregistré")
    # 3. l'administrateur saisit pour l'interne
    pg.evaluate("location.hash = '#admin'"); pg.wait_for_selector("#asPour")
    pg.select_option("#asPour", "RAYANN"); pg.wait_for_selector("#asCal .cj")
    rj = pg.evaluate("[dayFromYMD(2027, 2, 5), dayFromYMD(2027, 2, 9)]")
    for d in rj: pg.click(f'#asCal .cj[data-j="{d}"]')
    pg.click("#asCal [data-astr-save]"); pg.wait_for_function("S.astrInd.some((x) => x.id === 'RAYANN')", timeout=8000)
    B.ok("RAYANN ✓" in pg.inner_text("#astrAdm"), "réponses suivies (✓)")
    # 4. génération
    pg.click("#asGen"); pg.wait_for_selector("#asSave", timeout=15000)
    r = pg.evaluate("""() => { const { res, indispo } = ASTR_RES; const parts = astrParticipants();
        const pb = controlerAstreintes(res, indispo, 3);
        const ecartMax = Math.max(...parts.flatMap((p) => ASTR_TYPES.map((t) => Math.abs(res.compteurs[p.id][t] - res.cibles[p.id][t]))));
        const da = res.unites.filter((u) => u.qui === 'DA').flatMap((u) => u.jours);
        const ray = res.unites.filter((u) => u.qui === 'RAYANN').flatMap((u) => u.jours);
        return { pb, vides: res.aPourvoir.length, ecartMax, daIndispo: da.filter((d) => indispo.DA.includes(d)).length, rayIndispo: ray.filter((d) => indispo.RAYANN.includes(d)).length,
          db: res.compteurs.DB, da2: res.compteurs.DA, nb: res.nb, we: res.unites.filter((u) => u.type === 'W').every((u) => weekday(u.debut) === 4 || u.debut === res.unites[0].debut) }; }""")
    B.ok(not r["pb"] and r["vides"] == 0, f"génération sans conflit ni trou ({r['pb'][:3]})")
    B.ok(r["daIndispo"] == 0 and r["rayIndispo"] == 0, "indisponibilités respectées")
    B.ok(r["ecartMax"] < 1.01, f"équité : chaque compteur à moins d'une astreinte de sa cible (écart max {r['ecartMax']:.2f})")
    B.ok(sum(r["db"].values()) < sum(r["da2"].values()), f"prorata de la quotité : DB à 50 % en fait moins ({r['db']} / {r['da2']})")
    B.ok(r["nb"]["F"] >= 3 and r["we"], f"fériés comptés à part, week-ends du vendredi au dimanche ({r['nb']})")
    B.ok(pg.locator("#asRes select[data-unite]").count() > 100, "planning des astreintes modifiable à la main")
    # modification à la main qui viole une règle : signalée
    u0 = pg.evaluate("ASTR_RES.res.unites.find((u) => u.type === 'S' && weekday(u.debut) === 0 && u.qui !== 'DA' && ASTR_RES.res.unites.some((w) => w.type === 'W' && w.fin === u.debut - 1 && w.qui))")
    we_qui = pg.evaluate("(d) => ASTR_RES.res.unites.find((w) => w.type === 'W' && w.fin === d - 1).qui", u0["debut"])
    pg.locator(f'#asRes select[data-unite="{u0["id"]}"]').select_option(we_qui)
    B.ok("après son week-end" in pg.inner_text("#asRes"), "modification à la main contraire aux règles signalée")
    pg.locator(f'#asRes select[data-unite="{u0["id"]}"]').select_option(u0["qui"])
    # 5. enregistrement dans le classeur
    pg.click("#asSave"); pg.wait_for_function("document.querySelector('#astrMsg').innerText.includes('enregistré')", timeout=15000)
    n = pg.evaluate("S.P.astreintes.filter((a) => a.d >= S.astrCfg.du && a.d <= S.astrCfg.au).length")
    B.ok(n == 181, f"astreintes enregistrées dans le classeur, un jour = une ligne ({n})")
    # liste du mois : week-end sur une seule ligne
    pg.evaluate("S.me = 'DA'; S.astMois = 202701; location.hash = '#astreintes'"); pg.wait_for_selector("#astBody table.astt")
    t = pg.inner_text("#astBody")
    B.ok("Ven 01/01 → Dim 03/01" in t and pg.locator("#astBody tbody tr").count() == 21, f"Astreintes : week-end du vendredi au dimanche sur une ligne ({pg.locator('#astBody tbody tr').count()} lignes)")
    B.ok(pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "pas de défilement horizontal sur téléphone")
    # 6. saisie close : calendrier en lecture seule pour le médecin
    pg.evaluate("S.store.set(PATHS.astrCfg(), { ...S.astrCfg, finMs: Date.now() - 1000 })"); pg.wait_for_timeout(300)
    pg.evaluate("renderAstr()")
    B.ok("saisie close" in pg.inner_text("#astSaisieSub") and pg.locator("#astSaisie [data-astr-save]").count() == 0, "après la date limite : lecture seule")
    B.ok(not errs, "aucune erreur JavaScript" + (f" : {errs[:3]}" if errs else ""))
    b.close()
raise SystemExit(0 if B.fin() else 1)
