# Zatom WebMCP Challenge Edition

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

> 人と AI Agent が、同じ科学空間でともに作業できるように。

私たちが目指すのは、AI がチャット欄でただこう答えることではありません。

> 「184 番の原子の座標は……」

ひとつの分子、結晶、表面を人と AI が一緒に見ながら、自然にやり取りできるようにすることです。

> 「この位置ですか？」
>
> 「違う、右側のほう。」
>
> 「この水素を、隣の酸素に向けて。」
>
> 「そう、それで大丈夫。」

Zatom は、ひとつの素朴で根本的な問いから始まりました。AI Agent が科学モデリングソフトウェアの中に入ったとき、人と AI はどう協働するべきでしょうか。

## デモ動画

2 分で、私たちが Zatom をつくる理由をご覧いただけます。

<!-- Replace with the final demo video -->

[デモを見る](YOUR_VIDEO_LINK)

<!--
ここには、次のような内容が伝わるデモ GIF または動画のサムネイルを置くのがおすすめです。

- 分子または結晶の 3D ビュー
- Agent が吸着サイトの候補にフォーカスしている場面
- 対象原子のハイライト
- ユーザー入力：the one on the right
- Agent がリアルタイムで構造を調整する場面
-->

## Why Zatom?

ここ数年、言語モデルはソフトウェアを使うことにますます長けてきました。ツールを呼び出し、コードを書き、情報を検索し、ファイルや API を操作し、複雑なタスクを継続的に計画して実行できます。

一方、科学モデリングには特有の難しさがあります。科学者が見ているのは空間としての世界ですが、Agent に与えられるのは、多くの場合、座標、ID、ツールの一覧だけです。

```text
Atom 181  O   3.214  7.812  12.391
Atom 182  H   3.841  8.120  12.904
Atom 183  H   2.771  8.492  11.944
...
```

人なら自然に、こう言えます。

> 「この原子。」
>
> 「上側のこの層。」
>
> 「2 つの原子の間にある位置。」
>
> 「この分子を少しこちらに回して。」
>
> 「なぜ、ここだけ電子密度が高いのか見てみよう。」

しかし、座標、ID、ツールの一覧しか持たない Agent にとって、「これ」を理解するほうが複雑な数式を解くより難しいことがあります。

Zatom が埋めようとしているのは、人と Agent の間に欠けている科学的な空間コンテキストです。

## 01 Agent とともにモデリングする

### Model Together

私たちが目指す AI 科学モデリングは、次のような一方向の流れではありません。

> Prompt → 複雑な構造を自動生成 → ユーザーが結果を受け入れる

実際の科学の仕事は、観察、試行、調整、比較、確認を繰り返すものです。Agent にも、その過程そのものへ参加してほしいと考えています。

Agent は、現在の次のような状態を理解できます。

- 分子（Molecule）
- 結晶（Crystal）
- 表面（Surface）
- 周期系（Periodic System）
- 選択範囲（Selection）
- 局所環境（Local Environment）
- 結合関係（Bonding）
- 空間関係（Spatial Relationships）
- 候補サイト（Candidate Sites）

また、次の操作を自ら行えます。

- 対象にフォーカスし、ハイライトする
- 対象を選択する
- 視点を回転し、カメラを移動する
- 候補位置をマークする
- 構造を変形する
- ユーザーに確認を求める
- 操作を元に戻す
- 結果を検証する

たとえば、次のようなやり取りです。

```text
User:
Help me place H₂O on this surface.

Agent:
This site?

User:
No. The one on the right.

Agent:
This one?

User:
Yes.
Point one hydrogen toward that oxygen.
```

すると対象の酸素がハイライトされ、H₂O がアンカーを中心に自動で回転し、Agent がもう一度ユーザーに確認します。

原子 ID を覚えたり、XYZ 座標を手入力したり、チャットと科学ソフトウェアの間で何度もデータをコピーしたりする必要はありません。人と Agent が、ひとつのコンテキストを共有します。

私たちは、この能力を「空間的注意の共有」（Shared Spatial Attention）と呼んでいます。Agent はソフトウェアを操作するだけでなく、あなたが何を見ているのかを知り、自分が何を考え、どこに注目しているのかを伝える必要があります。

## 02 構造を増やすだけで終わらない

### Understand Deeper

AI によって大量のモデルをより速く構築できるようになりつつあります。しかし私たちが本当に速くしたいのは、1 日に生成できる構造の数ではなく、ひとつの構造、反応、機構を理解するまでの時間です。

Zatom では基本的なモデリングに加え、科学的な構造を観察し、理解するための可視化・解析機能も継続的に開発しています。

- 分子軌道（Molecular Orbitals）
- 電子密度（Electron Density）
- 静電ポテンシャル（Electrostatic Potential）
- 部分電荷（Partial Charges）
- スカラー場（Scalar Fields）
- スライス平面（Slice Planes）
- 等値面（Isosurfaces）
- ヒートマップ（Heatmaps）
- 局所環境（Local Environments）
- 結合解析（Bond Analysis）
- 距離解析（Distance Analysis）
- 結合角・二面角解析（Angle / Dihedral Analysis）
- 周期構造（Periodic Structures）
- 結晶表面（Crystal Surfaces）
- 吸着構造（Adsorption Structures）
- 欠陥（Defects）
- 界面（Interfaces）

ワークフローを次の状態で止めたくはありません。

```text
Structure Generated
```

その先でも、こう問い続けます。

```text
Why?
```

構造から電子構造へ、そして機構へ。Agent はモデルを描く手伝いをするだけでなく、一緒に観察し、比べ、分析し、問いを立て、説明を探すことができます。

## 03 モデリングはワークフローの終点ではない

### Compute Openly

私たちは、AGI が科学技術へのアクセスをより公平にしていくと考えています。

これまで計算化学、材料シミュレーション、科学計算には、複雑なソフトウェアスタック、高価な商用ツール、急な学習曲線、分断されたワークフローが伴っていました。ソフトウェア間で入出力形式を何度も変換し、多くの低レベルな技術知識を身につける必要もあります。

Zatom は、よりオープンな計算化学エコシステムの循環をつくろうとしています。

```text
Model -> Compute -> Analyze -> Visualize -> Understand -> Ask the next question
```

AI Agent を通じて、複雑な科学ソフトウェア、計算手順、専門知識をつなぎます。モデルをつくった後も、ユーザーは Agent とともに次の作業を続けられます。

- 計算タスクを準備する
- 計算入力を構築する
- オープンソースの科学計算ツールを呼び出す
- 計算を投入し、管理する
- 計算結果を取得する
- 異常を確認する
- 結果を可視化環境へ戻す
- 構造と電子的性質を解析する
- 反応機構について議論を続ける
- 結果に基づいてモデルを修正する

私たちの目的は、あらゆる科学計算ソフトウェアを一からつくり直すことではありません。オープンソースの科学計算エコシステムを活かし、Zatom を人と Agent がこうしたツールへ入っていくための、より自然な入口にしたいと考えています。

いつか、ひとつの Agent とひとつの科学ワークスペースだけで、モデルから実際の計算結果までたどり着けるかもしれません。

## モデリングしながら学ぶ

オープンな科学計算は、その一部にすぎません。私たちは、科学をもっと楽しく、もっとわかりやすく学べるようにしたいと考えています。

AI は、すでに科学ソフトウェアに慣れている人の作業を速くするだけのものではありません。有機化学、構造化学、計算化学、材料科学、分子モデリング、科学計算に初めて触れる人にも、目の前にあるものを理解する手助けができるはずです。

有機分子を組み立てているとき、Agent は次のことを説明できます。

- なぜ、ここが \(sp^2\) 混成なのか
- なぜ、この結合は自由に回転できないのか
- 共役とは何か
- 芳香族性が電子構造にどう影響するのか
- R/S 配置は何を意味するのか
- なぜ、ある配座のほうが安定なのか

結晶を扱っているときには、次の概念を説明できます。

- 原始単位胞（Primitive Cell）
- 慣用単位胞（Conventional Cell）
- ミラー指数（Miller Index）
- 周期境界条件（Periodic Boundary Conditions）
- 配位環境（Coordination Environment）
- 結晶対称性（Crystal Symmetry）
- 表面の劈開（Surface Cleavage）
- 空孔（Vacancy）
- 欠陥（Defect）
- 界面（Interface）

吸着系を構築するときには、次の内容も扱えます。

- 吸着サイト（Adsorption Site）
- 表面配位（Surface Coordination）
- 配向（Orientation）
- 電荷再分布（Charge Redistribution）
- 電子的相互作用（Electronic Interaction）
- 反応機構（Reaction Mechanism）

教科書を最初から最後まで読んでから科学ソフトウェアを開く必要はありません。モデルをつくりながら学び、計算しながら理解し、探索しながら知識を育てる。AI 時代の科学教育は、少しずつこのような形に近づいていくかもしれません。

## もうひとつの実験

### Agent がスクリーンショットに頼らないとしたら

マルチモーダルモデルに科学ソフトウェアの画面を直接見せるのも、ひとつの方法です。しかし、1 枚の RGB 画像を見せることが科学空間の理解における終着点だとは、私たちは考えていません。

科学モデリングに含まれる多くの情報は、ピクセルから推測し直すのに向いていません。

- 周期性（Periodicity）
- 結合トポロジー（Bond Topology）
- 原子の種類と同一性（Atomic Identity）
- 局所配位（Local Coordination）
- フラグメントの同一性（Fragment Identity）
- 周期イメージ（Periodic Images）
- 表面法線（Surface Normal）
- 選択状態（Selection State）
- 空間関係（Spatial Relations）
- 化学状態（Chemical State）

そこで私たちは、3D の科学世界を、言語モデルが推論しやすい構造化された観測表現（observation）に変換する方法を試しています。単なるスクリーンショットではなく、次のような表現です。

```text
SYSTEM
  type: surface
  periodicity: [true, true, false]

SELECTION
  fragment: H2O
  anchor: O_184

LOCAL_ENVIRONMENT
  nearest_surface_atom: O_72
  relative_position: front-right
  coordination: ...

SURFACE
  normal: +Z
  candidate_site: bridge

PERIODIC_IMAGE
  translation: [0, 0, 0]
```

この観測表現には、次の情報を含められます。

- トポロジー（Topology）
- 幾何（Geometry）
- 周期性（Periodicity）
- 化学的同一性（Chemical Identity）
- 局所環境（Local Environment）
- 空間関係（Spatial Relationships）
- カメラコンテキスト（Camera Context）
- ユーザーの選択範囲（User Selection）
- 候補領域（Candidate Regions）
- 制約（Constraints）
- 過去の操作（Previous Actions）

Agent は、この情報をもとに、観察、推論、行動、再観察、検証のサイクルを繰り返せます。

## ARC 型推論から得た着想

ARC のような reasoning task から、私たちは多くの着想を得ています。視覚的な問題を、Agent が観察し、理解し、推論し、行動できる問題空間へ変換するという考え方です。

科学モデリングは、有限の問題集ではありません。あらゆる分子が新しい問題になり、あらゆる材料が新しい環境になりえます。表面、欠陥、界面、吸着構造、反応、さらにはユーザーがその場で投げかけた問いさえ、新しい reasoning problem になりえます。

だから私たちは、これを「オープンエンドな科学推論環境」（An Open-Ended Scientific Reasoning Environment）として捉えています。科学の世界そのものが、ほとんど尽きることのない問題生成器です。

この道が最終的にどこへつながるのか、私たちにもまだわかりません。だからこそ、探求を続ける価値があります。

## Challenge Edition

このリポジトリは、WebMCP Challenge に向けて用意したオープン版です。主に次のテーマを探求しています。

- WebMCP Scientific Modeling Tools
- Molecular & Crystal Modeling
- Human-Agent Collaboration
- Spatial Grounding
- Shared Spatial Attention
- Structured Scientific Observation
- Scientific Visualization
- Open Scientific Computing Workflows
- Agent-assisted Scientific Reasoning

本バージョンはまだ非常に初期の段階にあり、フルバージョンの製品も引き続き開発中です。

## まだ答えのない問い

本当の Human–Agent Scientific Interface がどうあるべきかについて、業界全体でもまだ明確な答えは出ていないのかもしれません。私たちは、次の問いを探り続けています。

- Agent にどれだけの空間情報を見せるべきか？
- どの情報を構造化するべきか？
- どの情報を視覚モデルに委ねるべきか？
- 周期像（Periodic Images）をどう記述するか？
- 複雑な局所環境をどう表現するか？
- 「これ」「隣のもの」「右側のもの」をどう扱うか？
- Screen Space と World Space を grounding にどう組み合わせるか？
- Agent はいつ直接実行するべきか？
- いつ対象を先にハイライトしてユーザーに確認するべきか？
- モデリング操作が科学的にも本当に正しいことをどう検証するか？
- 大規模な系でコンテキストを段階的に絞り込むにはどうするか？
- 数千原子の系で Agent が局所領域だけに注目するにはどうするか？
- 構造理解から実際の計算へどう接続するか？
- tool call が成功した後、科学的なタスクそのものも成功したと Agent が判断するにはどうするか？

これらの問いも、Challenge Edition を公開する大切な理由です。単なる Demo ではなく、議論の始まりにしたいと考えています。

## 科学モデリングの基礎機能

Zatom の現行版および今後のバージョンでは、次の機能を継続的に整備しています。

### Molecular Modeling

- 原子編集（Atom Editing）
- 結合編集（Bond Editing）
- 結合次数（Bond Order）
- 分子幾何（Molecular Geometry）
- フラグメント管理（Fragment Management）
- 電荷（Charge）
- 立体化学（Stereochemistry）
- 構造操作（Structural Manipulation）

### Periodic & Crystal Modeling

- 単位胞（Unit Cell）
- 分率座標（Fractional Coordinates）
- デカルト座標（Cartesian Coordinates）
- 周期境界条件（Periodic Boundary Conditions）
- 周期像（Periodic Images）
- スーパーセル（Supercell）
- 結晶構造（Crystal Structure）
- 表面（Surface）
- スラブ（Slab）
- 真空層（Vacuum）
- 欠陥（Defect）
- 界面（Interface）

### Scientific Visualization

- 軌道（Orbitals）
- 電子密度（Electron Density）
- 静電ポテンシャル（ESP）
- 電荷分布（Charge Distribution）
- スライス平面（Slice Planes）
- 等値面（Isosurfaces）
- ヒートマップ（Heatmaps）
- 構造測定（Structural Measurements）

これらの機能は GUI を使うユーザーだけのためではありません。Agent が理解し、呼び出し、検証できる科学基盤へと少しずつ育てていきます。

## オープンな科学計算

将来的には、次の分野を含む、より多くのオープンな科学計算エコシステムと順次つなげていきたいと考えています。

- 量子化学（Quantum Chemistry）
- 電子構造（Electronic Structure）
- 分子シミュレーション（Molecular Simulation）
- 材料シミュレーション（Materials Simulation）
- 機械学習ポテンシャル（Machine Learning Potentials）
- 構造最適化（Structure Optimization）
- 反応探索（Reaction Exploration）
- 物性計算（Property Calculation）
- 科学解析（Scientific Analysis）

Zatom を、閉じた計算の孤島にはしたくありません。優れたインターフェースをつくり、既存のエコシステムと協働することが、私たちの目指す方向です。

## これからの学習体験

今後のフルバージョンには、より体系的な学習コンテンツも含める予定です。

### Organic Chemistry

- 分子幾何（Molecular Geometry）
- 混成（Hybridization）
- 共鳴（Resonance）
- 共役（Conjugation）
- 芳香族性（Aromaticity）
- 立体化学（Stereochemistry）
- 官能基（Functional Groups）
- 反応構造（Reaction Structures）

### Structural Chemistry

- 分子対称性（Molecular Symmetry）
- 結晶構造（Crystal Structure）
- 配位（Coordination）
- 周期性（Periodicity）
- 表面構造（Surface Structure）
- 欠陥（Defects）
- 界面（Interfaces）

### Scientific Modeling

- モデルを適切に構築する方法
- 周期境界を理解する方法
- 表面系を構築する方法
- 吸着構造をつくる方法
- 計算入力を準備する方法
- 計算結果を理解する方法
- モデリングでよくある誤りを避ける方法

これらの内容を「Page 1、Page 2、Page 3、Quiz」という単純な流れにはせず、できる限り実際の操作に組み込みます。結合を回転させながら、なぜ回転できるのかを理解する。結晶面を切り出しながら Miller Index を理解する。軌道を観察しながら、それが表す電子構造を理解する。学びは、製品を使う体験の中で起きるべきだと考えています。

## Steam と App Store

フルバージョンは現在も開発中で、Steam と App Store での提供を予定しています。

今後のフルバージョンには、さらに次の内容を含める予定です。

- Advanced Modeling Tools
- Scientific Plugins
- Interactive Tutorials
- Organic Chemistry Learning Content
- Structural Chemistry Learning Content
- Computational Workflows
- Scientific Visualization
- Agent-assisted Learning
- Additional Scientific Reasoning Tools

本格的な研究ツールとして使えること。そして同時に、多くの人にとって初めて分子、結晶、電子構造、計算科学に出会う場所になること。その両方を目指しています。

## プロジェクトへの参加

Zatom は、まだとても初期のプロジェクトです。だからこそ、今は設計や方向性に参加する面白さが多く残っています。

私たちは、次のような方々を歓迎します。

- Frontend Engineers
- Graphics Engineers
- WebGL / WebGPU Developers
- Scientific Computing Developers
- Computational Chemists
- Materials Scientists
- Molecular Modeling Developers
- UI / Interaction Designers
- AI Agent Developers
- MCP Developers
- Open-source Contributors
- Educators
- Students

長期メンバーになる必要はありません。ひとつの Issue、ひとつの Pull Request、新しい Scientific Tool、Test Structure、Agent Interaction、Tutorial、あるいは「この設計は、実際にはあまり合理的ではないと思う」という一言でも、このプロジェクトをより良くするきっかけになります。

AI、科学、可視化、教育が交わる領域に興味があれば、ぜひ参加してください。

## オープンソースと商用ライセンス

Zatom WebMCP Challenge Edition では、GNU AGPL-3.0 ライセンスを採用する予定です。

研究者、開発者、コミュニティのみなさんが、このオープン版を研究し、変更し、拡張できるようにしたいと考えています。

AGPL のオープンソース方式を採らず、クローズドソースの商用製品またはサービスへ本プロジェクトの技術を組み込みたい組織には、別途商用ライセンスを提供する予定です。

フルバージョンの商用製品、一部の公式拡張、ブランド素材、ロゴ、商標、および現在のリポジトリに含まれていないその他の内容は、Challenge Edition のオープンな範囲には含まれません。

具体的な範囲については、次のファイルをご覧ください。

```text
LICENSE
COMMERCIAL-LICENSE.md
TRADEMARKS.md
```

## コミュニティへ

私たちは、フルバージョンの製品に向けて、Plugins、Scientific Workflows、Tutorials、Learning Content、Additional Modeling Tools の開発を続けています。コミュニティのみなさんがこの方向性に共感してくださるなら、こうした成果をさらに多くコミュニティへ還元し、次の問いを一緒に探求したいと考えています。

- Agent は科学ソフトウェアにどう参加するべきか
- 科学ソフトウェアは AI の時代にどう進化するべきか
- 科学知識を、より自然でオープンで楽しい体験として設計し直せるか

## 最後に

Zatom は、ひとつのモデラーとして始まりました。Agent と接続するようになってから、私たちは、本当に面白い問いは「AI は人に代わってモデリングを完了できるのか」ではないのかもしれないと気づきました。

> 人と AI が初めて、本当の意味でひとつの科学空間を共有できたら、何が起きるでしょうか。

私たちは、この問いをこれからも追い続けたいと考えています。コミュニティのみなさんがこの方向性に共感してくださるなら、より多くのプラグイン、チュートリアル、ワークフロー、実験的な機能を今後もコミュニティへ届けていきます。

フルバージョンをそのまま使ってみたい方とは、App Store と Steam でお会いできることを楽しみにしています。

一緒にモデリングし、より深く理解し、オープンに計算する。

人と Agent がともに科学するための、より良い方法を一緒につくっていけるかもしれません。
