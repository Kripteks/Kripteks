const https = require("https");
const fs = require("fs");
const path = require("path");

const token = process.env.METRICS_TOKEN || process.env.GITHUB_TOKEN;
if (!token) {
  console.error("Error: METRICS_TOKEN or GITHUB_TOKEN environment variable is required.");
  process.exit(1);
}

const currentYear = new Date().getFullYear();
let yearsQuery = "";
for (let y = 2015; y <= currentYear; y++) {
  yearsQuery += `
    y${y}: contributionsCollection(from: "${y}-01-01T00:00:00Z", to: "${y}-12-31T23:59:59Z") {
      totalCommitContributions
      restrictedContributionsCount
    }`;
}

const query = `
query {
  user(login: "Kripteks") {
    createdAt
    repositories(first: 100, isFork: false, ownerAffiliations: [OWNER]) {
      totalCount
      nodes {
        nameWithOwner
        stargazerCount
        languages(first: 10, orderBy: {field: SIZE, direction: DESC}) {
          edges { size node { name color } }
        }
      }
    }
    repositoriesContributedTo(first: 100, includeUserRepositories: false, contributionTypes: COMMIT) {
      nodes {
        nameWithOwner
        languages(first: 10, orderBy: {field: SIZE, direction: DESC}) {
          edges { size node { name color } }
        }
      }
    }
    pullRequests {
      totalCount
    }
    issues {
      totalCount
    }
    contributionsCollection {
      totalRepositoriesWithContributedCommits
    }
    ${yearsQuery}
  }
}
`;

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + " kB";
  return bytes + " B";
}

const req = https.request("https://api.github.com/graphql", {
  method: "POST",
  headers: {
    "User-Agent": "NodeJS",
    "Authorization": "Bearer " + token,
    "Content-Type": "application/json"
  }
}, res => {
  let body = "";
  res.on("data", d => body += d);
  res.on("end", () => {
    let json;
    try {
      json = JSON.parse(body);
    } catch (e) {
      console.error("Invalid JSON response:", body);
      process.exit(1);
    }

    if (json.errors) {
      console.error("GraphQL Errors:", json.errors);
      process.exit(1);
    }

    const userData = json.data.user;

    // Calculate Lifetime Commits
    let totalLifetimeCommits = 0;
    for (let y = 2015; y <= currentYear; y++) {
      const cy = userData[`y${y}`];
      if (cy) {
        totalLifetimeCommits += (cy.totalCommitContributions || 0) + (cy.restrictedContributionsCount || 0);
      }
    }

    // Stars
    let totalStars = 0;
    for (const r of userData.repositories.nodes) {
      totalStars += (r.stargazerCount || 0);
    }

    const totalPRs = userData.pullRequests.totalCount || 0;
    const totalIssues = userData.issues.totalCount || 0;
    const contributedTo = userData.contributionsCollection.totalRepositoriesWithContributedCommits || 0;

    // Languages calculation
    const repos = [
      ...userData.repositories.nodes,
      ...userData.repositoriesContributedTo.nodes
    ];

    const seen = new Set();
    const filteredRepos = repos.filter(r => {
      if (seen.has(r.nameWithOwner)) return false;
      seen.add(r.nameWithOwner);

      const [owner, name] = r.nameWithOwner.split("/");
      if (name === "smf-forum") return false;
      return ["Kripteks", "ecvatoria", "AtlantisMP"].includes(owner);
    });

    const langStats = {};
    const langColors = {};
    let totalBytes = 0;

    for (const r of filteredRepos) {
      for (const edge of r.languages.edges) {
        const name = edge.node.name;
        const size = edge.size;
        langStats[name] = (langStats[name] || 0) + size;
        langColors[name] = edge.node.color || "#8b949e";
        totalBytes += size;
      }
    }

    const topLangs = Object.entries(langStats)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, size]) => ({
        name,
        size,
        color: langColors[name],
        percentNum: (size / totalBytes) * 100,
        percent: ((size / totalBytes) * 100).toFixed(2) + "%",
        formattedSize: formatBytes(size)
      }));

    const barWidth = 380;
    let currentX = 0;
    const barRects = topLangs.map(l => {
      const w = (l.percentNum / 100) * barWidth;
      const rect = `<rect x="${currentX.toFixed(2)}" y="0" width="${w.toFixed(2)}" height="8" fill="${l.color}" rx="0"/>`;
      currentX += w;
      return rect;
    }).join("\n            ");

    const leftCol = [];
    const rightCol = [];

    topLangs.forEach((l, i) => {
      const item = `
        <div class="lang-item">
          <div class="lang-name">
            <span class="lang-dot" style="background:${l.color}"></span>
            ${l.name}
          </div>
          <div class="lang-meta">
            <span class="lang-size">${l.formattedSize}</span>
            <span class="lang-pct">${l.percent}</span>
          </div>
        </div>`;
      if (i % 2 === 0) leftCol.push(item);
      else rightCol.push(item);
    });

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="820" height="220" viewBox="0 0 820 220" fill="none">
  <defs>
    <linearGradient id="bg-grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#16161e"/>
      <stop offset="100%" stop-color="#1a1b26"/>
    </linearGradient>
    <linearGradient id="accent-grad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#7aa2f7"/>
      <stop offset="100%" stop-color="#bb9af7"/>
    </linearGradient>
    <clipPath id="bar-clip">
      <rect width="${barWidth}" height="8" rx="4"/>
    </clipPath>
  </defs>

  <style>
    .card {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #c0caf5;
    }
    .title {
      font-size: 15px;
      font-weight: 600;
      fill: #7aa2f7;
    }
    .stat-label {
      font-size: 13px;
      fill: #7982a9;
    }
    .stat-val {
      font-size: 13px;
      font-weight: 600;
      fill: #c0caf5;
    }
    .stat-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }
    .stat-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .stat-icon {
      width: 16px;
      height: 16px;
      fill: #7aa2f7;
    }
    .divider {
      stroke: #24283b;
      stroke-width: 1.5;
    }
    .lang-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
      font-size: 12px;
    }
    .lang-name {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 500;
      color: #c0caf5;
    }
    .lang-dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      display: inline-block;
    }
    .lang-meta {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .lang-size {
      color: #565f89;
      font-size: 11px;
    }
    .lang-pct {
      color: #9aa5ce;
      font-size: 11px;
      font-weight: 600;
      min-width: 44px;
      text-align: right;
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-top: 10px;
    }
  </style>

  <!-- Background Card -->
  <rect width="820" height="220" rx="12" fill="url(#bg-grad)" stroke="#24283b" stroke-width="1.5"/>

  <!-- Top Accent Line -->
  <rect x="0" y="0" width="820" height="3" rx="1.5" fill="url(#accent-grad)"/>

  <!-- Left Section: Activity Stats -->
  <g transform="translate(24, 20)">
    <text x="0" y="16" class="title">⚡ GitHub Activity</text>
  </g>

  <foreignObject x="24" y="50" width="330" height="150">
    <div xmlns="http://www.w3.org/1999/xhtml" class="card">
      <div class="stat-row">
        <div class="stat-left">
          <svg class="stat-icon" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M10.5 7.75a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0zm1.43.75a4.002 4.002 0 01-7.86 0H.75a.75.75 0 110-1.5h3.32a4.002 4.002 0 017.86 0h3.32a.75.75 0 110 1.5h-3.32z"/></svg>
          <span class="stat-label">Total Commits</span>
        </div>
        <span class="stat-val">${totalLifetimeCommits}</span>
      </div>
      <div class="stat-row">
        <div class="stat-left">
          <svg class="stat-icon" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.628a2.251 2.251 0 101.5 0V5A2.5 2.5 0 0011 2.5zm1 10.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z"/></svg>
          <span class="stat-label">Pull Requests</span>
        </div>
        <span class="stat-val">${totalPRs}</span>
      </div>
      <div class="stat-row">
        <div class="stat-left">
          <svg class="stat-icon" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM0 8a8 8 0 1116 0A8 8 0 010 8zm9 3a1 1 0 11-2 0 1 1 0 012 0zm-.25-6.25a.75.75 0 00-1.5 0v3.5a.75.75 0 001.5 0v-3.5z"/></svg>
          <span class="stat-label">Issues Opened</span>
        </div>
        <span class="stat-val">${totalIssues}</span>
      </div>
      <div class="stat-row">
        <div class="stat-left">
          <svg class="stat-icon" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M2 2.5A2.5 2.5 0 014.5 0h8.75a.75.75 0 01.75.75v12.5a.75.75 0 01-.75.75h-2.5a.75.75 0 110-1.5h1.75v-2h-8a1 1 0 00-.714 1.7.75.75 0 01-1.072 1.05A2.495 2.495 0 012 11.5v-9zm10.5-1h-8a1 1 0 00-1 1v6.708A2.486 2.486 0 014.5 9h8V1.5z"/></svg>
          <span class="stat-label">Contributed To</span>
        </div>
        <span class="stat-val">${contributedTo} repos</span>
      </div>
      <div class="stat-row">
        <div class="stat-left">
          <svg class="stat-icon" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M8 .25a.75.75 0 01.673.418l1.882 3.815 4.21.612a.75.75 0 01.416 1.279l-3.046 2.97.719 4.192a.75.75 0 01-1.088.791L8 12.347l-3.766 1.98a.75.75 0 01-1.088-.79l.72-4.194L.818 6.374a.75.75 0 01.416-1.28l4.21-.611L7.327.668A.75.75 0 018 .25z"/></svg>
          <span class="stat-label">Total Stars Earned</span>
        </div>
        <span class="stat-val">${totalStars}</span>
      </div>
    </div>
  </foreignObject>

  <!-- Vertical Divider -->
  <line x1="385" y1="20" x2="385" y2="200" class="divider"/>

  <!-- Right Section: Languages Breakdown -->
  <g transform="translate(415, 20)">
    <text x="0" y="16" class="title">🚀 Most Used Languages</text>
  </g>

  <!-- Language Progress Bar -->
  <g transform="translate(415, 48)" clip-path="url(#bar-clip)">
    <rect width="${barWidth}" height="8" fill="#24283b"/>
    ${barRects}
  </g>

  <!-- Languages List (2 columns) -->
  <foreignObject x="415" y="64" width="${barWidth}" height="140">
    <div xmlns="http://www.w3.org/1999/xhtml" class="card">
      <div class="grid">
        <div>
          ${leftCol.join("\n")}
        </div>
        <div>
          ${rightCol.join("\n")}
        </div>
      </div>
    </div>
  </foreignObject>
</svg>`;

    const outputPath = path.resolve(__dirname, "../../github-metrics.svg");
    fs.writeFileSync(outputPath, svg, "utf8");
    console.log("Successfully generated unified github-metrics.svg!");
    console.log(`Commits: ${totalLifetimeCommits}, PRs: ${totalPRs}, Issues: ${totalIssues}, Contributed: ${contributedTo}, Stars: ${totalStars}`);
    console.log("Top languages:", topLangs.map(l => `${l.name} (${l.percent})`).join(", "));
  });
});

req.write(JSON.stringify({ query }));
req.end();
