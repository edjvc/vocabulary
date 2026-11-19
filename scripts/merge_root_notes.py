"""Validate and merge reviewed root notes into the offline vocabulary dataset."""

import argparse
import json
from pathlib import Path
from tempfile import NamedTemporaryFile
from urllib.parse import urlsplit


NOTE_FORMAT = "vocabulary-root-notes"
TEXT_FIELDS = ("split", "key_origin", "mnemonic")


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def read_batch(path, words):
    payload = read_json(path)
    if not isinstance(payload, dict):
        raise ValueError(f"{path}: expected a JSON object")
    entries = payload.get("entries")
    if (
        payload.get("format") != NOTE_FORMAT
        or payload.get("schema_version") != 1
        or payload.get("core_word_count") != len(words)
        or not isinstance(entries, list)
        or payload.get("entry_count") != len(entries)
    ):
        raise ValueError(f"{path}: invalid batch format or entry count")

    result = {}
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError(f"{path}: expected a note object")
        note_id = entry.get("id")
        word = entry.get("word")
        if not isinstance(note_id, str) or note_id not in words or word != words[note_id]:
            raise ValueError(f"{path}: {note_id!r} does not match the spelling {word!r} in the core list")
        if note_id in result:
            raise ValueError(f"{path}: duplicated entry {note_id} ({word})")
        if any(not isinstance(entry.get(key), str) or not entry[key].strip() for key in TEXT_FIELDS):
            raise ValueError(f"{path}: {word} is missing a note field")
        sources = entry.get("sources")
        if not isinstance(sources, list) or not sources:
            raise ValueError(f"{path}: {word} is missing sources")
        for source in sources:
            if (
                not isinstance(source, dict)
                or not isinstance(source.get("title"), str)
                or not source["title"].strip()
                or not isinstance(source.get("url"), str)
            ):
                raise ValueError(f"{path}: {word} has a malformed source")
            url = urlsplit(source["url"])
            if url.scheme != "https" or not url.hostname:
                raise ValueError(f"{path}: {word} has a source without an HTTPS URL")
        result[note_id] = entry
    return result


def write_atomic(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as stream:
        temp_path = Path(stream.name)
        stream.write(text)
    try:
        temp_path.replace(path)
    finally:
        temp_path.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("batches", type=Path, nargs="*")
    parser.add_argument("--core", type=Path, default=Path("data/core.json"))
    parser.add_argument("--output", type=Path, default=Path("data/root-notes.json"))
    parser.add_argument("--replace", action="store_true", help="allow a reviewed note to replace an existing note")
    parser.add_argument("--next", dest="next_count", type=int, metavar="COUNT",
                        help="print the next unreviewed words and IDs in source order")
    args = parser.parse_args()
    if args.next_count is not None and (args.next_count < 1 or args.batches):
        parser.error("--next requires a positive count and no input batch")

    try:
        core = read_json(args.core)
        words = {entry["id"]: entry["word"] for entry in core["words"]}
        if len(words) != core["word_count"] or len(words) != len(set(words.values())):
            raise ValueError("core list has a duplicate or incorrect count")
        notes = read_batch(args.output, words) if args.output.exists() else {}
        if not args.batches and not args.output.exists():
            raise ValueError(f"{args.output}: no existing dataset to validate")

        for batch in args.batches:
            for note_id, entry in read_batch(batch, words).items():
                if note_id in notes and notes[note_id] != entry and not args.replace:
                    raise ValueError(f"{note_id} ({entry['word']}) conflicts with a reviewed note")
                notes[note_id] = entry

        if args.batches:
            compiled = {
                "format": NOTE_FORMAT,
                "schema_version": 1,
                "core_source": core["source"],
                "core_word_count": len(words),
                "entry_count": len(notes),
                "wiktionary_license": "https://creativecommons.org/licenses/by-sa/4.0/",
                "entries": [notes[note_id] for note_id in words if note_id in notes],
            }
            text = json.dumps(compiled, ensure_ascii=False, indent=2) + "\n"
            if not args.output.exists() or args.output.read_text(encoding="utf-8") != text:
                write_atomic(args.output, text)
    except (OSError, ValueError, KeyError, TypeError) as exc:
        parser.exit(1, f"字根記憶匯入失敗：{exc}\n")

    if args.next_count is not None:
        remaining = [{"id": note_id, "word": word} for note_id, word in words.items() if note_id not in notes]
        print(json.dumps(remaining[:args.next_count], ensure_ascii=False, indent=2))
    else:
        print(f"字根記憶已驗證 {len(notes):,} / {len(words):,} 字")


if __name__ == "__main__":
    main()
