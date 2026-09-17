// Triage open GitHub issues with `ask`. Prints a table; `--apply` writes the labels.
//
//   node playground/triage.ts owner/repo [--limit 10] [--comments] [--apply]
//
// Needs TYPESAFE_API_KEY or AI_GATEWAY_API_KEY. GITHUB_TOKEN is optional for reading public repos, required for --apply.
// Both are read from the environment or the repo root `.env` (see `.env.example`).

import { Octokit } from "octokit";
import { ask } from "advocaat";

// Typed by hand to keep @types/node out of the repo.
const process: NodeProcess = (globalThis as unknown as { process: NodeProcess }).process;
interface NodeProcess {
  argv: string[];
  env: Record<string, string | undefined>;
  exit(code: number): never;
  loadEnvFile(path: URL): void;
}

try {
  process.loadEnvFile(new URL("../.env", import.meta.url));
} catch {}

try {
  process.loadEnvFile(new URL(".env", import.meta.url));
} catch {}

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const withComments = args.includes("--comments");
const limit = Number(args[args.indexOf("--limit") + 1] || 10);
const [owner, repo] = (args.find((a) => a.includes("/")) ?? "").split("/");
if (!owner || !repo) {
  console.error("Usage: node playground/triage.ts owner/repo [--limit 10] [--comments] [--apply]");
  process.exit(1);
}

const github = new Octokit({ auth: process.env.GITHUB_TOKEN });

// The issues endpoint also returns pull requests, so keep paging until `limit` real issues.
type Issue = Awaited<ReturnType<typeof github.rest.issues.listForRepo>>["data"][number];
const issues: Issue[] = [];
const pages = github.paginate.iterator(github.rest.issues.listForRepo, {
  owner,
  repo,
  state: "open",
  per_page: 100,
});
for await (const { data } of pages) {
  issues.push(...data.filter((issue) => !issue.pull_request));
  if (issues.length >= limit) break;
}
issues.splice(limit);

// Only fields that inform the questions; the raw issue is mostly URLs and ids.
async function state(issue: Issue) {
  return {
    title: issue.title,
    body: issue.body ?? "",
    labels: issue.labels.map((l) => (typeof l === "string" ? l : (l.name ?? ""))),
    author: {
      login: issue.user?.login ?? null,
      association: issue.author_association ?? null,
      bot: issue.user?.type === "Bot",
    },
    reactions: { thumbsUp: issue.reactions?.["+1"] ?? 0, total: issue.reactions?.total_count ?? 0 },
    createdAt: issue.created_at,
    commentCount: issue.comments,
    ...(withComments && issue.comments > 0 ? { comments: await comments(issue.number) } : {}),
  };
}

// Last five comments, trimmed, so long threads stay inside the token budget.
const comments = async (issueNumber: number) => {
  const { data } = await github.rest.issues.listComments({
    owner,
    repo,
    issue_number: issueNumber,
    per_page: 5,
    sort: "created",
    direction: "desc",
  });
  return data.reverse().map((c) => ({
    author: c.user?.login ?? null,
    association: c.author_association,
    body: (c.body ?? "").slice(0, 1000),
  }));
};

const triage = async (issue: Issue) =>
  ask(await state(issue), {
    kind: ask.choice`What kind of issue is this?`({
      bug: "Something is broken or behaves unexpectedly",
      feature: "Request for new behavior or an enhancement",
      question: "Asks how to do something or for help",
      docs: "Documentation is missing, wrong, or unclear",
      other: null,
    }),
    severity: ask.score`How severe is this issue for users?`([
      "Cosmetic or minor annoyance",
      "Noticeable, but a workaround exists",
      "Blocks a common use case",
      "Data loss, crash, or blocks production",
    ]),
    security: "Does this issue describe a security vulnerability?",
    // Blocked, undecided, or maintainer-owned work is not "needs info", so say what does not count.
    needsInfo:
      "Would a maintainer have to ask the reporter for more information (reproduction, versions, expected behavior) before anyone could start on it, taking any comments into account? Open design questions and waiting on other work do not count.",
    ai: "Does the issue text look written by an AI assistant (an explicit disclosure, or uniform assistant-style prose)?",
  });

const answers = await Promise.all(issues.map(triage));

const rows = issues.map((issue, i) => {
  const a = answers[i]!;
  const labels: string[] = [a.kind.choice];
  if (a.security.chance > 0.5) labels.push("security");
  if (a.kind.choice === "bug" && a.severity.ratio >= 0.66) labels.push("priority:high");
  const maintainer = issue.author_association === "MEMBER" || issue.author_association === "OWNER";
  if (a.needsInfo.chance > 0.7 && !maintainer) labels.push("needs-info");
  return {
    "#": issue.number,
    title: issue.title.slice(0, 50),
    kind: `${a.kind.choice} (${pct(a.kind.confidence)})`,
    severity: a.severity.score.toFixed(1),
    security: pct(a.security.chance),
    needsInfo: pct(a.needsInfo.chance),
    ai: pct(a.ai.chance),
    labels: labels.join(", "),
  };
});

console.table(rows);

if (apply) {
  for (const row of rows) {
    await github.rest.issues.addLabels({
      owner,
      repo,
      issue_number: row["#"],
      labels: row.labels.split(", "),
    });
    console.log(`#${row["#"]}: added ${row.labels}`);
  }
}

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}
