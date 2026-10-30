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
