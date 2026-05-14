"use client";

import { useEffect, useMemo, useState } from "react";
import {
  FLOW_LEVELS,
  MOODS,
  OVULATION_SIGNS,
  SYMPTOMS,
  type CervicalMucus,
  type DailyLog,
  type FlowLevel,
  type Mood,
  type OvulationSign,
  type SexualActivity,
  type Symptom,
  type TrackerData,
  type UserProfile,
} from "@/lib/types";
import { emptyData, sampleData } from "@/lib/sample-data";
import { calculateCycleStats, predictNextWindow, sortCycles } from "@/lib/predictions";
import {
  addDays,
  diffDays,
  endOfMonth,
  formatDateRange,
  formatShortDate,
  isBetween,
  monthTitle,
  parseDate,
  startOfMonth,
  toDateKey,
} from "@/lib/date-utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";

const STORAGE_KEY = "luna-arc-tracker-data-v1";
const todayKey = toDateKey(new Date());

type Tab = "dashboard" | "calendar" | "log" | "insights" | "privacy";

const tabLabels: Record<Tab, string> = {
  dashboard: "Overview",
  calendar: "Calendar",
  log: "Daily log",
  insights: "Insights",
  privacy: "Privacy",
};

function id(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cloneData(data: TrackerData): TrackerData {
  return JSON.parse(JSON.stringify(data)) as TrackerData;
}

function classNames(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function deriveKey(passphrase: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: exactBuffer(salt), iterations: 210000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptData(data: TrackerData, passphrase: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(data)),
  );

  return JSON.stringify({
    version: 1,
    algorithm: "PBKDF2-SHA256/AES-GCM",
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    payload: bytesToBase64(new Uint8Array(encrypted)),
  });
}

async function decryptData(packageText: string, passphrase: string) {
  const parsed = JSON.parse(packageText) as {
    salt: string;
    iv: string;
    payload: string;
  };
  const salt = base64ToBytes(parsed.salt);
  const iv = base64ToBytes(parsed.iv);
  const key = await deriveKey(passphrase, salt);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    base64ToBytes(parsed.payload),
  );
  return JSON.parse(new TextDecoder().decode(decrypted)) as TrackerData;
}

export default function PeriodTrackerApp() {
  const [data, setData] = useState<TrackerData>(emptyData);
  const [hydrated, setHydrated] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as TrackerData;
          setData(parsed);
          setLocked(Boolean(parsed.profile?.privacy.passcodeEnabled));
        } catch {
          setData(emptyData);
        }
      }
      setHydrated(true);
    });
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data, hydrated]);

  const stats = useMemo(() => calculateCycleStats(data), [data]);
  const prediction = useMemo(() => predictNextWindow(data, todayKey), [data]);

  function updateData(updater: (current: TrackerData) => TrackerData) {
    setData((current) => updater(cloneData(current)));
  }

  function completeOnboarding(profile: UserProfile) {
    const endDate = addDays(profile.lastPeriodStart, profile.typicalPeriodLength - 1);
    setData({
      ...emptyData,
      profile,
      cycles: [
        {
          id: id("cycle"),
          startDate: profile.lastPeriodStart,
          endDate,
        },
      ],
    });
    setActiveTab("log");
  }

  function loadSample() {
    setData(cloneData(sampleData));
    setLocked(false);
    setActiveTab("dashboard");
  }

  function resetOnboarding() {
    setData(emptyData);
    setLocked(false);
    setActiveTab("dashboard");
  }

  function addCycle(startDate: string, endDate?: string) {
    updateData((current) => ({
      ...current,
      cycles: sortCycles([
        ...current.cycles,
        {
          id: id("cycle"),
          startDate,
          endDate: endDate || undefined,
        },
      ]),
      profile: current.profile
        ? {
            ...current.profile,
            lastPeriodStart: startDate,
          }
        : current.profile,
    }));
  }

  function deleteCycle(cycleId: string) {
    updateData((current) => ({
      ...current,
      cycles: current.cycles.filter((cycle) => cycle.id !== cycleId),
    }));
  }

  function saveLog(log: DailyLog) {
    updateData((current) => {
      const existing = current.logs.some((item) => item.date === log.date);
      return {
        ...current,
        logs: existing ? current.logs.map((item) => (item.date === log.date ? log : item)) : [...current.logs, log],
      };
    });
  }

  function deleteAllData() {
    window.localStorage.removeItem(STORAGE_KEY);
    setData(emptyData);
    setLocked(false);
  }

  if (!hydrated) {
    return <LoadingShell />;
  }

  if (data.profile?.privacy.passcodeEnabled && locked) {
    return <LockScreen profile={data.profile} onUnlock={() => setLocked(false)} />;
  }

  if (!data.profile) {
    return <Onboarding onComplete={completeOnboarding} onLoadSample={loadSample} />;
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-4 sm:px-6 lg:px-8">
        <Header
          data={data}
          confidence={prediction.confidence}
          onLoadSample={loadSample}
          onResetOnboarding={resetOnboarding}
          onLock={() => setLocked(true)}
        />

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as Tab)}>
          <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-xl border bg-card p-1 shadow-sm sm:grid-cols-5">
            {(Object.keys(tabLabels) as Tab[]).map((tab) => (
              <TabsTrigger key={tab} value={tab} className="h-10">
                {tabLabels[tab]}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="dashboard">
            <Dashboard data={data} stats={stats} prediction={prediction} onAddCycle={addCycle} onDeleteCycle={deleteCycle} />
          </TabsContent>
          <TabsContent value="calendar">
            <CalendarView data={data} prediction={prediction} onSelectDate={() => setActiveTab("log")} />
          </TabsContent>
          <TabsContent value="log">
            <DailyLogger data={data} onSave={saveLog} onAddCycle={addCycle} />
          </TabsContent>
          <TabsContent value="insights">
            <Insights data={data} stats={stats} prediction={prediction} />
          </TabsContent>
          <TabsContent value="privacy">
            <PrivacyCenter
              data={data}
              onUpdate={(next) => setData(next)}
              onDeleteAll={deleteAllData}
              onLock={() => setLocked(true)}
            />
          </TabsContent>
        </Tabs>

        <p className="rounded-xl border bg-card px-4 py-3 text-sm leading-6 text-muted-foreground shadow-sm">
          Medical disclaimer: cycle, fertile, and ovulation predictions are estimates based on logged history and are not
          medical advice, diagnosis, contraception, or a substitute for care from a qualified healthcare professional.
        </p>
      </div>
    </main>
  );
}

function LoadingShell() {
  return (
    <main className="grid min-h-screen place-items-center bg-background px-4 text-foreground">
      <Card className="w-full max-w-md text-center">
        <CardContent className="p-6">
          <p className="text-sm font-semibold text-primary">Loading private tracker</p>
        </CardContent>
      </Card>
    </main>
  );
}

function Header({
  data,
  confidence,
  onLoadSample,
  onResetOnboarding,
  onLock,
}: {
  data: TrackerData;
  confidence: string;
  onLoadSample: () => void;
  onResetOnboarding: () => void;
  onLock: () => void;
}) {
  return (
    <Card className="overflow-hidden border-border/80 bg-card/95">
      <header className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.12em] text-primary">Luna Arc</p>
        <h1 className="mt-1 text-3xl font-bold tracking-normal text-[#20302e] sm:text-4xl">Private cycle tracker</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          Local-first tracking for people who menstruate, with estimated windows that adapt to regular and irregular
          cycles.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="success" className="px-3 py-1.5 text-sm">
          {confidence} confidence
        </Badge>
        <Badge variant="warning" className="px-3 py-1.5 text-sm">
          Local by default
        </Badge>
        {data.profile?.privacy.passcodeEnabled && (
          <Button variant="outline" onClick={onLock}>
            Lock
          </Button>
        )}
        <Button variant="outline" onClick={onLoadSample}>
          Sample data
        </Button>
        <Button variant="secondary" onClick={onResetOnboarding}>
          Onboarding
        </Button>
      </div>
      </header>
    </Card>
  );
}

function Onboarding({
  onComplete,
  onLoadSample,
}: {
  onComplete: (profile: UserProfile) => void;
  onLoadSample: () => void;
}) {
  const [lastPeriodStart, setLastPeriodStart] = useState(todayKey);
  const [typicalPeriodLength, setTypicalPeriodLength] = useState(5);
  const [typicalCycleLength, setTypicalCycleLength] = useState(32);
  const [knownCycle, setKnownCycle] = useState(true);
  const [irregularCycles, setIrregularCycles] = useState(false);
  const [birthControlUse, setBirthControlUse] = useState("");
  const [pregnancyTracking, setPregnancyTracking] = useState<UserProfile["pregnancyTracking"]>("not-tracking");
  const [trackingNeeds, setTrackingNeeds] = useState<string[]>([]);
  const [reminders, setReminders] = useState({
    periodWindow: true,
    medication: false,
    symptoms: true,
    latePeriod: true,
  });
  const [error, setError] = useState("");

  function toggleNeed(value: string) {
    setTrackingNeeds((current) => (current.includes(value) ? current.filter((item) => item !== value) : [...current, value]));
  }

  function submit() {
    if (!lastPeriodStart) {
      setError("Last period start date is required.");
      return;
    }
    if (typicalPeriodLength < 1 || typicalPeriodLength > 20) {
      setError("Typical period length should be between 1 and 20 days.");
      return;
    }
    if (knownCycle && (typicalCycleLength < 15 || typicalCycleLength > 120)) {
      setError("Typical cycle length should be between 15 and 120 days.");
      return;
    }

    onComplete({
      lastPeriodStart,
      typicalPeriodLength,
      typicalCycleLength: knownCycle ? typicalCycleLength : undefined,
      irregularCycles,
      birthControlUse: birthControlUse.trim() || "Not specified",
      pregnancyTracking,
      trackingNeeds,
      reminders,
      privacy: {
        passcodeEnabled: false,
        biometricEnabled: false,
      },
      onboardedAt: todayKey,
    });
  }

  return (
    <main className="min-h-screen bg-background px-4 py-5 text-foreground">
      <section className="mx-auto grid w-full max-w-6xl gap-5 lg:grid-cols-[0.85fr_1.15fr]">
        <div className="flex min-h-[420px] flex-col justify-between rounded-xl bg-primary p-6 text-primary-foreground shadow-sm">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.12em] text-[#bde6df]">Luna Arc</p>
            <h1 className="mt-3 text-4xl font-bold tracking-normal">Set up private tracking</h1>
            <p className="mt-4 text-base leading-7 text-[#e7fffb]">
              Your data starts on this device. Predictions become more useful as you add your own history, especially
              when cycles vary.
            </p>
          </div>
          <div className="mt-8 rounded-xl border border-white/25 bg-white/10 p-4 text-sm leading-6 text-[#f7fffd]">
            Predictions are shown as estimated windows, never fixed promises. You can export, encrypt, lock, or delete
            your data at any time.
          </div>
        </div>

        <Card>
          <CardHeader className="flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="text-2xl">Onboarding</CardTitle>
              <CardDescription className="mt-1 leading-6">A few details help avoid one-size-fits-all estimates.</CardDescription>
            </div>
            <Button variant="outline" onClick={onLoadSample}>
              Explore sample data
            </Button>
          </CardHeader>
          <CardContent>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Field label="Last period start date">
              <Input type="date" value={lastPeriodStart} onChange={(event) => setLastPeriodStart(event.target.value)} />
            </Field>
            <Field label="Typical period length">
              <Input
                type="number"
                min={1}
                max={20}
                value={typicalPeriodLength}
                onChange={(event) => setTypicalPeriodLength(Number(event.target.value))}
              />
            </Field>
            <Field label="Typical cycle length">
              <div className="flex gap-2">
                <Input
                  type="number"
                  min={15}
                  max={120}
                  disabled={!knownCycle}
                  value={typicalCycleLength}
                  onChange={(event) => setTypicalCycleLength(Number(event.target.value))}
                />
                <label className="flex min-h-10 items-center gap-2 rounded-md border border-input px-3 text-sm text-muted-foreground">
                  <input type="checkbox" checked={!knownCycle} onChange={(event) => setKnownCycle(!event.target.checked)} />
                  Unknown
                </label>
              </div>
            </Field>
            <Field label="Cycle pattern">
              <label className="flex min-h-10 items-center gap-2 rounded-md border border-input px-3 text-sm text-muted-foreground">
                <input type="checkbox" checked={irregularCycles} onChange={(event) => setIrregularCycles(event.target.checked)} />
                Cycles are irregular or hard to predict
              </label>
            </Field>
            <Field label="Birth control use">
              <Input
                placeholder="None, pill, IUD, implant, etc."
                value={birthControlUse}
                onChange={(event) => setBirthControlUse(event.target.value)}
              />
            </Field>
            <Field label="Pregnancy tracking preference">
              <NativeSelect
                value={pregnancyTracking}
                onChange={(event) => setPregnancyTracking(event.target.value as UserProfile["pregnancyTracking"])}
              >
                <option value="not-tracking">Not tracking pregnancy</option>
                <option value="avoid">Avoiding pregnancy</option>
                <option value="trying">Trying to conceive</option>
              </NativeSelect>
            </Field>
          </div>

          <div className="mt-5">
            <p className="text-sm font-semibold text-[#20302e]">Tracking needs</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {["PCOS", "endometriosis", "perimenopause", "pain patterns", "mood patterns"].map((need) => (
                  <Button
                    key={need}
                    variant={trackingNeeds.includes(need) ? "default" : "outline"}
                    size="sm"
                    onClick={() => toggleNeed(need)}
                  >
                    {need}
                  </Button>
              ))}
            </div>
          </div>

          <div className="mt-5">
            <p className="text-sm font-semibold text-[#20302e]">Reminder preferences</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {[
                ["periodWindow", "Upcoming period window"],
                ["medication", "Medication reminders"],
                ["symptoms", "Log symptoms reminder"],
                ["latePeriod", "Late period notification"],
              ].map(([key, label]) => (
                <label key={key} className="flex min-h-10 items-center gap-2 rounded-md border border-input px-3 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={reminders[key as keyof typeof reminders]}
                    onChange={(event) => setReminders((current) => ({ ...current, [key]: event.target.checked }))}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          {error && <p className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive">{error}</p>}
          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            <Button onClick={submit}>
              Start tracking
            </Button>
            <Button variant="outline" onClick={onLoadSample}>
              Use test history
            </Button>
          </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Dashboard({
  data,
  stats,
  prediction,
  onAddCycle,
  onDeleteCycle,
}: {
  data: TrackerData;
  stats: ReturnType<typeof calculateCycleStats>;
  prediction: ReturnType<typeof predictNextWindow>;
  onAddCycle: (startDate: string, endDate?: string) => void;
  onDeleteCycle: (cycleId: string) => void;
}) {
  const [startDate, setStartDate] = useState(todayKey);
  const [endDate, setEndDate] = useState("");
  const [error, setError] = useState("");
  const cycles = sortCycles(data.cycles).slice().reverse();

  function submitCycle() {
    if (!startDate) {
      setError("Start date is required.");
      return;
    }
    if (endDate && endDate < startDate) {
      setError("End date cannot be before the start date.");
      return;
    }
    const length = endDate ? diffDays(startDate, endDate) + 1 : 1;
    if (length > 20) {
      setError("Periods longer than 20 days are saved only after you confirm with a care professional.");
      return;
    }
    onAddCycle(startDate, endDate);
    setError("");
    setStartDate(todayKey);
    setEndDate("");
  }

  return (
    <section className="grid gap-5 xl:grid-cols-[1fr_0.9fr]">
      <div className="grid gap-5">
        <EstimatedWindow prediction={prediction} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Metric label="Average cycle" value={stats.averageCycleLength ? `${stats.averageCycleLength} days` : "Need history"} />
          <Metric label="Shortest cycle" value={stats.shortestCycle ? `${stats.shortestCycle} days` : "Need history"} />
          <Metric label="Longest cycle" value={stats.longestCycle ? `${stats.longestCycle} days` : "Need history"} />
          <Metric label="Average period" value={stats.averagePeriodLength ? `${stats.averagePeriodLength} days` : "Need logs"} />
          <Metric label="Variability" value={stats.cycleVariability !== undefined ? `${stats.cycleVariability} days` : "Need history"} />
        </div>
        <Reminders data={data} prediction={prediction} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Cycle history</CardTitle>
        </CardHeader>
        <CardContent>
        <div className="grid gap-3">
          <div className="grid gap-3 rounded-xl border bg-muted/35 p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Period start">
                <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
              </Field>
              <Field label="Period end">
                <Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
              </Field>
            </div>
            {error && <p className="text-sm font-semibold text-destructive">{error}</p>}
            <Button onClick={submitCycle}>
              Add period
            </Button>
          </div>
          {cycles.length === 0 ? (
            <EmptyState title="No cycles yet" body="Add your first period start date to begin estimating future windows." />
          ) : (
            cycles.map((cycle, index) => {
              const nextOlder = cycles[index + 1];
              const cycleLength = nextOlder ? diffDays(nextOlder.startDate, cycle.startDate) : undefined;
              return (
                <div key={cycle.id} className="flex items-center justify-between gap-3 rounded-xl border bg-card p-3">
                  <div>
                    <p className="font-semibold text-foreground">
                      {formatShortDate(cycle.startDate)}
                      {cycle.endDate ? ` - ${formatShortDate(cycle.endDate)}` : " - ongoing"}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {cycle.endDate ? `${diffDays(cycle.startDate, cycle.endDate) + 1} period days` : "Incomplete log"}
                      {cycleLength ? `, ${cycleLength}-day cycle` : ""}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => onDeleteCycle(cycle.id)}>
                    Delete
                  </Button>
                </div>
              );
            })
          )}
        </div>
        </CardContent>
      </Card>
    </section>
  );
}

function EstimatedWindow({ prediction }: { prediction: ReturnType<typeof predictNextWindow> }) {
  return (
    <Card>
      <CardContent className="grid gap-4 p-5 lg:grid-cols-[1.2fr_0.8fr]">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.12em] text-primary">Estimated window</p>
        <h2 className="mt-2 text-2xl font-bold tracking-normal">
          {prediction.nextPeriodWindow
            ? formatDateRange(prediction.nextPeriodWindow.start, prediction.nextPeriodWindow.end)
            : "Add cycle history"}
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{prediction.basis}</p>
      </div>
      <div className="grid gap-2">
        <Metric label="Confidence" value={`${prediction.confidence} (${prediction.confidenceScore}%)`} />
        {prediction.fertileWindow && <Metric label="Fertile estimate" value={formatDateRange(prediction.fertileWindow.start, prediction.fertileWindow.end)} />}
        {prediction.ovulationWindow && <Metric label="Ovulation estimate" value={formatDateRange(prediction.ovulationWindow.start, prediction.ovulationWindow.end)} />}
      </div>
      {prediction.warnings.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 lg:col-span-2">
          <p className="text-sm font-semibold text-amber-900">Prediction notes</p>
          <ul className="mt-2 grid gap-1 text-sm leading-6 text-amber-800">
            {prediction.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
        <p className="mt-2 text-lg font-bold tracking-normal text-foreground">{value}</p>
      </CardContent>
    </Card>
  );
}

function Reminders({ data, prediction }: { data: TrackerData; prediction: ReturnType<typeof predictNextWindow> }) {
  const items: string[] = [];
  const prefs = data.profile?.reminders;

  if (prefs?.periodWindow && prediction.nextPeriodWindow) {
    const daysUntilStart = diffDays(todayKey, prediction.nextPeriodWindow.start);
    if (daysUntilStart >= 0) {
      items.push(`Estimated period window starts in ${daysUntilStart} day${daysUntilStart === 1 ? "" : "s"}.`);
    }
  }
  if (prefs?.latePeriod && prediction.lateByDays) {
    items.push(`Late indicator: estimated window ended ${prediction.lateByDays} day${prediction.lateByDays === 1 ? "" : "s"} ago.`);
  }
  if (prefs?.medication) {
    items.push("Medication reminder is enabled for daily check-ins.");
  }
  if (prefs?.symptoms) {
    items.push("Symptom logging reminder is enabled.");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reminders</CardTitle>
      </CardHeader>
      <CardContent>
      {items.length === 0 ? (
        <EmptyState title="No reminders due" body="Reminder preferences are ready; notices appear here when timing matches your estimates." />
      ) : (
        <div className="grid gap-2">
          {items.map((item) => (
            <p key={item} className="rounded-md border bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
              {item}
            </p>
          ))}
        </div>
      )}
      </CardContent>
    </Card>
  );
}

function CalendarView({
  data,
  prediction,
  onSelectDate,
}: {
  data: TrackerData;
  prediction: ReturnType<typeof predictNextWindow>;
  onSelectDate: (date: string) => void;
}) {
  const [month, setMonth] = useState(startOfMonth(new Date()));
  const monthStart = startOfMonth(month);
  const firstGridDate = new Date(monthStart);
  firstGridDate.setDate(monthStart.getDate() - monthStart.getDay());
  const dates = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(firstGridDate);
    date.setDate(firstGridDate.getDate() + index);
    return toDateKey(date);
  });

  function monthOffset(offset: number) {
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  }

  return (
    <Card>
      <CardContent className="p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-normal">{monthTitle(month)}</h2>
          <p className="mt-1 text-sm text-muted-foreground">Period days, estimate windows, ovulation estimates, and logged symptoms.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => monthOffset(-1)}>
            Previous
          </Button>
          <Button variant="outline" onClick={() => setMonth(startOfMonth(new Date()))}>
            Today
          </Button>
          <Button variant="outline" onClick={() => monthOffset(1)}>
            Next
          </Button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-7 gap-1 text-center text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
          <div key={day} className="py-2">
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {dates.map((date) => {
          const day = parseDate(date).getDate();
          const inMonth = date >= toDateKey(monthStart) && date <= toDateKey(endOfMonth(month));
          const log = data.logs.find((item) => item.date === date);
          const isPeriod = data.cycles.some((cycle) => isBetween(date, cycle.startDate, cycle.endDate ?? cycle.startDate));
          const isPredicted = prediction.nextPeriodWindow && isBetween(date, prediction.nextPeriodWindow.start, prediction.nextPeriodWindow.end);
          const isFertile = prediction.fertileWindow && isBetween(date, prediction.fertileWindow.start, prediction.fertileWindow.end);
          const isOvulation = prediction.ovulationWindow && isBetween(date, prediction.ovulationWindow.start, prediction.ovulationWindow.end);

          return (
            <button
              key={date}
              className={classNames(
                "min-h-24 rounded-md border p-2 text-left transition focus:outline-none focus:ring-2 focus:ring-[#1f6f68]",
                inMonth ? "border-border bg-card" : "border-border/60 bg-muted/40 text-muted-foreground/70",
                date === todayKey && "ring-2 ring-primary",
              )}
              onClick={() => onSelectDate(date)}
              title={`Log ${date}`}
            >
              <span className="text-sm font-bold">{day}</span>
              <span className="mt-2 flex flex-wrap gap-1">
                {isPeriod && <Tag tone="rose">Period</Tag>}
                {isPredicted && <Tag tone="amber">Est.</Tag>}
                {isFertile && <Tag tone="teal">Fertile</Tag>}
                {isOvulation && <Tag tone="blue">Ov.</Tag>}
                {log?.symptoms.slice(0, 2).map((symptom) => (
                  <Tag key={symptom} tone="neutral">
                    {symptom}
                  </Tag>
                ))}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Tag tone="rose">Logged period</Tag>
        <Tag tone="amber">Estimated period window</Tag>
        <Tag tone="teal">Fertile estimate</Tag>
        <Tag tone="blue">Ovulation estimate</Tag>
      </div>
      </CardContent>
    </Card>
  );
}

function Tag({ tone, children }: { tone: "rose" | "amber" | "teal" | "blue" | "neutral"; children: React.ReactNode }) {
  const tones = {
    rose: "border-[#efc0ba] bg-[#fff0ee] text-[#9c3f2f]",
    amber: "border-[#efd5a8] bg-[#fff8e8] text-[#7a5618]",
    teal: "border-[#b7d9d3] bg-[#edf8f6] text-[#1f6f68]",
    blue: "border-[#b8d4e8] bg-[#eef7fd] text-[#275f7d]",
    neutral: "border-[#d7dfda] bg-[#f6f8f6] text-[#526762]",
  };

  return <span className={classNames("rounded-md border px-1.5 py-0.5 text-[11px] font-semibold", tones[tone])}>{children}</span>;
}

type LogDraft = {
  flow: FlowLevel | "";
  symptoms: Symptom[];
  mood: Mood | "";
  painLevel: number;
  medications: string;
  birthControl: string;
  ovulationSigns: OvulationSign[];
  cervicalMucus: CervicalMucus;
  temperature: string;
  sexualActivity: SexualActivity;
  notes: string;
};

function draftFromLog(log: DailyLog | undefined, defaultBirthControl: string): LogDraft {
  return {
    flow: log?.flow ?? "",
    symptoms: log?.symptoms ?? [],
    mood: log?.mood ?? "",
    painLevel: log?.painLevel ?? 0,
    medications: log?.medications ?? "",
    birthControl: log?.birthControl ?? defaultBirthControl,
    ovulationSigns: log?.ovulationSigns ?? [],
    cervicalMucus: log?.cervicalMucus ?? "none",
    temperature: log?.temperature ? String(log.temperature) : "",
    sexualActivity: log?.sexualActivity ?? "none",
    notes: log?.notes ?? "",
  };
}

function DailyLogger({
  data,
  onSave,
  onAddCycle,
}: {
  data: TrackerData;
  onSave: (log: DailyLog) => void;
  onAddCycle: (startDate: string, endDate?: string) => void;
}) {
  const [date, setDate] = useState(todayKey);
  const existing = data.logs.find((log) => log.date === date);
  const defaultBirthControl = data.profile?.birthControlUse ?? "";
  const [draft, setDraft] = useState<LogDraft>(() => draftFromLog(existing, defaultBirthControl));
  const [periodStart, setPeriodStart] = useState(false);
  const [periodEnd, setPeriodEnd] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    queueMicrotask(() => {
      setDraft(draftFromLog(existing, defaultBirthControl));
      setPeriodStart(false);
      setPeriodEnd("");
      setMessage("");
    });
  }, [date, existing, defaultBirthControl]);

  function toggleSymptom(symptom: Symptom) {
    setDraft((current) => ({
      ...current,
      symptoms: current.symptoms.includes(symptom)
        ? current.symptoms.filter((item) => item !== symptom)
        : [...current.symptoms, symptom],
    }));
  }

  function toggleOvulationSign(sign: OvulationSign) {
    setDraft((current) => ({
      ...current,
      ovulationSigns: current.ovulationSigns.includes(sign)
        ? current.ovulationSigns.filter((item) => item !== sign)
        : [...current.ovulationSigns, sign],
    }));
  }

  function save() {
    const parsedTemp = draft.temperature ? Number(draft.temperature) : undefined;
    if (parsedTemp !== undefined && (Number.isNaN(parsedTemp) || parsedTemp < 34 || parsedTemp > 42)) {
      setMessage("Temperature should be between 34 and 42 C.");
      return;
    }
    if (periodStart && periodEnd && periodEnd < date) {
      setMessage("Period end cannot be before the selected date.");
      return;
    }

    onSave({
      id: existing?.id ?? id("log"),
      date,
      flow: draft.flow || undefined,
      symptoms: draft.symptoms,
      mood: draft.mood || undefined,
      painLevel: Math.max(0, Math.min(10, draft.painLevel)),
      medications: draft.medications,
      birthControl: draft.birthControl,
      ovulationSigns: draft.ovulationSigns,
      cervicalMucus: draft.cervicalMucus,
      temperature: parsedTemp,
      sexualActivity: draft.sexualActivity,
      notes: draft.notes,
    });

    if (periodStart) {
      onAddCycle(date, periodEnd || undefined);
    }

    setMessage("Saved.");
  }

  return (
    <section className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">One-tap daily log</CardTitle>
          <CardDescription className="leading-6">Capture as much or as little as you want today.</CardDescription>
        </CardHeader>
        <CardContent>
        <div className="grid gap-4">
          <Field label="Date">
            <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </Field>
          <Field label="Flow intensity">
            <Segmented options={FLOW_LEVELS} value={draft.flow} onChange={(value) => setDraft((current) => ({ ...current, flow: value as FlowLevel }))} />
          </Field>
          <Field label={`Pain level: ${draft.painLevel}`}>
            <input
              className="w-full accent-primary"
              type="range"
              min={0}
              max={10}
              value={draft.painLevel}
              onChange={(event) => setDraft((current) => ({ ...current, painLevel: Number(event.target.value) }))}
            />
          </Field>
          <Field label="Mood">
            <Segmented options={MOODS} value={draft.mood} onChange={(value) => setDraft((current) => ({ ...current, mood: value as Mood }))} />
          </Field>
        </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
        <div className="grid gap-4">
          <ChoiceGroup title="Symptoms" options={SYMPTOMS} selected={draft.symptoms} onToggle={toggleSymptom} />
          <ChoiceGroup title="Ovulation signs" options={OVULATION_SIGNS} selected={draft.ovulationSigns} onToggle={toggleOvulationSign} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Medications">
              <Input value={draft.medications} onChange={(event) => setDraft((current) => ({ ...current, medications: event.target.value }))} />
            </Field>
            <Field label="Birth control">
              <Input value={draft.birthControl} onChange={(event) => setDraft((current) => ({ ...current, birthControl: event.target.value }))} />
            </Field>
            <Field label="Cervical mucus">
              <NativeSelect
                value={draft.cervicalMucus}
                onChange={(event) => setDraft((current) => ({ ...current, cervicalMucus: event.target.value as CervicalMucus }))}
              >
                {["none", "dry", "sticky", "creamy", "watery", "egg-white"].map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Temperature (C)">
              <Input inputMode="decimal" value={draft.temperature} onChange={(event) => setDraft((current) => ({ ...current, temperature: event.target.value }))} />
            </Field>
            <Field label="Sexual activity">
              <NativeSelect
                value={draft.sexualActivity}
                onChange={(event) => setDraft((current) => ({ ...current, sexualActivity: event.target.value as SexualActivity }))}
              >
                <option value="none">none</option>
                <option value="protected">protected</option>
                <option value="unprotected">unprotected</option>
                <option value="other">other</option>
              </NativeSelect>
            </Field>
            <Field label="Period marker">
              <label className="flex min-h-10 items-center gap-2 rounded-md border border-input px-3 text-sm text-muted-foreground">
                <input type="checkbox" checked={periodStart} onChange={(event) => setPeriodStart(event.target.checked)} />
                This date is a period start
              </label>
            </Field>
            {periodStart && (
              <Field label="Period end date">
                <Input type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} />
              </Field>
            )}
          </div>
          <Field label="Notes">
            <Textarea
              className="min-h-28 resize-y"
              value={draft.notes}
              onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
            />
          </Field>
          {message && <p className="text-sm font-semibold text-primary">{message}</p>}
          <Button onClick={save}>
            Save daily log
          </Button>
        </div>
        </CardContent>
      </Card>
    </section>
  );
}

function Segmented<T extends readonly string[]>({
  options,
  value,
  onChange,
}: {
  options: T;
  value: string;
  onChange: (value: T[number]) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {options.map((option) => (
        <Button
          key={option}
          variant={value === option ? "default" : "outline"}
          className="min-h-10 capitalize"
          onClick={() => onChange(option)}
        >
          {option}
        </Button>
      ))}
    </div>
  );
}

function ChoiceGroup<T extends string>({
  title,
  options,
  selected,
  onToggle,
}: {
  title: string;
  options: readonly T[];
  selected: T[];
  onToggle: (value: T) => void;
}) {
  return (
    <div>
      <p className="text-sm font-semibold text-[#20302e]">{title}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((option) => (
          <Button
            key={option}
            variant={selected.includes(option) ? "default" : "outline"}
            size="sm"
            className="capitalize"
            onClick={() => onToggle(option)}
          >
            {option}
          </Button>
        ))}
      </div>
    </div>
  );
}

function Insights({
  data,
  stats,
  prediction,
}: {
  data: TrackerData;
  stats: ReturnType<typeof calculateCycleStats>;
  prediction: ReturnType<typeof predictNextWindow>;
}) {
  const symptomCounts = countValues(data.logs.flatMap((log) => log.symptoms));
  const moodCounts = countValues(data.logs.flatMap((log) => (log.mood ? [log.mood] : [])));
  const flowCounts = countValues(data.logs.flatMap((log) => (log.flow ? [log.flow] : [])));
  const painAverage = averageNumber(data.logs.map((log) => log.painLevel));
  const consultReasons = [
    stats.cycleVariability && stats.cycleVariability >= 10 ? "Cycle variability is high compared with your logged history." : "",
    stats.shortestCycle && stats.shortestCycle < 21 ? "One or more cycles are shorter than 21 days." : "",
    stats.longestCycle && stats.longestCycle > 45 ? "One or more cycles are longer than 45 days." : "",
    painAverage >= 7 ? "Average pain is high across logged days." : "",
    prediction.lateByDays && prediction.lateByDays >= 7 ? "Your period is at least 7 days beyond the estimated window." : "",
    ...stats.unusualChanges,
  ].filter(Boolean);

  return (
    <section className="grid gap-5 lg:grid-cols-2">
      <TrendPanel title="Symptom trends" values={symptomCounts} empty="Log symptoms to see trends." />
      <TrendPanel title="Mood patterns" values={moodCounts} empty="Log moods to compare changes over time." />
      <TrendPanel title="Flow changes" values={flowCounts} empty="Add period-day flow levels to see changes." />
      <Card>
        <CardHeader>
          <CardTitle>Cycle regularity</CardTitle>
        </CardHeader>
        <CardContent>
        <div className="grid gap-3">
          <Metric label="Completed intervals" value={`${stats.completedCycleCount}`} />
          <Metric label="Current confidence" value={`${prediction.confidence} (${prediction.confidenceScore}%)`} />
          <Metric label="Average pain" value={painAverage ? `${painAverage.toFixed(1)} / 10` : "Need logs"} />
        </div>
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Care prompts</CardTitle>
        </CardHeader>
        <CardContent>
        {consultReasons.length === 0 ? (
          <EmptyState
            title="No unusual pattern flagged"
            body="This does not rule out health concerns. Trust your body and seek care when symptoms feel new, severe, or worrying."
          />
        ) : (
          <div className="grid gap-2">
            {consultReasons.map((reason) => (
              <p key={reason} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-900">
                {reason}
              </p>
            ))}
          </div>
        )}
        </CardContent>
      </Card>
    </section>
  );
}

function countValues(values: string[]) {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function averageNumber(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function TrendPanel({ title, values, empty }: { title: string; values: Record<string, number>; empty: string }) {
  const entries = Object.entries(values).sort((a, b) => b[1] - a[1]);
  const max = entries[0]?.[1] ?? 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
      {entries.length === 0 ? (
        <EmptyState title="No trend yet" body={empty} />
      ) : (
        <div className="grid gap-3">
          {entries.map(([label, value]) => (
            <div key={label}>
              <div className="flex justify-between gap-3 text-sm">
                <span className="font-semibold capitalize text-foreground">{label}</span>
                <span className="text-muted-foreground">{value}</span>
              </div>
              <Progress className="mt-1" value={Math.max(10, (value / max) * 100)} />
            </div>
          ))}
        </div>
      )}
      </CardContent>
    </Card>
  );
}

function PrivacyCenter({
  data,
  onUpdate,
  onDeleteAll,
  onLock,
}: {
  data: TrackerData;
  onUpdate: (data: TrackerData) => void;
  onDeleteAll: () => void;
  onLock: () => void;
}) {
  const [passcode, setPasscode] = useState("");
  const [syncPassphrase, setSyncPassphrase] = useState("");
  const [backupPackage, setBackupPackage] = useState("");
  const [importPackage, setImportPackage] = useState("");
  const [message, setMessage] = useState("");

  async function enablePasscode() {
    if (passcode.length < 6) {
      setMessage("Use at least 6 characters for the passcode.");
      return;
    }
    const passcodeHash = await sha256(passcode);
    onUpdate({
      ...data,
      profile: data.profile
        ? {
            ...data.profile,
            privacy: {
              ...data.profile.privacy,
              passcodeEnabled: true,
              passcodeHash,
            },
          }
        : data.profile,
    });
    setPasscode("");
    setMessage("Passcode lock enabled.");
  }

  function disablePasscode() {
    onUpdate({
      ...data,
      profile: data.profile
        ? {
            ...data.profile,
            privacy: {
              passcodeEnabled: false,
              biometricEnabled: false,
            },
          }
        : data.profile,
    });
    setMessage("Passcode lock disabled.");
  }

  async function registerBiometric() {
    if (!window.PublicKeyCredential || !data.profile?.privacy.passcodeEnabled) {
      setMessage("Device unlock requires WebAuthn support and an enabled passcode.");
      return;
    }

    try {
      const credential = await navigator.credentials.create({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rp: { name: "Luna Arc" },
          user: {
            id: crypto.getRandomValues(new Uint8Array(16)),
            name: "local-user",
            displayName: "Local tracker user",
          },
          pubKeyCredParams: [{ type: "public-key", alg: -7 }],
          authenticatorSelection: { userVerification: "preferred" },
          timeout: 60000,
        },
      });
      const credentialId = credential?.id;
      if (!credentialId) throw new Error("No credential returned");
      onUpdate({
        ...data,
        profile: data.profile
          ? {
              ...data.profile,
              privacy: {
                ...data.profile.privacy,
                biometricEnabled: true,
                biometricCredentialId: credentialId,
              },
            }
          : data.profile,
      });
      setMessage("Device unlock registered.");
    } catch {
      setMessage("Device unlock registration was canceled or unavailable.");
    }
  }

  async function exportPlainJson() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `luna-arc-export-${todayKey}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage("Data export created.");
  }

  async function createEncryptedBackup() {
    if (syncPassphrase.length < 8) {
      setMessage("Use an encryption passphrase with at least 8 characters.");
      return;
    }
    const encrypted = await encryptData(data, syncPassphrase);
    setBackupPackage(encrypted);
    onUpdate({
      ...data,
      cloudSync: {
        enabled: true,
        providerLabel: "Encrypted vault package",
        lastEncryptedBackupAt: new Date().toISOString(),
      },
    });
    setMessage("Encrypted sync package created.");
  }

  async function importEncryptedBackup() {
    if (!syncPassphrase || !importPackage) {
      setMessage("Provide both the encrypted package and passphrase.");
      return;
    }
    try {
      const decrypted = await decryptData(importPackage, syncPassphrase);
      onUpdate(decrypted);
      setMessage("Encrypted package imported.");
    } catch {
      setMessage("Import failed. Check the passphrase and package text.");
    }
  }

  return (
    <section className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Device privacy</CardTitle>
          <CardDescription className="leading-6">Data is stored in this browser by default and is never sold or shared by this app.</CardDescription>
        </CardHeader>
        <CardContent>
        <div className="mt-4 grid gap-3">
          <Field label="Passcode">
            <Input
              type="password"
              value={passcode}
              onChange={(event) => setPasscode(event.target.value)}
              placeholder="At least 6 characters"
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button onClick={enablePasscode}>
              Enable passcode
            </Button>
            <Button variant="outline" onClick={disablePasscode}>
              Disable lock
            </Button>
            {data.profile?.privacy.passcodeEnabled && (
              <Button variant="outline" onClick={onLock}>
                Lock now
              </Button>
            )}
          </div>
          <Button variant="secondary" onClick={registerBiometric}>
            Register device unlock
          </Button>
        </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Export and deletion</CardTitle>
          <CardDescription className="leading-6">Export readable JSON for your own records or remove all local data.</CardDescription>
        </CardHeader>
        <CardContent>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="outline" onClick={exportPlainJson}>
            Export data
          </Button>
          <Button variant="destructive" onClick={onDeleteAll}>
            Delete all data
          </Button>
        </div>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Optional encrypted sync</CardTitle>
          <CardDescription className="leading-6">
            This creates an encrypted package suitable for a cloud vault. The app cannot read it without your passphrase.
          </CardDescription>
        </CardHeader>
        <CardContent>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="grid gap-3">
            <Field label="Encryption passphrase">
              <Input type="password" value={syncPassphrase} onChange={(event) => setSyncPassphrase(event.target.value)} />
            </Field>
            <Button onClick={createEncryptedBackup}>
              Create encrypted package
            </Button>
            {backupPackage && (
              <Textarea className="min-h-36 font-mono text-xs" readOnly value={backupPackage} aria-label="Encrypted backup package" />
            )}
          </div>
          <div className="grid gap-3">
            <Field label="Import encrypted package">
              <Textarea
                className="min-h-36 font-mono text-xs"
                value={importPackage}
                onChange={(event) => setImportPackage(event.target.value)}
              />
            </Field>
            <Button variant="outline" onClick={importEncryptedBackup}>
              Import encrypted package
            </Button>
          </div>
        </div>
        </CardContent>
      </Card>
      {message && <p className="rounded-md border bg-primary/10 px-3 py-2 text-sm font-semibold text-primary lg:col-span-2">{message}</p>}
    </section>
  );
}

function LockScreen({ profile, onUnlock }: { profile: UserProfile; onUnlock: () => void }) {
  const [passcode, setPasscode] = useState("");
  const [message, setMessage] = useState("");

  async function unlockWithPasscode() {
    const hash = await sha256(passcode);
    if (hash === profile.privacy.passcodeHash) {
      onUnlock();
      return;
    }
    setMessage("Passcode did not match.");
  }

  async function unlockWithDevice() {
    if (!window.PublicKeyCredential || !profile.privacy.biometricCredentialId) {
      setMessage("Device unlock is not registered.");
      return;
    }

    try {
      await navigator.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          userVerification: "preferred",
          timeout: 60000,
        },
      });
      onUnlock();
    } catch {
      setMessage("Device unlock was canceled or unavailable.");
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-background px-4 text-foreground">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Tracker locked</CardTitle>
          <CardDescription className="leading-6">Unlock to view local health data.</CardDescription>
        </CardHeader>
        <CardContent>
        <div className="grid gap-3">
          <Input type="password" value={passcode} onChange={(event) => setPasscode(event.target.value)} placeholder="Passcode" />
          <Button onClick={unlockWithPasscode}>
            Unlock
          </Button>
          {profile.privacy.biometricEnabled && (
            <Button variant="outline" onClick={unlockWithDevice}>
              Use device unlock
            </Button>
          )}
          {message && <p className="text-sm font-semibold text-destructive">{message}</p>}
        </div>
        </CardContent>
      </Card>
    </main>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-3 rounded-xl border border-dashed bg-muted/35 p-4">
      <p className="font-semibold text-foreground">{title}</p>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">{body}</p>
    </div>
  );
}
