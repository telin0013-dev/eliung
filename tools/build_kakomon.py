#!/usr/bin/env python3
"""修了試験の過去問テキスト（data/kakomon/*.txt）と集計（data/menjo_*.json）から
アプリ用のデータ src/kakomon.js と src/menjo_stats.js を作る。

テキストの書式:
  @ 問番号 中分類ID テーマ 正解(ア〜エ)
  問題文（複数行可）
  ア 選択肢
  イ 選択肢
  ウ 選択肢
  エ 選択肢
  E: 解説
"""
import collections
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
KANA = "アイウエ"
CATS = {"kiso", "algo", "comp", "sys", "soft", "hw", "db", "nw", "sec", "dev",
        "pm", "sm", "audit", "sysst", "biz", "law"}


def label(exam):
    """20260726 → R8.7（令和の年.月）"""
    y, m = int(exam[:4]), int(exam[4:6])
    return f"R{y - 2018}.{m}"


def parse(path):
    exam = path.stem
    items, cur = [], None
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("#") or not line.strip():
            continue
        m = re.match(r"^@ (\d+) (\w+) (.+) ([アイウエ])$", line)
        if m:
            cur = {"exam": exam, "no": int(m.group(1)), "c": m.group(2), "t": m.group(3),
                   "a": KANA.index(m.group(4)), "q": [], "o": [], "e": ""}
            assert cur["c"] in CATS, (exam, line)
            items.append(cur)
            continue
        if cur is None:
            raise ValueError(f"{path}: 見出しの前に本文がある: {line}")
        if line.startswith("E: "):
            cur["e"] = line[3:].strip()
        elif re.match(r"^[アイウエ] ", line) and len(cur["o"]) < 4 and line[0] == KANA[len(cur["o"])]:
            cur["o"].append(line[2:].strip())
        else:
            assert not cur["o"], f"{exam} 問{cur['no']}: 選択肢の後に本文: {line}"
            cur["q"].append(line)
    for it in items:
        assert len(it["o"]) == 4 and it["e"], f"{exam} 問{it['no']} が不完全"
        it["q"] = "\n".join(it["q"])
    return items


def norm(s):
    return re.sub(r"[\s，、。．・「」（）()]", "", s)


def main():
    index = json.loads((DATA / "menjo_index.json").read_text(encoding="utf-8"))
    cluster_of = {(r["exam"], r["no"]): r["cluster"] for r in index}
    members = collections.defaultdict(list)
    for r in index:
        members[r["cluster"]].append(r["exam"])

    items = []
    for p in sorted((DATA / "kakomon").glob("*.txt")):
        items += parse(p)

    # 同じ問題（同一クラスタ・同一問題文）は最新の回だけ残し，出題回をまとめる
    items.sort(key=lambda x: (x["exam"], x["no"]), reverse=True)
    seen_cluster, seen_text, out = {}, {}, []
    for it in items:
        cl = cluster_of.get((it["exam"], it["no"]))
        key = norm(it["q"])[:60] + "|" + norm(it["o"][0])[:20]
        if cl is not None and cl in seen_cluster:
            continue
        if key in seen_text:
            prev = seen_text[key]
            if cl is not None:
                prev["_clusters"].add(cl)
            continue
        it["_clusters"] = {cl} if cl is not None else set()
        seen_text[key] = it
        if cl is not None:
            seen_cluster[cl] = it
        out.append(it)

    res = []
    for it in out:
        exams = sorted({e for cl in it["_clusters"] for e in members[cl]} | {it["exam"]})
        res.append({
            "id": f"k{it['exam'][2:]}-{it['no']:02d}",
            "c": it["c"], "t": it["t"],
            "src": f"{label(it['exam'])} 問{it['no']}",
            "n": len(exams),
            "past": [label(e) for e in exams],
            "q": it["q"], "o": it["o"], "a": it["a"], "e": it["e"],
            "exam": it["exam"], "no": it["no"],
        })
    res.sort(key=lambda x: (x["exam"], x["no"]))
    js = "// 修了試験（科目A免除試験）の過去問。tools/build_kakomon.py で生成。o は ア〜エ の順，a が正解の位置。\n"
    js += "// 出典：IPA「修了認定に係る試験（基本情報技術者試験に係る問題）」。解答・解説は本アプリで作成したもの。\n"
    js += "window.KAKOMON = " + json.dumps(res, ensure_ascii=False, indent=0) + ";\n"
    (ROOT / "src" / "kakomon.js").write_text(js, encoding="utf-8")

    # ── 統計 ──
    exams = sorted({r["exam"] for r in index})
    by_exam = collections.defaultdict(list)
    for r in index:
        by_exam[r["exam"]].append(r)
    seen = set()
    exam_rows = []
    for e in exams:
        cls = {r["cluster"] for r in by_exam[e]}
        rep = len(cls & seen)
        exam_rows.append({"exam": e, "label": label(e), "n": len(by_exam[e]),
                          "total": 80 if e < "20230611" else 60, "rep": rep})
        seen |= cls
    new = [e for e in exams if e >= "20230611"]
    cnt = collections.Counter(r["cat"] for r in index if r["exam"] in new)
    tot = sum(cnt.values())
    avg60 = {k: round(v / tot * 60, 1) for k, v in cnt.items()}
    # 問番号ごとに最も多い中分類（60問形式）
    slot = collections.defaultdict(collections.Counter)
    for r in index:
        if r["exam"] in new:
            slot[r["no"]][r["cat"]] += 1
    layout = []
    for n in range(1, 61):
        c = slot[n].most_common(1)[0][0]
        if layout and layout[-1]["c"] == c:
            layout[-1]["to"] = n
        else:
            layout.append({"c": c, "from": n, "to": n})
    clusters = collections.Counter(r["cluster"] for r in index)
    stats = {
        "exams": exam_rows,
        "questions": len(index),
        "unique": len(clusters),
        "repeated": sum(1 for v in clusters.values() if v > 1),
        "avg60": avg60,
        "layout": layout,
        "themes": json.loads((DATA / "menjo_themes.json").read_text(encoding="utf-8")),
        "kakomon": len(res),
    }
    js = "// 修了試験21回分（令和3年7月〜令和8年7月）の集計。tools/build_kakomon.py で生成。\n"
    js += "window.MENJO = " + json.dumps(stats, ensure_ascii=False) + ";\n"
    (ROOT / "src" / "menjo_stats.js").write_text(js, encoding="utf-8")
    print(f"過去問 {len(res)}問（重複除外前 {len(items)}問）")
    print("layout:", [(l["c"], l["from"], l["to"]) for l in layout])


if __name__ == "__main__":
    main()
