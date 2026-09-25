# v0.2 検証ガイド

配布候補は `Kazohe.html` の1ファイルです。生成元の `src/catalog.json` と独立検証用の `tests/fixtures/catalog.json` は別の役割を持ち、両者と配布HTMLの整合を確認します。

## 自動検証

| コマンド | 対象 |
|---|---|
| `npm run build:check` | 生成結果と配布HTMLの完全一致 |
| `npm run lint` | HTML/JS構文、公開文書の存在とリンク、TC登録・仕様対応、許可されたPublic構成、監査ゲートの負例 |
| `npm run audit:catalog` | 101 ID、学年別件数・点数・前提関係・根拠コード、生成・支援の接続 |
| `npm run test:unit` | 固定例、数値・入力・得点・時計・評価・保存。対象純粋関数の行・分岐カバレッジ各90%以上 |
| `npm run test:property` | 101技能×1,000問、独立オラクル、途中式、有限集合の一巡、seed、配分、範囲境界 |
| `npm run test:pedagogy` | 101技能×40問、ヒントの逆演算・学年・単位、図の値、筆算途中値、未確定の約数、旧版JSON拒否 |
| `npm run audit:single-html` | HTML/CSS/JSの構造解析、実行時参照、ファイル名・版 |
| `npm run test:e2e` | Chromium/Firefox/WebKitのfile://操作、全101入力と解答、9入力形式、104例×4画面幅の問題/支援、数字列・線・行高、キーボード、保存、axe |
| `npm run audit:visual-diff` | 新Publicの別commitにある基点と候補を同一ブラウザで16組撮影し、比較画像を出力。視覚合否は付けない |
| `npm run audit:release -- --machine-only` | 必須自動検証をHTML、版、checkout commit、PR head、repository、run IDとattemptで照合 |

TCと担当方法は `scripts/manifest.mjs`、現行仕様の実装所有先とテスト群は `tests/fixtures/implementation-map.json` で管理します。TC-D03と旧KZ-002は一回限りの参考原型の固定ハッシュ契約だったため廃止しました。TC-D01は公開文書とリンク、TC-D04は現行カタログの整合を検査します。TC-D02は独立したID範囲を基準に、欠落・重複・参照切れを検出します。

未出力、重複、不一致、失敗、別commit・別runのレポートは集約できません。PRの合成マージSHAを検証のcheckout commitとして記録し、PR head SHAは別に保持します。Playwrightの再試行は0です。生成検証は `DEEP_AUDIT=1` で各技能10,000問に増やせます。

## 目視と実機

スクリーンショットの作成は目視合格ではありません。筆算の位、借り越し、小数点、部分積、商の0、入力欄の欠け、説明の折返し、学年に合う言葉、選択内容と支援の分かりやすさを実画像で確認し、新Public内で画像の対象となったcommit、Actions run ID、確認者、環境と画像を `tests/evidence/visual-review.json` に記録します。記録のcommitがこのリポジトリの履歴にあり、HTMLハッシュが一致することも正式リリース時に確認します。現在の新Public用記録は未確認項目を `NOT_RUN` としています。

ブラウザ自動化やタッチ設定は物理端末での試験とは別です。PC・タブレット・スマホで実機証跡がなければTC-B15は `NOT_RUN` です。通常の `npm run audit:release` は目視・実機が未実施なら非0で終了します。

GitHub Actionsはmath、3エンジンのbrowser、visual、aggregateに分けます。各ジョブは同じ実行元とHTMLを証跡に残し、集約時に全レポートを要求します。画像差分は承認や基点の更新には使用しません。自動集約に成功したHTMLのみ候補artifactとして出力し、正式リリースは別の監査です。
