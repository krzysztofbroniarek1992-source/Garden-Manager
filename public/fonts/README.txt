DejaVu Sans and DejaVu Sans Bold, subset for Garden Manager PDF reports.
Source: https://dejavu-fonts.github.io/ (fonts-dejavu-core system package).
License and attribution: LICENSE-DejaVu.txt. Font family names remain DejaVu Sans.

Vendored TrueType files work offline and require no font generation at runtime.
The subsets preserve Latin (including Polish), Greek, Cyrillic, punctuation,
currency, arrows, common mathematical symbols and check marks. Unsupported
characters are reported explicitly before a PDF can be saved.

Optional regeneration with fonttools (not needed to build the application):
pyftsubset ORIGINAL.ttf --output-file=TARGET.ttf --unicodes=U+0000-024F,U+0370-052F,U+2000-206F,U+20A0-20CF,U+2190-22FF,U+2500-25FF,U+2713-2714,U+FFFD --layout-features='*' --name-IDs='*' --name-languages='*' --no-hinting --recommended-glyphs
