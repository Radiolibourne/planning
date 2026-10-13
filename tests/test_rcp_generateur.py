# -*- coding: utf-8 -*-
"""
Générateur des RCP (médecins fictifs) : occurrences (jour, semaines du mois, fériés), indisponibilités (absence,
jour off, autre site, astreinte pour une RCP à partir de 17h), mode « tous les présents », équilibre par RCP et au total
avec l'historique, liste déduite des fiches importées, écran Admin (liste, génération, retouche, enregistrement).
"""
import datetime as dt, os
from playwright.sync_api import sync_playwright
from commun import Bilan, DIST, chromium

B = Bilan("Générateur des RCP")
with sync_playwright() as p:
    b = chromium(p)
    pg = b.new_context(viewport={"width": 1200, "height": 900}).new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("dialog", lambda d: d.accept())
    pg.goto("file://" + os.path.join(DIST, "demo.html") + "#admin")
    pg.wait_for_selector("#loginCard:not([hidden])")
    pg.fill("#loginEmail", "a@b.fr"); pg.fill("#loginPw", "x"); pg.click("#loginForm button[type=submit]")
    pg.wait_for_selector("#adminBody:not([hidden])")
    pg.evaluate("S.store.reset()"); pg.wait_for_timeout(300)
    pg.wait_for_selector("#useDefault:not([hidden])")
    pg.click("#useDefault"); pg.wait_for_function("document.querySelector('#paramInfo').innerText.includes('médecins')")

    # 1. fonctions pures (mars 2027 : lundis 1, 8, 15, 22, 29 ; jeudis 4, 11, 18, 25)
    r = pg.evaluate("""() => {
      const D = (j) => dayFromYMD(2027, 3, j), du = D(1), au = D(31);
      const rcps = [
        { id: 'P', service: 'PNEUMO', horaire: '16h-17h', jour: 0, semaines: [], mode: 'nb', nb: 1, medecins: ['DA', 'DB', 'IA'] },
        { id: 'S', service: 'SENO', horaire: 'LUNDI 13h-14h', jour: 0, semaines: [], mode: 'tous', nb: 1, medecins: ['SA', 'SB', 'SC'] },
        { id: 'G', service: 'DIGESTIF', horaire: '17h-20h', jour: 0, semaines: [2, 4], mode: 'nb', nb: 1, medecins: ['DA', 'DB'] },
        { id: 'I', service: 'INFECTIEUX', horaire: 'JEUDI 14h-15h', jour: 3, semaines: [], mode: 'nb', nb: 1, medecins: ['IA', 'IB', 'DA'] } ];
      const ind = { DA: [D(1)], SB: [D(8)], DB: [D(8)] };   // DB : astreinte le 8 (bloque seulement la RCP de 17h)
      const dispo = (i, d, debut) => (i === 'DB' && d === D(8) ? (debut >= 17 * 60 ? "d'astreinte" : '') : (ind[i] || []).includes(d) ? 'absent' : '');
      const occ = occurrencesRcp(rcps, du, au, new Map([[D(29), 'férié test']]));
      const hist = historiqueRcp([{ d: D(1) - 7, service: 'PNEUMO', horaire: '16h-17h', ini: ['IA'] }, { d: D(1) - 14, service: 'PNEUMO', horaire: '16h-17h', ini: ['IA'] }], rcps, du);
      const g = genererRcp({ rcps, du, au, feries: new Map([[D(29), 'x']]), dispo, historique: hist, graine: 3 });
      const de = (id, d) => g.occ.find((o) => o.id === id && o.d === d);
      const cnt = (id, i) => g.occ.filter((o) => o.id === id && o.ini.includes(i)).length;
      const pb = controlerRcpGen(g.occ, rcps, g.indispo);
      return { nP: occ.filter((o) => o.id === 'P').length, nG: occ.filter((o) => o.id === 'G').map((o) => ymd(o.d).d), nI: occ.filter((o) => o.id === 'I').length,
        p1: de('P', D(1)).ini, s8: de('S', D(8)).ini, s1: de('S', D(1)).ini, g8: de('G', D(8)).ini, p8: de('P', D(8)).ini, pb: pb.length,
        pIA: cnt('P', 'IA'), pDA: cnt('P', 'DA'), pDB: cnt('P', 'DB'), iCnt: ['IA', 'IB', 'DA'].map((i) => cnt('I', i)),
        debuts: [debutRcp('17h-20h 1er lundi 16h-17h 3ème lundi', D(1)), debutRcp('17h-20h 1er lundi 16h-17h 3ème lundi', D(15)), debutRcp('MARDI 12h30', D(2))],
        dep: rcpDepuisImport([{ d: D(1), service: 'SENO', horaire: 'LUNDI 13h-14h', ini: ['SA', 'SB'] }, { d: D(8), service: 'SENO', horaire: 'LUNDI 13h-14h', ini: ['SC'] },
          { d: D(1), service: 'ORL', horaire: '13h-14h', ini: ['DA'] }, { d: D(15), service: 'ORL', horaire: '13h-14h', ini: ['DB'] }]) };
    }""")
    B.ok(r["nP"] == 4 and r["nG"] == [8, 22] and r["nI"] == 4, f"occurrences : chaque lundi sauf férié, 2e et 4e lundis, chaque jeudi ({r['nP']}, {r['nG']}, {r['nI']})")
    B.ok("DA" not in r["p1"] and r["pb"] == 0, f"absent jamais placé, aucun problème signalé ({r['p1']}, {r['pb']})")
    B.ok(r["s1"] == ["SA", "SB", "SC"] and r["s8"] == ["SA", "SC"], f"séno : tous les inscrits présents ({r['s1']}, {r['s8']})")
    B.ok(r["g8"] == ["DA"] and r["p8"] != [], f"astreinte : bloque la RCP de 17h seulement ({r['g8']}, {r['p8']})")
    B.ok(r["pIA"] <= min(r["pDA"], r["pDB"]) and max(r["iCnt"]) - min(r["iCnt"]) <= 1, f"équilibre avec l'historique (pneumo IA {r['pIA']}, DA {r['pDA']}, DB {r['pDB']} ; infectieux {r['iCnt']})")
    B.ok(r["debuts"] == [17 * 60, 16 * 60, 12 * 60 + 30], f"heure de début selon le rang du lundi ({r['debuts']})")
    dep = {x["service"]: x for x in r["dep"]}
    B.ok(dep["SENO"]["mode"] == "tous" and dep["SENO"]["medecins"] == ["SA", "SB", "SC"] and dep["ORL"]["mode"] == "nb" and dep["ORL"]["semaines"] == [1, 3], "liste déduite des fiches importées (mode, inscrits, semaines)")

    # 2. indisponibilités tirées du planning : jour off, autre site, absence acceptée
    r = pg.evaluate("""() => {
      const lun = dayFromYMD(2027, 3, 1), jeu = lun + 3;
      const pl = { jours: [lun, jeu], mainSite: 'Libourne', sites: ['Libourne', 'Blaye'], ordre: ['SCAN', 'BLA'],
        postes: { SCAN: { site: 'Libourne' }, BLA: { site: 'Blaye' } }, cases: { [`${jeu}_M_BLA`]: 'IA', [`${jeu}_AM_SCAN`]: 'IB' },
        statuts: { DB: { [`${lun}_AM`]: 'OFF' }, OA: { [`${lun}_M`]: 'ABS' } } };
      const garde = window.planDuJour; window.planDuJour = (d) => (pl.jours.includes(d) ? pl : null);
      const out = { ia: dispoRcp('IA', jeu, 14 * 60), ib: dispoRcp('IB', jeu, 14 * 60), db: dispoRcp('DB', lun, 16 * 60), db13: dispoRcp('DB', lun, 12 * 60 + 30), oa: dispoRcp('OA', lun, 12 * 60) };
      window.planDuJour = garde;
      return out;
    }""")
    B.ok(r == {"ia": "à Blaye", "ib": "", "db": "en repos", "db13": "", "oa": "absent"}, f"planning : autre site, repos, absence ({r})")

    # 3. écran Admin : liste des RCP, génération, retouche, enregistrement
    pg.wait_for_selector("#rcpgListe li[data-rcpg='d1']", timeout=8000)
    t = pg.inner_text("#rcpgListe")
    B.ok(pg.locator("#rcpgListe li[data-rcpg]").count() == 11 and "Liste proposée" in t and "1er, 3e lundi du mois" in t, "liste proposée par défaut (11 RCP, sans médecins)")
    pg.click("#rcpgListe li[data-rcpg='d2'] [data-rcpg-edit]")
    pg.click("#rcpgListe li[data-rcpg='d2'] [data-f=medecins] button[data-k='DA']"); pg.click("#rcpgListe li[data-rcpg='d2'] [data-rcpg-ok]")
    pg.wait_for_function("S.rcpCfg && S.rcpCfg.rcps && S.rcpCfg.rcps.length === 11", timeout=8000)
    B.ok(pg.evaluate("S.rcpCfg.rcps.find((r) => r.id === 'd2').medecins") == ["DA"], "première inscription : la liste proposée est enregistrée")
    pg.evaluate("""S.store.set(PATHS.rcpGen(), { rcps: [
        { id: 'P', service: 'PNEUMO', horaire: '16h-17h', jour: 0, semaines: [], mode: 'nb', nb: 1, medecins: ['DA', 'DB', 'IA'] },
        { id: 'S', service: 'SENO', horaire: 'LUNDI 13h-14h', jour: 0, semaines: [], mode: 'tous', nb: 1, medecins: ['SA', 'SB', 'SC'] } ] })""")
    pg.wait_for_selector("#rcpgListe li[data-rcpg='P']", timeout=8000)
    B.ok("chaque lundi" in pg.inner_text("#rcpgListe") and "tous les inscrits présents" in pg.inner_text("#rcpgListe"), "liste des RCP affichée")
    # ajout d'une RCP par le formulaire
    pg.click("#rcpgAjout")
    f = "#rcpgListe li[data-rcpg='nouveau']"
    pg.fill(f + " [data-f=service]", "Infectieux"); pg.select_option(f + " [data-f=jour]", "3"); pg.fill(f + " [data-f=horaire]", "14h-15h")
    for i in ["IA", "IB"]: pg.click(f + f" [data-f=medecins] button[data-k='{i}']")
    pg.click(f + " [data-rcpg-ok]")
    pg.wait_for_function("S.rcpCfg && S.rcpCfg.rcps.length === 3", timeout=8000)
    inf = pg.evaluate("S.rcpCfg.rcps.find((r) => r.service === 'INFECTIEUX')")
    B.ok(inf["jour"] == 3 and inf["medecins"] == ["IA", "IB"] and inf["semaines"] == [] and inf["mode"] == "nb", f"RCP ajoutée par le formulaire ({inf})")
    pg.click("#rcpgGen"); pg.wait_for_selector("#rcpgRes table.rcpt:not(.rcpeq)", timeout=8000)
    n = pg.locator("#rcpgRes table.rcpt:not(.rcpeq) tbody tr").count()
    B.ok(n >= 12, f"génération du mois suivant affichée ({n} lignes)")
    sel = pg.locator("#rcpgRes select[data-occ]").first
    sel.select_option("DB"); pg.wait_for_timeout(100)
    occ0 = pg.evaluate("(i) => RCPG.occ[i].ini", int(pg.locator("#rcpgRes select[data-occ]").first.get_attribute("data-occ")))
    B.ok(occ0 == ["DB"], "retouche à la main")
    pg.click("#rcpgSave"); pg.wait_for_function("document.querySelector('#rcpgMsg').innerText.includes('enregistrées')", timeout=8000)
    mois = pg.evaluate("S.rcpgMois")
    pg.wait_for_function("(m) => S.rcp && S.rcp.items && S.rcp.items.some((x) => moisDeJour(x.d) === m)", arg=mois, timeout=8000)
    items = pg.evaluate("(m) => S.rcp.items.filter((x) => moisDeJour(x.d) === m).length", mois)
    B.ok(items == n, f"RCP enregistrées dans les RCP du mois ({items} / {n})")
    # affichage existant : Général → RCP
    pg.evaluate("S.genView.mode = 'rcp'; location.hash = '#general'"); pg.wait_for_selector("#genBody table.rcpt", timeout=8000)
    B.ok("Pneumo" in pg.inner_text("#genBody"), "visibles dans Général → RCP")
    pg.set_viewport_size({"width": 390, "height": 844}); pg.evaluate("location.hash = '#admin'"); pg.wait_for_timeout(300)
    B.ok(pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"), "téléphone : pas de débordement de la page Admin")
    B.ok(not errs, "aucune erreur JavaScript" + (f" : {errs[:3]}" if errs else ""))
    b.close()
raise SystemExit(0 if B.fin() else 1)
