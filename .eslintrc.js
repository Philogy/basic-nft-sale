module.exports = {
  env: {
    commonjs: true,
    es2021: true,
    node: true
  },
  extends: 'eslint:recommended',
  globals: {
    describe: 'readonly',
    before: 'readonly',
    it: 'readonly'
  },
  parserOptions: {
    ecmaVersion: 12
  },
  rules: {
    indent: ['error', 2],
    'linebreak-style': ['error', 'unix'],
    quotes: ['error', 'single'],
    semi: ['error', 'never']
  }
}
