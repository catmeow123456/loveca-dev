/**
 * Node.js 环境下的卡组加载器
 * 包含文件系统操作
 */

import * as fs from 'fs';
import * as yaml from 'yaml';
import {
  DeckLoader,
  DeckConfigSchema,
  type DeckLoadResult,
  type CardDataRegistry,
} from './deck-loader';

/**
 * 从 YAML 文件加载卡组 (Node.js 环境)
 * @param filePath YAML 文件路径
 * @param registry 卡牌注册表
 * @returns 加载结果
 */
export function loadDeckFromYaml(filePath: string, registry: CardDataRegistry): DeckLoadResult {
  const loader = new DeckLoader(registry);

  // 检查文件是否存在
  if (!fs.existsSync(filePath)) {
    return {
      success: false,
      errors: [`文件不存在: ${filePath}`],
      warnings: [],
    };
  }

  // 读取并解析 YAML
  let rawConfig: unknown;
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    rawConfig = yaml.parse(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      errors: [`YAML 解析错误: ${message}`],
      warnings: [],
    };
  }

  // 验证 YAML 结构
  const parseResult = DeckConfigSchema.safeParse(rawConfig);
  if (!parseResult.success) {
    return {
      success: false,
      errors: [`YAML 格式验证失败: ${String(parseResult.error)}`],
      warnings: [],
    };
  }

  return loader.loadFromConfig(parseResult.data);
}
