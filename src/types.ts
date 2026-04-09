// --- IR Types ---

export type LineType =
  | "function-start"
  | "type-start"
  | "branch"
  | "loop"
  | "exit"
  | "import"
  | "export"
  | "assignment"
  | "error-handling"
  | "async"
  | "comment"
  | "blank"
  | "unknown";

export interface StructureLine {
  line: number;
  indent: number;
  type: LineType;
  raw: string;
}

export type StructureMap = StructureLine[];

export interface FingerprintResult {
  type: "fingerprint" | "fingerprint+hint" | "raw";
  ir: string;
  hint?: string;
  confidence: number;
}

export interface DeltaContext {
  file: string;
  hunks: DeltaHunk[];
}

export interface DeltaHunk {
  startLine: number;
  endLine: number;
  changed: string[];
  surroundingIR: string;
  functionScope: string | null;
  blame: BlameInfo | null;
}

export interface BlameInfo {
  author: string;
  date: string;
  commitMessage: string;
}

// --- Health Types ---

export interface HealthAnnotation {
  churn: number;
  fixRatio: number;
  coverageTrend: "up" | "stable" | "down" | "unknown";
  staleness: string;
  authorCount: number;
  consistency: "high" | "medium" | "low";
}

export interface HealthTag {
  file: string;
  annotation: HealthAnnotation;
  tag: string;
  isHealthy: boolean;
}

// --- Trend Types ---

export interface Hotspot {
  file: string;
  changesInLast30Commits: number;
  bugFixRatio: number;
  authorCount: number;
}

export interface DecaySignal {
  file: string;
  metric: "complexity" | "churn";
  trend: "declining" | "stable" | "improving";
  dataPoints: { date: string; value: number }[];
}

export interface Inconsistency {
  file: string;
  patterns: { author: string; style: string }[];
}

export interface TrendAnalysis {
  hotspots: Hotspot[];
  decaySignals: DecaySignal[];
  inconsistencies: Inconsistency[];
}

export interface GitLogEntry {
  hash: string;
  author: string;
  date: string;
  message: string;
  files: string[];
}

// --- Finding Types ---

export type Severity = "info" | "warning" | "critical";

export interface Finding {
  watcherId: string;
  severity: Severity;
  file: string;
  line?: number;
  message: string;
  action?: FindingAction;
}

export interface FindingAction {
  type: "auto-fix" | "agent-required" | "human-only";
  autoFix?: string;
  agentHint?: {
    role: "fixer" | "reviewer";
    model: "haiku" | "sonnet";
    contextFiles: string[];
  };
}

// --- Router Types ---

export interface RouteRule {
  pattern: string;
  contentSignal?: RegExp;
  agents: string[];
  irLayer: "L0" | "L1" | "L2" | "L3";
}

export interface RouteDecision {
  agents: string[];
  irLayer: "L0" | "L1" | "L2" | "L3";
  deterministic: boolean;
}

// --- Protocol Types ---

export interface FileChangeEvent {
  file: string;
  type: "create" | "modify" | "delete";
  content?: string;
}

export type CompostoMessage =
  | { type: "finding"; data: Finding }
  | { type: "proposal"; data: { id: string; description: string; findings: Finding[] } }
  | { type: "edit"; data: { file: string; content: string } }
  | { type: "question"; data: { id: string; text: string; options?: string[] } }
  | { type: "trend-report"; data: TrendAnalysis };

export interface CompostoProtocol {
  onFileChange(event: FileChangeEvent): void;
  onCommand(cmd: string, args: string[]): void;
  onApproval(proposalId: string, approved: boolean): void;
  notify(message: CompostoMessage): void;
}

// --- Config Types ---

export interface CompostoConfig {
  watchers: Record<string, WatcherConfig>;
  agents: Record<string, AgentConfig>;
  ir: IRConfig;
  trends: TrendConfig;
}

export interface WatcherConfig {
  enabled: boolean;
  severity?: Record<string, Severity>;
  trigger?: string | string[];
}

export interface AgentConfig {
  enabled: boolean;
  model: "haiku" | "sonnet" | "opus";
}

export interface IRConfig {
  deltaContextLines: number;
  confidenceThreshold: number;
  genericPatterns: "default" | string;
}

export interface TrendConfig {
  enabled: boolean;
  hotspotThreshold: number;
  bugFixRatioThreshold: number;
  decayCheckTrigger: string;
  fullReportSchedule: string;
}
