import { describe, expect, expectTypeOf, it } from "vitest";
import { ask, askSwitch, chance, choice, score } from "../src/index.ts";

// With TYPESAFE_API_KEY set, requests go to the real API and only answer shapes are checked.
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
const live = Boolean(env?.TYPESAFE_API_KEY);

const mock = {
  security: { type: "noul", noul: 0.9 },
  kind: { type: "choice", choice: "bug", confidence: 0.8, probabilities: { bug: 0.8, other: 0.2 } },
  noul: { type: "noul", noul: 0.9 },
  choice: {
    type: "choice",
    choice: "bug",
    confidence: 0.8,
    probabilities: { bug: 0.8, other: 0.2 },
  },
  score: { type: "score", score: 1.5, confidence: 0.7, legend: {}, probabilities: {} },
  severity: {
    type: "score",
    score: 1.5,
    confidence: 0.7,
    legend: { 0: "Cosmetic", 1: "Workaround exists", 2: "Blocks production" },
    probabilities: { 0: 0, 1: 0.5, 2: 0.5 },
  },
};

let seen: { url: string; body: any };
const fetch: typeof globalThis.fetch = async (url, init) => {
  seen = { url: String(url), body: JSON.parse(init!.body as string) };
  if (live) return globalThis.fetch(url, init);
  // The API answers only the questions it was asked, by name or else by type.
  const answers = Object.fromEntries(
    Object.entries(seen.body.questions).map(([name, q]) => [
      name,
      mock[name as keyof typeof mock] ?? mock[(q as { type: keyof typeof mock }).type],
    ]),
  );
  return Response.json({ model: "m", answers, usage: { input_tokens: 0, output_tokens: 0 } });
};
const options = live ? { fetch } : { apiKey: "k", fetch };

describe("ask", () => {
  it("sends one batch and returns typed answers", async () => {
    const level = "issue";
    const result = await ask(
      { title: "Crash on login", body: "Anyone can log in as admin with an empty password." },
      {
        security: "Does this describe a security vulnerability?",
        kind: ask.choice`What kind of ${level} is this?`({
          bug: "Something is broken",
          other: null,
        }),
        severity: ask.score`How severe?`(["Cosmetic", "Workaround exists", "Blocks production"]),
      },
      options,
    );

    expect(seen.body.state).toEqual({
      title: "Crash on login",
      body: "Anyone can log in as admin with an empty password.",
    });
    expect(seen.body.questions).toEqual({
      security: { type: "noul", instructions: "Does this describe a security vulnerability?" },
      kind: {
        type: "choice",
        instructions: "What kind of issue is this?",
        criteria: { bug: "Something is broken", other: null },
      },
      severity: {
        type: "score",
        instructions: "How severe?",
        criteria: ["Cosmetic", "Workaround exists", "Blocks production"],
      },
    });

    expect(result.security.type).toBe("chance");
    expect(result.security.chance).toBeGreaterThan(0.5);
    expect(result.kind.choice).toBe("bug");
    expect(result.severity.ratio).toBe(result.severity.score / 2);
    expect(result.severity.legend[2]).toBe("Blocks production");
    if (!live) {
      expect(result.security.chance).toBe(0.9);
      expect(result.severity.score).toBe(1.5);
    }

    expectTypeOf(result.kind.choice).toEqualTypeOf<"bug" | "other">();
    expectTypeOf(result.severity.legend[1]).toEqualTypeOf<"Workaround exists">();
    expectTypeOf(result.security.chance).toEqualTypeOf<number>();
  }, 20_000);

  it("accepts plain question objects and tags with criteria", async () => {
    const result = await ask(
      "The login page lets anyone in with an empty password.",
      {
        security: chance`Is this a security issue?`({
          true: "Exploitable",
          false: "Not exploitable",
        }),
        kind: { type: "choice", instructions: "What kind?", criteria: { bug: null, other: null } },
        severity: { type: "score", instructions: "Severity?", criteria: ["low", "mid", "high"] },
      },
      options,
    );
    expect(seen.body.questions.security.criteria).toEqual({
      true: "Exploitable",
      false: "Not exploitable",
    });
    expectTypeOf(result.kind.choice).toEqualTypeOf<"bug" | "other">();
    expect(["bug", "other"]).toContain(result.kind.choice);
    expect(result.severity.ratio).toBeGreaterThanOrEqual(0);
    expect(result.severity.ratio).toBeLessThanOrEqual(1);
  }, 20_000);

  it("tags are plain builders", () => {
    expect(choice`Kind?`({ a: null })).toEqual({
      type: "choice",
      instructions: "Kind?",
      criteria: { a: null },
    });
    expect(score`Level?`(["low", "high"])).toEqual({
      type: "score",
      instructions: "Level?",
      criteria: ["low", "high"],
    });
    expect(chance`Yes?`()).toEqual({ type: "noul", instructions: "Yes?", criteria: undefined });
    // `then` stays hidden so the object serializes as a plain question.
    expect(Object.keys(choice`Kind?`({ a: null }))).toEqual(["type", "instructions", "criteria"]);
  });

  it("tags also accept a plain string", () => {
    expect(choice("Kind?", { a: null })).toEqual(choice`Kind?`({ a: null }));
    expect(score("Level?", ["low", "high"])).toEqual(score`Level?`(["low", "high"]));
    expect(chance("Yes?")).toEqual(chance`Yes?`());
    expect(chance("Yes?", { true: "y" })).toEqual(chance`Yes?`({ true: "y" }));
  });

  it("plain calls accept structured instructions", () => {
    const instructions = { question: "Kind?", focus: "title" };
    expect(choice(instructions, { a: null })).toEqual({
      type: "choice",
      instructions,
      criteria: { a: null },
    });
    expect(score(["Level?", "ignore code"], ["low", "high"]).instructions).toEqual([
      "Level?",
      "ignore code",
    ]);
    expect(chance(null).instructions).toBeNull();
    expectTypeOf(choice("Kind?", { a: null, b: null }).criteria).toEqualTypeOf<{
      readonly a: null;
      readonly b: null;
    }>();
  });

  it("ask.if sends one yes/no question about the interpolated state", async () => {
    const issue = { title: "Checkout is down", body: "No one can pay." };
    const result = await ask.if(options)`Does ${issue} affect ${"checkout"} within ${24} hours?`;

    expect(seen.body.state).toEqual({ input: issue });
    expect(seen.body.questions).toEqual({
      input: { type: "noul", instructions: "Does `input` affect checkout within 24 hours?" },
    });
    expect(result).toBe(true);
    expectTypeOf(result).toEqualTypeOf<boolean>();
  }, 20_000);

  it.skipIf(live)("ask.if compares the chance with the threshold", async () => {
    expect(await ask.if(options)`Is ${{ a: 1 }} true?`).toBe(true);
    expect(await ask.if({ ...options, threshold: 0.95 })`Is ${{ a: 1 }} true?`).toBe(false);

    const low: typeof globalThis.fetch = async () =>
      Response.json({
        model: "m",
        answers: { input: { type: "noul", noul: 0.1 } },
        usage: { input_tokens: 0, output_tokens: 0 },
      });
    expect(await ask.if({ apiKey: "k", fetch: low })`Is ${{ a: 1 }} true?`).toBe(false);
  });

  it.skipIf(live)("ask.if takes an array as the state", async () => {
    const messages = ["hi", "help me"];
    await ask.if(options)`Does ${messages} ask for help?`;
    expect(seen.body.state).toEqual({ input: messages });
    expect(seen.body.questions.input.instructions).toBe("Does `input` ask for help?");
  });

  it.skipIf(live)("ask.if sends several objects as one input array", async () => {
    const issue = { title: "Checkout is down" };
    const policy = ["Outages are P1"];
    await ask.if(options)`Is ${issue} a ${"P1"} under ${policy}?`;
    expect(seen.body.state).toEqual({ input: [issue, policy] });
    expect(seen.body.questions.input.instructions).toBe("Is `input[0]` a P1 under `input[1]`?");
  });

  it("ask.if sends a plain question with an empty state", async () => {
    const message = "URGENT: your account is locked, click here to verify";
    const result = await ask.if(options)`Is the message "${message}" likely phishing?`;
    expect(seen.body.state).toBe("");
    expect(seen.body.questions.input.instructions).toBe(
      `Is the message "${message}" likely phishing?`,
    );
    expect(result).toBe(true);
  }, 20_000);

  it.skipIf(live)("ask.if inside ask resolves to a boolean", async () => {
    const result = await ask(
      { title: "Crash on login" },
      {
        security: ask.if`Is this a security issue?`,
        q: ask.if({ threshold: 0.95 })`Is it urgent?`,
      },
      options,
    );
    expect(seen.body.state).toEqual({ title: "Crash on login" });
    expect(seen.body.questions).toEqual({
      security: { type: "noul", instructions: "Is this a security issue?" },
      q: { type: "noul", instructions: "Is it urgent?" },
    });
    expect(result).toEqual({ security: true, q: false });
    expectTypeOf(result.security).toEqualTypeOf<boolean>();
  });

  it("ask.switch resolves to the selected label", async () => {
    const issue = { title: "Checkout is down", body: "No one can pay." };
    const kind = await ask.switch`What kind of issue is ${issue}?`(
      { bug: "Something is broken", other: null },
      options,
    );

    expect(seen.body.state).toEqual({ input: issue });
    expect(seen.body.questions).toEqual({
      input: {
        type: "choice",
        instructions: "What kind of issue is `input`?",
        criteria: { bug: "Something is broken", other: null },
      },
    });
    expect(kind).toBe("bug");
    expectTypeOf(kind).toEqualTypeOf<"bug" | "other">();
  }, 20_000);

  it.skipIf(live)("ask.switch inside ask resolves to the label", async () => {
    const result = await ask(
      { title: "Crash on login" },
      {
        kind: ask.switch`What kind of issue is this?`({ bug: null, other: null }),
        plain: askSwitch("Kind?", { bug: null, other: null }),
      },
      options,
    );
    expect(seen.body.questions).toEqual({
      kind: {
        type: "choice",
        instructions: "What kind of issue is this?",
        criteria: { bug: null, other: null },
      },
      plain: { type: "choice", instructions: "Kind?", criteria: { bug: null, other: null } },
    });
    expect(result).toEqual({ kind: "bug", plain: "bug" });
    expectTypeOf(result.kind).toEqualTypeOf<"bug" | "other">();
    expectTypeOf(result.plain).toEqualTypeOf<"bug" | "other">();

    expect(ask.switch`Kind?`({ a: null })).toEqual({
      type: "switch",
      instructions: "Kind?",
      criteria: { a: null },
    });

    const literal = await ask(
      { title: "Crash on login" },
      {
        kind: { type: "switch", instructions: "Kind?", criteria: { bug: null, other: null } },
        urgent: { type: "if", instructions: "Urgent?", threshold: 0.95 },
      },
      options,
    );
    expect(literal).toEqual({ kind: "bug", urgent: false });
    expectTypeOf(literal.kind).toEqualTypeOf<"bug" | "other">();
  });

  it.skipIf(live)(
    "tags inside ask send their interpolated objects once each as input",
    async () => {
      const issue = { title: "Crash on login" };
      const other = { title: "Login is slow" };
      const { bug, dupe } = await ask(
        { repo: "a/b" },
        { bug: ask.if`Is ${issue} a bug?`, dupe: ask.if`Is ${issue} a duplicate of ${other}?` },
        options,
      );
      expect(seen.body.state).toEqual({ repo: "a/b", input: [issue, other] });
      expect(seen.body.questions).toEqual({
        bug: { type: "noul", instructions: "Is `input[0]` a bug?" },
        dupe: { type: "noul", instructions: "Is `input[0]` a duplicate of `input[1]`?" },
      });
      expect(bug).toBe(true);
      expect(dupe).toBe(true);

      await ask(null, { bug: ask.if`Is ${issue} a bug?` }, options);
      expect(seen.body.state).toEqual({ input: issue });
      expect(seen.body.questions.bug.instructions).toBe("Is `input` a bug?");

      await ask("Triage", { urgent: "Is this urgent?", bug: ask.if`Is ${issue} a bug?` }, options);
      expect(seen.body.state).toEqual({ input: ["Triage", issue] });
      expect(seen.body.questions.bug.instructions).toBe("Is `input[1]` a bug?");

      await ask([other], { bug: ask.if`Is ${issue} a bug?` }, options);
      expect(seen.body.state).toEqual({ input: [[other], issue] });

      const messages = [other];
      await ask(messages, { bug: ask.if`Does ${messages} report a bug?` }, options);
      expect(seen.body.state).toEqual({ input: messages });
      expect(seen.body.questions.bug.instructions).toBe("Does `input` report a bug?");

      await ask(
        "",
        { a: ask.if`Is ${issue} a bug?`, b: ask.score`Severity of ${issue}?`(["low", "high"]) },
        options,
      );
      expect(seen.body.state).toEqual({ input: issue });
      expect(seen.body.questions.b.instructions).toBe("Severity of `input`?");

      await expect(ask({ input: 1 }, { bug: ask.if`Is ${issue} a bug?` }, options)).rejects.toThrow(
        /already has "input"/,
      );
    },
  );

  it.skipIf(live)("tags send on their own when awaited", async () => {
    const issue = { title: "Crash on login" };
    const kind = await ask.choice`What kind of issue is ${issue}?`(
      { bug: null, other: null },
      options,
    );
    expect(seen.body.state).toEqual({ input: issue });
    expect(seen.body.questions).toEqual({
      input: {
        type: "choice",
        instructions: "What kind of issue is `input`?",
        criteria: { bug: null, other: null },
      },
    });
    expect(kind.choice).toBe("bug");
    expectTypeOf(kind.choice).toEqualTypeOf<"bug" | "other">();

    const severity = await ask.score("How severe?", ["low", "mid", "high"], options);
    expect(seen.body.state).toBe("");
    expect(severity.ratio).toBe(0.75);

    const security = await ask.chance`Is ${issue} a security issue?`(undefined, options);
    expect(seen.body.state).toEqual({ input: issue });
    expect(security.chance).toBe(0.9);
    expectTypeOf(security.chance).toEqualTypeOf<number>();
  });

  it.skipIf(live)("a tag keeps its interpolated objects when reused", async () => {
    const issue = { title: "Crash on login" };
    const kind = ask.choice`Kind of ${issue}, again ${issue}?`({ bug: null, other: null }, options);
    await ask("Triage", { kind, same: kind }, options);
    expect(seen.body.state).toEqual({ input: ["Triage", issue] });
    expect(seen.body.questions.kind.instructions).toBe("Kind of `input[1]`, again `input[1]`?");
    expect(seen.body.questions.same.instructions).toBe("Kind of `input[1]`, again `input[1]`?");
    expect(kind.instructions).toBe("Kind of `input`, again `input`?");
    expect((await kind).choice).toBe("bug");
    expect(seen.body.state).toEqual({ input: issue });
    expect(seen.body.questions.input.instructions).toBe("Kind of `input`, again `input`?");
  });

  it("validates limits before sending", async () => {
    const opts = { apiKey: "k", fetch: () => Promise.reject(new Error("no")) };
    await expect(ask(null, { c: choice`c`({ only: null }) }, opts)).rejects.toThrow(/2 to 255/);
    await expect(
      ask(
        null,
        { s: { type: "score", criteria: Array.from({ length: 11 }, () => null) as never } },
        opts,
      ),
    ).rejects.toThrow(/2 to 10/);
  });
});
