export const FLOW_LEVELS = ["spotting", "light", "medium", "heavy"] as const;
export const SYMPTOMS = [
  "cramps",
  "headache",
  "acne",
  "breast tenderness",
  "fatigue",
  "bloating",
  "nausea",
  "cravings",
] as const;
export const MOODS = [
  "calm",
  "anxious",
  "sad",
  "irritable",
  "energetic",
  "emotional",
] as const;
export const OVULATION_SIGNS = [
  "positive LH test",
  "egg-white mucus",
  "mittelschmerz",
  "libido change",
  "temperature shift",
] as const;

export type FlowLevel = (typeof FLOW_LEVELS)[number];
export type Symptom = (typeof SYMPTOMS)[number];
export type Mood = (typeof MOODS)[number];
export type OvulationSign = (typeof OVULATION_SIGNS)[number];
export type Confidence = "low" | "medium" | "high";

export type CervicalMucus =
  | "none"
  | "dry"
  | "sticky"
  | "creamy"
  | "watery"
  | "egg-white";

export type SexualActivity = "none" | "protected" | "unprotected" | "other";

export interface ReminderPreferences {
  periodWindow: boolean;
  medication: boolean;
  symptoms: boolean;
  latePeriod: boolean;
}

export interface PrivacySettings {
  passcodeEnabled: boolean;
  passcodeHash?: string;
  biometricEnabled: boolean;
  biometricCredentialId?: string;
}

export interface UserProfile {
  lastPeriodStart: string;
  typicalPeriodLength: number;
  typicalCycleLength?: number;
  irregularCycles: boolean;
  birthControlUse: string;
  pregnancyTracking: "avoid" | "trying" | "not-tracking";
  trackingNeeds: string[];
  reminders: ReminderPreferences;
  privacy: PrivacySettings;
  onboardedAt: string;
}

export interface Cycle {
  id: string;
  startDate: string;
  endDate?: string;
  notes?: string;
}

export interface DailyLog {
  id: string;
  date: string;
  flow?: FlowLevel;
  symptoms: Symptom[];
  mood?: Mood;
  painLevel: number;
  medications: string;
  birthControl: string;
  ovulationSigns: OvulationSign[];
  cervicalMucus: CervicalMucus;
  temperature?: number;
  sexualActivity: SexualActivity;
  notes: string;
}

export interface CloudSyncSettings {
  enabled: boolean;
  providerLabel: string;
  lastEncryptedBackupAt?: string;
}

export interface TrackerData {
  profile?: UserProfile;
  cycles: Cycle[];
  logs: DailyLog[];
  cloudSync: CloudSyncSettings;
}

export interface CycleStats {
  completedCycleCount: number;
  averageCycleLength?: number;
  shortestCycle?: number;
  longestCycle?: number;
  averagePeriodLength?: number;
  cycleVariability?: number;
  lastCycleLength?: number;
  unusualChanges: string[];
}

export interface PredictionWindow {
  start: string;
  end: string;
}

export interface PredictionResult {
  nextPeriodWindow?: PredictionWindow;
  fertileWindow?: PredictionWindow;
  ovulationWindow?: PredictionWindow;
  confidence: Confidence;
  confidenceScore: number;
  basis: string;
  warnings: string[];
  lateByDays?: number;
}
