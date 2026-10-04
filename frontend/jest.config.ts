import nextJest from "next/jest.js";

const createJestConfig = nextJest({
  dir: "./",
});

const customJestConfig = {
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  testEnvironment: "jest-environment-jsdom",
  testPathIgnorePatterns: ["<rootDir>/scripts/", "<rootDir>/tests/e2e/", "<rootDir>/tests/planning-e2e/", "<rootDir>/tests/completion-e2e/", "<rootDir>/tests/remediation-e2e/", "<rootDir>/tests/subject-control-e2e/", "<rootDir>/tests/proxy-e2e/"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
};

export default createJestConfig(customJestConfig);
