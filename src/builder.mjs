const listEl = document.getElementById('list')
const logEl = document.getElementById('log')
let catalog = []

async function fetchCatalog() {
  // External sources: dsh-hub plugins + deepseek-harness packages (via window.electron API)
  catalog = await window.builderAPI.listPlugins(document.getElementById('dshDir').value)
  render()
}
function render() {
  listEl.innerHTML = ''
  const mode = document.getElementById('mode').value
  const uniqueGroups = {}
  for (const p of catalog) {
    const card = document.createElement('div')
    card.className = 'card ' + (p.unique ? 'unique' : 'multi')
    const type = p.unique ? '唯一' : '不限数'
    card.innerHTML = `
      <div><b>${p.name}</b> <small>${type} · ${p.category||''}</small></div>
      <div style="font-size:12px;color:#aaa">${p.description||''}</div>
      <div style="font-size:12px">id: <input data-id="${p.id}" value="${p.id}" style="width:140px" ${p.unique?'':'placeholder="my-'+p.id}" /></div>
      <label><input type="${p.unique?'radio':'checkbox'}" name="${p.unique?'unique-'+p.category:p.id}" data-name="${p.name}" ${p.enabled?'checked':''} /> ${p.unique ? '选用' : '添加'}</label>
    `
    // For unique, radio group per category ensures single
    if (p.unique) {
      card.querySelector('input[type=radio]').addEventListener('change', e => {
        if (e.target.checked) {
          // uncheck others in same category
          document.querySelectorAll(`input[name="unique-${p.category}"]`).forEach(el => { if (el!==e.target) el.checked=false })
        }
      })
    }
    listEl.appendChild(card)
  }
}
window.addCustom = () => {
  const spec = document.getElementById('customSpec').value.trim()
  if (!spec) return
  const id = spec.split('/').pop().split(':').pop().replace(/[^a-z0-9-]/gi,'-').slice(0,24)
  catalog.push({ id, name: spec, description: '用户自定义', category: 'custom', unique: false, enabled: true })
  render()
}
window.build = async () => {
  const mode = document.getElementById('mode').value
  const dshDir = document.getElementById('dshDir').value
  const productName = document.getElementById('productName').value
  const plugins = []
  const seenUnique = new Set()
  document.querySelectorAll('#list .card').forEach(card => {
    const inp = card.querySelector('input[type=checkbox],input[type=radio]')
    if (!inp.checked) return
    const id = card.querySelector('input[data-id]').value.trim()
    const name = inp.dataset.name
    const unique = card.classList.contains('unique')
    if (unique) {
      if (seenUnique.has(inp.name)) return
      seenUnique.add(inp.name)
    }
    plugins.push({ id, name })
  })
  logEl.textContent = `mode=${mode} dshDir=${dshDir} plugins=${plugins.length}\n` + JSON.stringify({mode, dshDir, productName, plugins}, null, 2)
  const res = await window.builderAPI.build({ mode, dshDir, productName, plugins })
  logEl.textContent += '\n' + res.log
}
document.getElementById('mode').addEventListener('change', render)
document.getElementById('dshDir').addEventListener('change', fetchCatalog)
fetchCatalog()
