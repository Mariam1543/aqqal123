// Renders the printable products in product.html.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dtg = iso => {
  const d = new Date(iso), p = n => String(n).padStart(2, '0');
  const M = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  return `${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}Z ${M[d.getUTCMonth()]} ${p(d.getUTCFullYear() % 100)}`;
};

async function main() {
  const q = new URLSearchParams(location.search);
  const which = q.get('kind') || 'brief';
  const url = which === 'folder'
    ? `/api/product/folder?kind=${encodeURIComponent(q.get('tkind') || 'oasset')}&id=${encodeURIComponent(q.get('id') || 'oa-pin')}`
    : '/api/product/brief';
  let data;
  try { data = await (await fetch(url)).json(); }
  catch (e) { document.getElementById('doc').innerHTML = '<p>The server is not answering.</p>'; return; }

  const marking = data.marking || data.folder?.marking || '';
  document.getElementById('doc').innerHTML = which === 'folder' ? folderDoc(data) : briefDoc(data);
  for (const b of document.querySelectorAll('.band')) b.textContent = marking;
  // tell the viewer what to put in its bar
  parent?.postMessage({ type: 'product', title: which === 'folder' ? 'Target folder' : data.title, marking, partner: null }, '*');
  document.title = (which === 'folder' ? 'Target folder' : data.title) + ' — ' + marking;
  document.addEventListener('keydown', e => { if (e.key === 'Escape') parent?.postMessage({ type: 'product-close' }, '*'); });
}

function briefDoc(d) {
  return `<header><div class="eyebrow">${esc(d.command)}</div><h1>${esc(d.title)}</h1>
      <div class="meta">${esc(dtg(d.generated))}</div></header>
    ${d.sections.map(s => `<section><h2>${esc(s.heading)}</h2><p>${esc(s.body)}</p></section>`).join('')}
    <section><h2>Every posture</h2><table><thead><tr>${d.table.head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${d.table.rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></section>`;
}

function folderDoc(d) {
  const f = d.folder, t = f.target, o = f.optimal;
  return `<header><div class="eyebrow">Target folder</div><h1>${esc(t.name.replace(/\s*\(assessed\)/, ''))}</h1>
      <div class="meta">${esc(dtg(d.generated))} · ${esc(t.confidence)} confidence, assessed ${t.asOfHours} h ago</div></header>
    <section><h2>The target</h2><table><tbody>
      <tr><th>Category</th><td>${esc(t.category)}</td></tr>
      <tr><th>Position</th><td>${t.lat.toFixed(4)}°N ${t.lng.toFixed(4)}°E</td></tr>
      <tr><th>Confidence</th><td>${esc(t.confidence)}</td></tr></tbody></table></section>
    ${o ? `<section><h2>Optimal package</h2><table><tbody>
      <tr><th>System</th><td>${esc(o.name)}</td></tr>
      <tr><th>Rounds</th><td>${o.rounds}</td></tr>
      <tr><th>Reach to spare</th><td>${o.marginKm} km</td></tr>
      <tr><th>Into action</th><td>${o.ttpMin} min</td></tr>
      <tr><th>Release</th><td>${esc(o.release)}</td></tr></tbody></table></section>` : ''}
    <section><h2>Rules of engagement</h2><ul>${f.roe.rules.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
      <p>${esc(f.roe.collateral)}</p></section>
    <section><h2>Plan of execution</h2><table><tbody>
      ${f.execution.map(p => `<tr><th>${esc(p.phase)}</th><td>${esc(p.text)}</td></tr>`).join('')}</tbody></table></section>
    <section><h2>Escalation</h2><p>Rung ${f.escalation.rung} — ${esc(f.escalation.rungName)}.
      ${Math.round(f.escalation.above * 100)} per cent chance of an answer above this rung;
      ${Math.round(f.escalation.strategic * 100)} per cent strategic. ${esc(f.escalation.answer)}</p>
      <p>${esc(f.after)}</p></section>
    <section><h2>Grounding</h2><table><tbody>
      ${f.grounding.map(g => `<tr><th>${esc(g.label)}</th><td>${esc(g.value)} <em>(${esc(g.source)})</em></td></tr>`).join('')}</tbody></table></section>`;
}
main();
