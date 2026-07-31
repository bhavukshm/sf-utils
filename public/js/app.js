const appEl = document.getElementById('app');

// highlight.js's bash grammar only colors real shell keywords/builtins (if, cd, export...);
// external programs like grep/git/sf are plain words to it, same as in a real terminal.
// Extend recognition with the actual CLI tools these docs use, so command names get colored
// too. Only matches at a line start or right after a pipe, so it can't clobber existing spans.
const CLI_COMMANDS = [
    'sf',
    'sfdx',
    'git',
    'find',
    'fd',
    'grep',
    'rg',
    'sed',
    'sd',
    'awk',
    'jq',
    'curl',
    'cat',
    'tail',
    'head',
    'sort',
    'uniq',
    'wc',
    'mkdir',
    'ls',
    'code',
    'npm',
    'npx',
    'node',
    'playwright',
    'docker',
    'python',
    'pip',
    'brew',
    'choco',
    'scoop',
    'apt',
    'apt-get'
];
const CLI_COMMAND_REGEX = new RegExp(
    `(^|\\n|\\|\\s*)(${CLI_COMMANDS.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
    'g'
);
hljs.addPlugin({
    'after:highlight': (result) => {
        result.value = result.value.replace(
            CLI_COMMAND_REGEX,
            (m, prefix, cmd) => `${prefix}<span class="hljs-built_in">${cmd}</span>`
        );
    }
});

async function renderList() {
    appEl.innerHTML = '<p>Loading...</p>';
    const res = await fetch('/api/files');
    const files = await res.json();

    if (files.length === 0) {
        appEl.innerHTML = '<p>No markdown or HTML files found in <code>docs/</code>.</p>';
        return;
    }

    const items = files
        .map((name) => {
            const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
            const base = name.slice(0, name.lastIndexOf('.'));
            return `<li><a href="#/view?file=${encodeURIComponent(name)}">
                <span class="file-name">${base}</span>
                <span class="file-ext ext-${ext}">${ext}</span>
            </a></li>`;
        })
        .join('');
    appEl.innerHTML = `
    <input type="search" id="doc-search" class="doc-search" placeholder="Search docs..." autocomplete="off">
    <ul class="file-list">${items}</ul>
  `;

    const searchEl = document.getElementById('doc-search');
    const listItems = Array.from(appEl.querySelectorAll('.file-list li'));

    searchEl.addEventListener('input', () => {
        const term = searchEl.value.trim().toLowerCase();
        listItems.forEach((li) => {
            const name = li.textContent.toLowerCase();
            li.style.display = name.includes(term) ? '' : 'none';
        });
    });

    searchEl.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const firstVisible = listItems.find((li) => li.style.display !== 'none');
        const link = firstVisible && firstVisible.querySelector('a');
        if (link) window.location.hash = link.getAttribute('href').slice(1);
    });

    searchEl.focus();
}

async function renderDoc(name) {
    appEl.innerHTML = '<p>Loading...</p>';
    const res = await fetch(`/api/content/${encodeURIComponent(name)}`);

    if (!res.ok) {
        appEl.innerHTML = `<p>File not found: ${name}</p><p><a class="back-link" href="#/">&larr; Back to all docs</a></p>`;
        return;
    }

    const raw = await res.text();
    const isHtml = name.toLowerCase().endsWith('.html');

    // These docs are developer-authored files from docs/, not user input, so we skip
    // DOMPurify entirely for both formats — for the HTML docs it was stripping their
    // own <style> block, and there's no untrusted content here that needs sanitizing.
    if (isHtml) {
        appEl.innerHTML = `<p><a class="back-link" href="#/">&larr; Back to all docs</a></p>${raw}`;
    } else {
        appEl.innerHTML = `<p><a class="back-link" href="#/">&larr; Back to all docs</a></p><article class="markdown-body">${marked.parse(raw)}</article>`;
        appEl.querySelectorAll('pre code').forEach((block) => hljs.highlightElement(block));

        // Give bash/sh blocks the same dark-terminal look as docs/Playwright.html's
        // shell blocks (see .sh-block in style.css) instead of the generic IDE theme.
        appEl
            .querySelectorAll('pre code.language-bash, pre code.language-sh, pre code.language-shell')
            .forEach((code) => {
                const pre = code.parentElement;
                const wrapper = document.createElement('div');
                wrapper.className = 'sh-block';
                pre.replaceWith(wrapper);
                wrapper.innerHTML = '<div class="sh-cap">BASH</div>';
                wrapper.appendChild(pre);
            });
    }
}

function route() {
    const hash = window.location.hash || '#/';

    if (hash.startsWith('#/view')) {
        const query = hash.split('?')[1] || '';
        const file = new URLSearchParams(query).get('file');
        if (file) {
            renderDoc(file);
            return;
        }
    } else if (hash.startsWith('#/')) {
        renderList();
    }
    // else: an in-page anchor inside the currently rendered doc (e.g. "#s1" from a
    // table of contents) — leave the doc alone and let the browser scroll to it.
}

window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', route);
