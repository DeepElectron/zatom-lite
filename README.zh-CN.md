<p align="center">
  <a href="https://zatom.zauq.tech/">
    <img src="assets/zatom-logo.png" alt="Zatom 标志" width="144">
  </a>
</p>

<h1 align="center">Zatom WebMCP Challenge Edition</h1>

<p align="center">让人与 AI Agent 在同一个科学空间里工作。</p>

<p align="center">
  <a href="https://zatom.zauq.tech/">官方网站</a>
  ·
  <a href="README.md">English</a>
  ·
  <a href="README.zh-CN.md">简体中文</a>
  ·
  <a href="README.ja.md">日本語</a>
</p>

我们想做的，不是让 AI 只在聊天框里告诉你：

> “第 184 个原子的坐标是……”

而是让它和你一起看着一个分子、一块晶体或一个表面，然后自然地交流：

> “这个位置？”
>
> “不是，右边那个。”
>
> “让这个氢朝向旁边那个氧。”
>
> “对，就这样。”

Zatom 从一个简单的问题出发：当 AI Agent 真正进入科学建模软件后，人和 AI 应该怎样一起工作？

## 演示视频

<p align="center">
  <a href="https://youtu.be/zrvn-9GJ6Qs">
    <img src="https://i.ytimg.com/vi/zrvn-9GJ6Qs/maxresdefault.jpg" alt="在 YouTube 观看两分钟 Zatom 演示" width="960">
  </a>
</p>

<p align="center">
  <a href="https://youtu.be/zrvn-9GJ6Qs"><strong>在 YouTube 观看两分钟演示</strong></a>
</p>

视频展示了一条共享建模流程：人和 AI Agent 在同一个三维工作空间中指向、选择、调整并确认。

## 为什么是 Zatom

过去几年，语言模型越来越擅长使用软件。它可以调用工具、编写代码、搜索资料、操作文件和 API，也能连续规划并执行复杂任务。

但科学建模有一个特殊之处：科学家看到的是一个空间世界，而 Agent 往往只能拿到一串坐标、ID 和工具列表。

```text
Atom 181  O   3.214  7.812  12.391
Atom 182  H   3.841  8.120  12.904
Atom 183  H   2.771  8.492  11.944
...
```

人会很自然地说：

> “这个原子。”
>
> “上面这一层。”
>
> “两个原子中间那个位置。”
>
> “把这个分子转过来一点。”
>
> “看看这里为什么电子密度这么高。”

对只掌握坐标、ID 和工具列表的 Agent 来说，理解“这个”有时比解一道复杂公式更困难。

Zatom 希望补上人与 Agent 之间缺失的科学空间语境。

## 01 与 Agent 一起建模

### 协同建模

我们不希望 AI 科学建模变成一条单向流程：

> 输入提示词，自动生成复杂结构，用户接受结果。

真实的科学工作更接近不断循环的观察、尝试、调整、比较与确认。Agent 应该真正参与这个过程。

它可以理解当前的：

- 分子（Molecule）
- 晶体（Crystal）
- 表面（Surface）
- 周期体系（Periodic System）
- 选区（Selection）
- 局部环境（Local Environment）
- 成键关系（Bonding）
- 空间关系（Spatial Relationships）
- 候选位点（Candidate Sites）

也可以主动执行：

- 聚焦与高亮
- 选择目标
- 旋转视角和移动相机
- 标记候选位置
- 变换结构
- 请求用户确认
- 撤销操作
- 验证结果

例如：

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

随后，目标氧原子会被高亮，H₂O 围绕锚点自动旋转，Agent 再次请用户确认。

整个过程不需要记住原子 ID，不需要手工填写 XYZ 坐标，也不必在聊天窗口和科学软件之间来回复制数据。人、Agent 与共享上下文始终处在同一个工作空间中。

我们把这种能力称为“共享空间注意力”（Shared Spatial Attention）。Agent 不仅要能操作软件，还要知道你正在看什么，并让你了解它正在思考和关注什么。

## 02 不止生成结构，更要理解结构

### 深入理解

AI 正在让批量建模变得更快，但我们更关心的是，能否加快理解一个结构、一个反应或一种机制的过程。

除了基础建模，Zatom 也在持续开发用于观察和分析科学结构的能力，包括：

- 分子轨道（Molecular Orbitals）
- 电子密度（Electron Density）
- 静电势（Electrostatic Potential）
- 部分电荷（Partial Charges）
- 标量场（Scalar Fields）
- 切片平面（Slice Planes）
- 等值面（Isosurfaces）
- 热图（Heatmaps）
- 局部环境（Local Environments）
- 成键分析（Bond Analysis）
- 距离分析（Distance Analysis）
- 键角和二面角分析（Angle / Dihedral Analysis）
- 周期结构（Periodic Structures）
- 晶体表面（Crystal Surfaces）
- 吸附结构（Adsorption Structures）
- 缺陷（Defects）
- 界面（Interfaces）

工作流不应停在：

```text
Structure Generated
```

它还应该继续追问：

```text
Why?
```

也就是从结构走向电子结构，再走向机制。Agent 不仅帮你画出模型，也能与你一起观察、比较、分析、提出问题并寻找解释。

## 03 建模不是工作流的终点

### 开放计算

我们相信，AGI 会推动科学技术进一步走向平权。

长期以来，计算化学、材料模拟和科学计算通常伴随着复杂的软件栈、昂贵的商业工具、陡峭的学习曲线，以及彼此割裂的工作流。用户需要在不同软件之间反复转换输入和输出，还必须掌握大量底层技术细节。

Zatom 正在探索一个更开放的计算化学生态闭环：

```text
Model -> Compute -> Analyze -> Visualize -> Understand -> Ask the next question
```

我们希望通过 AI Agent 连接复杂的科学软件、计算流程和专业知识。模型完成后，用户可以继续与 Agent 一起：

- 准备计算任务
- 构建计算输入
- 调用开源科学计算工具
- 提交和管理计算
- 获取计算结果
- 检查异常
- 把结果带回可视化环境
- 分析结构和电子性质
- 继续讨论反应机制
- 根据结果修改模型

Zatom 无意重新实现所有科学计算软件。我们选择拥抱开源科学计算生态，让 Zatom 成为人与 Agent 进入这些工具的自然入口。

最终，你也许只需要一个 Agent 和一个科学工作空间，就能从建模一直走到真实计算结果。

## 在建模中学习

开放科学计算只是其中一部分。我们还希望让学习科学的过程更有趣，也更容易理解。

AI 不应只帮助已经熟悉科学软件的人提高效率，也应该帮助初次接触有机化学、结构化学、计算化学、材料科学、分子建模或科学计算的人，看懂自己正在操作和观察的内容。

搭建有机分子时，Agent 可以解释：

- 为什么这里是 \(sp^2\) 杂化
- 为什么这个键不能自由旋转
- 什么是共轭
- 为什么芳香性会改变电子结构
- R/S 构型意味着什么
- 为什么某些构象更稳定

操作晶体时，它可以解释：

- 原胞（Primitive Cell）
- 惯用晶胞（Conventional Cell）
- 米勒指数（Miller Index）
- 周期性边界条件（Periodic Boundary Conditions）
- 配位环境（Coordination Environment）
- 晶体对称性（Crystal Symmetry）
- 表面切割（Surface Cleavage）
- 空位（Vacancy）
- 缺陷（Defect）
- 界面（Interface）

搭建吸附体系时，它还可以继续解释：

- 吸附位点（Adsorption Site）
- 表面配位（Surface Coordination）
- 取向（Orientation）
- 电荷重排（Charge Redistribution）
- 电子相互作用（Electronic Interaction）
- 反应机制（Reaction Mechanism）

学习不必从读完整本教材开始，也不必等到学完以后才打开科学软件。我们希望知识能在建模、计算和探索的过程中逐渐建立起来。这可能会成为 AI 时代科学教育的一种新形态。

## 还有一项实验

### 如果 Agent 不依赖截图

让多模态模型观察科学软件的截图是一种可行方案，但一张 RGB 图片并不是科学空间理解的终点。

科学建模中的许多信息并不适合从像素中重新猜测，例如：

- 周期性（Periodicity）
- 成键拓扑（Bond Topology）
- 原子身份（Atomic Identity）
- 局部配位（Local Coordination）
- 片段身份（Fragment Identity）
- 周期镜像（Periodic Images）
- 表面法向（Surface Normal）
- 选择状态（Selection State）
- 空间关系（Spatial Relations）
- 化学状态（Chemical State）

因此，我们正在尝试把三维科学世界转换成一种更适合语言模型推理的结构化观察（observation）。它不只是一张截图，而更接近：

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

这种表达需要覆盖：

- 拓扑（Topology）
- 几何（Geometry）
- 周期性（Periodicity）
- 化学身份（Chemical Identity）
- 局部环境（Local Environment）
- 空间关系（Spatial Relationships）
- 相机上下文（Camera Context）
- 用户选区（User Selection）
- 候选区域（Candidate Regions）
- 约束（Constraints）
- 历史操作（Previous Actions）

Agent 可以据此循环执行：观察、推理、行动、再次观察和验证。

## 来自 ARC 类推理任务的启发

ARC 类推理任务给了我们很多启发：一个视觉问题可以被转换成 Agent 能够观察、理解、推理和行动的问题空间。

科学建模的特别之处在于，它不是有限的题库。每个分子都可能成为一道新问题，每种材料都可能成为一个新环境。表面、缺陷、界面、吸附结构、反应，乃至用户临时提出的问题，都可以成为新的推理任务。

因此，我们更愿意把它称为“开放式科学推理环境”（An Open-Ended Scientific Reasoning Environment）。科学世界本身就是一个近乎没有边界的问题生成器。

我们尚不知道这条路线最终会走到哪里，这正是它值得继续探索的原因。

## Challenge Edition

当前仓库是为 WebMCP Challenge 准备的开放版本，主要探索：

- WebMCP 科学建模工具
- 分子与晶体建模
- 人与 Agent 协作
- 空间定位（Spatial Grounding）
- 共享空间注意力
- 结构化科学观察
- 科学可视化
- 开放科学计算工作流
- Agent 辅助的科学推理

这是一个很早期的版本，完整版产品仍在持续开发。

## 仍待回答的问题

真正的人机协同科学界面应该是什么样，行业目前还没有确定答案。我们仍在探索：

- Agent 应该看到多少空间信息？
- 哪些信息应该结构化？
- 哪些信息应该交给视觉模型？
- 如何描述周期镜像？
- 如何表达复杂的局部环境？
- 如何理解“这个”“旁边那个”“右边那个”？
- 屏幕空间（Screen Space）与世界空间（World Space）如何共同参与定位？
- Agent 什么时候应该直接执行？
- 什么时候应该先高亮目标并询问用户？
- 如何验证一次建模操作在科学上确实正确？
- 大型体系如何逐级缩小上下文？
- Agent 如何在数千原子的体系中只关注局部区域？
- 如何从结构理解进一步连接真实计算？
- 一次工具调用成功后，Agent 如何判断科学任务是否真的完成？

这些问题也是我们开放 Challenge Edition 的重要原因。我们希望它既是一个可运行的演示，也能成为讨论的起点。

## 基础科学建模

Zatom 当前版本和后续版本正在持续完善以下能力，包括但不限于：

### 分子建模

- 原子编辑（Atom Editing）
- 化学键编辑（Bond Editing）
- 键级（Bond Order）
- 分子几何（Molecular Geometry）
- 片段管理（Fragment Management）
- 电荷（Charge）
- 立体化学（Stereochemistry）
- 结构操作（Structural Manipulation）

### 周期体系与晶体建模

- 晶胞（Unit Cell）
- 分数坐标（Fractional Coordinates）
- 笛卡尔坐标（Cartesian Coordinates）
- 周期性边界条件（Periodic Boundary Conditions）
- 周期镜像（Periodic Images）
- 超胞（Supercell）
- 晶体结构（Crystal Structure）
- 表面（Surface）
- 薄层模型（Slab）
- 真空层（Vacuum）
- 缺陷（Defect）
- 界面（Interface）

### 科学可视化

- 轨道（Orbitals）
- 电子密度（Electron Density）
- 静电势（ESP）
- 电荷分布（Charge Distribution）
- 切片平面（Slice Planes）
- 等值面（Isosurfaces）
- 热图（Heatmaps）
- 结构测量（Structural Measurements）

这些能力不仅面向图形界面用户，也会逐步成为 Agent 能够理解、调用和验证的科学基础设施。

## 开放科学计算

未来，我们希望逐步连接更多开放科学计算生态，包括但不限于：

- 量子化学（Quantum Chemistry）
- 电子结构（Electronic Structure）
- 分子模拟（Molecular Simulation）
- 材料模拟（Materials Simulation）
- 机器学习势（Machine Learning Potentials）
- 结构优化（Structure Optimization）
- 反应探索（Reaction Exploration）
- 性质计算（Property Calculation）
- 科学分析（Scientific Analysis）

Zatom 不希望成为封闭的计算孤岛。我们的方向是把界面做好，并与现有生态协作。

## 未来的学习体验

后续的完整扩展版本还将提供更多结构化教学内容。

### 有机化学

- 分子几何（Molecular Geometry）
- 杂化（Hybridization）
- 共振（Resonance）
- 共轭（Conjugation）
- 芳香性（Aromaticity）
- 立体化学（Stereochemistry）
- 官能团（Functional Groups）
- 反应结构（Reaction Structures）

### 结构化学

- 分子对称性（Molecular Symmetry）
- 晶体结构（Crystal Structure）
- 配位（Coordination）
- 周期性（Periodicity）
- 表面结构（Surface Structure）
- 缺陷（Defects）
- 界面（Interfaces）

### 科学建模

- 如何正确建立模型
- 如何理解周期边界
- 如何建立表面体系
- 如何构建吸附结构
- 如何准备计算输入
- 如何理解计算结果
- 如何避免常见建模错误

这些内容不会采用简单的“第 1 页、第 2 页、第 3 页、测验”流程，而会尽可能融入实际操作。旋转一个键时理解它为何能转，切割晶面时理解米勒指数，观察轨道时理解它对应的电子结构。

学习应该发生在使用产品的过程中。

## Steam 与 App Store

完整扩展版本正在持续开发，并计划登陆 Steam 和 App Store。

未来的完整体验将进一步包括：

- 高级建模工具（Advanced Modeling Tools）
- 科学插件（Scientific Plugins）
- 交互式教程（Interactive Tutorials）
- 有机化学学习内容（Organic Chemistry Learning Content）
- 结构化学学习内容（Structural Chemistry Learning Content）
- 计算工作流（Computational Workflows）
- 科学可视化（Scientific Visualization）
- Agent 辅助学习（Agent-assisted Learning）
- 其他科学推理工具（Additional Scientific Reasoning Tools）

我们希望它既能成为真正的研究工具，也能成为许多人第一次接触分子、晶体、电子结构和计算科学的地方。

## 参与项目

这是一个早期项目，现在加入，仍有很多机会参与设计和方向讨论。

我们欢迎：

- 前端工程师
- 图形工程师
- WebGL / WebGPU 开发者
- 科学计算开发者
- 计算化学研究者
- 材料科学研究者
- 分子建模开发者
- UI / 交互设计师
- AI Agent 开发者
- MCP 开发者
- 开源贡献者
- 教育工作者
- 学生

你不必成为长期成员。一次 Issue、一个 Pull Request、一项新的科学工具、一个测试结构、一种 Agent 交互、一篇新教程，甚至一句“这个设计其实不合理”，都可能帮助项目继续改进。

如果你对 AI、科学、可视化与教育的交叉领域感兴趣，欢迎参与。

## 开源与商业授权

Zatom WebMCP Challenge Edition 计划采用 GNU AGPL-3.0 许可证。

我们希望研究者、开发者和社区能够研究、修改并扩展这个开放版本。

对于希望把本项目技术集成到闭源商业产品或服务中，同时不采用 AGPL 开源模式的组织，我们计划提供单独的商业授权。

完整版商业产品、部分官方扩展、品牌资产、Logo、商标，以及未包含在当前仓库中的其他内容，不属于 Challenge Edition 的开放范围。

具体范围请参阅：

```text
LICENSE
COMMERCIAL-LICENSE.md
TRADEMARKS.md
```

## 面向社区

我们仍在为完整产品开发插件、科学工作流、教程、学习内容和更多建模工具。如果社区认可这个方向，我们希望把其中更多内容带回社区，与大家一起探索：

- Agent 应该怎样进入科学软件
- 科学软件应该怎样进入 AI 时代
- 科学知识能否被设计成一种更自然、更开放，也更有趣的体验

## 写在最后

Zatom 最初只是一个建模器。接入 Agent 后，我们发现更值得追问的并不是“AI 能不能替人完成建模”，而是：

> 如果人与 AI 第一次可以真正共享一个科学空间，会发生什么？

我们想沿着这个问题继续做下去。如果社区也认可这个方向，我们会把更多插件、教程、工作流和实验能力带回社区。

如果你只想直接使用完整版本，我们期待与你在 App Store 和 Steam 见面。

一起建模，深入理解，开放计算。

也许，我们可以一起找到一种更好的方式，让人和 Agent 共同探索科学。
