const listEl = document.getElementById('list')
const logEl = document.getElementById('log')
const dshDirEl = document.getElementById('dshDir')
const modeEl = document.getElementById('mode')
const dshVersionEl = document.getElementById('dshVersion')
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
  if (!catalog.length) {
    logEl.textContent += '\n未发现插件，请检查 DSH_DIR 是否为 deepseek-harness 检出（含 packages/）且 dsh-hub/plugins 存在'
  } else {
    logEl.textContent = `已加载 ${catalog.length} 个插件（唯一 ${catalog.filter(c=>c.unique).length} / 不限数 ${catalog.filter(c=>!c.unique).length}）`
  }
  render()
}
function render() {
  listEl.innerHTML = ''
  // Group by category
  const byCat = {}
  for (const p of catalog) {
    if (!byCat[p.category]) byCat[p.category] = []
    byCat[p.category].push(p)
  }
  for (const [cat, items] of Object.entries(byCat).sort()) {
    const header = document.createElement('div')
    header.style.gridColumn = '1 / -1'
    header.style.fontSize = '12px'
    header.style.color = '#888'
    header.style.marginTop = '8px'
    header.textContent = `${cat} — ${items.length} 个`
    listEl.appendChild(header)
    for (const p of items) {
      const card = document.createElement('div')
      card.className = 'card ' + (p.unique ? 'unique' : 'multi')
      const badge = p.unique ? '唯一' : '不限数'
      const badgeCls = p.unique ? 'badge unique' : 'badge multi'
      card.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px"><h3>${p.name}</h3><span class="${badgeCls}">${badge}</span></div>
        <p>${p.description || '—'}</p>
        <div class="meta">id: <input data-id="${p.id}" value="${p.id}" style="width:160px" /> · ${p.category}</div>
        <label style="display:flex;align-items:center;gap:6px"><input type="${p.unique?'radio':'checkbox'}" name="${p.unique?'unique-'+p.category:p.id}" data-name="${p.name}" ${p.enabled?'checked':''} /> ${p.unique ? '选用（同类唯一）' : '添加'}</label>
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
  if (!catalog.length) {
    const empty = document.createElement('div')
    empty.style.gridColumn = '1 / -1'
    empty.style.color = '#666'
    empty.style.fontSize = '13px'
    empty.innerHTML = '暂无插件 — 请检查 <code>dsh-hub/plugins</code> 是否已 <code>git submodule update --init</code>，或在上方输入 <code>github:owner/repo</code> 手动添加'
    listEl.appendChild(empty)
  }
}
window.addCustom = () => {
  const spec = document.getElementById('customSpec').value.trim()
  if (!spec) return
  const id = spec.split('/').pop().split(':').pop().replace(/[^a-z0-9-]/gi,'-').slice(0,24).toLowerCase() || 'custom'
  catalog.push({ id, name: spec, description: '用户自定义', category: 'custom', unique: false, enabled: true })
  document.getElementById('customSpec').value = ''
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
    } else {
      // multi: allow duplicate name with different id, so don't dedup by name
    }
    // id globally unique check later in main
    plugins.push({ id, name })
  })
  if (!plugins.length) {
    logEl.textContent = '请至少选择一个插件（或添加自定义源）'
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
fetchCatalog()
