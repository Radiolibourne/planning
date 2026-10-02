# -*- coding: utf-8 -*-
"""Rappel « écran d'accueil » : affiché sur téléphone, marche à suivre iPhone / Android, plus affiché après « C'est fait »."""
import os
from playwright.sync_api import sync_playwright
from commun import Bilan, DIST, chromium

B = Bilan("Rappel écran d'accueil")
URL = "file://" + os.path.join(DIST, "demo.html")
IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36"
with sync_playwright() as p:
    b = chromium(p)
    errs = []
    # iPhone
    ctx = b.new_context(user_agent=IPHONE, viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL); pg.wait_for_selector("#installOverlay:not([hidden])", timeout=8000)
    B.ok(pg.is_visible("#instIos") and pg.is_hidden("#instAndroid"), "iPhone : marche à suivre Safari affichée")
    B.ok("Sur l'écran d'accueil" in pg.inner_text("#instIos"), "iPhone : étape « Sur l'écran d'accueil »")
    pg.click("#instLater")
    B.ok(pg.is_hidden("#installOverlay"), "« Plus tard » ferme la fenêtre")
    pg.reload(); pg.wait_for_selector("#vMon:not([hidden])"); pg.wait_for_timeout(2000)
    B.ok(pg.is_hidden("#installOverlay"), "« Plus tard » : pas de nouveau rappel tout de suite")
    pg.evaluate("localStorage.setItem('planning-radio-installation', 'plus-tard:1')")   # délai écoulé
    pg.reload(); pg.wait_for_selector("#installOverlay:not([hidden])", timeout=8000)
    B.ok(True, "rappel de nouveau proposé après le délai")
    pg.click("#instDone")
    pg.reload(); pg.wait_for_selector("#vMon:not([hidden])"); pg.wait_for_timeout(2000)
    B.ok(pg.is_hidden("#installOverlay"), "« C'est fait » : plus jamais affiché")
    pg.click("a[data-tab=cal]"); pg.wait_for_timeout(500)
    if pg.query_selector("#calInstall"):
        pg.click("#calInstall"); B.ok(pg.is_visible("#installOverlay"), "onglet Calendrier : marche à suivre accessible à tout moment")
    else:
        B.ok("Choisissez vos initiales" in pg.inner_text("#vCal") or "Aucun planning" in pg.inner_text("#vCal"), "onglet Calendrier affiché")
    ctx.close()
    # Android
    ctx = b.new_context(user_agent=ANDROID, viewport={"width": 412, "height": 900}, is_mobile=True, has_touch=True)
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL); pg.wait_for_selector("#installOverlay:not([hidden])", timeout=8000)
    B.ok(pg.is_visible("#instAndroid") and pg.is_hidden("#instIos"), "Android : marche à suivre Chrome affichée")
    ctx.close()
    # ordinateur : jamais
    ctx = b.new_context()
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL); pg.wait_for_selector("#vMon:not([hidden])"); pg.wait_for_timeout(2000)
    B.ok(pg.is_hidden("#installOverlay"), "ordinateur : pas de rappel")
    B.ok(not errs, "aucune erreur JavaScript" + (f" : {errs[:3]}" if errs else ""))
    b.close()
raise SystemExit(0 if B.fin() else 1)
