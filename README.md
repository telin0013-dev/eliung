# FE科目A 予測ドリル

基本情報技術者試験の科目A免除（修了試験）対策用の、スマホで動く練習アプリです。

- 修了試験21回分（令和3年7月〜令和8年7月、1,382問）を OCR して集計し、**問番号ごとの分野配置**と**再出題の傾向**を分析
- **修了試験の過去問 332問**（R8.7・R8.6 の全問、3回以上出題された問題など）と**予想問題 138問**を収録、解説付き
- 予測模試（60問・90分、配置どおりに頻出過去問と最新回を優先）、R8.7・R8.6 の本番再現、頻出過去問、苦手復習、カスタム練習
- 解答履歴と分野別正答率を端末のブラウザに保存
- 分析の詳細は [docs/analysis.md](docs/analysis.md)

過去問の解答・解説は IPA の公式解答ではなく、このアプリで作成したものです。

## 使い方

`dist/index.html` は1ファイルで完結しています。スマホのブラウザで開けば動きます（フォント以外は通信不要）。

GitHub Pages で配信する場合、公開元に指定できるのはリポジトリのルートか `/docs` だけなので、`dist/index.html` を `docs/index.html` にコピーしてから Settings → Pages で `/docs` を指定してください。

## 構成

```
data/kakomon/*.txt       過去問の書き起こし（回ごと。書式はファイル先頭に記載）
data/menjo_index.json    21回分の各問の分野と同一問題クラスタ
data/menjo_themes.json   テーマ別の出題回数
data/menjo_overrides.txt 分野の手修正（クラスタID 中分類ID）
src/stats.js             分野の予測配置と本試験の公開データ
src/questions.js         予想問題（o[0] が正解）
src/app.html             アプリ本体
tools/ocr_menjo.sh       問題冊子 PDF の OCR
tools/analyze_menjo.py   OCR テキストの切り出し・分類・同一問題の判定
tools/build_kakomon.py   data/ から src/kakomon.js と src/menjo_stats.js を生成
build.py                 src を1ファイルにまとめて dist/ に出力
```

過去問を追加・修正したら `python3 tools/build_kakomon.py && python3 build.py` を実行してください。
問題冊子 PDF と OCR テキストはリポジトリに含めていません。
