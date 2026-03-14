import eslint from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import prettier from 'eslint-config-prettier';
import prettierPlugin from 'eslint-plugin-prettier';

export default [
  // 忽略文件配置
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
  
  // 基础 ESLint 推荐配置
  eslint.configs.recommended,
  
  // TypeScript 文件配置
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        project: './tsconfig.test.json',
      },
      globals: {
        // Node.js 全局变量
        console: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'readonly',
        require: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      prettier: prettierPlugin,
    },
    rules: {
      // TypeScript 规则
      ...tseslint.configs.recommended.rules,
      ...tseslint.configs['recommended-requiring-type-checking']?.rules,
      
      // 关闭与 TypeScript 冲突的基础规则
      'no-unused-vars': 'off',
      
      // 放宽 TypeScript 规则
      '@typescript-eslint/no-unused-vars': 'warn',  // 只警告未使用变量
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',  // 关闭不必要类型断言检查
      '@typescript-eslint/no-non-null-assertion': 'off',  // 允许非空断言
      '@typescript-eslint/prefer-readonly': 'off',  // 关闭 readonly 建议
      '@typescript-eslint/restrict-template-expressions': 'off',  // 关闭模板字面量类型限制
      '@typescript-eslint/no-unsafe-enum-comparison': 'off',  // 关闭枚举比较检查
      '@typescript-eslint/explicit-function-return-type': 'off',  // 关闭显式返回类型要求
      '@typescript-eslint/no-explicit-any': 'warn',  // any 类型改为警告
      
      // 关闭其他过于严格的规则
      'no-case-declarations': 'off',  // 允许 case 块中的词法声明
      
      // Prettier 集成
      'prettier/prettier': 'error',
    },
  },
  
  // Prettier 配置 (禁用与 Prettier 冲突的规则)
  prettier,
];
