import { CONFIG_CATEGORIES, CONFIG_FIELDS, CONFIG_PRESETS } from './config-schema.js';

// Application State
const state = {
  activeCategory: 'overview',
  showAdvanced: false,
  serverEndpoint: window.location.origin && window.location.origin !== 'null' && !window.location.origin.startsWith('file:') 
    ? window.location.origin 
    : 'http://localhost:3100',
  isConnected: false,
  currentConfig: {}
};

// DOM Element References
const elements = {
  serverEndpoint: document.getElementById('serverEndpoint'),
  connectionBadge: document.getElementById('connectionBadge'),
  connectionStatusText: document.getElementById('connectionStatusText'),
  sidebarNav: document.getElementById('sidebarNav'),
  appSidebar: document.getElementById('appSidebar'),
  mobileMenuToggle: document.getElementById('mobileMenuToggle'),
  toggleAdvanced: document.getElementById('toggleAdvanced'),
  presetsContainer: document.getElementById('presetsContainer'),
  dynamicFormContainer: document.getElementById('dynamicFormContainer'),
  dynamicPanelTitle: document.getElementById('dynamicPanelTitle'),
  dynamicPanelDesc: document.getElementById('dynamicPanelDesc'),
  rawJsonEditor: document.getElementById('rawJsonEditor'),
  toastContainer: document.getElementById('toastContainer'),
  statEmbedding: document.getElementById('statEmbedding'),
  statDimensions: document.getElementById('statDimensions'),
  statVectorStore: document.getElementById('statVectorStore'),
  statMemoryGate: document.getElementById('statMemoryGate'),
  // Config action buttons (were referenced in setupEventListeners but missing
  // from this map -> TypeError aborted the whole listener setup).
  btnSaveServer: document.getElementById('btnSaveServer'),
  btnLoadServer: document.getElementById('btnLoadServer'),
  btnExportConfig: document.getElementById('btnExportConfig'),
  btnImportTrigger: document.getElementById('btnImportTrigger'),
  btnResetDefaults: document.getElementById('btnResetDefaults')
};

// Toast Notifications
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
  toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
  elements.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 200);
  }, 3500);
}

// Initialize default config values from schema
function initDefaultConfig() {
  const defaults = {};
  for (const field of CONFIG_FIELDS) {
    defaults[field.key] = field.default;
  }
  return defaults;
}

// Render Sidebar Navigation from Categories
function renderSidebar() {
  elements.sidebarNav.innerHTML = '';
  CONFIG_CATEGORIES.forEach(cat => {
    const item = document.createElement('div');
    item.className = `nav-item ${state.activeCategory === cat.id ? 'active' : ''}`;
    item.innerHTML = `<span class="nav-item-icon">${cat.icon}</span><span>${cat.label}</span>`;
    item.onclick = () => {
      setActiveCategory(cat.id);
      if (window.innerWidth <= 868) elements.appSidebar.classList.remove('open');
    };
    elements.sidebarNav.appendChild(item);
  });
}

// Switch Active Panel
function setActiveCategory(catId) {
  state.activeCategory = catId;
  renderSidebar();
  
  document.getElementById('panel-overview').style.display = catId === 'overview' ? 'block' : 'none';
  document.getElementById('panel-playground').style.display = catId === 'playground' ? 'block' : 'none';
  document.getElementById('panel-raw').style.display = catId === 'raw' ? 'block' : 'none';
  
  const isDynamic = !['overview', 'playground', 'raw'].includes(catId);
  document.getElementById('panel-dynamic-form').style.display = isDynamic ? 'block' : 'none';
  
  if (isDynamic) {
    const catObj = CONFIG_CATEGORIES.find(c => c.id === catId);
    elements.dynamicPanelTitle.textContent = `${catObj.icon} ${catObj.label}`;
    elements.dynamicPanelDesc.textContent = catObj.description;
    renderDynamicForm(catId);
  } else if (catId === 'raw') {
    elements.rawJsonEditor.value = JSON.stringify(state.currentConfig, null, 2);
  } else if (catId === 'overview') {
    updateOverviewStats();
  }
}

// Render Preset Cards
function renderPresets() {
  elements.presetsContainer.innerHTML = '';
  CONFIG_PRESETS.forEach(preset => {
    const card = document.createElement('div');
    card.className = 'preset-card';
    card.innerHTML = `
      <span class="preset-badge">${preset.badge}</span>
      <h3>${preset.title}</h3>
      <p>${preset.description}</p>
      <button class="btn btn-secondary" style="margin-top: 1rem; width: 100%; font-size: 0.8rem;">Apply Profile</button>
    `;
    card.querySelector('button').onclick = (e) => {
      e.stopPropagation();
      applyPreset(preset);
    };
    card.onclick = () => applyPreset(preset);
    elements.presetsContainer.appendChild(card);
  });
}

// Update Overview Stats Cards
function updateOverviewStats() {
  const cfg = state.currentConfig;
  elements.statEmbedding.textContent = (cfg.embeddingModel || 'local').toUpperCase();
  elements.statDimensions.textContent = cfg.embeddingDimension ? `${cfg.embeddingDimension} dims` : '384 dims';
  elements.statVectorStore.textContent = (cfg.vectorStore || 'memory').toUpperCase();
  elements.statMemoryGate.textContent = cfg.memoryGateEnabled ? 'ACTIVE (Enabled)' : 'OFF (Bypassed)';
  elements.statMemoryGate.style.color = cfg.memoryGateEnabled ? '#34d399' : '#94a3b8';
}

// Render Dynamic Form Controls based on schema
function renderDynamicForm(category) {
  elements.dynamicFormContainer.innerHTML = '';
  const fields = CONFIG_FIELDS.filter(f => f.category === category && (state.showAdvanced || !f.advanced));
  
  fields.forEach(field => {
    const group = document.createElement('div');
    group.className = 'field-group';
    const currentValue = state.currentConfig[field.key] !== undefined ? state.currentConfig[field.key] : field.default;
    
    if (field.type === 'toggle') {
      group.innerHTML = `
        <div class="switch-container">
          <div>
            <div class="field-label">${field.label}</div>
            <div class="field-desc">${field.description}</div>
          </div>
          <label class="switch">
            <input type="checkbox" id="field-${field.key}" ${currentValue ? 'checked' : ''}>
            <span class="slider-round"></span>
          </label>
        </div>
      `;
      group.querySelector('input').onchange = (e) => {
        state.currentConfig[field.key] = e.target.checked;
      };
    } else if (field.type === 'slider') {
      group.innerHTML = `
        <div class="field-label-row">
          <label class="field-label" for="field-${field.key}">${field.label}</label>
          <span class="slider-value" id="val-${field.key}">${currentValue}</span>
        </div>
        <div class="field-desc">${field.description}</div>
        <div class="slider-row">
          <input type="range" id="field-${field.key}" min="${field.min}" max="${field.max}" step="${field.step}" value="${currentValue}">
        </div>
      `;
      const rangeInput = group.querySelector('input');
      const valDisplay = group.querySelector(`#val-${field.key}`);
      rangeInput.oninput = (e) => {
        valDisplay.textContent = e.target.value;
        state.currentConfig[field.key] = parseFloat(e.target.value);
      };
    } else if (field.type === 'select') {
      const optsHtml = field.options.map(opt => `<option value="${opt.value}" ${opt.value === currentValue ? 'selected' : ''}>${opt.label}</option>`).join('');
      group.innerHTML = `
        <div class="field-label-row">
          <label class="field-label" for="field-${field.key}">${field.label}</label>
        </div>
        <div class="field-desc">${field.description}</div>
        <select class="form-control" id="field-${field.key}">${optsHtml}</select>
      `;
      group.querySelector('select').onchange = (e) => {
        state.currentConfig[field.key] = e.target.value;
      };
    } else {
      // text, number, password
      const inputType = field.type === 'password' ? 'password' : field.type === 'number' ? 'number' : 'text';
      group.innerHTML = `
        <div class="field-label-row">
          <label class="field-label" for="field-${field.key}">${field.label}</label>
        </div>
        <div class="field-desc">${field.description}</div>
        <input type="${inputType}" class="form-control" id="field-${field.key}" value="${currentValue || ''}" placeholder="${field.placeholder || ''}" ${field.step ? `step="${field.step}"` : ''}>
      `;
      group.querySelector('input').oninput = (e) => {
        state.currentConfig[field.key] = field.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value;
      };
    }
    elements.dynamicFormContainer.appendChild(group);
  });
}

// Check Connection to EME Server
async function checkConnection() {
  const url = elements.serverEndpoint.value.trim().replace(/\/+$/, '');
  state.serverEndpoint = url;
  try {
    const res = await fetch(`${url}/health`, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
    if (res.ok) {
      const data = await res.json();
      state.isConnected = true;
      elements.connectionBadge.className = 'status-badge connected';
      elements.connectionStatusText.textContent = `Online (v${data.version || '1.2.1'})`;
      return true;
    }
  } catch (err) {
    // disconnected
  }
  state.isConnected = false;
  elements.connectionBadge.className = 'status-badge';
  elements.connectionStatusText.textContent = 'Disconnected (Local Cache)';
  return false;
}

// Load Config from EME HTTP Server
async function loadConfigFromServer() {
  const isOnline = await checkConnection();
  if (!isOnline) {
    showToast('EME server unreachable. Using local profile.', 'error');
    return;
  }
  try {
    const res = await fetch(`${state.serverEndpoint}/api/config`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.config) {
      state.currentConfig = { ...state.currentConfig, ...data.config };
      setActiveCategory(state.activeCategory);
      showToast('Loaded active configuration from server!', 'success');
    }
  } catch (err) {
    showToast(`Failed to load config: ${err.message}`, 'error');
  }
}

// Save Config to EME Server
async function saveConfigToServer() {
  const isOnline = await checkConnection();
  if (!isOnline) {
    showToast('EME server is offline. Changes kept in local UI.', 'error');
    return;
  }
  try {
    const payload = { ...state.currentConfig };
    delete payload.encryptionKey; // Never push empty or redacted key
    delete payload.openRouterApiKey;
    delete payload.postgresConnection;
    
    const res = await fetch(`${state.serverEndpoint}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP ${res.status}`);
    }
    showToast('Configuration successfully saved and applied!', 'success');
    updateOverviewStats();
  } catch (err) {
    showToast(`Save error: ${err.message}`, 'error');
  }
}

// Apply Preset Profile
function applyPreset(preset) {
  state.currentConfig = { ...state.currentConfig, ...preset.config };
  setActiveCategory(state.activeCategory);
  showToast(`Applied "${preset.title}" profile!`, 'success');
}

// Export Config as Downloadable JSON
function exportConfigToFile() {
  const blob = new Blob([JSON.stringify(state.currentConfig, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'eme-config.json';
  a.click();
  URL.revokeObjectURL(url);
  showToast('Downloaded eme-config.json', 'success');
}

// Import Config from User Selected File
function importConfigFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      state.currentConfig = { ...state.currentConfig, ...parsed };
      setActiveCategory(state.activeCategory);
      showToast('Successfully imported configuration!', 'success');
    } catch (err) {
      showToast('Invalid JSON file format', 'error');
    }
  };
  reader.readAsText(file);
}

// Run Doctor Audit
async function runDoctorAudit() {
  const out = document.getElementById('doctorOutput');
  out.textContent = 'Running system health audit...';
  try {
    const res = await fetch(`${state.serverEndpoint}/api/tools/doctor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verbose: true })
    });
    const data = await res.json();
    out.textContent = JSON.stringify(data, null, 2);
    showToast('Health audit completed!', 'success');
  } catch (err) {
    out.textContent = `Diagnostic check failed: ${err.message}`;
  }
}

// Execute Semantic Search Query Test
async function executeSearch() {
  const query = document.getElementById('playgroundSearchQuery').value.trim();
  if (!query) return showToast('Please enter a query', 'error');
  const out = document.getElementById('searchOutput');
  out.textContent = 'Searching...';
  try {
    const res = await fetch(`${state.serverEndpoint}/api/tools/search_memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, limit: 5, includeGraph: true })
    });
    const data = await res.json();
    out.textContent = JSON.stringify(data, null, 2);
  } catch (err) {
    out.textContent = `Search failed: ${err.message}`;
  }
}

// Store Test Memory
async function executeAddMemory() {
  const text = document.getElementById('playgroundMemoryText').value.trim();
  const namespace = document.getElementById('playgroundNamespace').value.trim() || 'default';
  if (!text) return showToast('Please enter memory text', 'error');
  const out = document.getElementById('addMemoryOutput');
  out.textContent = 'Ingesting memory...';
  try {
    const res = await fetch(`${state.serverEndpoint}/api/tools/add_memory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, namespace, agentId: 'gui-user', visibility: 'shared' })
    });
    const data = await res.json();
    out.textContent = JSON.stringify(data, null, 2);
    showToast('Memory successfully stored!', 'success');
  } catch (err) {
    out.textContent = `Add failed: ${err.message}`;
  }
}

// Setup Event Listeners and Initialize
function setupEventListeners() {
  elements.btnSaveServer.onclick = saveConfigToServer;
  elements.btnLoadServer.onclick = loadConfigFromServer;
  elements.btnExportConfig.onclick = exportConfigToFile;
  elements.btnImportTrigger.onclick = () => document.getElementById('importFileInput').click();
  document.getElementById('importFileInput').onchange = (e) => {
    if (e.target.files.length > 0) importConfigFile(e.target.files[0]);
  };
  
  elements.btnResetDefaults.onclick = async () => {
    if (!confirm('Reset configuration to minimal defaults?')) return;
    state.currentConfig = initDefaultConfig();
    setActiveCategory(state.activeCategory);
    showToast('Reset to default configuration', 'info');
  };
  
  document.getElementById('btnSaveCategory').onclick = saveConfigToServer;
  document.getElementById('btnResetCategory').onclick = () => renderDynamicForm(state.activeCategory);
  
  elements.toggleAdvanced.onchange = (e) => {
    state.showAdvanced = e.target.checked;
    if (!['overview', 'playground', 'raw'].includes(state.activeCategory)) {
      renderDynamicForm(state.activeCategory);
    }
  };
  
  elements.mobileMenuToggle.onclick = () => elements.appSidebar.classList.toggle('open');
  elements.serverEndpoint.onchange = checkConnection;
  
  document.getElementById('btnRunDoctor').onclick = runDoctorAudit;
  document.getElementById('btnExecuteSearch').onclick = executeSearch;
  document.getElementById('btnExecuteAddMemory').onclick = executeAddMemory;
  
  document.getElementById('btnApplyRawJson').onclick = () => {
    try {
      const parsed = JSON.parse(elements.rawJsonEditor.value);
      state.currentConfig = parsed;
      showToast('Raw JSON applied successfully', 'success');
    } catch (e) {
      showToast('Invalid JSON syntax', 'error');
    }
  };
  
  document.getElementById('btnFormatRawJson').onclick = () => {
    try {
      const parsed = JSON.parse(elements.rawJsonEditor.value);
      elements.rawJsonEditor.value = JSON.stringify(parsed, null, 2);
    } catch (e) {
      showToast('Cannot format invalid JSON', 'error');
    }
  };
}

// Bootstrap Application
async function bootstrap() {
  state.currentConfig = initDefaultConfig();
  renderSidebar();
  renderPresets();
  setupEventListeners();
  setActiveCategory('overview');
  const isOnline = await checkConnection();
  if (isOnline) {
    await loadConfigFromServer();
  }
}

bootstrap();
