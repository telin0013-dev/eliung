// 出題統計・予測データ（出典は docs/analysis.md と画面の「分析」タブに記載）
window.STATS = {
  updated: "2026-10-21",
  // 本試験 科目A / 修了試験(免除試験)の形式
  format: [
    { k: "科目A（本試験）", v: "四肢択一 60問・90分（採点対象56問、4問は将来用の試行問題）" },
    { k: "修了試験（免除試験）", v: "本試験の科目Aとほぼ同形式。60問・90分・100点満点中60点以上で合格が一般的（講座ごとに要確認）" },
    { k: "免除期間", v: "修了認定日から1年間、科目Aが免除" },
    { k: "受験回数", v: "修了試験は2回まで受験可能" },
    { k: "シラバス", v: "Ver.9.2（2026年1月掲載）。下請法→中小受託取引適正化法（取適法）へ差し替え" }
  ],
  // サンプル問題(60) + 令和5〜7年度公開問題(各20) = 120問の大分類内訳（合格ナビ集計）
  public120: [
    { k: "テクノロジ系", n: 78 },
    { k: "マネジメント系", n: 13 },
    { k: "ストラテジ系", n: 29 }
  ],
  // 科目A 60問の一般的な内訳（STUDYing 等）
  standard60: [
    { k: "テクノロジ系", n: 41 },
    { k: "マネジメント系", n: 7 },
    { k: "ストラテジ系", n: 12 }
  ],
  // IPA サンプル問題60問の中分類グループ別（TAC 傾向分析資料）
  sample60: [
    { k: "技術要素（DB・NW・セキュリティ等）", n: 18 },
    { k: "コンピュータシステム", n: 10 },
    { k: "基礎理論（アルゴリズム含む）", n: 9 }
  ],
  // 過去問アーカイブの収録数（H21〜R8、多いほど繰り返し出題されている分野）
  archive: [
    { k: "情報セキュリティ", n: 130, src: "基本情報技術者試験.com" },
    { k: "オペレーティングシステム", n: 86, src: "e-Words" },
    { k: "システムの評価指標", n: 75, src: "e-Words" },
    { k: "離散数学", n: 69, src: "e-Words" },
    { k: "システムの構成", n: 67, src: "e-Words" },
    { k: "アルゴリズム", n: 58, src: "e-Words" },
    { k: "プロセッサ", n: 56, src: "e-Words" }
  ],
  sources: [
    { t: "IPA 科目A試験免除制度", u: "https://www.ipa.go.jp/shiken/about/menjo-fe.html" },
    { t: "IPA 基本情報技術者試験", u: "https://www.ipa.go.jp/shiken/kubun/fe.html" },
    { t: "IPA 令和8年度 科目A公開問題(PDF)", u: "https://www.ipa.go.jp/shiken/mondai-kaiotu/sg_fe/koukai/rcu1hd0000012qj6-att/2026r08_fe_kamoku_a_qs.pdf" },
    { t: "IPA 試験要綱・シラバス", u: "https://www.ipa.go.jp/shiken/syllabus/gaiyou.html" },
    { t: "Wikipedia 科目A試験免除制度", u: "https://ja.wikipedia.org/wiki/%E5%9F%BA%E6%9C%AC%E6%83%85%E5%A0%B1%E6%8A%80%E8%A1%93%E8%80%85%E8%A9%A6%E9%A8%93%E3%81%AE%E7%A7%91%E7%9B%AEA%E8%A9%A6%E9%A8%93%E5%85%8D%E9%99%A4%E5%88%B6%E5%BA%A6" },
    { t: "合格ナビ 科目Aの出題数・分野内訳", u: "https://www.goukaku-navi.jp/fe/blog/fe-kamokua-strategy" },
    { t: "TAC 傾向分析と最新学習法(PDF)", u: "https://www.tac-school.co.jp/library/00006dougaChannel/yVP-gqtfQCs.pdf" },
    { t: "e-Words 基本情報技術者試験過去問題集", u: "https://e-words.jp/p/e-fe-past.html" },
    { t: "基本情報技術者試験.com テクノロジ系", u: "https://www.fe-siken.com/index_te.html" },
    { t: "STUDYing 試験時間と問題数", u: "https://studying.jp/kihonjoho/about-more/kiji-24.html" }
  ]
};

// 中分類ごとの予測出題数（60問中）。合計 テクノロジ41・マネジメント7・ストラテジ12。
// 基礎理論9 / コンピュータシステム10 / 技術要素18 はサンプル問題の実数に合わせている。
window.CATS = [
  { id: "kiso",  g: "T", name: "基礎理論",               pred: 5,  themes: "基数変換・2の補数・論理演算・誤差・待ち行列・AI" },
  { id: "algo",  g: "T", name: "アルゴリズムとプログラミング", pred: 4,  themes: "スタック/キュー・探索・整列・計算量・再帰" },
  { id: "comp",  g: "T", name: "コンピュータ構成要素",     pred: 4,  themes: "CPI/MIPS・キャッシュ・割込み・並列化" },
  { id: "sys",   g: "T", name: "システム構成要素",         pred: 3,  themes: "稼働率・MTBF/MTTR・RAID・クラウド" },
  { id: "soft",  g: "T", name: "ソフトウェア",             pred: 2,  themes: "ページ置換・スケジューリング・OSS" },
  { id: "hw",    g: "T", name: "ハードウェア・HI・マルチメディア", pred: 1, themes: "画像/音声データ量・UI設計" },
  { id: "db",    g: "T", name: "データベース",             pred: 4,  themes: "正規化・SQL・排他制御・障害回復" },
  { id: "nw",    g: "T", name: "ネットワーク",             pred: 4,  themes: "サブネット・プロトコル・伝送時間" },
  { id: "sec",   g: "T", name: "セキュリティ",             pred: 10, themes: "暗号・署名・攻撃手法・認証・ゼロトラスト" },
  { id: "dev",   g: "T", name: "開発技術",                 pred: 4,  themes: "テスト技法・アジャイル・UML・モジュール設計" },
  { id: "pm",    g: "M", name: "プロジェクトマネジメント", pred: 2,  themes: "クリティカルパス・EVM・WBS" },
  { id: "sm",    g: "M", name: "サービスマネジメント",     pred: 3,  themes: "SLA・インシデント/問題管理・バックアップ" },
  { id: "audit", g: "M", name: "システム監査",             pred: 2,  themes: "監査人の独立性・内部統制" },
  { id: "sysst", g: "S", name: "システム戦略・企画",       pred: 3,  themes: "BPR・RPA・非機能要件・RFP・生成AI" },
  { id: "biz",   g: "S", name: "経営戦略・技術戦略",       pred: 5,  themes: "SWOT・PPM・損益分岐点・BSC・IoT" },
  { id: "law",   g: "S", name: "企業活動・法務",           pred: 4,  themes: "著作権・派遣/請負・個人情報・取適法・財務指標" }
];
