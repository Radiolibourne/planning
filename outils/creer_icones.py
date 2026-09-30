# -*- coding: utf-8 -*-
"""Dessine les icônes de l'application (écran d'accueil iPhone / Android) dans src/pwa/.

Usage : python outils/creer_icones.py   (nécessite Pillow : pip install pillow)
Les PNG produits sont commités : la construction du site n'a pas besoin de Pillow.
"""
import os
from PIL import Image, ImageDraw

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SORTIE = os.path.join(RACINE, "src", "pwa")
BLEU = (31, 56, 100)        # #1f3864, couleur du site
BLEU_CLAIR = (47, 85, 151)  # #2f5597
BLANC = (255, 255, 255)
VERT = (84, 130, 53)


def dessiner(taille, marge_securite):
    """Calendrier blanc sur fond bleu. marge_securite : fraction réservée (icônes « maskable » Android)."""
    S = 1024
    im = Image.new("RGB", (S, S), BLEU)
    d = ImageDraw.Draw(im)
    m = int(S * marge_securite)
    zone = S - 2 * m
    # carte du calendrier
    x0, y0 = m + int(zone * 0.16), m + int(zone * 0.20)
    x1, y1 = S - m - int(zone * 0.16), S - m - int(zone * 0.14)
    r = int(zone * 0.07)
    d.rounded_rectangle([x0, y0, x1, y1], radius=r, fill=BLANC)
    # bandeau d'en-tête
    h = int((y1 - y0) * 0.24)
    d.rounded_rectangle([x0, y0, x1, y0 + h], radius=r, fill=BLEU_CLAIR)
    d.rectangle([x0, y0 + h - r, x1, y0 + h], fill=BLEU_CLAIR)
    # anneaux
    for fx in (0.3, 0.7):
        cx = x0 + int((x1 - x0) * fx)
        w = int(zone * 0.035)
        d.rounded_rectangle([cx - w, y0 - int(zone * 0.07), cx + w, y0 + int(zone * 0.06)], radius=w, fill=BLANC)
    # grille 4 x 3 de demi-journées ; une case « matin / après-midi » mise en valeur
    gx0, gy0 = x0 + int((x1 - x0) * 0.1), y0 + h + int((y1 - y0 - h) * 0.12)
    gx1, gy1 = x1 - int((x1 - x0) * 0.1), y1 - int((y1 - y0 - h) * 0.12)
    cols, rows = 4, 3
    cw, ch = (gx1 - gx0) / cols, (gy1 - gy0) / rows
    pad = int(min(cw, ch) * 0.14)
    for i in range(rows):
        for j in range(cols):
            bx0, by0 = gx0 + j * cw + pad, gy0 + i * ch + pad
            bx1, by1 = gx0 + (j + 1) * cw - pad, gy0 + (i + 1) * ch - pad
            coul = VERT if (i, j) == (1, 2) else (214, 222, 235)
            d.rounded_rectangle([bx0, by0, bx1, by1], radius=int(pad * 0.9), fill=coul)
    return im.resize((taille, taille), Image.LANCZOS)


def main():
    os.makedirs(SORTIE, exist_ok=True)
    fichiers = {
        "icone-180.png": dessiner(180, 0.0),        # iPhone (apple-touch-icon)
        "icone-192.png": dessiner(192, 0.0),
        "icone-512.png": dessiner(512, 0.0),
        "icone-maskable-512.png": dessiner(512, 0.10),  # Android (découpe ronde)
        "favicon-32.png": dessiner(32, 0.0),
    }
    for nom, im in fichiers.items():
        im.save(os.path.join(SORTIE, nom), optimize=True)
        print(nom)


if __name__ == "__main__":
    main()
