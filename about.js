// Loads about.md and shows it in a side panel on the main page.
// Includes a small Markdown converter, so there are no dependencies.
// The About button stays hidden until about.md has some text.
(function () {
  'use strict';

  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // Only allow ordinary web links and paths, never javascript: etc.
  const safeUrl = (u) => (/^(https?:|mailto:|#|\.{0,2}\/|[\w-])/i.test(u) &&
    !/^\s*(javascript|data|vbscript):/i.test(u) ? u : '#');

  function inline(text) {
    const codes = [];
    let s = esc(text).replace(/`([^`]+)`/g, (m, c) => {
      codes.push('<code>' + c + '</code>');
      return '\u0000' + (codes.length - 1) + '\u0000';
    });
    s = s
      .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, src) =>
        '<img src="' + safeUrl(src) + '" alt="' + alt + '">')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, href) =>
        '<a href="' + safeUrl(href) + '"' +
        // links to other sites open in a new tab, so the world keeps running
        (/^https?:/i.test(href) ? ' target="_blank" rel="noopener"' : '') +
        '>' + t + '</a>')
      .replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, '<a href="$1">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
      .replace(/(^|[^\w])_([^_\s][^_]*)_(?!\w)/g, '$1<em>$2</em>');
    return s.replace(/\u0000(\d+)\u0000/g, (m, i) => codes[+i]);
  }

  function markdown(src) {
    const lines = src.replace(/<!--[\s\S]*?-->/g, '').replace(/\r/g, '').split('\n');
    const out = [];
    let i = 0;
    const isBlank = (l) => !l.trim();
    const startsBlock = (l) => /^(#{1,6}\s|>|\s*[-*+]\s|\s*\d+[.)]\s|```|(-{3,}|\*{3,}|_{3,})\s*$)/.test(l);
    while (i < lines.length) {
      const l = lines[i];
      if (isBlank(l)) { i++; continue; }
      let m;
      if ((m = l.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/))) {
        out.push('<h' + m[1].length + '>' + inline(m[2]) + '</h' + m[1].length + '>');
        i++;
      } else if (/^```/.test(l)) {
        const code = [];
        for (i++; i < lines.length && !/^```/.test(lines[i]); i++) code.push(lines[i]);
        i++;
        out.push('<pre><code>' + esc(code.join('\n')) + '</code></pre>');
      } else if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(l)) {
        out.push('<hr>');
        i++;
      } else if (/^>/.test(l)) {
        const q = [];
        while (i < lines.length && /^>/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ''));
        out.push('<blockquote>' + markdown(q.join('\n')) + '</blockquote>');
      } else if (/^\s*([-*+]|\d+[.)])\s/.test(l)) {
        const ordered = /^\s*\d/.test(l);
        const items = [];
        while (i < lines.length && /^\s*([-*+]|\d+[.)])\s/.test(lines[i])) {
          let item = lines[i++].replace(/^\s*([-*+]|\d+[.)])\s+/, '');
          while (i < lines.length && /^\s{2,}\S/.test(lines[i]) &&
                 !/^\s*([-*+]|\d+[.)])\s/.test(lines[i])) item += ' ' + lines[i++].trim();
          items.push('<li>' + inline(item) + '</li>');
        }
        const tag = ordered ? 'ol' : 'ul';
        out.push('<' + tag + '>' + items.join('') + '</' + tag + '>');
      } else {
        const para = [];
        while (i < lines.length && !isBlank(lines[i]) && !(para.length && startsBlock(lines[i]))) {
          para.push(lines[i++].trim());
        }
        out.push('<p>' + inline(para.join(' ')) + '</p>');
      }
    }
    return out.join('\n');
  }

  function setup() {
    const btn = document.getElementById('about-btn');
    const panel = document.getElementById('about');
    const body = document.getElementById('about-body');
    if (!btn || !panel || !body) return;
    const open = () => { panel.hidden = false; btn.setAttribute('aria-expanded', 'true'); };
    const close = () => {
      panel.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      if (location.hash === '#about') history.replaceState(null, '', location.pathname);
    };
    btn.onclick = () => (panel.hidden ? open() : close());
    document.getElementById('about-close').onclick = close;
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

    // browsers won't let a file:// page read other files; skip quietly
    if (location.protocol === 'file:') return;
    fetch('about.md', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.text() : ''))
      .catch(() => '')   // e.g. opened from a file:// URL
      .then((text) => {
        const html = markdown(text || '');
        if (!html.trim()) return;           // nothing written yet
        body.innerHTML = html;
        btn.hidden = false;
        if (location.hash === '#about') open();
      });
  }

  window.EmberleyAbout = { markdown };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
  else setup();
})();
