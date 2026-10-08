# Echo Memory Engine (EME) — GUI Dashboard

A visual, responsive, zero-dependency configuration dashboard for non-technical users and developers to manage, tune, test, and save EME settings.

---

## ✨ Features

- **Non-Technical Friendly**: Visual cards, intuitive toggle switches, sensitivity sliders, and built-in explanations for all parameters.
- **One-Click Presets**:
  - 🟢 **Local Solo**: 100% on-device, offline, zero API keys or external DBs.
  - ⚡ **Production High-Accuracy**: 2048-dim Llama Nemotron embeddings + Qdrant vector database.
  - 🍃 **Ultra-Lightweight**: Minimal RAM and CPU consumption for Raspberry Pi or low-end hardware.
  - 🌐 **Sovereign Web3**: IPFS snapshot pinning with verifiable CIDs.
- **Mobile Responsive**: Adaptive navigation drawer, touch-friendly inputs, and flexible card layouts.
- **Bidirectional Persistence**: Save/load directly with the EME server, download/export as JSON, import from file, or reset to defaults.
- **Live Test Bench**: Run Doctor system audits, test semantic vector queries, and store test memories directly from the browser.
- **Raw JSON Editor**: Synchronized JSON inspector for advanced users.

---

## 🛠️ Developer Extensibility Guide (Schema-Driven)

The dashboard is engineered with a **Schema-Driven Architecture**. Form elements, options, types, defaults, and validation are generated dynamically from the configuration schema.

### How to Add a New Option/Feature in the Future

To add any new option to the GUI dashboard, you **do not** need to write HTML or CSS. Simply open `frontend/config-schema.js` and add an object to the `CONFIG_FIELDS` array:

```javascript
{
  key: 'myNewSetting',               // Exact key name used in EME Config
  category: 'models',                // Sidebar category ID to display under
  label: 'Enable Hyper-Compression', // Human-readable label
  type: 'toggle',                    // Input type: 'text', 'number', 'password', 'select', 'slider', 'toggle'
  default: false,                    // Default fallback value
  description: 'Compresses long memories using local tiny models.',
  advanced: false                    // Hide behind advanced toggle if true
}
```

### Valid Field Types Supported
1. `text`: Text input box.
2. `number`: Number input with `min`, `max`, and `step` properties.
3. `password`: Masked input for keys/URIs (redacted in API display).
4. `select`: Dropdown menu requiring an `options: [{value, label}]` array.
5. `slider`: Floating-point range slider with `min`, `max`, and `step` scale.
6. `toggle`: Binary checkbox switch.

That's it! The frontend takes care of everything else.

---

## 🚀 Quick Launch

### Option 1: Integrated EME HTTP Server (Recommended)
Run from the root of the EME project:
```bash
make gui
# or
node dist/eme-http-server.js
```
Open `http://localhost:3100` in your desktop or mobile browser.

### Option 2: Standalone Offline Mode
Open `frontend/index.html` directly or serve via any lightweight HTTP server:
```bash
npx serve frontend
```

---

## 🛠️ How to Add New EME Features in the Future

The dashboard is **100% schema-driven**. You do not need to edit HTML or CSS when adding new EME options:

1. Open `frontend/config-schema.js`.
2. Append a new entry to `CONFIG_FIELDS`:
```javascript
{
  key: 'newFeatureKey',
  category: 'gate', // overview, models, storage, gate, graph, snapshots, system
  label: 'Human-Readable Option Name',
  type: 'toggle',   // toggle, slider, select, text, number, password
  default: true,
  description: 'Explanation of what this new feature does.',
  advanced: false
}
```
3. Refresh the browser — the UI automatically renders the control, binds state, and syncs with the server.

---

## 🚀 Quick Launch

### Option 1: Integrated EME HTTP Server (Recommended)
Run from the root of the EME project:
```bash
make gui
# or
node dist/eme-http-server.js
```
Open `http://localhost:3100` in your desktop or mobile browser.

### Option 2: Standalone Offline Mode
Open `frontend/index.html` directly or serve via any lightweight HTTP server:
```bash
npx serve frontend
```

---

## 🛠️ How to Add New EME Features in the Future

The dashboard is **100% schema-driven**. You do not need to edit HTML or CSS when adding new EME options:

1. Open `frontend/config-schema.js`.
2. Append a new entry to `CONFIG_FIELDS`:
```javascript
{
  key: 'newFeatureKey',
  category: 'gate', // overview, models, storage, gate, graph, snapshots, system
  label: 'Human-Readable Option Name',
  type: 'toggle',   // toggle, slider, select, text, number, password
  default: true,
  description: 'Explanation of what this new feature does.',
  advanced: false
}
```
3. Refresh the browser — the UI automatically renders the control, binds state, and syncs with the server.
