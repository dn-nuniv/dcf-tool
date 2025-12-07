# Monte-Carlo DCF Valuation Tool

**企業価値評価（DCF法）を Monte-Carlo シミュレーションで行い、理論株価の分布を可視化する Web ツールです。**  
割引率（r）や永続成長率（g）に幅を持たせた確率分布を用いることで、  
「DCFは一点予想で当てられない」という現実的な不確実性を反映した評価ができます。

🔗 デモ（GitHub Pages）  
https://dn-nuniv.github.io/dcf-tool/

---

## 🚀 Features（主な機能）

- Monte-Carlo 法による **理論株価の確率分布**の算定
- ヒストグラム表示と **モード値（最頻値）の視覚化**
- 割引率 / 成長率の **三角分布**を採用（モード中心の現実的分布）
- 選択可能な2つのモデル
  - **過去CFベースモデル**（平均FCF）
  - **将来予測ベースモデル**（1〜5年のFCFを入力）
- **感応度分析**（Sensitvity Heatmap）
- 入力単位変更（円 / 千円 / 百万円 / 億円）

---

## 📘 Inputs（入力項目）

| 項目 | 内容 |
|---|---|
| 営業CF（過去5年） | 選択単位で入力 |
| 有形・無形固定資産の取得額（過去5年） | CapEx として使用 |
| 現金・負債残高 | Net Debt を算出 |
| 株式数 | 1株価算出用 |
| 永続成長率 g | min / mode / max（小数で） |
| 割引率 r | min / mode / max または固定値 |

※ g ≥ r の場合はDCFモデルが破綻するため自動スキップまたは警告表示します。

---

## 🎯 Purpose（開発目的）

- 不確実性を考慮した**より現実的なDCF**を教育現場で活用する
- 「一点予想」ではなく **レンジで判断する思考**を育成する
- データサイエンスとファイナンス教育を接続する教材として活用

---

## 🛠 Technology（使用技術）

- HTML / CSS / JavaScript（Vanilla）
- Chart.js（ヒストグラム・ヒートマップ）
- GitHub Pages（ホスティング）

---

## 📊 実装モデル概要

各シミュレーション試行ごとに：

FCF₁ = FCF₀ × (1 + g)
TV = FCF₁ / (r − g)
Equity Value = TV − Net Debt
Stock Price = Equity Value / Shares

不正試行（r ≤ g）は除外。  
試行結果（通常10,000回以上）から統計量および分布を生成。

---

## 📦 Setup（導入方法）

```bash
git clone https://github.com/dn-nuniv/dcf-tool.git
cd dcf-tool
open index.html

ブラウザのみで実行できます（サーバ不要）。

⸻

📄 License

© Daisuke Nakamura, 2025
教育目的での利用を歓迎します。商用利用は別途ご相談ください。

⸻

👤 Author / Maintainer
	•	Daisuke Nakamura
	•	Nagoka University (Economics & Management)
	•	GitHub: https://github.com/dn-nuniv/

⸻

🔄 Changelog
	•	v1.0.0（2025-12-07）
　初期公開：Monte-Carlo DCF、将来予測モード、感応度分析対応

⸻

## 🔬 Academic Use / 研究利用について

本ツールは、今後、簿記・会計教育やファイナンス教育に関する  
教育実践・研究（紀要論文等）で取り上げる可能性があります。

- 授業・ゼミ・研修などで **自由に利用していただいて構いません**。
- ただし、本ツールのアイデアやコードをほぼそのまま用いて  
  **第三者が自分の業績として論文・記事等を公開することはお控えください**。
- 研究目的で利用される場合は、可能な範囲で本リポジトリ  
  （`https://github.com/dn-nuniv/dcf-tool`）を出典として明記してください。

ご不明な点や、研究での本格的な利用を検討される場合は、  
Issue やメール等でご相談いただければ幸いです

---

### ✨カスタマイズも可能

必要なら：

- **英語版 README**
- **スクリーンショット追加**
- DOI 取得（Zenodo）
- バッジ（Pages / License / Version）
- 引用 BibTeX 生成

…全部できます。

---

次どれ行きます？  
優先順位としては：転記トレーナー → 財務指標 → 勘定科目ゲーム の順をおすすめしますが、  
お好きなものからどうぞ！
