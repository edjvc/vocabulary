"""Regression guard for Ed Vocabulary markup / JavaScript mismatches.

Run from repository root: python -m unittest discover -s tests
No third-party packages required.
"""
import re
import unittest
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "index.html").read_text(encoding="utf-8")
APP = (ROOT / "app.js").read_text(encoding="utf-8")
STYLE = (ROOT / "style.css").read_text(encoding="utf-8")
SW = (ROOT / "sw.js").read_text(encoding="utf-8")

class TagIds(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = []
    def handle_starttag(self, tag, attrs):
        self.ids.extend(value for name, value in attrs if name == "id")

class UIIntegrityTests(unittest.TestCase):
    def test_no_duplicate_ids(self):
        doc = TagIds()
        doc.feed(HTML)
        duplicates = [key for key, count in Counter(doc.ids).items() if count > 1]
        self.assertEqual(duplicates, [], f"Repeated HTML element IDs: {duplicates}")

    def test_javascript_references_exist_in_html(self):
        doc = TagIds()
        doc.feed(HTML)
        references = set(re.findall(r"\$\(['\"]([^'\"]+)['\"]\)", APP))
        references.update(re.findall(r"\bbind\(['\"]([^'\"]+)['\"]", APP))
        # Dynamic lookups in renderDictionary/renderStats are also required.
        references.update(f"detail-{key}" for key in ("meaning", "examples"))
        references.update(f"stat-{grade}" for grade in (0, 1, 2, 3, 4))
        missing = sorted(references.difference(doc.ids))
        self.assertEqual(missing, [], f"JS uses elements missing from index.html: {missing}")

    def test_note_editor_markup_and_styles(self):
        for required in ("detail-note-toggle", "detail-note-content", "detail-note",
                         "root-note-toggle", "root-note-editor", "last-backup-device"):
            self.assertIn(f'id="{required}"', HTML)
        self.assertIn(".detail-note-section", STYLE)
        self.assertIn('id="detail-cambridge"', HTML)

    def test_offline_cache_includes_executable_assets(self):
        for file in ("./index.html", "./app.js", "./style.css", "./db.js"):
            self.assertIn(file, SW)
        self.assertIn("cacheName", SW)
        self.assertIn("serviceWorker.register", APP)

if __name__ == "__main__":
    unittest.main()
