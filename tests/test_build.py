import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from build_vocab import extract

class TestBuild(unittest.TestCase):
    def test_sample_tsv(self):
        text='level\torder_in_level\tword\tword_forms\tsource_list\tsource_rank\n1\t1\tabandon\tabandon, abandoned\tNGSL\t1\n2\t1\tcontemplate\tcontemplate\tTSL\t2\n'
        doc=extract(text,expected=2)
        self.assertEqual(doc['word_count'],2)
        self.assertEqual([r['word'] for r in doc['words']],['abandon','contemplate'])
        self.assertEqual(doc['words'][1]['level'],'2')
    def test_mismatch_does_not_pass(self):
        with self.assertRaisesRegex(ValueError,'Expected 4027'):
            extract('word\na\n',expected=4027)
    def test_duplicate_refused(self):
        with self.assertRaisesRegex(ValueError,'Duplicate'):
            extract('word\nword\nWORD\n',expected=2)

if __name__=='__main__':unittest.main()
