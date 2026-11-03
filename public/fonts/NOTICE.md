# ezPDF Sans VN

`ezSansVN-Regular.ttf` and `ezSansVN-Bold.ttf` are subsets (Latin, Latin Extended,
Vietnamese, Greek, Cyrillic, common punctuation, № ₽; shaping tables removed) of **Noto Sans**
(Copyright 2014-2021 Adobe and Google, Reserved Font Name "Noto Sans"),
taken from `@embedpdf/fonts-latin` 1.0.0.

Because they are Modified Versions under the SIL Open Font License 1.1 and
"Noto Sans" is a Reserved Font Name, the family is renamed to "ezPDF Sans VN".
License text: `OFL.txt`. Rebuild with `python3 scripts/make_fonts.py`.

# STIX Two Math

`STIXTwoMath-Regular.woff2` is **STIX Two Math** 2.x (Copyright 2001-2021 The STIX
Fonts Project Authors, https://github.com/stipub/stixfonts), as packaged by
`@fontsource/stix-two-math` 5.3.0, unchanged. It draws equations in Word files on
devices that have neither Cambria Math nor STIX Two Math installed (the page asks the
system for those first, so the file is only downloaded when needed).
License text (SIL Open Font License 1.1): `OFL-STIX.txt`.

# Fonts with the same letter widths as Word's (`metric/`)

When a Word file asks for Times New Roman, Arial, Calibri or Palatino Linotype and
the device does not have that font (Android above all), the Word screen draws the
text with a free font whose letters have the same widths, so lines, tab columns and
pages break where Word breaks them. The page asks the system for the real font first
(`local()` in `src/app/word/word-fonts.css`); a file is only downloaded when needed.

- `tinos-*.woff2` (for Times New Roman), `arimo-*.woff2` (for Arial),
  `carlito-*.woff2` (for Calibri): **Tinos**, **Arimo** (Copyright The Tinos /
  Arimo Project Authors, https://github.com/googlefonts/tinos, …/arimo) and
  **Carlito** (Copyright 2013 The Carlito Project Authors,
  https://github.com/googlefonts/carlito), as packaged by `@fontsource/tinos`,
  `@fontsource/arimo`, `@fontsource/carlito` 5.3.0, unchanged (the Latin, Latin
  Extended, Vietnamese, Cyrillic, Cyrillic Extended and Greek files). License text
  (SIL Open Font License 1.1): `metric/OFL-tinos.txt`, `metric/OFL-arimo.txt`,
  `metric/OFL-carlito.txt`.
- `ezpagella-*.woff2` (for Palatino Linotype): derived from **TeX Gyre Pagella**
  2.501 (Copyright 2006-2009 B. Jackowski, J. M. Nowacki, GUST e-foundry), subset to
  Latin, Latin Extended, Vietnamese and common punctuation, converted to WOFF2 and,
  as the license requests of a changed font, renamed "ezPDF Pagella". License text
  (GUST Font License, LPPL 1.3c): `metric/GUST-FONT-LICENSE.txt`.
