# -*- coding: utf-8 -*-
"""
Admin : cartes repliables. Par défaut seules Générer, Planning à publier et Absences sont ouvertes ;
un appui sur le titre ouvre ou referme la carte, et l'état est retenu sur l'appareil.
"""
import os
from playwright.sync_api import sync_playwright
from commun import Bilan, DIST, chromium

B = Bilan("Cartes repliables (Admin)")
URL = "file://" + os.path.join(DIST, "demo.html") + "#admin"

with sync_playwright() as p:
    b = chromium(p, plis=True)
    ctx = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_selector("#loginCard:not([hidden])")
    pg.fill("#loginEmail", "a@b.fr"); pg.fill("#loginPw", "x"); pg.click("#loginForm button[type=submit]")
    pg.wait_for_selector("#adminBody:not([hidden])")
    ferme = lambda i: pg.evaluate(f"document.getElementById('{i}').classList.contains('ferme')")
    B.ok(not ferme("genCard") and not ferme("indCard"), "Générer et Absences ouvertes par défaut")
    B.ok(ferme("medCard") and ferme("paramCard") and ferme("cloCard") and pg.is_hidden("#useDefault"), "Médecins, Paramètres, dates limites repliées par défaut")
    y = lambda i: pg.evaluate(f"document.getElementById('{i}').getBoundingClientRect().top")
    B.ok(y("genCard") < y("indCard") < y("cloCard") < y("paramCard"), "cartes les plus utilisées en haut")
    pg.click("#paramCard > .pli-tete", position={"x": 5, "y": 5})
    B.ok(not ferme("paramCard") and pg.is_visible("#useDefault"), "appui sur le titre : la carte s'ouvre")
    pg.click("#genCard > h2")
    B.ok(ferme("genCard"), "appui sur le titre : la carte se replie")
    pg.reload()
    pg.wait_for_selector("#loginCard:not([hidden]), #adminBody:not([hidden])")
    if pg.is_visible("#loginCard"):
        pg.fill("#loginEmail", "a@b.fr"); pg.fill("#loginPw", "x"); pg.click("#loginForm button[type=submit]")
    pg.wait_for_selector("#adminBody:not([hidden])")
    B.ok(not ferme("paramCard") and ferme("genCard"), "état retenu après rechargement")
    pg.focus("#paramCard > .pli-tete"); pg.keyboard.press("Enter")
    B.ok(ferme("paramCard"), "clavier : Entrée replie la carte")
    B.ok(not errs, "aucune erreur JavaScript" + (f" : {errs[:3]}" if errs else ""))
    b.close()
raise SystemExit(0 if B.fin() else 1)
