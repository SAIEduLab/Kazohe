# v0.2 検証ガイド

配布候補は `Kazohe.html` の1ファイルです。Privateの設計資料・参考原型はPublicへ同梱していません。`tests/fixtures/input-receipt.json` は初回に行った入力確認の記録です。参考原型のハッシュを記録していますが、原型の実動作成功を製品の成功として扱いません。

## 自動検証

|コマンド|対象|
|---|---|
|`npm run build:check`|ソースからの生成結果と配布HTMLが完全一致|
|`npm run lint`|HTML/JS構文、文書リンク、221 TCの登録、Publicへ含めないファイル、監査ゲートの負例|
|`npm run audit:catalog`|101 ID、学年別件数・点数・前提関係・根拠コード、生成・支援の接続|
|`npm run test:unit`|固定例、数値・入力・得点・時計・評価・保存。V8による主要純粋関数の行・分岐カバレッジ90%以上|
|`npm run test:property`|101技能×1000問、独立オラクル、途中式、有限集合の一巡、seed、配分、範囲境界|
|`npm run test:pedagogy`|101技能×40問、ヒントの逆演算・学年・単位、図の値、筆算途中値、未確定の約数、旧版JSON拒否|
|`npm run audit:single-html`|HTML/CSS/JSの構造解析、実行時参照、ファイル名・版|
|`npm run test:e2e`|Chromium/Firefox/WebKit各23シナリオ、file://、全101入力と解答、9入力形式、104例×4画面幅の問題/支援、数字列・線・行高、キーボード、保存、axe|
|`npm run audit:visual-diff`|同一ブラウザでbase/candidateを16画面撮影し、並列画像と差分を出力。視覚合否は付けない|
|`npm run audit:release -- --machine-only`|同一HTMLハッシュの必須自動検証の集約|

TCと担当方法は `scripts/manifest.mjs`、44の仕様IDに対応する実装所有先・シンボル・テスト群は `tests/fixtures/implementation-map.json` で管理します。群の指定はTCの接頭辞、個別の指定は完全なTC IDです。lintが仕様IDの欠落・重複、所有先やテストの不在を検出します。同じTCの自動部分・目視部分・実機部分は別の検証です。未出力・FAIL・NOT_RUN・別HTMLのレポートは自動監査の合格になりません。再試行で失敗を隠さないようPlaywrightのretriesは0です。

生成検証は `DEEP_AUDIT=1` で各技能10,000問へ増やせます。標準の生成検証には条件区分別の件数を記録します。失敗時のログにはID、seed、問題を残します。

## 目視と実機

スクリーンショットを作成しただけでは目視合格ではありません。v0.1の視覚監査は表記と操作の不適合を見落としたため、[判断を撤回](v0.1-verification.md)しました。筆算の位、借り越し、小数点、部分積、商の0、ボタンや入力欄の欠けに加え、筆算と説明の分離、説明の折返し、学年に合う言葉、選択内容の理解、支援の開き方を実際に確認します。実施記録は `tests/evidence/visual-review.json` へ対象ハッシュ・確認者・環境・画像を記載します。自動の座標検査だけでは教育的な分かりやすさを保証しません。

Chromium/Firefox/WebKitの自動化やタッチ設定は実端末試験とは区別します。PC・タブレット・スマホの実機証跡がない場合、TC-B15はNOT_RUNです。通常の `npm run audit:release` は未実施を含む限り非0で終了します。

GitHub Actionsはmath、browserの3エンジンmatrix、visual、aggregateに分けます。すべてのジョブで同じ完成HTMLを使い、集約時は数学・教材・画像比較と3エンジンの実レポートを要求します。画像差分は自動承認や正しい画像への更新には使用しません。候補HTMLのartifactは自動集約成功後だけ出力します。

ローカルでも、数学・状態・教材回帰と実画面確認は実行します。今回のv0.2作業範囲は作業ブランチへのpushまでです。push後のGitHub Actions完了確認、v0.2のPR、mainへの反映、正式リリースは別の工程です。
