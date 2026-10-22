# -*- coding: utf-8 -*-
"""
Outils de l'administrateur (médecins fictifs) : récapitulatif avant publication, retour à la publication précédente,
cadenas et régénération d'une semaine, compteurs d'équilibre, calendrier des absences, absence imprévue, écran « À faire »,
modification des RCP enregistrées.
"""
import datetime as dt, os
from playwright.sync_api import sync_playwright
from commun import Bilan, DIST, chromium

B = Bilan("Outils de l'administrateur")
auj = dt.date.today()
L1 = auj + dt.timedelta(days=7 - auj.weekday())          # lundi prochain
FIN = L1 + dt.timedelta(days=11)                          # vendredi de la semaine suivante
with sync_playwright() as p:
    b = chromium(p)
    pg = b.new_context(viewport={"width": 1200, "height": 900}).new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("dialog", lambda d: d.accept())
    pg.add_init_script("window.__PLIS_TOUT = true")
    pg.goto("file://" + os.path.join(DIST, "demo.html") + "#admin")
    pg.wait_for_selector("#loginCard:not([hidden])")
    pg.fill("#loginEmail", "a@b.fr"); pg.fill("#loginPw", "x"); pg.click("#loginForm button[type=submit]")
    pg.wait_for_selector("#adminBody:not([hidden])")
    pg.evaluate("S.store.reset()"); pg.wait_for_timeout(300)
    pg.wait_for_selector("#useDefault:not([hidden])")
    pg.click("#useDefault"); pg.wait_for_function("document.querySelector('#paramInfo').innerText.includes('médecins')")
    pg.evaluate("S.me = 'DA'")

    def generer():
        pg.fill("#gStart", L1.isoformat()); pg.fill("#gEnd", FIN.isoformat()); pg.select_option("#gQual", "10")
        pg.click("#gBtn"); pg.wait_for_function("document.querySelector('#gMsg').innerText.startsWith('Planning généré')", timeout=90000)

    # ---------------------------------------------------------------- 1. récapitulatif avant publication, retour en arrière
    generer()
    pg.click("#publishBtn"); pg.wait_for_selector("#pubOverlay:not([hidden])")
    B.ok("jour(s) nouveau(x)" in pg.inner_text("#pubCorps"), "récapitulatif : jours nouveaux annoncés")
    pg.click("#pubOk"); pg.wait_for_function("document.querySelector('#gMsg').innerText.startsWith('Planning publié')", timeout=10000)
    v1 = pg.evaluate("JSON.stringify(S.published.cases)")
    # modification d'une case déjà publiée
    pg.click("#editPublished"); pg.wait_for_selector("#draftBody:not([hidden])")
    k, avant = pg.evaluate("""() => { const k = Object.keys(S.draft.cases).find((k) => splitInis(S.draft.cases[k]).length === 1 && !k.endsWith('-TT'));
        const a = S.draft.cases[k]; S.draft.cases[k] = ''; return [k, a]; }""")
    pg.click("#publishBtn"); pg.wait_for_selector("#pubOverlay:not([hidden])")
    t = pg.inner_text("#pubCorps")
    B.ok("1 demi-journée(s) déjà publiée(s) changent" in t and avant in t and "→" in t, f"récapitulatif : changement par médecin ({t[:120]})")
    pg.click("#pubAnnul"); B.ok(pg.is_hidden("#pubOverlay") and pg.evaluate("JSON.stringify(S.published.cases)") == v1, "« Retour » : rien n'est publié")
    pg.click("#publishBtn"); pg.click("#pubOk")
    pg.wait_for_function("(k) => S.published.cases[k] === ''", arg=k, timeout=10000)
    pg.wait_for_selector("#undoPub:not([hidden])", timeout=8000)
    pg.click("#undoPub")
    pg.wait_for_function("(v) => JSON.stringify(S.published.cases) === v", arg=v1, timeout=10000)
    B.ok(pg.evaluate("S.published.publication.retour === true && Object.keys(S.published.publication.modifs).length === 1"), "retour à la publication précédente (médecin concerné prévenu)")

    # ---------------------------------------------------------------- 2. cadenas et régénération d'une semaine
    pg.click("#editPublished"); pg.wait_for_selector("#draftBody:not([hidden])")
    k2 = pg.evaluate("""(l2) => Object.keys(S.draft.cases).find((k) => +k.split('_')[0] >= l2 && splitInis(S.draft.cases[k]).length === 1 && !k.endsWith('-TT'))""", (L1 - dt.date(1970, 1, 1)).days + 7)
    semaine1 = pg.evaluate("(l1) => JSON.stringify(Object.entries(S.draft.cases).filter(([k]) => +k.split('_')[0] < l1 + 7))", (L1 - dt.date(1970, 1, 1)).days)
    occ = pg.evaluate("(k) => S.draft.cases[k]", k2)
    pg.evaluate("(k) => { S.draftVue = { week: mondayOf(+k.split('_')[0]) }; renderDraft(); }", k2)
    pg.click(f"#draftGrid td[data-k='{k2}']"); pg.click("#caseVerrou"); pg.click("#caseFini")
    B.ok(pg.evaluate("(k) => !!S.draft.verrous[k]", k2) and pg.locator(f"#draftGrid td.lock[data-k='{k2}']").count() == 1, "case verrouillée (cadenas affiché)")
    pg.select_option("#regenSem", str((L1 - dt.date(1970, 1, 1)).days + 7))
    pg.click("#regenBtn"); pg.wait_for_function("document.querySelector('#pubMsg').innerText.startsWith('Régénéré')", timeout=90000)
    B.ok(pg.evaluate("(k) => S.draft.cases[k]", k2) == occ, f"régénération : la case verrouillée garde son médecin ({occ})")
    B.ok(pg.evaluate("(l1) => JSON.stringify(Object.entries(S.draft.cases).filter(([k]) => +k.split('_')[0] < l1 + 7))", (L1 - dt.date(1970, 1, 1)).days) == semaine1, "régénération d'une semaine : l'autre semaine ne bouge pas")
    pg.click("#publishBtn"); pg.click("#pubOk"); pg.wait_for_function("!S.draft", timeout=10000)
    B.ok(pg.evaluate("!('verrous' in S.published)"), "les cadenas ne sont pas publiés")

    # ---------------------------------------------------------------- 3. équilibre par médecin pendant les retouches
    pg.click("#editPublished"); pg.wait_for_selector("#draftBody:not([hidden])")
    pg.evaluate("document.getElementById('eqDetails').open = true")
    tot = lambda: int(pg.inner_text("#dEq tbody tr:has(td b:text-is('DA')) td:nth-child(2)"))
    t0 = tot()
    pg.evaluate("""() => { const k = Object.keys(S.draft.cases).find((k) => !k.endsWith('-TT') && splitInis(S.draft.cases[k]).includes('DA'));
        memoriser(); retirerDe('DA', k); apresRetouche(); }""")
    B.ok(tot() == t0 - 1 and pg.locator("#dEq th").count() >= 5, f"équilibre par médecin mis à jour à chaque retouche ({t0} → {tot()})")
    B.ok("écart" in pg.inner_text("#eqResume") or "équilibré" in pg.inner_text("#eqResume"), "résumé des écarts")
    pg.click("#discardBtn"); pg.wait_for_function("!S.draft")

    # ---------------------------------------------------------------- 4. calendrier des absences, demandes qui se chevauchent
    J = lambda d: (d - dt.date(1970, 1, 1)).days
    M2 = L1 + dt.timedelta(days=28)   # hors planning publié
    pg.evaluate("""([a, b]) => { S.store.add(PATHS.indispos(), { ini: 'DB', d1: a, d2: a + 2, periode: 'Journée', motif: '', creeLe: Date.now(), statut: 'acceptee' });
        S.store.add(PATHS.indispos(), { ini: 'IA', d1: a + 1, d2: a + 1, periode: 'Matin', motif: '', creeLe: Date.now(), statut: 'attente' });
        S.store.add(PATHS.indispos(), { ini: 'SA', d1: a + 1, d2: a + 1, periode: 'Journée', motif: '', creeLe: Date.now(), statut: 'attente' }); }""", [J(M2), 0])
    pg.wait_for_function("S.indispos.length >= 3", timeout=8000)
    pg.evaluate("(m) => { S.acMois = m; renderAbsCal(); }", M2.year * 100 + M2.month)
    pg.select_option("#acSeuil", "3")
    B.ok(pg.locator(f"#acGrille tr:has(th:text-is('DB')) td.acc[data-j='{J(M2)}']").count() == 1 and pg.locator(f"#acGrille tr:has(th:text-is('IA')) td.att[data-j='{J(M2) + 1}']").count() == 1,
         "calendrier : absence acceptée pleine, demande en attente hachurée")
    B.ok(pg.locator("#acGrille tr.tot td.trop").count() == 1, "jour à 3 absents signalé en rouge")
    B.ok("Déjà absents ces jours-là : DB" in pg.inner_text("#admInd"), "demande à valider : collègues déjà absents indiqués")

    # ---------------------------------------------------------------- 5. absence imprévue
    ini, jour = pg.evaluate("""(l1) => { const k = Object.keys(S.published.cases).find((k) => +k.split('_')[0] >= l1 && /_(ECH1|MAM|IRM1)$/.test(k) && splitInis(S.published.cases[k]).length === 1);
        return [splitInis(S.published.cases[k])[0], +k.split('_')[0]]; }""", J(L1))
    pg.select_option("#impIni", ini); pg.fill("#impD1", (dt.date(1970, 1, 1) + dt.timedelta(days=jour)).isoformat()); pg.fill("#impD2", (dt.date(1970, 1, 1) + dt.timedelta(days=jour)).isoformat())
    pg.click("#impChercher"); pg.wait_for_selector("#impRes table.impt, #impRes p")
    n = pg.locator("#impRes select[data-imp]").count()
    rempl = [pg.locator(f"#impRes select[data-imp='{i}']").input_value() for i in range(n)]
    B.ok(n >= 1 and all(r and r != ini for r in rempl), f"absence imprévue : {n} demi-journée(s) à remplacer, remplaçants proposés ({rempl})")
    pg.click("#impValider"); pg.wait_for_function("document.querySelector('#impMsg').innerText.includes('republié')", timeout=10000)
    r = pg.evaluate("""([ini, d]) => ({ reste: Object.keys(S.published.cases).filter((k) => +k.split('_')[0] === d && splitInis(S.published.cases[k]).includes(ini)).length,
        abs: S.published.statuts[ini][d + '_M'] === 'ABS' && S.published.statuts[ini][d + '_AM'] === 'ABS', ind: S.indispos.some((x) => x.ini === ini && x.d1 === d && x.statut === 'acceptee'),
        notif: Object.keys(S.published.publication.modifs) })""", [ini, jour])
    B.ok(r["reste"] == 0 and r["abs"] and r["ind"], f"cases libérées, statut absent, absence enregistrée ({r})")
    B.ok(ini in r["notif"] and all(x in r["notif"] for x in rempl), "médecins concernés prévenus (absent et remplaçants)")
    dbl = pg.evaluate("""([d]) => ['M', 'AM'].map((h) => { const n = {}; for (const c of postesAffiches(S.published)) for (const o of occupants(S.published, d, h, c)) n[o.ini] = (n[o.ini] || 0) + 1; return Math.max(...Object.values(n)); })""", [jour])
    B.ok(max(dbl) == 1, "un remplaçant pris sur un autre poste en est retiré (pas de doublon)")

    # ---------------------------------------------------------------- 6. « À faire »
    ini2, j2 = pg.evaluate("""(l1) => { const k = Object.keys(S.published.cases).find((k) => +k.split('_')[0] >= l1 + 7 && /_(ECH1|MAM|IRM1)$/.test(k) && splitInis(S.published.cases[k]).length === 1);
        return [splitInis(S.published.cases[k])[0], +k.split('_')[0]]; }""", J(L1))
    pg.evaluate("([i, d]) => S.store.add(PATHS.indispos(), { ini: i, d1: d, d2: d, periode: 'Journée', motif: '', creeLe: Date.now(), statut: 'acceptee' })", [ini2, j2])
    pg.wait_for_function("(i) => document.querySelector('#todoList').innerText.includes(i + ' absent')", arg=ini2, timeout=8000)
    t = pg.inner_text("#todoList")
    B.ok("demande(s) d'absence" in t and "à valider" in t and "Astreintes de" in t and "Aucune sauvegarde" in t, f"À faire : demandes, astreintes du mois prochain, sauvegarde ({t[:160]})")
    pg.click(f"#todoList [data-imp-pre^='{ini2}|']")
    pg.wait_for_selector("#impRes select[data-imp]", timeout=8000)
    B.ok(pg.input_value("#impIni") == ini2 and pg.locator("#impRes select[data-imp]").count() >= 1, "« Remplacer » ouvre l'absence imprévue préremplie avec les remplaçants")
    pg.click("#todoList [data-todo='indCard']"); pg.wait_for_timeout(1200)
    B.ok(pg.evaluate("Math.abs(document.getElementById('indCard').getBoundingClientRect().top) < 200"), "« Voir » amène à la bonne carte")

    # ---------------------------------------------------------------- 7. médecin : dépôt d'absence au calendrier
    pg.evaluate("S.admin = false; S.me = 'OC'; location.hash = '#indispos'")
    pg.wait_for_selector("#indForm"); pg.click("[data-indmode='cal']"); pg.evaluate("renderIndispos()")
    pg.wait_for_selector(f"#indCal [data-ij='{J(M2)}']")
    B.ok(pg.inner_text(f"#indCal [data-ij='{J(M2) + 1}'] .na") == "3" and pg.locator(f"#indCal [data-ij='{J(M2) + 5}']").is_disabled(),
         "calendrier : nombre de collègues absents affiché, week-end non sélectionnable")
    for k in (3, 4, 7, 9): pg.click(f"#indCal [data-ij='{J(M2) + k}']")
    B.ok(pg.inner_text("#indCalSel").count("du ") == 1 and "Sélection" in pg.inner_text("#indCalSel"), f"jours touchés regroupés en plages ({pg.inner_text('#indCalSel')})")
    avant = pg.evaluate("S.indispos.length")
    pg.click("#indSubmit"); pg.wait_for_function("document.querySelector('#indMsg').innerText.includes('demandes envoyées')", timeout=8000)
    try: pg.wait_for_function("S.indispos.filter((x) => x.ini === 'OC' && x.statut === 'attente').length >= 2", timeout=8000)
    except Exception: pass
    diag = pg.evaluate("JSON.stringify([document.querySelector('#indMsg').innerText, S.indispos.filter((x) => x.ini === 'OC'), S.me, todayDay()])")
    r = pg.evaluate("(a) => S.indispos.filter((x) => x.ini === 'OC' && x.statut === 'attente').map((x) => [x.d1, x.d2]).sort()", J(M2))
    B.ok(r == [[J(M2) + 3, J(M2) + 7], [J(M2) + 9, J(M2) + 9]], f"2 demandes : jeudi → lundi (week-end compris dans la plage) et mercredi ({r} {diag if len(r) != 2 else ''})")
    pg.click("[data-indmode='dates']")
    B.ok(pg.is_visible("#indD1") and pg.is_hidden("#indCal"), "saisie par dates toujours possible")
    pg.evaluate("S.admin = true")

    # ---------------------------------------------------------------- 8. modifier les RCP enregistrées
    pg.evaluate("location.hash = '#admin'")
    pg.evaluate("""(a) => S.store.set(PATHS.rcp(), { items: [{ d: a, service: 'PNEUMO', horaire: '16h-17h', ini: ['DA'] }, { d: a + 1, service: 'HEMATO', horaire: 'MARDI 14h-15h', ini: ['DB'] }] })""", J(M2))
    mo = M2.year * 100 + M2.month
    pg.wait_for_selector(f"#rcpListe [data-rcp-modif='{mo}']", timeout=8000)
    pg.click(f"#rcpListe [data-rcp-modif='{mo}']"); pg.wait_for_selector("#rcpEdit tr[data-l='1']")
    pg.fill("#rcpEdit tr[data-l='0'] [data-c='ini']", "ob / oc")
    pg.click("#rcpEdit [data-rcpe-suppr='1']")
    pg.click("#rcpeAjout"); pg.fill("#rcpEdit tr[data-l='1'] [data-c='service']", "orl"); pg.fill("#rcpEdit tr[data-l='1'] [data-c='horaire']", "13h-14h")
    pg.fill("#rcpEdit tr[data-l='1'] [data-c='d']", (M2 + dt.timedelta(days=7)).isoformat()); pg.fill("#rcpEdit tr[data-l='1'] [data-c='ini']", "SA")
    pg.click("#rcpeSave"); pg.wait_for_function("document.querySelector('#rcpMsg').innerText.includes('enregistrées')", timeout=8000)
    pg.wait_for_function("S.rcp.items.length === 2 && S.rcp.items[1].service === 'ORL'", timeout=5000)
    it = pg.evaluate("S.rcp.items.map((x) => [x.service, x.ini.join('/')])")
    B.ok(it == [["PNEUMO", "OB/OC"], ["ORL", "SA"]], f"RCP modifiées : radiologues changés, une supprimée, une ajoutée ({it})")
    pg.evaluate("(m) => { S.genView.mode = 'rcp'; S.genView.rcpMois = m; location.hash = '#general'; }", mo)
    pg.wait_for_selector("#rcpModifGen", timeout=8000)
    B.ok(True, "Général → RCP : lien « Modifier » pour l'administrateur")

    B.ok(not errs, "aucune erreur JavaScript" + (f" : {errs[:3]}" if errs else ""))
    b.close()
raise SystemExit(0 if B.fin() else 1)
