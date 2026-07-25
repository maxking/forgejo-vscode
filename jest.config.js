module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  moduleNameMapper: {
    '^vscode$': '<rootDir>/__mocks__/vscode.js'
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        types: ['jest', 'node']
      }
    }]
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/test/**',           // Exclude integration tests
    '!src/**/*.test.ts',      // Exclude test files
    '!src/__tests__/**',      // Exclude test infrastructure
    '!src/models/**',         // Exclude interfaces (no logic)
    '!src/extension.ts',      // Tested by integration tests
    '!src/webview/**/provider.ts',  // Webview providers require VS Code APIs
    '!src/webview/**/index.js',     // Browser-only code
    // Note: src/webview/shared/*.ts is included for unit testing
  ],
  coverageThreshold: {
    global: {
      statements: 55,
      branches: 45,
      functions: 50,
      lines: 55
    }
  },
  setupFiles: ['<rootDir>/src/__tests__/setup.ts'],
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true
};
