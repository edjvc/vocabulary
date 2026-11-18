"""Build the offline Traditional Chinese glosses from an ECDICT CSV."""

import argparse
import csv
import json
from pathlib import Path

from opencc import OpenCC


CORE_GLOSSES = {
    "August": "n. 八月",
    "March": "n. 三月",
    "May": "n. 五月",
    "café": "n. 咖啡館；供應簡餐和飲品的小餐館",
    "conservative": "adj. 保守的；謹慎的（估計）\nn. 保守派人士",
    "core": "n. 核心；果核；地核\nadj. 核心的；最重要的\nv. 去除果核；取出岩心",
    "entrée": "n. （美式）主菜；（部分其他地區）前菜",
    "fax": "n. 傳真；傳真機；傳真文件\nv. 傳真（文件）",
    "god": "n. 神；神明；受崇拜的人",
    "march": "n. 行進；遊行；進行曲\nv. 齊步行進；遊行；大步走",
    "mister": "n. 先生（稱呼男子）",
    "north": "n. 北方\nadj. 北方的；北部的\nadv. 向北",
    "pole": "n. 桿；柱；（地理）極；（電學）電極；（對立的）一極\nv. 用桿撐船",
    "polish": "v. 拋光；擦亮；潤飾\nn. 擦亮劑；光澤；精緻",
    "résumé": "n. 履歷；摘要",
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv_file", type=Path)
    parser.add_argument("--core", type=Path, default=Path("data/core.json"))
    parser.add_argument("--output", type=Path, default=Path("data/glosses-zh.json"))
    args = parser.parse_args()

    core = json.loads(args.core.read_text(encoding="utf-8"))
    headwords = {entry["word"] for entry in core["words"]}
    convert = OpenCC("s2twp").convert
    glosses = {}

    with args.csv_file.open(encoding="utf-8-sig", newline="") as source:
        for row in csv.DictReader(source):
            word = row["word"]
            frequency = int(row["frq"]) if row["frq"].isdigit() else 0
            if word not in headwords and not 0 < frequency <= 20000:
                continue
            lines = row["translation"].replace(r"\n", "\n").splitlines()
            entries = [
                convert(line.strip()) for line in lines
                if line.strip() and not line.lstrip().startswith(("[网络]", "[網路]"))
            ]
            if entries:
                glosses[word] = "\n".join(entries)

    glosses.update({word: text for word, text in CORE_GLOSSES.items() if word in headwords})
    args.output.write_text(
        json.dumps(glosses, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(f"{len(headwords & glosses.keys())}/{len(headwords)} core entries; {len(glosses)} total glosses")
    print("Without glosses:", ", ".join(sorted(headwords - glosses.keys())))


if __name__ == "__main__":
    main()
