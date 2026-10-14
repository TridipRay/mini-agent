import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

export function claudeEnvironment(environment, directory) {
  const result = { ...environment };
  for (const key of Object.keys(result)) {
    if (/^(ANTHROPIC_|CLAUDE_|ACCESS_TOKEN$)/.test(key)) delete result[key];
  }
  // Never inherit a parent Claude Code session when launching a separate local agent.
  delete result.CLAUDECODE;
  result.CLAUDE_CONFIG_DIR = directory;
  return result;
}
export function claudeBinary(environment = process.env) {
  if (environment.MINI_AGENT_CLAUDE_BIN) return environment.MINI_AGENT_CLAUDE_BIN;
  const require = createRequire(environment.MINI_AGENT_CLAUDE_SDK
    ? pathToFileURL(path.resolve(environment.MINI_AGENT_CLAUDE_SDK)) : import.meta.url);
  return require.resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/${process.platform === 'win32' ? 'claude.exe' : 'claude'}`);
}
export async function loadClaudeSdk() {
  return import(process.env.MINI_AGENT_CLAUDE_SDK ? pathToFileURL(path.resolve(process.env.MINI_AGENT_CLAUDE_SDK)).href : '@anthropic-ai/claude-agent-sdk');
}
