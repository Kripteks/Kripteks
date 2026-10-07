const https = require("https");
const fs = require("fs");
const path = require("path");

const token = process.env.METRICS_TOKEN || process.env.GITHUB_TOKEN;
if (!token) {
  console.error("Error: METRICS_TOKEN or GITHUB_TOKEN environment variable is required.");
  process.exit(1);
}

const query = `
query {
  user(login: "Kripteks") {
    repositories(first: 100, isFork: false, ownerAffiliations: [OWNER]) {
      nodes {
        nameWithOwner
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

    const repos = [
      ...json.data.user.repositories.nodes,
      ...json.data.user.repositoriesContributedTo.nodes
    ];

    const seen = new Set();
    const filtered = repos.filter(r => {
      if (seen.has(r.nameWithOwner)) return false;
      seen.add(r.nameWithOwner);

      const [owner, name] = r.nameWithOwner.split("/");
      if (name === "smf-forum") return false;
      return ["Kripteks", "ecvatoria", "AtlantisMP"].includes(owner);
    });

    const langStats = {};
    const langColors = {};
    let total = 0;

    for (const r of filtered) {
      for (const edge of r.languages.edges) {
        const name = edge.node.name;
        const size = edge.size;
        langStats[name] = (langStats[name] || 0) + size;
        langColors[name] = edge.node.color || "#8b949e";
        total += size;
      }
    }

    // Top 8 languages
    const topLangs = Object.entries(langStats)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, size]) => ({
        name,
        size,
        color: langColors[name],
        percentNum: (size / total) * 100,
        percent: ((size / total) * 100).toFixed(2) + "%",
        formattedSize: formatBytes(size)
      }));

    const barWidth = 460;
    let currentX = 0;
    const barRects = topLangs.map(l => {
      const w = (l.percentNum / 100) * barWidth;
      const rect = `<rect mask="url(#languages-bar)" x="${currentX.toFixed(2)}" y="0" width="${w.toFixed(2)}" height="8" fill="${l.color}"/>`;
      currentX += w;
      return rect;
    }).join("\n        ");

    const leftCol = [];
    const rightCol = [];

    topLangs.forEach((l, i) => {
      const item = `
        <div class="field language details">
          <div class="field">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
              <path fill="${l.color}" fill-rule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8z"/>
            </svg>
            ${l.name}
          </div>
          <small>
            <div>${l.formattedSize}</div>
            <div>${l.percent}</div>
          </small>
        </div>`;
      if (i % 2 === 0) leftCol.push(item);
      else rightCol.push(item);
    });

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="166" class="">
  <defs>
    <style/>
  </defs>
  <style>
    @keyframes animation-gauge{0%{stroke-dasharray:0 329}}
    svg{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif,Apple Color Emoji,Segoe UI Emoji;color:#777}
    h2,h3{margin:8px 0 2px;padding:0;color:#0366d6;font-weight:400}
    h2 svg,h3 svg{fill:currentColor}
    h2{font-size:16px}
    h3,svg{font-size:14px}
    section>.field{margin-left:5px;margin-right:5px}
    .field{display:flex;align-items:center;margin-bottom:2px;white-space:nowrap}
    .field svg{margin:0 8px;fill:#959da5;flex-shrink:0}
    .row{display:flex;flex-wrap:wrap}
    .row section{flex:1 1 0}
    .column{display:flex;flex-direction:column;align-items:center}
    #metrics-end,.fill-width{width:100%}
    svg.bar{margin:4px 0}
    .field.language{margin:0 8px;flex-grow:0}
    .field.language.details,.field.language.details small{display:flex;justify-content:space-between}
    .field.language.details small{color:#666;text-align:right}
    .field.language.details small>*, .field.language.details>*{flex:1 1 0}
    .field.language.details small>:not(:last-child){margin-right:6px}
  </style>
  <foreignObject x="0" y="0" width="100%" height="100%">
    <div xmlns="http://www.w3.org/1999/xhtml" class="items-wrapper">
      <section>
        <h2 class="field">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
            <path fill-rule="evenodd" d="M1.5 2.75a.25.25 0 01.25-.25h12.5a.25.25 0 01.25.25v8.5a.25.25 0 01-.25.25h-6.5a.75.75 0 00-.53.22L4.5 14.44v-2.19a.75.75 0 00-.75-.75h-2a.25.25 0 01-.25-.25v-8.5zM1.75 1A1.75 1.75 0 000 2.75v8.5C0 12.216.784 13 1.75 13H3v1.543a1.457 1.457 0 002.487 1.03L8.061 13h6.189A1.75 1.75 0 0016 11.25v-8.5A1.75 1.75 0 0014.25 1H1.75zm5.03 3.47a.75.75 0 010 1.06L5.31 7l1.47 1.47a.75.75 0 01-1.06 1.06l-2-2a.75.75 0 010-1.06l2-2a.75.75 0 011.06 0zm2.44 0a.75.75 0 000 1.06L10.69 7 9.22 8.47a.75.75 0 001.06 1.06l2-2a.75.75 0 000-1.06l-2-2a.75.75 0 00-1.06 0z"/>
          </svg>
          ${topLangs.length} Most Used Languages
        </h2>
      </section>
      <section class="column">
        <svg class="bar" xmlns="http://www.w3.org/2000/svg" width="${barWidth}" height="8">
          <mask id="languages-bar">
            <rect x="0" y="0" width="${barWidth}" height="8" fill="white" rx="5"/>
          </mask>
          <rect mask="url(#languages-bar)" x="0" y="0" width="${barWidth}" height="8" fill="#d1d5da"/>
          ${barRects}
        </svg>
        <div class="row fill-width">
          <section>
            ${leftCol.join("\n")}
          </section>
          <section>
            ${rightCol.join("\n")}
          </section>
        </div>
      </section>
    </div>
    <div xmlns="http://www.w3.org/1999/xhtml" id="metrics-end"></div>
  </foreignObject>
</svg>`;

    const outputPath = path.resolve(__dirname, "../../github-metrics-languages.svg");
    fs.writeFileSync(outputPath, svg, "utf8");
    console.log("Successfully generated github-metrics-languages.svg!");
    console.log("Top languages included:", topLangs.map(l => `${l.name} (${l.percent})`).join(", "));
  });
});

req.write(JSON.stringify({ query }));
req.end();
