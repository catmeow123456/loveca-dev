import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 测试文件匹配模式
    include: ['tests/**/*.test.ts', 'tests/**/*.spec.ts'],
    
    // 排除目录
    exclude: ['node_modules', 'dist'],
    
    // 测试环境
    environment: 'node',
    
    // 全局变量（如 describe, it, expect）
    globals: true,
    
    // 覆盖率配置
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/**/index.ts'],
      thresholds: {
        // 最低覆盖率要求
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
    
    // 类型检查
    typecheck: {
      enabled: true,
      tsconfig: './tsconfig.test.json',
    },
  },
});
