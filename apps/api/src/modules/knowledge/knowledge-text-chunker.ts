import { MarkdownTextSplitter } from '@langchain/textsplitters';

interface MarkdownSection {
  headingPath: string[];
  content: string;
}

export interface KnowledgeTextChunk {
  index: number;
  content: string;
  characterCount: number;
  headingPath: string[];
}

export async function splitKnowledgeText(content: string) {
  if (content.trim().length === 0) {
    return [];
  }

  const splitter = new MarkdownTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
  });

  const chunks: KnowledgeTextChunk[] = [];

  for (const section of splitMarkdownSections(content)) {
    const sectionChunks = await splitter.splitText(section.content);

    for (const chunkContent of sectionChunks) {
      chunks.push({
        // 全文统一编号，不在每个章节重新从 0 开始。
        index: chunks.length,
        content: chunkContent,
        characterCount: chunkContent.length,
        headingPath: [...section.headingPath],
      });
    }
  }
  return chunks;
}

/**
 * 将 Markdown 按 # 至 ###### 标题划分为章节。
 *
 * 每个章节之后再由 MarkdownTextSplitter 分块。
 */

function splitMarkdownSections(content: string): MarkdownSection[] {
  // 保存最终得到的章节。
  const sections: MarkdownSection[] = [];

  // 保存当前所在的标题层级。
  // 例如 ['退款政策', '申请条件'] 表示当前位于二级标题下。
  const headings: string[] = [];

  // 暂存当前章节的正文行。
  let bodyLines: string[] = [];

  // 如果正在代码块内，记录围栏字符：` 或 ~。
  // 空字符串表示当前不在代码块内。
  let fenceCharacter = '';

  // 记录代码围栏长度，例如 ``` 的长度为 3。
  let fenceLength = 0;

  const flush = () => {
    // 把正文行重新组成文本，只去除章节首尾空白。
    const text = bodyLines.join('\n').trim();

    // 标题下没有正文时，不产生空章节。
    if (text) {
      sections.push({
        // 复制当前标题路径，避免后续修改 headings
        // 影响已经保存的章节。
        headingPath: headings.filter(Boolean),
        content: text,
      });
    }

    // 清空暂存区，准备收集下一章节的正文。
    bodyLines = [];
  };

  for (const line of content.split('\n')) {
    // 识别行首的 ``` 或 ~~~ 代码围栏。
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})/);

    if (fenceCharacter) {
      // 已经在代码块内：所有内容都当正文保存。
      // 即使某行以 # 开头，也不能识别为标题。
      bodyLines.push(line);

      // 只有遇到相同字符、长度足够的结束围栏，
      // 才退出代码块。
      if (
        fence &&
        fence[1][0] === fenceCharacter &&
        fence[1].length >= fenceLength &&
        /^ {0,3}(`{3,}|~{3,})\s*$/.test(line)
      ) {
        fenceCharacter = '';
        fenceLength = 0;
      }
      continue;
    }
    if (fence) {
      // 遇到代码块的开始围栏。
      fenceCharacter = fence[1][0];
      fenceLength = fence[1].length;
      bodyLines.push(line);
      continue;
    }
    const heading = line.match(/^ {0,3}(#{1,6})[ \t]+(.+?)\s*#*\s*$/);

    if (heading) {
      // 先用“旧标题路径”保存上一章节正文。
      // 不能先更新标题，否则上一章节会归到新标题下。
      flush();

      const level = heading[1].length;

      // 清除比新标题更深的旧标题。
      // 例如从 ### 返回 ## 时，旧的三级标题必须消失。
      headings.length = level;

      // 数组下标从 0 开始：
      // # 对应 headings[0]，## 对应 headings[1]。
      headings[level - 1] = heading[2].trim();

      continue;
    }

    // 普通文本行归入当前章节。
    bodyLines.push(line);
  }
  flush();

  return sections;
}
