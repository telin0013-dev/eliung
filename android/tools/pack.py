#!/usr/bin/env python3
"""aapt2 の出力 APK に classes.dex を加え，無圧縮エントリを4バイト境界にそろえる（zipalign 相当）。"""
import sys
import zipfile

src, dex, out = sys.argv[1:4]
with zipfile.ZipFile(src) as zin, open(out, "wb") as f, zipfile.ZipFile(f, "w") as zout:
    items = [(i, zin.read(i.filename)) for i in zin.infolist()]
    dex_info = zipfile.ZipInfo("classes.dex", date_time=(2026, 1, 1, 0, 0, 0))
    dex_info.compress_type = zipfile.ZIP_DEFLATED
    items.append((dex_info, open(dex, "rb").read()))
    for info, data in items:
        zi = zipfile.ZipInfo(info.filename, date_time=info.date_time)
        zi.compress_type = info.compress_type
        zi.external_attr = info.external_attr
        zi.extra = b""
        if zi.compress_type == zipfile.ZIP_STORED:
            header_end = f.tell() + 30 + len(zi.filename.encode("utf-8"))
            zi.extra = b"\0" * ((4 - header_end % 4) % 4)
        zout.writestr(zi, data)
