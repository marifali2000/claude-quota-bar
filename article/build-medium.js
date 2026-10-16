// Builds article/medium.html from article/claude-quota-bar.md: plain semantic
// HTML that Medium's "Import a story" and copy-paste understand. Images with
// an italic line under them become figures with real captions.
const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

const md = fs.readFileSync(path.join(__dirname, 'claude-quota-bar.md'), 'utf8');
const title = md.match(/^# (.+)$/m)[1];
const subtitle = md.match(/^## (.+)$/m)[1];
const cover = md.match(/!\[[^\]]*\]\(([^)]+)\)/)[1];
const url = 'https://marifali2000.github.io/claude-quota-bar/article/medium.html';

let body = marked.parse(md);
body = body
  // The subtitle sits right under the title as a small heading, which Medium reads as the subtitle.
  .replace(`<h2>${subtitle}</h2>`, `<h3>${subtitle}</h3>`)
  .replace(/<p><img src="([^"]+)" alt="([^"]*)"><\/p>\s*<p><em>([\s\S]*?)<\/em><\/p>/g,
    '<figure><img src="$1" alt="$2"><figcaption>$3</figcaption></figure>')
  .replace(/<p><img src="([^"]+)" alt="([^"]*)"><\/p>/g, '<figure><img src="$1" alt="$2"></figure>');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(subtitle)}">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(subtitle)}">
<meta property="og:image" content="${cover}">
<meta property="og:url" content="${url}">
<meta name="author" content="M Arif Ali">
<style>
  body { max-width: 700px; margin: 40px auto; padding: 0 16px; font: 20px/1.6 Georgia, serif; color: #242424; background: #fff; }
  h1, h2, h3 { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.25; }
  h1 { font-size: 40px; margin-bottom: 8px; } h3 { color: #6b6b6b; font-weight: 400; margin-top: 0; }
  figure { margin: 32px 0; } img { width: 100%; border-radius: 4px; }
  figcaption { text-align: center; font-size: 14px; color: #6b6b6b; margin-top: 8px; }
  pre { background: #f2f2f2; padding: 16px; overflow-x: auto; font-size: 15px; }
  code { font-size: 0.85em; background: #f2f2f2; padding: 1px 4px; } pre code { padding: 0; }
  a { color: inherit; }
</style>
</head>
<body>
<article>
${body}</article>
</body>
</html>
`;
fs.writeFileSync(path.join(__dirname, 'medium.html'), html);
console.log('wrote article/medium.html');
