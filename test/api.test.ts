import { describe, expect, it } from "vitest";
import { APIError, choice, noul, score, typesafe } from "../src/api.ts";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

describe("typesafe api", () => {
  it("posts questions and returns typed answers", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const client = typesafe({
      apiKey: "k",
      baseURL: "https://example.test/",
      fetch: async (url, init) => {
        calls.push({ url: String(url), init: init! });
        return json({
          model: "jev-latest",
          answers: {
            billing: { type: "noul", noul: 0.9 },
            tone: {
              type: "choice",
              choice: "calm",
              confidence: 0.8,
              probabilities: { calm: 0.8, angry: 0.2 },
            },
            urgency: {
              type: "score",
              score: 1.5,
              confidence: 0.7,
              legend: { 0: "low", 1: "high" },
              probabilities: { 0: 0.5, 1: 0.5 },
            },
          },
          usage: { input_tokens: 1, output_tokens: 2 },
        });
      },
    });

    const { answers } = await client.systemOne({
      state: "I was charged twice",
      questions: {
        billing: noul("Is this about billing?"),
        tone: choice("Tone?", { calm: null, angry: null }),
        urgency: score("Urgency?", ["low", "high"]),
      },
    });

    expect(answers.billing.noul).toBe(0.9);
    expect(answers.tone.choice).toBe("calm");
    expect(answers.urgency.legend[1]).toBe("high");

    const { url, init } = calls[0]!;
    expect(url).toBe("https://example.test/v1/systemone");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer k");
    expect(JSON.parse(init.body as string).model).toBe("jev-latest");
  });

  it("lists models", async () => {
    const client = typesafe({
      apiKey: "k",
      fetch: async () => json({ models: [{ name: "jev-latest" }] }),
    });
    expect(await client.models()).toEqual([{ name: "jev-latest" }]);
  });

  it("throws APIError on non-2xx", async () => {
    const client = typesafe({
      apiKey: "k",
      fetch: async () =>
        json({ error: { message: "bad key" } }, 401, { "x-typesafe-request-id": "req_1" }),
    });
    const err = await client.systemOne({ state: null, questions: { q: noul() } }).catch((e) => e);
    expect(err).toBeInstanceOf(APIError);
    expect(err.status).toBe(401);
    expect(err.requestId).toBe("req_1");
    expect(err.message).toBe("401 bad key");
  });

  it("reads TYPESAFE_* env variables when options are omitted", async () => {
    const g = globalThis as { process?: { env?: Record<string, string | undefined> } };
    const saved = g.process;
    g.process = {
      env: {
        TYPESAFE_API_KEY: " env-key ",
        TYPESAFE_BASE_URL: "https://env.test",
        TYPESAFE_DEFAULT_MODEL: "env-model",
      },
    };
    try {
      let seen: { url: string; init: RequestInit } | undefined;
      const client = typesafe({
        fetch: async (url, init) => {
          seen = { url: String(url), init: init! };
          return json({ model: "m", answers: {}, usage: { input_tokens: 0, output_tokens: 0 } });
        },
      });
      await client.systemOne({ state: null, questions: { q: noul() } });
      expect(seen!.url).toBe("https://env.test/v1/systemone");
      expect((seen!.init.headers as Record<string, string>).Authorization).toBe("Bearer env-key");
      expect(JSON.parse(seen!.init.body as string).model).toBe("env-model");

      g.process = { env: { TYPESAFE_API_KEY: "  " } };
      expect(() => typesafe()).toThrow(/TYPESAFE_API_KEY/);
    } finally {
      g.process = saved;
    }
  });

  it("validates questions before sending", () => {
    const client = typesafe({ apiKey: "k", fetch: () => Promise.reject(new Error("no")) });
    expect(() => client.systemOne({ state: null, questions: {} })).toThrow(/at least one/i);
    expect(() =>
      client.systemOne({
        state: null,
        questions: { s: { type: "score", criteria: ["one"] as never } },
      }),
    ).toThrow(/2 to 10 levels/);
    expect(() =>
      client.systemOne({
        state: null,
        questions: { c: { type: "choice", criteria: { a: null } } },
      }),
    ).toThrow(/2 to 255 options/);
  });
});
