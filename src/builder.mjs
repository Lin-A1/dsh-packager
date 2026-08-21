const listEl = document.getElementById('list')
const logEl = document.getElementById('log')
const dshDirEl = document.getElementById('dshDir')
const modeEl = document.getElementById('mode')
const dshVersionEl = document.getElementById('dshVersion')
const searchEl = document.getElementById('search')
const filterCatEl = document.getElementById('filterCat')
const countEl = document.getElementById('count')
let catalog = []

async function fetchCatalog() {
  const dshDir = dshDirEl.value.trim() || '../../deepseek-harness'
  logEl.textContent = `加载插件列表… dshDir=${dshDir}`
  try {
    catalog = await window.builderAPI.listPlugins(dshDir)
    const ver = await window.builderAPI.getDshVersion(dshDir)
    if (ver) dshVersionEl.textContent = ver
  } catch (e) {
    catalog = []
    logEl.textContent = '加载失败: ' + e.message
  }
  const cats = [...new Set(catalog.map(c=>c.category))].sort()
  filterCatEl.innerHTML = '<option value="">全部分类</option>' + cats.map(c=>`<option value="${c}">${c}</option>`).join('')
  if (!catalog.length) {
    logEl.textContent += '\n未发现插件，请检查 DSH_DIR 是否为 deepseek-harness 检出（含 packages/）且 dsh-hub/plugins 已 git submodule update --init'
  } else {
    logEl.textContent = `已加载 ${catalog.length} 个插件（唯一 ${catalog.filter(c=>c.unique).length} / 不限数 ${catalog.filter(c=>!c.unique).length}）— 搜索或筛选后勾选`
  }
  render()
}
function render() {
  const q = (searchEl.value || '').toLowerCase().trim()
  const catFilter = filterCatEl.value
  listEl.innerHTML = ''
  let shown = 0
  const byCat = {}
  for (const p of catalog) {
    if (catFilter && p.category !== catFilter) continue
    if (q && !(p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q) || (p.description||'').toLowerCase().includes(q))) continue
    if (!byCat[p.category]) byCat[p.category] = []
    byCat[p.category].push(p)
  }
  for (const [cat, items] of Object.entries(byCat).sort()) {
    const header = document.createElement('div')
    header.style.gridColumn = '1 / -1'
    header.style.fontSize = '12px'
    header.style.color = '#8a9099'
    header.style.marginTop = '8px'
    header.style.display = 'flex'
    header.style.alignItems = 'center'
    header.style.gap = '8px'
    header.innerHTML = `<span style="font-weight:600;color:#cbd5e1">${cat}</span><span style="flex:1;height:1px;background:#1e242b"></span><span>${items.length} 个</span>`
    listEl.appendChild(header)
    for (const p of items) {
      shown++
      const card = document.createElement('div')
      card.className = 'card ' + (p.unique ? 'unique' : 'multi')
      const badge = p.unique ? '唯一' : '不限数'
      const badgeCls = p.unique ? 'badge unique' : 'badge multi'
      const link = p.name.startsWith('github:') || p.name.startsWith('npm:') || p.name.startsWith('file:') || p.name.startsWith('http') ? p.name : `https://www.npmjs.com/package/${p.name}`
      card.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px"><h3>${p.name}</h3><span class="${badgeCls}">${badge}</span></div>
        <p>${p.description || '—'}</p>
        <a class="link" href="${link}" target="_blank">${link}</a>
        <div class="meta">id <input data-id="${p.id}" value="${p.id}" style="width:150px" /> · ${p.category}</div>
        <label style="display:flex;align-items:center;gap:6px;margin-top:4px"><input type="${p.unique?'radio':'checkbox'}" name="${p.unique?'unique-'+p.category:p.id}" data-name="${p.name}" ${p.enabled?'checked':''} /> ${p.unique ? '选用（同类唯一）' : '添加'}</label>
      `
      if (p.unique) {
        const radio = card.querySelector('input[type=radio]')
        radio.addEventListener('change', e => {
          if (e.target.checked) {
            document.querySelectorAll(`input[name="unique-${cat}"]`).forEach(el => { if (el!==e.target) el.checked=false })
          }
        })
      }
      listEl.appendChild(card)
    }
  }
  countEl.textContent = `显示 ${shown} / ${catalog.length}`
  if (!shown) {
    const empty = document.createElement('div')
    empty.className = 'empty'
    empty.style.gridColumn = '1 / -1'
    empty.innerHTML = q || catFilter ? `无匹配 — 试试清空搜索或切换分类` : `暂无插件 — 请检查 <code>dsh-hub/plugins</code> 是否已 <code>git submodule update --init</code>，或在上方“添加自定义插件”输入链接`
    listEl.appendChild(empty)
  }
}
window.addCustom = () => {
  const link = document.getElementById('customLink').value.trim()
  const desc = document.getElementById('customDesc').value.trim()
  if (!link) return
  const id = link.split('/').pop().split(':').pop().replace(/[^a-z0-9-]/gi,'-').slice(0,28).toLowerCase() || 'custom'
  catalog.push({ id, name: link, description: desc || '用户自定义', category: 'custom', unique: false, enabled: true })
  document.getElementById('customLink').value = ''
  document.getElementById('customDesc').value = ''
  if (![...filterCatEl.options].some(o=>o.value==='custom')) {
    const opt = document.createElement('option')
    opt.value = 'custom'; opt.textContent = 'custom'; filterCatEl.appendChild(opt)
  }
  render()
}
window.build = async () => {
  const mode = modeEl.value
  const dshDir = dshDirEl.value.trim() || '../../deepseek-harness'
  const productName = document.getElementById('productName').value.trim() || 'dsh-fixed-demo'
  const plugins = []
  const seenUnique = new Set()
  document.querySelectorAll('#list .card').forEach(card => {
    const inp = card.querySelector('input[type=checkbox],input[type=radio]')
    if (!inp || !inp.checked) return
    const id = card.querySelector('input[data-id]').value.trim()
    const name = inp.dataset.name
    const unique = card.classList.contains('unique')
    if (!id || !name) return
    if (unique) {
      if (seenUnique.has(inp.name)) return
      seenUnique.add(inp.name)
    }
    plugins.push({ id, name })
  })
  if (!plugins.length) {
    logEl.textContent = '请至少选择一个插件（或添加自定义链接）'
    return
  }
  logEl.textContent = `准备出包 mode=${mode} dshDir=${dshDir} productName=${productName} 插件 ${plugins.length} 个…\n` + JSON.stringify({mode, dshDir, productName, plugins}, null, 2)
  try {
    const res = await window.builderAPI.build({ mode, dshDir, productName, plugins })
    logEl.textContent += '\n' + (res.log || JSON.stringify(res))
  } catch (e) {
    logEl.textContent += '\n构建失败: ' + e.message
  }
}
modeEl.addEventListener('change', render)
dshDirEl.addEventListener('change', fetchCatalog)
searchEl.addEventListener('input', render)
filterCatEl.addEventListener('change', render)
fetchCatalog()
