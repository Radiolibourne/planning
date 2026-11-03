# -*- coding: utf-8 -*-
"""
Admin en rubriques (démonstration, médecins fictifs) : barre des 6 rubriques, un outil à la fois, accueil « Préparer le mois »
(demandes acceptées ou refusées sans changer d'écran), Planning du mois (générer / publier / modifier au même endroit),
RCP en trois façons (importer, générer, modifier), aide « ? », « Se déconnecter » dans ⚙, astreintes rappelées deux fois par an.
"""
import datetime as dt, os
from playwright.sync_api import sync_playwright
from commun import Bilan, DIST, chromium

B = Bilan("Rubriques de l'administration")
auj = dt.date.today()
L1 = auj + dt.timedelta(days=7 - auj.weekday())          # lundi prochain
y, m = (auj.year + 1, 1) if auj.month == 12 else (auj.year, auj.month + 1)
DEB = dt.date(y, m, 1)                                     # 1er jour du mois suivant
J = lambda d: (d - dt.date(1970, 1, 1)).days

with sync_playwright() as p:
    b = chromium(p, plis=True)                             # comportement réel : un outil à la fois
    ctx = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("dialog", lambda d: d.accept())
    pg.goto("file://" + os.path.join(DIST, "demo.html") + "#admin")
    pg.wait_for_selector("#loginCard:not([hidden])")
    pg.fill("#loginEmail", "a@b.fr"); pg.fill("#loginPw", "x"); pg.click("#loginForm button[type=submit]")
    pg.wait_for_selector("#adminBody:not([hidden])")
    pg.evaluate("S.store.reset()"); pg.wait_for_timeout(300)
    haut = lambda i: pg.evaluate(f"document.getElementById('{i}').getBoundingClientRect().top")

    # 1. sans paramètres : le classeur en tête de l'accueil
    pg.wait_for_selector("#useDefault:not([hidden])", timeout=8000)
    B.ok(pg.is_visible("#paramCard") and pg.is_visible("#accueilCard") and haut("paramCard") < haut("accueilCard"), "sans paramètres : le classeur de paramètres en tête de l'accueil")
    pg.click("#useDefault"); pg.wait_for_function("document.querySelector('#paramInfo').innerText.includes('médecins')")
    pg.wait_for_selector("#accEtapes li")

    # 2. barre des rubriques, accueil
    nav = pg.evaluate("[...document.querySelectorAll('#admNav [data-sec]')].map((x) => [x.dataset.sec, x.getAttribute('aria-current')])")
    B.ok([x[0] for x in nav] == ["accueil", "planning", "absences", "rcp", "equipe", "suivi"] and nav[0][1] == "page", f"6 rubriques, accueil par défaut ({nav})")
    B.ok(not pg.is_visible("#paramCard") and pg.is_visible("#todoCard") and not pg.is_visible("#admOutils") and not pg.is_visible("#medCard"),
         "accueil : préparer le mois et « À surveiller » ; le classeur est rangé dans Équipe")
    et = pg.inner_text("#accEtapes")
    B.ok("Dépôt des absences" in et and "Demandes d'absence" in et and "Planning de" in et and "RCP de" in et, "accueil : étapes du mois suivant")

    # 3. étape « Planning » : ouvre « Planning du mois », dates du mois suivant
    pg.click("#accEtapes [data-todo='genCard']"); pg.wait_for_timeout(300)
    outils = pg.evaluate("[...document.querySelectorAll('#admOutils [data-outil]')].map((x) => x.innerText.trim())")
    B.ok(pg.evaluate("S.admSec") == "planning" and pg.is_visible("#genCard") and not pg.is_visible("#impCard") and pg.input_value("#gStart") == DEB.isoformat(),
         f"étape Planning : rubrique Planning, dates du mois suivant ({pg.input_value('#gStart')})")
    B.ok(outils == ["Planning du mois", "Absence imprévue"], f"Planning : deux outils ({outils})")
    pg.fill("#gStart", L1.isoformat()); pg.fill("#gEnd", (L1 + dt.timedelta(days=4)).isoformat()); pg.select_option("#gQual", "10")
    pg.click("#gBtn"); pg.wait_for_function("document.querySelector('#gMsg').innerText.startsWith('Planning généré')", timeout=90000)
    B.ok(pg.is_visible("#draftBody") and not pg.is_visible("#genCard") and pg.is_visible("#gMsg") and pg.is_visible("#publishBtn"),
         "brouillon : publication et retouches à la place du formulaire, au même endroit")
    pg.click("#publishBtn"); pg.click("#pubOk"); pg.wait_for_function("S.published && S.published.cases", timeout=10000)
    B.ok(pg.is_visible("#genCard") and pg.is_visible("#editPublished") and "Publié jusqu'au" in pg.inner_text("#draftSub"), "publié : nouveau planning ou modifier le publié")
    # raccourci « Modifier le publié » depuis l'accueil
    pg.click("#admNav [data-sec='accueil']"); pg.click("#accRacc [data-todo='editPublished']"); pg.wait_for_timeout(300)
    B.ok(pg.evaluate("!!S.draft && S.admSec") == "planning" and pg.is_visible("#draftBody"), "raccourci : modifier le planning publié")
    pg.click("#discardBtn"); pg.wait_for_function("!S.draft")

    # 4. demandes acceptées ou refusées depuis l'accueil
    pg.evaluate("""([a]) => { S.store.add(PATHS.indispos(), { ini: 'IA', d1: a, d2: a, periode: 'Matin', motif: '', creeLe: Date.now(), statut: 'attente' });
        S.store.add(PATHS.indispos(), { ini: 'SA', d1: a + 1, d2: a + 2, periode: 'Journée', motif: '', creeLe: Date.now(), statut: 'attente' }); }""", [J(DEB) + 7])
    pg.click("#admNav [data-sec='accueil']")
    pg.wait_for_function("document.querySelectorAll('#accEtapes [data-accept]').length === 2", timeout=8000)
    B.ok(pg.inner_text("#admNav [data-sec='absences'] .ab") == "2" and pg.inner_text("#admNav [data-sec='accueil'] .ab") == "2", "pastilles : 2 demandes à valider")
    pg.click("#accEtapes [data-accept]")
    pg.wait_for_function("S.indispos.some((x) => x.ini === 'IA' && x.statut === 'acceptee')", timeout=8000)
    B.ok("acceptée" in pg.inner_text("#accMsg") and pg.evaluate("S.admSec") == "accueil", "accepter depuis l'accueil, sans changer d'écran")
    pg.wait_for_function("document.querySelectorAll('#accEtapes [data-refuse]').length === 1", timeout=8000)
    pg.click("#accEtapes [data-refuse]")
    pg.wait_for_function("S.indispos.some((x) => x.ini === 'SA' && x.statut === 'refusee')", timeout=8000)
    pg.wait_for_function("document.querySelector('#accEtapes').innerText.includes('Aucune demande en attente')", timeout=8000)
    B.ok(pg.locator("#admNav [data-sec='absences'] .ab").count() == 0, "refuser depuis l'accueil ; plus de pastille")

    # 5. un outil à la fois, retenu par rubrique
    pg.click("#admNav [data-sec='absences']")
    outils = pg.evaluate("[...document.querySelectorAll('#admOutils [data-outil]')].map((x) => x.innerText.trim())")
    B.ok(outils == ["Demandes", "Calendrier", "Dates limites", "Congés"] and pg.is_visible("#indCard") and not pg.is_visible("#absCalCard"), f"Absences : 4 outils, un seul affiché ({outils})")
    pg.click("#admOutils [data-outil='absCalCard']")
    B.ok(pg.is_visible("#absCalCard") and not pg.is_visible("#indCard") and not pg.is_visible("#cloCard"), "changement d'outil")
    pg.click("#admNav [data-sec='equipe']"); pg.click("#admNav [data-sec='absences']")
    B.ok(pg.is_visible("#absCalCard"), "l'outil choisi est retenu dans la rubrique")
    # aide « ? »
    B.ok(not pg.is_visible("#absCalCard p.aide"), "aide détaillée masquée")
    pg.click("#absCalCard .aideb")
    B.ok(pg.is_visible("#absCalCard p.aide") and pg.get_attribute("#absCalCard .aideb", "aria-expanded") == "true", "« ? » affiche l'aide détaillée")

    # 6. RCP : trois façons de faire
    pg.click("#admNav [data-sec='rcp']")
    B.ok(pg.is_visible("#rcpCard") and pg.is_visible("#rcpGenCard") and not pg.is_visible("#rcpImport") and not pg.is_visible("#rcpModif"), "RCP du mois suivant à faire : « Générer » ouvert")
    pg.click("#rcpCard [data-rcpmode='import']")
    B.ok(pg.is_visible("#rcpImport") and not pg.is_visible("#rcpGenCard"), "« Importer »")
    pg.click("#rcpCard [data-rcpmode='modif']")
    B.ok(pg.is_visible("#rcpModif") and "Aucune RCP enregistrée" in pg.inner_text("#rcpListe"), "« Modifier » : mois enregistrés")
    pg.click("#admOutils [data-outil='astrCard']")
    B.ok(pg.is_visible("#astrCard") and not pg.is_visible("#rcpCard"), "Astreintes dans la même rubrique")

    # 7. astreintes : rappelées seulement à l'approche de la fin de la période saisie (deux fois par an)
    ast = pg.evaluate("""() => {
      const orig = window.astreintesConnues, cfg = S.astrCfg, t = todayDay(), res = {};
      const essai = (m) => { window.astreintesConnues = () => m; S.astrCfg = null; renderAccueil();
        return [document.querySelector('#accEtapes').innerText.includes('Astreintes'), todoItems().some((x) => /^Astreintes/.test(x[1]))]; };
      res.aucune = essai(new Map());
      res.loin = essai(new Map([[t + 150, ['DA']]]));
      res.bientot = essai(new Map([[t + 40, ['DA']]]));
      window.astreintesConnues = orig; S.astrCfg = cfg; renderAccueil();
      return res; }""")
    B.ok(ast["aucune"] == [True, True] and ast["loin"] == [False, False] and ast["bientot"] == [True, True], f"astreintes : pas de rappel mensuel, seulement avant la fin de la période saisie ({ast})")

    # 8. téléphone : pas de défilement horizontal ; ordinateur : menu à gauche
    larg = pg.evaluate("""() => ['accueil', 'planning', 'absences', 'rcp', 'equipe', 'suivi'].map((s) => { admSection(s); return document.documentElement.scrollWidth <= innerWidth; })""")
    B.ok(all(larg), f"téléphone : aucune rubrique ne déborde ({larg})")
    pg.set_viewport_size({"width": 1440, "height": 900}); pg.wait_for_timeout(200)
    bx = pg.evaluate("(() => { const r = document.getElementById('admNav').getBoundingClientRect(), c = document.getElementById('accueilCard').getBoundingClientRect(); admSection('accueil'); return [r.width, getComputedStyle(document.getElementById('admNav')).flexDirection, document.getElementById('accueilCard').getBoundingClientRect().left > r.right]; })()")
    B.ok(bx[0] < 300 and bx[1] == "column" and bx[2], f"ordinateur : menu des rubriques à gauche ({bx})")
    pg.set_viewport_size({"width": 390, "height": 844})

    # 9. « Se déconnecter » dans ⚙
    B.ok(pg.locator("#adminBody #logoutBtn").count() == 0, "plus de « Se déconnecter » dans l'Admin")
    pg.click("#gearBtn"); pg.wait_for_selector("#compteCard")
    B.ok("administrateur" in pg.inner_text("#compteCard"), "⚙ : compte connecté")
    pg.click("#logoutBtn"); pg.wait_for_selector("#loginCard:not([hidden])", timeout=8000)
    B.ok(pg.evaluate("!S.admin") and pg.is_hidden("#adminBody"), "⚙ → Se déconnecter : retour à la connexion administrateur")
    B.ok(not errs, "aucune erreur JavaScript" + (f" : {errs[:3]}" if errs else ""))
    b.close()
raise SystemExit(0 if B.fin() else 1)
