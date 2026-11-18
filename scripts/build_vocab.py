#!/usr/bin/env python3
"""Create a one-time immutable snapshot of the Lexifold TOEIC word list.

Run from the repository root. Never overwrites an existing valid 4027-word snapshot.
"""
import argparse
import csv
import io
import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

SOURCE = 'https://lexifold.com/word-lists/toeic.tsv'
COUNT = 4027
OUT = Path('data/core.json')


def get_field(row, names):
    for name in names:
        if row.get(name):
            return row[name].strip()
    return ''


def extract(tsv, expected=COUNT):
    tsv = tsv.lstrip('\ufeff')
    reader = csv.DictReader(io.StringIO(tsv), delimiter='\t')
    if not reader.fieldnames:
        raise ValueError('TSV has no headers')
    reader.fieldnames = [c.lstrip('\ufeff').strip().lower().replace(' ', '_') for c in reader.fieldnames]
    print('TSV headers:', ', '.join(reader.fieldnames))
    records = []
    seen = set()
    for i, raw in enumerate(reader, 1):
        row = {k: (v or '').strip() for k, v in raw.items() if k}
        word = get_field(row, ('word', 'headword', 'lemma', 'term', 'entry', 'vocabulary', 'word_form', 'word_forms'))
        # When a source includes a list of inflected forms, use the first headword.
        if word and any(c in word for c in ',;|/'):
            word = re.split(r'[,;|/]', word, 1)[0].strip()
        if not word:
            raise ValueError(f'No headword at row {i}; columns: {list(row.keys())}')
        key = word.casefold()
        if key in seen:
            raise ValueError(f'Duplicate headword {word!r} at row {i}; snapshot will not be silently changed')
        seen.add(key)
        records.append({
            'id': f'core-{i:04d}',
            'word': word,
            # Retain the publisher's original stage/order as metadata; the UI does not filter by it.
            'level': get_field(row, ('level', 'stage', 'band')),
            'order_in_level': get_field(row, ('order_in_level', 'order', 'rank')),
            'source_list': get_field(row, ('source_list', 'source')),
            'source_rank': get_field(row, ('source_rank',)),
            'word_forms': get_field(row, ('word_forms',)),
        })
    if expected is not None and len(records) != expected:
        raise ValueError(f'Expected {expected} entries; found {len(records)}. Aborting rather than saving incorrect data.')
    return {'source': 'Lexifold TOEIC', 'source_url': SOURCE, 'license': 'CC BY-SA 4.0',
            'generated_at': datetime.now(timezone.utc).isoformat(), 'word_count': len(records), 'words': records}


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--input', help='Use local TSV (for testing)')
    p.add_argument('--output', default=str(OUT))
    p.add_argument('--expected-count', type=int, default=COUNT)
    args = p.parse_args()
    out = Path(args.output)
    if out.exists():
        try:
            existing = json.loads(out.read_text('utf-8'))
        except (ValueError, UnicodeDecodeError):
            raise SystemExit(f'Invalid existing core file: {out}. Refusing to overwrite.')
        if existing.get('word_count') == args.expected_count and len(existing.get('words', [])) == args.expected_count:
            print(f'LOCKED: {out} already has {args.expected_count} words. No changes.')
            return
        if existing.get('word_count') not in (0, None) or existing.get('words'):
            raise SystemExit('Core exists but differs from expected count. Refusing to overwrite.')
    if args.input:
        raw = Path(args.input).read_text('utf-8')
    else:
        req = urllib.request.Request(SOURCE, headers={'User-Agent': 'PersonalVocabularyPWA/1.0 (attribution in app)'})
        with urllib.request.urlopen(req, timeout=40) as response:
            raw = response.read().decode('utf-8-sig')
    result = extract(raw, args.expected_count)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Created {out}: {len(result["words"])} entries')


if __name__ == '__main__':
    main()
