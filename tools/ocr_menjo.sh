#!/bin/bash
# $1 = 作業ディレクトリ, $2 = PDF。表紙(p1)と注意書き(p2)を除いてOCRする
D=$1; f=$2; b=$(basename "$f" .pdf)
mkdir -p "$D/img/$b" "$D/ocr/$b"
[ "$(ls "$D/img/$b" 2>/dev/null | wc -l)" -ge 3 ] || pdftoppm -r 300 -gray -f 3 "$f" "$D/img/$b/p"
for p in "$D/img/$b"/p-*.pgm; do
  n=$(basename "$p" .pgm)
  [ "$n" = "p-01" ] && continue
  [ "$n" = "p-02" ] && continue
  [ -s "$D/ocr/$b/$n.txt" ] || OMP_THREAD_LIMIT=1 timeout 60 tesseract "$p" "$D/ocr/$b/$n" -l jpn --psm 6 >/dev/null 2>&1
done
echo "done $b"
