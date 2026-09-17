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

  it("routes through AI Gateway when only AI_GATEWAY_API_KEY is set", async () => {
    const g = globalThis as { process?: { env?: Record<string, string | undefined> } };
    const saved = g.process;
    g.process = { env: { AI_GATEWAY_API_KEY: "gw-key", TYPESAFE_DEFAULT_MODEL: "ignored" } };
    try {
      let seen: { url: string; init: RequestInit } | undefined;
      const client = typesafe({
        fetch: async (url, init) => {
          seen = { url: String(url), init: init! };
          return json({
            answers: {
              billing: { type: "boolean", probability: 0.9 },
              tone: { type: "choice", choice: "calm", probabilities: { calm: 0.8, angry: 0.2 } },
              urgency: { type: "score", score: 1.5, probabilities: { 0: 0.5, 1: 0.5 } },
              bare: { type: "choice", choice: "a" },
            },
            usage: { inputTokens: 1, outputTokens: 2 },
          });
        },
      });
      const result = await client.systemOne({
        state: null,
        questions: {
          billing: noul(),
          tone: choice("Tone?", { calm: null, angry: null }),
          urgency: score("Urgency?", ["low", "high"]),
          bare: choice("Bare?", { a: null, b: null }),
        },
      });
      expect(result).toEqual({
        model: "typesafe-ai/jev",
        answers: {
          billing: { type: "noul", noul: 0.9 },
          tone: {
            type: "choice",
            choice: "calm",
            confidence: 0.6,
            probabilities: { calm: 0.8, angry: 0.2 },
          },
          bare: { type: "choice", choice: "a", confidence: 0, probabilities: {} },
          urgency: {
            type: "score",
            score: 1.5,
            confidence: 0,
            legend: { 0: "low", 1: "high" },
            probabilities: { 0: 0.5, 1: 0.5 },
          },
        },
        usage: { input_tokens: 1, output_tokens: 2 },
      });

      expect(seen!.url).toBe("https://ai-gateway.vercel.sh/v4/ai/evaluation-model");
      expect(seen!.init.headers).toMatchObject({
        Authorization: "Bearer gw-key",
        "ai-gateway-protocol-version": "0.0.1",
        "ai-gateway-auth-method": "api-key",
        "ai-evaluation-model-specification-version": "4",
        "ai-model-id": "typesafe-ai/jev",
      });
      expect(JSON.parse(seen!.init.body as string)).toEqual({
        state: "",
        questions: {
          billing: { type: "boolean", instructions: "" },
          tone: { type: "choice", instructions: "Tone?", criteria: { calm: null, angry: null } },
          urgency: { type: "score", instructions: "Urgency?", criteria: ["low", "high"] },
          bare: { type: "choice", instructions: "Bare?", criteria: { a: null, b: null } },
        },
      });
      await expect(client.models()).rejects.toThrow(/not available/);
      expect(() => typesafe({ provider: "typesafe" })).toThrow(/TYPESAFE_API_KEY/);
    } finally {
      g.process = saved;
    }
  });

  it("uses VERCEL_OIDC_TOKEN when no key is set", async () => {
    const g = globalThis as { process?: { env?: Record<string, string | undefined> } };
    const saved = g.process;
    g.process = { env: { VERCEL_OIDC_TOKEN: "oidc-token" } };
    try {
      let seen: RequestInit | undefined;
      const client = typesafe({
        fetch: async (_url, init) => {
          seen = init!;
          return json({ answers: { q: { type: "boolean", probability: 0.5 } } });
        },
      });
      await client.systemOne({ state: "x", questions: { q: noul("Q?") } });
      expect(seen!.headers).toMatchObject({
        Authorization: "Bearer oidc-token",
        "ai-gateway-auth-method": "oidc",
      });

      g.process = { env: { VERCEL_OIDC_TOKEN: "oidc-token", AI_GATEWAY_API_KEY: "gw-key" } };
      await typesafe({
        fetch: async (_url, init) => ((seen = init!), json({ answers: {} })),
      }).systemOne({ state: "x", questions: { q: noul("Q?") } });
      expect(seen!.headers).toMatchObject({
        Authorization: "Bearer gw-key",
        "ai-gateway-auth-method": "api-key",
      });
    } finally {
      g.process = saved;
    }
  });

  it("supports explicit provider options", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const client = typesafe({
      apiKey: "gw-key",
      provider: "vercel",
      baseURL: "https://gw.test/",
      model: "typesafe-ai/custom",
      vercel: { zeroDataRetention: true },
      fetch: async (url, init) => {
        seen = { url: String(url), init: init! };
        return json({ answers: { q: { type: "boolean", probability: 0.5 } } });
      },
    });
    const { usage, model } = await client.systemOne(
      { state: "x", questions: { q: noul("Q?") }, model: "jev" },
      { headers: { "ai-gateway-auth-method": "custom" } },
    );
    expect(usage).toEqual({ input_tokens: 0, output_tokens: 0 });
    expect(model).toBe("typesafe-ai/jev");
    expect(seen!.url).toBe("https://gw.test/evaluation-model");
    expect(seen!.init.headers).toMatchObject({
      "ai-model-id": "typesafe-ai/jev",
      "ai-gateway-auth-method": "custom",
    });
    expect(JSON.parse(seen!.init.body as string).providerOptions).toEqual({
      gateway: { zeroDataRetention: true },
    });
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
