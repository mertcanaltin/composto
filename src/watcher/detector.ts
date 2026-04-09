import picomatch from "picomatch";
import type { Finding, Severity, WatcherConfig } from "../types.js";

type SeverityMap = Record<string, Severity>;

function getSeverity(filePath: string, severityMap: SeverityMap): Severity {
  for (const [glob, severity] of Object.entries(severityMap)) {
    if (picomatch.isMatch(filePath, glob)) return severity;
  }
  return "info";
}

const SECRET_PATTERNS = [
  /["'](sk-[a-zA-Z0-9-]{20,})["']/,
  /["'](AKIA[0-9A-Z]{16})["']/,
  /["'](ghp_[a-zA-Z0-9]{36})["']/,
  /(?:password|secret|token|api_?key)\s*[:=]\s*["']([^"']{8,})["']/i,
];

export function securityRule(code: string, filePath: string, severityMap: SeverityMap): Finding[] {
  const findings: Finding[] = [];
  const severity = getSeverity(filePath, severityMap);
  const lines = code.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith("//") || line.trim().startsWith("/*")) continue;

    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(line)) {
        findings.push({
          watcherId: "security",
          severity,
          file: filePath,
          line: i + 1,
          message: "Potential hardcoded secret detected",
          action: {
            type: "agent-required",
            agentHint: { role: "fixer", model: "haiku", contextFiles: [filePath] },
          },
        });
        break;
      }
    }
  }

  return findings;
}

export function consoleLogRule(code: string, filePath: string, severityMap: SeverityMap): Finding[] {
  const findings: Finding[] = [];
  const severity = getSeverity(filePath, severityMap);
  const lines = code.split("\n");

  for (let i = 0; i < lines.length; i++) {
    if (/\bconsole\.(log|debug|info|warn)\b/.test(lines[i])) {
      findings.push({
        watcherId: "consoleLog",
        severity,
        file: filePath,
        line: i + 1,
        message: "console.log detected — likely debug artifact",
        action: { type: "auto-fix", autoFix: "remove-line" },
      });
    }
  }

  return findings;
}

const RULES: Record<string, (code: string, file: string, severity: SeverityMap) => Finding[]> = {
  security: securityRule,
  consoleLog: consoleLogRule,
};

export function runDetector(
  code: string,
  filePath: string,
  watcherConfigs: Record<string, WatcherConfig>
): Finding[] {
  const findings: Finding[] = [];

  for (const [name, config] of Object.entries(watcherConfigs)) {
    if (!config.enabled) continue;
    const rule = RULES[name];
    if (rule && config.severity) {
      findings.push(...rule(code, filePath, config.severity));
    }
  }

  return findings;
}
