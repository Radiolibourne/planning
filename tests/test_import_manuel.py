# -*- coding: utf-8 -*-
"""
Import du planning Excel « fait à la main » (un onglet par semaine, lignes = postes, colonnes = lundi matin … vendredi après-midi),
avec des médecins fictifs : cellules fusionnées, « * » = télétravail, Blaye à deux noms, absences « (mat) », astreinte, notes,
internes ignorés, jour férié.
"""
import datetime as dt, os
from openpyxl import Workbook
from playwright.sync_api import sync_playwright
from commun import Bilan, DIST, SORTIE, chromium

B = Bilan("Import du planning fait à la main")
wb = Workbook(); wb.remove(wb.active)
LIB = {5: "INTERPRETATION RADIO LIBOURNE URGENCES :", 7: "DEPLACEMENT BLAYE", 9: "DEPLACEMENT STE FOY", 10: "SCANNER : LIBOURNE, BLAYE, STE FOY",
       12: "+", 14: "INTERVENTIONNEL SCANNER", 15: "IRM 1 + RADIO URGENCES", 16: "IRM 2 + RADIO EXTERNES", 19: "SALLE  Interventionnel",
       20: "ECHOGRAPHIE 1", 21: "ECHOGRAPHIE 2", 22: "MAMMOGRAPHIE", 23: "NOTE", 26: "Absence : Rayann", 32: "ASTREINTE"}
def semaine(titre, entete, cases, fusions=()):
    ws = wb.create_sheet(titre)
    ws["A1"] = entete
    for r, t in LIB.items(): ws.cell(r, 1, t)
    for (r, c), v in cases.items(): ws.cell(r, c, v)
    for f in fusions: ws.merge_cells(f)
# colonnes : B = lun M, C = lun AM, D = mar M, … , J = ven M, K = ven AM
semaine("DU 2 NOVEMBRE AU 6 NOVEMBRE", "SEMAINE DU 2 NOVEMBRE 2026 AU 6 NOVEMBRE 2026", {
    (5, 2): "SCAN/IRM (V/S)",                       # ligne d'interprétation : ignorée
    (7, 2): "SA / OA",                              # Blaye fusionné sur la journée : 1er mammo, 2e radio-écho
    (10, 2): "DA/OB*/ INTERNE", (10, 3): "DA/SC", (10, 6): "DB/OC",
    (19, 8): "OA",                                  # salle le jeudi matin -> arthrographies
    (15, 2): "SD", (15, 3): "RAYANN",
    (23, 4): "Réunion de service à 13h30",
    (31, 8): "IB(mat)/DA/ SB(off à récup : le 19/11)",
    (32, 2): "IA", (32, 8): "OB",
}, fusions=("B7:C7", "D23:E23", "F10:F11", "H31:I31"))
semaine("DU 9 NOVEMBRE AU 13 NOVEMBRE", "SEMAINE DU 9 NOVEMBRE 2026 AU 13 NOVEMBRE 2026", {
    (10, 2): "DA/OB/SC", (10, 6): "FERIE", (22, 6): "FERIE",
})
f = os.path.join(SORTIE, "planning_fait_main.xlsx")
wb.save(f)
jn = lambda m, d: (dt.date(2026, m, d) - dt.date(1970, 1, 1)).days

with sync_playwright() as p:
    b = chromium(p)
    pg = b.new_context(viewport={"width": 1200, "height": 900}).new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("dialog", lambda d: d.accept())
    pg.goto("file://" + os.path.join(DIST, "demo.html") + "#admin")
    pg.wait_for_selector("#loginCard:not([hidden])")
    pg.fill("#loginEmail", "a@b.fr"); pg.fill("#loginPw", "x"); pg.click("#loginForm button[type=submit]")
    pg.wait_for_selector("#adminBody:not([hidden])")
    pg.click("#useDefault"); pg.wait_for_function("document.querySelector('#paramInfo').innerText.includes('médecins')")
    pg.set_input_files("#upPlanning", f)
    pg.wait_for_function("document.querySelector('#gMsg').innerText.startsWith('Planning importé')", timeout=10000)
    msg = pg.inner_text("#gMsg")
    B.ok("fait à la main" in msg and "INTERNE" in msg and "RAYANN" in msg and "11)" not in msg.split("Ignorés")[-1], f"import accepté, internes signalés comme ignorés ({msg})")
    r = pg.evaluate("""([l, j, me, ve, l2, je2]) => { const d = S.draft, c = (dd, h, k) => d.cases[caseKey(dd, h, k)] || "";
      return { start: d.start, end: d.end, ferie: d.jours.includes(me + 7),
        blm: [c(l, "M", "BL-MAM"), c(l, "AM", "BL-MAM")], blr: [c(l, "M", "BL-RE"), c(l, "AM", "BL-RE")],
        scan: c(l, "M", "SCAN"), tt: c(l, "M", "SCAN-TT"), mer: [c(me, "M", "SCAN"), c(me, "AM", "SCAN")], arth: c(j, "M", "ARTH"), si: c(j, "M", "SI"),
        irm: [c(l, "M", "IRM1"), c(l, "AM", "IRM1")], ib: [(d.statuts.IB || {})[j + "_M"], (d.statuts.IB || {})[j + "_AM"]],
        da: [(d.statuts.DA || {})[j + "_M"], (d.statuts.DA || {})[j + "_AM"]], sb: (d.statuts.SB || {})[j + "_M"],
        notes: d.notes, scan2: c(l2, "M", "SCAN"), ignores: d.ignores }; }""",
        [jn(11, 2), jn(11, 5), jn(11, 4), jn(11, 6), jn(11, 9), jn(11, 12)])
    B.ok(r["start"] == jn(11, 2) and r["end"] == jn(11, 13) and not r["ferie"], "période lue dans les onglets, 11 novembre (férié) exclu")
    B.ok(r["blm"] == ["SA", "SA"] and r["blr"] == ["OA", "OA"], f"Blaye : cellule fusionnée sur la journée, 1er nom en mammo, 2e en radio-écho ({r['blm']} {r['blr']})")
    B.ok(r["scan"] == "DA" and r["tt"] == "OB", f"« * » : télétravail sur le scanner ({r['scan']} / {r['tt']})")
    B.ok(r["mer"] == ["DB / OC", ""], f"cellule fusionnée sur deux lignes : lue une seule fois ({r['mer']})")
    B.ok(r["arth"] == "OA" and r["si"] == "", "salle du jeudi matin : arthrographies")
    B.ok(r["irm"] == ["SD", ""], "interne ignoré (RAYANN)")
    B.ok(r["ib"] == ["ABS", None] and r["da"] == ["ABS", "ABS"] and r["sb"] == "ABS", f"absences : « (mat) » = le matin seulement, parenthèses ignorées ({r['ib']} {r['da']})")
    n = r["notes"] or {}
    B.ok("Réunion de service à 13h30" in n.get(str(jn(11, 3)), []) and "Astreinte : IA" in n.get(str(jn(11, 2)), []) and "Astreinte : OB" in n.get(str(jn(11, 5)), []),
         "notes et astreintes reprises")
    B.ok(r["scan2"] == "DA / OB / SC" and r["ignores"] is None, "2e semaine lue ; liste des ignorés non enregistrée dans le planning")
    pg.click("#publishBtn"); pg.wait_for_function("document.querySelector('#gMsg').innerText.startsWith('Planning publié')", timeout=10000)
    pg.wait_for_function("S.published && S.published.cases", timeout=10000)
    B.ok(pg.evaluate("S.published.cases[caseKey(%d, 'M', 'SCAN-TT')]" % jn(11, 2)) == "OB", "publication du planning importé")
    B.ok(not errs, "aucune erreur JavaScript" + (f" : {errs[:3]}" if errs else ""))
    b.close()
raise SystemExit(0 if B.fin() else 1)
