#!/usr/bin/env python3
"""src/ のファイルを1つのHTMLにまとめる。

dist/index.html    … そのままブラウザで開ける完全なHTML（GitHub Pages・端末保存用）
dist/fe-kamoku-a.html … claude.ai Artifact 公開用（doctype/head を付けない本文のみ）
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).parent
SRC = ROOT / "src"
DIST = ROOT / "dist"


def inline(html: str) -> str:
    def repl(m):
        js = (SRC / m.group(1)).read_text(encoding="utf-8")
        return "<script>\n" + js + "\n</script>"
    return re.sub(r"<!-- INLINE:([\w.]+) -->", repl, html)


def main():
    body = inline((SRC / "app.html").read_text(encoding="utf-8"))
    DIST.mkdir(exist_ok=True)
    (DIST / "fe-kamoku-a.html").write_text(body, encoding="utf-8")
    full = (
        '<!doctype html>\n<html lang="ja">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
        '<meta name="theme-color" content="#2443A0">\n'
        "<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}"
        "body{margin:0}[hidden]{display:none!important}</style>\n"
        "</head>\n<body>\n" + body + "\n</body>\n</html>\n"
    )
    (DIST / "index.html").write_text(full, encoding="utf-8")
    print("built:", DIST / "index.html", DIST / "fe-kamoku-a.html")


if __name__ == "__main__":
    main()
