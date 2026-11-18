# Word list attribution and licensing

The one-time-generated `data/core.json` is an adaptation of the TOEIC course word list published at:
https://lexifold.com/word-lists/

Licensing: Creative Commons Attribution–ShareAlike 4.0 International (CC BY-SA 4.0):
https://creativecommons.org/licenses/by-sa/4.0/

Lexifold's list adapts the New General Service List 1.2, TOEIC Service List 1.2 and New Academic Word List 1.2 by Browne, Culligan and Phillips.

Changes made in this repository: conversion from the publicly published TSV into JSON; retention of word, original stage, order and source metadata; addition of internal word IDs. The list is not from ETS and is not endorsed by ETS.

Only the word list is imported. Lexifold's proprietary explanatory text, examples, translations, illustrations, and audio are not copied.

## ECDICT Chinese glosses

`data/glosses-zh.json` contains selected translations from
[ECDICT by Linwei](https://github.com/skywind3000/ECDICT/tree/39cfb9672c0906b63569e0453c2e6abfb9ab182a)
under the [MIT license](data/LICENSE-ECDICT.txt). The build selects Lexifold
headwords and ECDICT's first 20,000 corpus ranks, omits web glosses, converts
simplified text to Taiwan Traditional Chinese using OpenCC and adds a small
set of project-authored core glosses. ECDICT terms in this dataset do not add
headwords to the study list.

## Wiktionary lookups

On-demand text comes from the English and Chinese editions of Wiktionary, by
Wiktionary contributors, under applicable terms including
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
Results extract and reformat senses, etymologies, explicit word-formation
combinations and dictionary usage examples. Page revision links in the app
credit and identify the source. Cambridge Dictionary is linked externally.

The app converts Chinese etymologies to Taiwan Traditional Chinese with
[opencc-js 1.4.2](https://github.com/nk2028/opencc-js). See the license files
in `vendor/`. The Chinese fallback summarizes specific details extracted
from the linked English Wiktionary text.
