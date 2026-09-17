// Ask the model to rate itself on a personality test and report keyed trait means.
//
//   node playground/personality.ts                        # runs both tests, writes personality.svg here
//   node playground/personality.ts test.json [--items]    # text report
//   node playground/personality.ts test.json --svg > card.svg
//
// See `ipip-50.json` for the expected test shape.
// Needs TYPESAFE_API_KEY or AI_GATEWAY_API_KEY, read from the environment or a `.env` in the repo root
// or in this folder (see `.env.example`).

import { ask, type ScoreCriteria } from "advocaat";

// Typed by hand to keep @types/node out of the repo.
const process: NodeProcess = (globalThis as unknown as { process: NodeProcess }).process;
interface NodeProcess {
  argv: string[];
  cwd(): string;
  loadEnvFile(path: URL): void;
  getBuiltinModule(id: "node:fs/promises"): {
    writeFile(path: URL, data: string): Promise<void>;
  };
}

interface PersonalityTest {
  title: string;
  label: string;
  tagline: string;
  source: string;
  prompt: string;
  options: string[];
  // Cut points on the trait mean; each trait needs `bands.length + 1` results.
  bands: number[];
  // Results with a `letter` combine into a type code such as INTJ.
  traits: Record<
    string,
    { name: string; results: { style: string; description: string; letter?: string }[] }
  >;
  questions: { id: string; text: string; trait: string; reverse: boolean }[];
}

try {
  process.loadEnvFile(new URL("../.env", import.meta.url));
} catch {}

try {
  process.loadEnvFile(new URL(".env", import.meta.url));
} catch {}

const args = process.argv.slice(2);
const file = args.find((arg) => !arg.startsWith("--"));

if (file) {
  const report = await run(new URL(file, `file://${process.cwd()}/`));
  if (args.includes("--svg")) {
    console.log(renderSvg([report]));
  } else {
    console.log(renderText(report));
    if (args.includes("--items")) {
      console.log(
        `\nExpected responses: 1 = ${report.test.options[0]}, ${report.max} = ${report.test.options[report.max - 1]}.`,
      );
      console.table(
        report.items.map((item) => ({
          item: item.id,
          statement: item.text,
          response: item.response.toFixed(2),
          keyedScore: item.keyedScore.toFixed(2),
        })),
      );
    }
  }
} else {
  const { writeFile } = process.getBuiltinModule("node:fs/promises");
  const reports = await Promise.all(
    ["mbti", "ipip-50"].map((name) => run(new URL(`${name}.json`, import.meta.url))),
  );
  await writeFile(new URL("personality.svg", import.meta.url), renderSvg(reports));
  for (const report of reports) {
    console.log(`${report.test.label}: ${report.sections.map(({ style }) => style).join(", ")}`);
  }
  console.log("Wrote playground/personality.svg");
}

interface Report {
  test: PersonalityTest;
  max: number;
  items: (PersonalityTest["questions"][number] & { response: number; keyedScore: number })[];
  sections: {
    trait: string;
    mean: number;
    total: number;
    count: number;
    style: string;
    description: string;
    letter?: string;
  }[];
  type?: string;
}

async function run(url: URL): Promise<Report> {
  const test: PersonalityTest = (await import(url.href, { with: { type: "json" } })).default;
  const max = test.options.length;

  const questions = Object.fromEntries(
    test.questions.map((item) => [
      item.id,
      ask.score(`${test.prompt} ${item.text}`, test.options as unknown as ScoreCriteria),
    ]),
  );

  const answers = await ask(null, questions);

  const items = test.questions.map((item) => {
    const score = answers[item.id]?.score;
    if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > max - 1) {
      throw new Error(
        `Missing or invalid score for ${item.id}; expected a number from 0 to ${max - 1}`,
      );
    }
    // API scores are zero-based expected values, not selected option indices.
    const response = score + 1;
    return { ...item, response, keyedScore: item.reverse ? max + 1 - response : response };
  });

  const sections = Object.entries(test.traits).map(([id, trait]) => {
    const values = items.filter((item) => item.trait === id);
    const total = values.reduce((sum, item) => sum + item.keyedScore, 0);
    const mean = total / values.length;
    const band = test.bands.filter((cut) => mean >= cut).length;
    const result = trait.results[band];
    if (!result) throw new Error(`Missing result ${band} for ${trait.name}`);
    return { trait: trait.name, mean, total, count: values.length, ...result };
  });

  const type = sections.every(({ letter }) => letter)
    ? sections.map(({ letter }) => letter).join("")
    : undefined;

  return { test, max, items, sections, type };
}

function renderText({ test, max, sections, type }: Report): string {
  return [
    `${test.title} model self-report`,
    "",
    `Reported style: ${sections.map(({ style }) => style).join(", ")}.`,
    ...(type ? [`Type code: ${type}.`] : []),
    "This describes the model's answers in this run, not measured behavior.",
    "",
    sections
      .map(
        ({ trait, style, mean, total, count, description }) =>
          `${trait} — ${style}\n  Mean: ${mean.toFixed(2)}/${max} | Total: ${total.toFixed(2)}/${count * max}\n  ${description}`,
      )
      .join("\n\n"),
    "",
    `Means range from 1 to ${max}. Higher scores mean more endorsement of each trait.`,
    `Descriptions use display bands split at ${test.bands.join(", ")}. These are not population norms or validated cutoffs.`,
    "This is not a validated AI personality assessment or a diagnosis. Human-specific items may not apply.",
    `Items and scoring keys: ${test.source}`,
  ].join("\n");
}

// Self-contained share card: the same words as the CLI plus the trait means, no charts.
function renderSvg(reports: Report[]): string {
  const escape = (text: string) =>
    text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");

  const emojiFont = "Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif";
  const letterEmoji: Record<string, string> = {
    I: "🌙",
    E: "☀️",
    S: "🔎",
    N: "✨",
    T: "🧠",
    F: "💛",
    J: "📋",
    P: "🧭",
  };
  const traitEmoji: Record<string, string> = {
    Extraversion: "💬",
    Agreeableness: "🤝",
    Conscientiousness: "📋",
    "Emotional Stability": "🌿",
    "Intellect/Imagination": "💡",
  };
  const badgeColors = ["#f4e4cf", "#f3ddd2", "#e2e8d2", "#dce8df", "#ece2cc"];
  const width = (1104 - (reports.length - 1) * 24) / reports.length;
  const panels = reports
    .map(({ test, max, sections, type }, index) => {
      const ink = type ? "#f7f3e8" : "#203b32";
      const muted = type ? "#b2c5b8" : "#647469";
      const start = type ? 178 : 78;
      const step = Math.min(type ? 61 : 72, (422 - start) / sections.length);
      const rows = sections
        .map(({ trait, style, letter, mean }, row) => {
          const emoji = (letter ? letterEmoji[letter] : traitEmoji[trait]) ?? "✦";
          const size = Math.min(28, Math.floor((width - 124) / (style.length * 0.6)));
          const labelSize = Math.min(11, Math.floor((width - 124) / (trait.length * 0.75)));
          return `<g transform="translate(32, ${start + row * step})">
        <rect y="1" width="44" height="44" rx="15" fill="${type ? "#344f44" : badgeColors[row % badgeColors.length]}"/>
        <text x="22" y="31" text-anchor="middle" font-family="${emojiFont}" font-size="24" font-weight="400" aria-hidden="true">${emoji}</text>
        <text x="60" y="10" font-size="${labelSize}" font-weight="700" letter-spacing="1.5" fill="${muted}">${escape(trait.toUpperCase())}</text>
        <text x="${width - 64}" y="10" text-anchor="end" font-size="11" font-weight="700" fill="${muted}">${mean.toFixed(1)}/${max}</text>
        <text x="60" y="39" font-size="${size}" font-weight="600">${escape(style)}</text>
        ${!type && row < sections.length - 1 ? `<path d="M60 57H${width - 64}" stroke="#d2dbcd"/>` : ""}
      </g>`;
        })
        .join("\n      ");

      return `<g transform="translate(${48 + index * (width + 24)}, 156)" fill="${ink}">
      <rect width="${width}" height="454" rx="28" fill="${type ? "#203b32" : "#e7ebdf"}"/>
      <text x="32" y="39" font-size="13" font-weight="700" letter-spacing="1.8" fill="${muted}">${escape(test.label)}</text>
      ${type ? `<text x="28" y="143" font-size="100" font-weight="700" letter-spacing="4" fill="#edb99a">${escape(type)}</text>` : ""}
      ${rows}
    </g>`;
    })
    .join("\n    ");

  const description = reports
    .map(
      ({ test, sections, type }) =>
        `${test.title}${type ? ` (${type})` : ""}: ${sections.map(({ style }) => style).join(", ")}.`,
    )
    .join(" ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675" role="img" aria-labelledby="title description">
  <title id="title">Jev's personality test</title>
  <desc id="description">${escape(description)} Model self-report, not measured behavior or a validated assessment.</desc>
  <rect width="1200" height="675" fill="#f7f3e8"/>
  <g font-family="Arial, Helvetica, sans-serif" fill="#203b32">
    <text x="48" y="44" font-size="12" font-weight="700" letter-spacing="2.4" fill="#647469">PERSONALITY SNAPSHOT</text>
    <text x="48" y="108" font-size="52" font-weight="700" letter-spacing="-1.8">Jev's personality test</text>
    ${panels}
  </g>
</svg>`;
}
