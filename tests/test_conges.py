# -*- coding: utf-8 -*-
"""
Compteurs de congés (médecins fictifs) : règle du off (CA, RTT), demi-journée seule sans off, formation sans off,
RTT consommés avant les CA ; droits au prorata ; compteurs invisibles pour les non-administrateurs ;
décompte et tableau de l'administrateur.
"""
import datetime as dt, os
from playwright.sync_api import sync_playwright
from commun import Bilan, DIST, chromium

B = Bilan("Compteurs de congés")
AN = dt.date.today().year + 1
with sync_playwright() as p:
    b = chromium(p)
    pg = b.new_context(viewport={"width": 1200, "height": 900}).new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("dialog", lambda d: d.accept())
    pg.goto("file://" + os.path.join(DIST, "demo.html") + "#admin")
    pg.wait_for_selector("#loginCard:not([hidden])")
    pg.fill("#loginEmail", "a@b.fr"); pg.fill("#loginPw", "x"); pg.click("#loginForm button[type=submit]")
    pg.wait_for_selector("#adminBody:not([hidden])")
    pg.evaluate("S.store.reset()"); pg.wait_for_timeout(300)   # démonstration vide (indépendante des autres tests)
    pg.wait_for_selector("#useDefault:not([hidden])")
    pg.click("#useDefault"); pg.wait_for_function("document.querySelector('#paramInfo').innerText.includes('médecins')")
    # règles de calcul
    r = pg.evaluate("""(an) => { const D = (m, d) => dayFromYMD(an, m, d), doc = { offA: new Set([4]), offB: new Set([4]) };
        const lundi = (() => { let d = D(3, 1); while (weekday(d) !== 0) d++; return d; })();
        const f = feriesPeriode(D(1, 1), D(12, 31));
        const t = (abs, rtt) => { const x = decompteConges(abs, doc, an, f, lundi, rtt); return [x.CA, x.RTT, x.FORM]; };
        const J = (d1, d2, type, periode = 'Journée') => ({ d1, d2, type, periode });
        return { un: t([J(lundi, lundi, 'CA')]), semaine: t([J(lundi, lundi + 4, 'CA')]), lunjeu: t([J(lundi, lundi + 3, 'CA')]),
          rtt: t([J(lundi + 1, lundi + 1, 'RTT')]), form: t([J(lundi + 1, lundi + 1, 'FORM')]), demi: t([J(lundi + 2, lundi + 2, 'CA', 'Matin')]),
          mixte: t([J(lundi, lundi, 'CA'), J(lundi + 1, lundi + 1, 'RTT')]), deux: t([J(lundi, lundi + 11, 'CA')]),
          deuxDemi: t([J(lundi + 2, lundi + 2, 'CA', 'Matin'), J(lundi + 3, lundi + 3, 'CA', 'Après-midi')]),
          prio: t([J(lundi, lundi + 4, 'CA')], 1.5), prio20: t([J(lundi, lundi, 'CA')], 20), formPrio: t([J(lundi + 1, lundi + 1, 'FORM')], 20),
          droits: droitsConges({}, 0.8), types: [typeConge('Congés annuels (CA)'), typeConge('Congés — x'), typeConge('RTT'), typeConge('Formation'), typeConge('Congrès')] }; }""", AN)
    B.ok(r["un"] == [2, 0, 0] and r["semaine"] == [5, 0, 0] and r["lunjeu"] == [5, 0, 0], f"règle du off : 1 jour = 2, semaine = 5, lundi-jeudi = 5 ({r['un']}, {r['semaine']}, {r['lunjeu']})")
    B.ok(r["rtt"] == [0, 2, 0] and r["form"] == [0, 0, 1] and r["demi"] == [0.5, 0, 0], f"RTT avec off, formation sans off, demi-journée seule sans off ({r['demi']})")
    B.ok(r["deuxDemi"] == [2, 0, 0], f"deux demi-journées dans la semaine : off décompté ({r['deuxDemi']})")
    B.ok(r["prio"] == [3.5, 1.5, 0] and r["prio20"] == [0, 2, 0] and r["formPrio"] == [0, 0, 1], f"RTT pris avant les CA ({r['prio']}, {r['prio20']})")
    B.ok(sum(r["mixte"]) == 3 and r["deux"] == [10, 0, 0], f"un seul off par semaine ({r['mixte']}, {r['deux']})")
    B.ok(r["droits"]["CA"]["droit"] == 20 and r["droits"]["RTT"]["droit"] == 16, "droits au prorata de la quotité (80 %)")
    B.ok(r["types"] == ["CA", "CA", "RTT", "FORM", None], f"motifs reconnus ({r['types']})")
    # non-administrateur : ni compteur ni décompte
    pg.evaluate("S.me = 'DA'; S.P.docs.DA.offA = new Set([4]); S.P.docs.DA.offB = new Set([4]); S.P.docs.DA.quotite = 1; S.admin = false; location.hash = '#indispos'")
    lundi = pg.evaluate("(an) => { let d = dayFromYMD(an, 3, 1); while (weekday(d) !== 0) d++; return toInput(d); }", AN)
    pg.wait_for_selector("#indD1"); pg.evaluate("renderIndispos()")
    pg.fill("#indD1", lundi); pg.fill("#indD2", lundi); pg.select_option("#indMotif", "Congés annuels (CA)"); pg.dispatch_event("#indMotif", "change")
    B.ok(pg.locator("#congMoiCard").is_hidden() and pg.locator("#indCout").is_hidden(), "non-administrateur : aucun compteur ni décompte affiché")
    # administrateur : décompte (RTT d'abord), puis tableau
    pg.evaluate("S.admin = true; renderIndispos()"); pg.dispatch_event("#indMotif", "change")
    t = pg.inner_text("#indCout")
    B.ok("2 RTT" in t and "jour off" in t and "ven" in t, f"administrateur : décompte annoncé, RTT d'abord ({t})")
    pg.click("#indSubmit"); pg.wait_for_function("document.querySelector('#indMsg').innerText.includes('enregistrée')", timeout=8000)
    pg.evaluate("(an) => { S.congAn = an; location.hash = '#admin'; }", AN); pg.wait_for_selector("#congTab tr[data-ini='DA']")
    pg.evaluate("(an) => { S.congAn = an; renderCongesAdmin(); }", AN)
    pg.wait_for_function("document.querySelector(\"#congTab tr[data-ini='DA']\").innerText.includes('18')", timeout=8000)
    row = pg.inner_text("#congTab tr[data-ini='DA']")
    B.ok(row.split("\t")[1:4] == ["25", "18", "4"], f"administrateur : congé CA décompté en RTT ({row})")
    pg.click("#congTab tr[data-ini='DA'] [data-cong-edit]")
    pg.fill("#congTab tr[data-ini='DA'] input[data-k='reportCA']", "3")
    pg.click("#congTab tr[data-ini='DA'] [data-cong-ok]")
    pg.wait_for_function("S.conges && S.conges.annees", timeout=8000)
    B.ok(pg.inner_text("#congTab tr[data-ini='DA']").split("\t")[1] == "28", "report ajouté aux droits")
    pg.fill("#congDefRTT", "19"); pg.click("#congDefOk"); pg.wait_for_function("S.conges.defauts && S.conges.defauts.RTT === 19", timeout=8000)
    B.ok(pg.inner_text("#congTab tr[data-ini='DA']").split("\t")[2] == "17", "droits par défaut modifiables")
    pg.set_viewport_size({"width": 390, "height": 844}); pg.wait_for_timeout(200)
    B.ok(pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"), "téléphone : pas de débordement de la page Admin")
    B.ok(not errs, "aucune erreur JavaScript" + (f" : {errs[:3]}" if errs else ""))
    b.close()
raise SystemExit(0 if B.fin() else 1)
