const appEl = document.getElementById('app');

async function renderList() {
  appEl.innerHTML = '<p>Loading...</p>';
  const res = await fetch('/api/files');
  const files = await res.json();

  if (files.length === 0) {
    appEl.innerHTML = '<p>No markdown or HTML files found in <code>docs/</code>.</p>';
    return;
  }

  const items = files
    .map((name) => `<li><a href="#/view?file=${encodeURIComponent(name)}">${name}</a></li>`)
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
    appEl.innerHTML = `<p>File not found: ${name}</p><p><a href="#/">&larr; Back</a></p>`;
    return;
  }

  const raw = await res.text();
  const isHtml = name.toLowerCase().endsWith('.html');
  const html = DOMPurify.sanitize(isHtml ? raw : marked.parse(raw));
  appEl.innerHTML = `<p><a href="#/">&larr; Back</a></p><article class="markdown-body">${html}</article>`;
  appEl.querySelectorAll('pre code').forEach((block) => hljs.highlightElement(block));
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
  }

  renderList();
}

window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', route);
