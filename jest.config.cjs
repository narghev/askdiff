/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/packages"],
  testMatch: ["**/*.test.ts"],
  transform: {
    // Use our root strict tsconfig so ts-jest sees ES2022 lib (Error.cause),
    // esModuleInterop, exactOptionalPropertyTypes, etc.
    "^.+\\.ts$": [
      "ts-jest",
      { tsconfig: "<rootDir>/tsconfig.base.json" },
    ],
  },
  moduleNameMapper: {
    // Resolve workspace package "@askdiff/protocol" to its source so
    // ts-jest can transform it without a build step.
    "^@askdiff/protocol$": "<rootDir>/packages/protocol/src/index.ts",
  },
};
