import { describe, expect, it } from "vitest";
import { buildLocalGoalPlan, createPracticeRounds, nextRoundIndex } from "@/lib/goals";
import type { TrainingGoal } from "@/lib/types";

describe("goal planning", () => {
  it("creates the three progressive rounds", () => {
    expect(createPracticeRounds().map((round) => round.mode)).toEqual(["full", "cues", "hidden"]);
  });

  it("builds an English local plan when AI is unavailable", () => {
    const plan = buildLocalGoalPlan({
      scenarioKind: "investor-pitch", language: "en-US", audience: "Seed investors",
      desiredOutcome: "Book a follow-up meeting", humorLevel: "light",
    });
    expect(plan.script).toContain("AI product");
    expect(plan.audiencePersona).toBe("Seed investors");
    expect(plan.milestones.join(" ")).toContain("humor");
  });

  it("selects the first unfinished round", () => {
    const now = new Date().toISOString();
    const goal = {
      id: "goal", title: "Test", scenarioKind: "live-speaking", targetDate: "",
      audience: "Audience", desiredOutcome: "Clear close", durationSeconds: 180,
      language: "zh-CN", humorLevel: "light", successCriteria: [], knowledgeDocumentIds: [],
      humorMaterialIds: [], plan: buildLocalGoalPlan({ scenarioKind: "live-speaking", language: "zh-CN", audience: "Audience", desiredOutcome: "Clear close", humorLevel: "light" }),
      rounds: createPracticeRounds(), createdAt: now, updatedAt: now,
    } satisfies TrainingGoal;
    goal.rounds[0].status = "completed";
    expect(nextRoundIndex(goal)).toBe(2);
  });
});
