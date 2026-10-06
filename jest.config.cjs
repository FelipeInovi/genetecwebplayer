const { compilerOptions } = require("./tsconfig.json");

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "jsdom",
  roots: ["<rootDir>/src", "<rootDir>/server"],
  testMatch: ["**/*.test.ts", "**/*.test.tsx", "**/*.test.cjs"],
  transform: {
    "^.+\.tsx?$": [
      "ts-jest",
      {
        // Jest runs CommonJS: JSON/default imports need interop (Vite does not).
        tsconfig: {
          ...compilerOptions,
          module: "CommonJS",
          moduleResolution: "node10",
          esModuleInterop: true
        },
        diagnostics: false
      }
    ]
  },
  moduleNameMapper: {
    // import.meta.env is not parseable by ts-jest (CJS): swap env.ts for a stub.
    "^@/render/config/env$": "<rootDir>/src/test/envStub.ts",
    "^@/(.*)$": "<rootDir>/src/$1"
  },
  setupFilesAfterEnv: ["<rootDir>/src/test/setup.ts"]
};
