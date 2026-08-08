import type { SourceNote } from "../../packages/contracts/src/index.ts";

/**
 * Product demonstration fixtures only. These records are never presented as
 * user-owned data; the UI labels them as “演示样本”.
 */
export const DEMO_NOTES: SourceNote[] = [
  {
    id: "demo-attention-paper",
    title: "《Attention Is All You Need》精读卡",
    content:
      "本文梳理 Transformer 架构的编码器与解码器。核心是 scaled dot-product self-attention：Query 与 Key 做矩阵乘法，缩放后经过 Softmax 得到权重，再聚合 Value。多头注意力把表示投影到多个子空间，最后拼接。附带一个 QKV 维度推导和小矩阵计算例子。",
    source: "PDF · 论文精读",
    capturedAt: "2026-07-18",
    confidence: 0.96,
  },
  {
    id: "demo-softmax-math",
    title: "从矩阵乘法到 Softmax",
    content:
      "线性代数复习：向量空间、矩阵乘法和点积。推导 Softmax 的归一化指数形式，并用三个数值完成计算例子。总结：点积产生相关性分数，Softmax 将分数转换成概率分布。",
    source: "手写笔记",
    capturedAt: "2026-07-21",
    confidence: 0.91,
  },
  {
    id: "demo-backprop",
    title: "神经网络训练的最短解释",
    content:
      "神经网络由参数化层和激活函数组成。反向传播用链式法则计算梯度，梯度下降更新参数。包含两层网络的公式推导、数值例子，以及学习率过高和过低的对比。",
    source: "课程笔记",
    capturedAt: "2026-06-30",
    confidence: 0.93,
  },
  {
    id: "demo-nlp-embeddings",
    title: "Token 与 Embedding 到底是什么",
    content:
      "自然语言处理先通过 tokenization 把文本切成词元 token，再通过词嵌入 embedding 映射为连续向量表示。对比 one-hot 与稠密向量，并用语义相似搜索作为实践案例。",
    source: "网页剪藏 + 自己总结",
    capturedAt: "2026-07-04",
    confidence: 0.88,
  },
  {
    id: "demo-sequence",
    title: "RNN 的长程依赖与并行瓶颈",
    content:
      "序列模型需要处理顺序和上下文。循环神经网络 RNN 按时间步计算，容易遇到长程依赖和并行效率问题。对比注意力机制后，总结其直接连接任意位置的优势。",
    source: "视频转写整理",
    capturedAt: "2026-07-11",
    confidence: 0.82,
  },
  {
    id: "demo-residual",
    title: "残差连接：深层网络为什么还能训练",
    content:
      "残差连接 residual connection 将输入直接加到子层输出，形成稳定梯度通路。用恒等映射作类比，并比较有无跳跃连接时深层神经网络的训练表现。",
    source: "读书笔记",
    capturedAt: "2026-07-15",
    confidence: 0.9,
  },
  {
    id: "demo-lora",
    title: "LoRA 微调实践记录",
    content:
      "用 LoRA 做参数高效微调，只训练低秩适配矩阵。记录数据清洗、训练参数和显存变化；并与全量 fine-tuning 对比。当前笔记偏实践，还没有补齐预训练原理。",
    source: "项目日志",
    capturedAt: "2026-07-28",
    confidence: 0.86,
  },
  {
    id: "demo-rag",
    title: "个人知识库 RAG 原型复盘",
    content:
      "RAG 检索增强生成流程包括文本切块、embedding、向量检索、上下文拼接与生成。实践中对比了切块大小，并记录召回率和引用准确率。",
    source: "项目复盘",
    capturedAt: "2026-08-02",
    confidence: 0.94,
  },
];
