/* ============================================
   SEGUNDO CEREBRO - App Principal
   ============================================ */

// ---- INDEXED DB STORAGE ----
const Storage = {
    DB_NAME: 'SegundoCerebroDB',
    DB_VERSION: 1,
    STORE_NAME: 'entries',
    API_KEY: 'segundo_cerebro_apikey',
    _db: null,

    async init() {
        if (this._db) return this._db;
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);
            request.onerror = () => reject(request.error);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(this.STORE_NAME)) {
                    const store = db.createObjectStore(this.STORE_NAME, { keyPath: 'id' });
                    store.createIndex('date', 'date', { unique: false });
                    store.createIndex('area', 'area', { unique: false });
                    store.createIndex('createdAt', 'createdAt', { unique: false });
                }
            };
            request.onsuccess = () => {
                this._db = request.result;
                resolve(this._db);
            };
        });
    },

    async migrateFromLocalStorage() {
        try {
            const oldKey = 'segundo_cerebro_entries';
            const raw = localStorage.getItem(oldKey);
            if (!raw) return;
            const entries = JSON.parse(raw);
            if (!Array.isArray(entries) || entries.length === 0) return;

            // Check if we already have data in IndexedDB
            const existing = await this.getEntries();
            if (existing.length > 0) return; // Already migrated

            const db = await this.init();
            const tx = db.transaction(this.STORE_NAME, 'readwrite');
            const store = tx.objectStore(this.STORE_NAME);

            for (const entry of entries) {
                store.put(entry);
            }

            await new Promise((resolve, reject) => {
                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error);
            });

            // Mark migration as done (but keep old data as backup for a while)
            localStorage.setItem('segundo_cerebro_migrated', 'true');
            console.log(`✅ Migrated ${entries.length} entries from localStorage to IndexedDB`);
        } catch (err) {
            console.error('Migration error:', err);
        }
    },

    async getEntries() {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE_NAME, 'readonly');
            const store = tx.objectStore(this.STORE_NAME);
            const request = store.getAll();
            request.onsuccess = () => {
                // Sort by createdAt descending (newest first)
                const entries = request.result.sort((a, b) =>
                    new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date)
                );
                resolve(entries);
            };
            request.onerror = () => reject(request.error);
        });
    },

    async addEntry(entry) {
        entry.id = Date.now().toString(36) + Math.random().toString(36).slice(2);
        entry.createdAt = new Date().toISOString();
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE_NAME, 'readwrite');
            const store = tx.objectStore(this.STORE_NAME);
            const request = store.add(entry);
            request.onsuccess = () => resolve(entry);
            request.onerror = () => reject(request.error);
        });
    },

    async getEntry(id) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE_NAME, 'readonly');
            const store = tx.objectStore(this.STORE_NAME);
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    },

    async getByArea(area) {
        const entries = await this.getEntries();
        return entries.filter(e => e.area === area && e.processed);
    },

    async getAllFlashcards() {
        const entries = await this.getEntries();
        const fc = [];
        entries.forEach(entry => {
            if (entry.flashcards) {
                entry.flashcards.forEach(card => {
                    fc.push({ ...card, entryTitle: entry.title, date: entry.date, area: entry.area });
                });
            }
        });
        return fc;
    },

    async updateEntry(id, updates) {
        const db = await this.init();
        const entry = await this.getEntry(id);
        if (!entry) return null;
        Object.assign(entry, updates);
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE_NAME, 'readwrite');
            const store = tx.objectStore(this.STORE_NAME);
            const request = store.put(entry);
            request.onsuccess = () => resolve(entry);
            request.onerror = () => reject(request.error);
        });
    },

    async deleteEntry(id) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE_NAME, 'readwrite');
            const store = tx.objectStore(this.STORE_NAME);
            const request = store.delete(id);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    },

    // Settings still use localStorage (small data, no need for IndexedDB)
    getApiKey() { return localStorage.getItem(this.API_KEY) || ''; },
    setApiKey(key) { localStorage.setItem(this.API_KEY, key); },
    getModel() { return localStorage.getItem('segundo_cerebro_model') || 'gemini-2.0-flash'; },
    setModel(m) { localStorage.setItem('segundo_cerebro_model', m); },
    getProvider() { return localStorage.getItem('segundo_cerebro_provider') || 'groq'; },
    setProvider(p) { localStorage.setItem('segundo_cerebro_provider', p); },
    getGroqKey() { return localStorage.getItem('segundo_cerebro_groq_key') || ''; },
    setGroqKey(k) { localStorage.setItem('segundo_cerebro_groq_key', k); },

    async exportData() {
        const entries = await this.getEntries();
        const data = {
            version: 2,
            exportedAt: new Date().toISOString(),
            entries: entries,
            provider: this.getProvider(),
            model: this.getModel()
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `segundo-cerebro-backup-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    },

    async importData(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    if (!data.entries || !Array.isArray(data.entries)) {
                        reject(new Error('Formato inválido'));
                        return;
                    }
                    // Clear existing and import all
                    const db = await this.init();
                    const tx = db.transaction(this.STORE_NAME, 'readwrite');
                    const store = tx.objectStore(this.STORE_NAME);
                    store.clear();
                    for (const entry of data.entries) {
                        store.put(entry);
                    }
                    await new Promise((res, rej) => {
                        tx.oncomplete = res;
                        tx.onerror = () => rej(tx.error);
                    });
                    resolve(data.entries.length);
                } catch (err) {
                    reject(new Error('El archivo no es un backup válido'));
                }
            };
            reader.onerror = () => reject(new Error('Error al leer el archivo'));
            reader.readAsText(file);
        });
    },

    async getStorageInfo() {
        if ('storage' in navigator && 'estimate' in navigator.storage) {
            const estimate = await navigator.storage.estimate();
            return {
                used: estimate.usage || 0,
                quota: estimate.quota || 0,
                usedMB: ((estimate.usage || 0) / (1024 * 1024)).toFixed(2),
                quotaMB: ((estimate.quota || 0) / (1024 * 1024)).toFixed(0)
            };
        }
        return null;
    }
};

// ---- AI PROVIDER ----
const CORNELL_PROMPT = `Eres un asistente de diario personal. Analiza este texto usando el Método Cornell.
Devuelve SOLO un JSON válido con esta estructura exacta:
{
  "title": "Título corto (máx 8 palabras)",
  "area": "UNA de: Diario, Dinero, Aprendizaje, Relaciones, Viajes, Historia, Random",
  "keyIdeas": ["idea 1", "idea 2", "idea 3"],
  "summary": "Resumen de 2-3 oraciones",
  "flashcards": [
    {"question": "Pregunta 1", "answer": "Respuesta 1"},
    {"question": "Pregunta 2", "answer": "Respuesta 2"}
  ]
}
Reglas:
- 3 a 5 ideas clave como frases cortas
- Usa "Diario" SOLO si el texto es un registro cotidiano sin aprendizaje o crecimiento claro (ej: "hoy desayuné, fui al gym, vi Netflix")
- Para cualquier otro contenido, usa el área más relevante
- Las flashcards deben ayudar a memorizar lo escrito
- NO incluyas markdown ni texto extra, solo JSON puro`;

const AIProvider = {
    async process(text) {
        const provider = Storage.getProvider();
        if (provider === 'groq') return this.callGroq(text);
        return this.callGemini(text);
    },

    async callGroq(text) {
        const apiKey = Storage.getGroqKey();
        if (!apiKey) throw new Error('NO_API_KEY');

        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages: [
                    { role: 'system', content: CORNELL_PROMPT },
                    { role: 'user', content: text }
                ],
                temperature: 0.7,
                response_format: { type: 'json_object' }
            })
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error?.message || `Error ${res.status}`);
        }

        const data = await res.json();
        let txt = data.choices?.[0]?.message?.content || '';
        return this.parseResult(txt);
    },

    async callGemini(text) {
        const apiKey = Storage.getApiKey();
        if (!apiKey) throw new Error('NO_API_KEY');

        const prompt = CORNELL_PROMPT + `\n\nTexto:\n"""\n${text}\n"""`;
        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${Storage.getModel()}:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.7 }
                })
            }
        );

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error?.message || `Error ${res.status}`);
        }

        const data = await res.json();
        let txt = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return this.parseResult(txt);
    },

    parseResult(txt) {
        txt = txt.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();
        const result = JSON.parse(txt);
        const validAreas = ['Diario', 'Dinero', 'Aprendizaje', 'Relaciones', 'Viajes', 'Historia', 'Random'];
        if (!validAreas.includes(result.area)) result.area = 'Random';
        if (!Array.isArray(result.keyIdeas)) result.keyIdeas = [];
        if (!Array.isArray(result.flashcards)) result.flashcards = [];
        return result;
    }
};

// ---- ROUTER ----
const Router = {
    init() {
        window.addEventListener('hashchange', () => this.navigate());
        this.navigate();
    },
    navigate() {
        const hash = location.hash.slice(1) || 'diario';
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
        const view = document.getElementById(`view-${hash}`);
        const tab = document.querySelector(`[data-view="${hash}"]`);
        if (view) view.classList.add('active');
        if (tab) tab.classList.add('active');
        if (hash === 'mapa') MapView.render();
        if (hash === 'flashcards') FlashcardsView.render();
    }
};

// ---- DIARY VIEW ----
const DiaryView = {
    currentEntryId: null,

    async init() {
        const now = new Date();
        const opts = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        document.getElementById('currentDate').textContent = now.toLocaleDateString('es-ES', opts);
        await this.loadSelector();
        document.getElementById('entrySelector').addEventListener('change', e => {
            e.target.value === 'new' ? this.newEntry() : this.loadEntry(e.target.value);
        });
    },

    async loadSelector() {
        const sel = document.getElementById('entrySelector');
        sel.innerHTML = '<option value="new">+ Nueva entrada</option>';
        const entries = await Storage.getEntries();
        entries.forEach(entry => {
            const o = document.createElement('option');
            o.value = entry.id;
            const d = new Date(entry.date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
            o.textContent = entry.processed ? `${d} — ${entry.title}` : `${d} — (sin procesar)`;
            sel.appendChild(o);
        });
    },

    async loadEntry(id) {
        const entry = await Storage.getEntry(id);
        if (!entry) return;
        this.currentEntryId = id;
        document.getElementById('diaryText').value = entry.rawText;
        document.getElementById('keyIdeasText').value = entry.keyIdeasText || (entry.keyIdeas || []).join('\n');
        document.getElementById('daySummary').value = entry.summary || '';
        if (entry.processed) {
            this.renderCornell(entry);
            document.getElementById('diaryText').readOnly = true;
            document.getElementById('keyIdeasText').readOnly = true;
            document.getElementById('daySummary').readOnly = true;
            document.getElementById('processBtn').style.display = 'none';
            document.getElementById('editBtn').style.display = 'flex';
            document.getElementById('deleteBtn').style.display = 'flex';
            document.getElementById('newEntryBtn').style.display = 'flex';
        } else {
            this.clearCornell();
            document.getElementById('processBtn').style.display = 'flex';
            document.getElementById('editBtn').style.display = 'none';
            document.getElementById('deleteBtn').style.display = 'none';
            document.getElementById('newEntryBtn').style.display = 'none';
        }
    },

    newEntry() {
        this.currentEntryId = null;
        document.getElementById('diaryText').value = '';
        document.getElementById('diaryText').readOnly = false;
        document.getElementById('keyIdeasText').value = '';
        document.getElementById('keyIdeasText').readOnly = false;
        document.getElementById('daySummary').value = '';
        document.getElementById('daySummary').readOnly = false;
        document.getElementById('entrySelector').value = 'new';
        document.getElementById('processBtn').style.display = 'flex';
        document.getElementById('editBtn').style.display = 'none';
        document.getElementById('deleteBtn').style.display = 'none';
        document.getElementById('newEntryBtn').style.display = 'none';
        this.clearCornell();
        document.getElementById('diaryText').focus();
    },

    clearCornell() {
        document.getElementById('entryTitle').textContent = 'Nueva Entrada';
        const badge = document.getElementById('entryArea');
        badge.textContent = 'Sin área';
        badge.className = 'area-badge area-badge-empty';
    },

    allAreas: ['Diario', 'Dinero', 'Aprendizaje', 'Relaciones', 'Viajes', 'Historia', 'Random'],
    areaIcons: { Diario: '📓', Dinero: '💰', Aprendizaje: '📚', Relaciones: '❤️', Viajes: '✈️', Historia: '📖', Random: '🎲' },

    renderCornell(data) {
        document.getElementById('entryTitle').textContent = data.title;
        const badge = document.getElementById('entryArea');
        badge.textContent = data.area;
        badge.className = 'area-badge area-' + data.area.toLowerCase();
        badge.title = 'Click para cambiar área';
        badge.style.cursor = 'pointer';
        badge.onclick = () => this.showAreaSelector(badge);
        document.getElementById('keyIdeasText').value = (data.keyIdeas || []).join('\n');
        document.getElementById('daySummary').value = data.summary || '';
    },

    showAreaSelector(badge) {
        if (!this.currentEntryId) return;
        // Remove existing selector
        const existing = document.querySelector('.area-selector');
        if (existing) { existing.remove(); return; }

        const dropdown = document.createElement('div');
        dropdown.className = 'area-selector';
        this.allAreas.forEach(area => {
            const opt = document.createElement('button');
            opt.className = 'area-selector-option';
            opt.textContent = `${this.areaIcons[area]} ${area}`;
            opt.onclick = (e) => {
                e.stopPropagation();
                this.changeArea(area);
                dropdown.remove();
            };
            dropdown.appendChild(opt);
        });
        badge.parentElement.style.position = 'relative';
        badge.parentElement.appendChild(dropdown);
        // Close on outside click
        setTimeout(() => {
            const close = (e) => { if (!dropdown.contains(e.target)) { dropdown.remove(); document.removeEventListener('click', close); } };
            document.addEventListener('click', close);
        }, 10);
    },

    async changeArea(newArea) {
        if (!this.currentEntryId) return;
        await Storage.updateEntry(this.currentEntryId, { area: newArea });
        const badge = document.getElementById('entryArea');
        badge.textContent = newArea;
        badge.className = 'area-badge area-' + newArea.toLowerCase();
        App.toast(`✅ Área cambiada a ${newArea}`);
    },

    enableEdit() {
        if (!this.currentEntryId) return;
        document.getElementById('diaryText').readOnly = false;
        document.getElementById('keyIdeasText').readOnly = false;
        document.getElementById('daySummary').readOnly = false;
        document.getElementById('processBtn').style.display = 'flex';
        document.getElementById('editBtn').style.display = 'none';
        document.getElementById('diaryText').focus();
        App.toast('✏️ Puedes editar la entrada. Presiona "Procesar con IA" para re-procesar.');
    },

    async deleteCurrentEntry() {
        if (!this.currentEntryId) return;
        if (!confirm('¿Seguro que quieres eliminar esta entrada?')) return;
        await Storage.deleteEntry(this.currentEntryId);
        App.toast('🗑️ Entrada eliminada');
        await this.loadSelector();
        this.newEntry();
    },

    async process() {
        const text = document.getElementById('diaryText').value.trim();
        if (!text) { App.toast('Escribe algo en tu diario primero ✏️'); return; }
        const provider = Storage.getProvider();
        const hasKey = provider === 'groq' ? Storage.getGroqKey() : Storage.getApiKey();
        if (!hasKey) { Settings.open(); App.toast('Configura tu API key primero'); return; }

        document.getElementById('loadingOverlay').style.display = 'flex';
        document.getElementById('processBtn').disabled = true;

        try {
            const result = await AIProvider.process(text);

            // If editing an existing entry, update it instead of creating new
            if (this.currentEntryId) {
                await Storage.updateEntry(this.currentEntryId, {
                    rawText: text,
                    title: result.title,
                    area: result.area,
                    keyIdeas: result.keyIdeas,
                    keyIdeasText: result.keyIdeas.join('\n'),
                    summary: result.summary,
                    flashcards: result.flashcards,
                    processed: true
                });
            } else {
                const entry = await Storage.addEntry({
                    date: new Date().toISOString().split('T')[0],
                    rawText: text,
                    title: result.title,
                    area: result.area,
                    keyIdeas: result.keyIdeas,
                    keyIdeasText: result.keyIdeas.join('\n'),
                    summary: result.summary,
                    flashcards: result.flashcards,
                    processed: true
                });
                this.currentEntryId = entry.id;
            }

            this.renderCornell(result);
            document.getElementById('diaryText').readOnly = true;
            document.getElementById('keyIdeasText').readOnly = true;
            document.getElementById('daySummary').readOnly = true;
            document.getElementById('processBtn').style.display = 'none';
            document.getElementById('editBtn').style.display = 'flex';
            document.getElementById('deleteBtn').style.display = 'flex';
            document.getElementById('newEntryBtn').style.display = 'flex';
            await this.loadSelector();
            document.getElementById('entrySelector').value = this.currentEntryId;
            App.toast('✅ ¡Entrada procesada!');
        } catch (err) {
            console.error(err);
            if (err.message === 'NO_API_KEY') {
                Settings.open();
            } else {
                App.toast('❌ Error: ' + err.message);
            }
        } finally {
            document.getElementById('loadingOverlay').style.display = 'none';
            document.getElementById('processBtn').disabled = false;
        }
    }
};

// ---- MAP VIEW ----
const MapView = {
    areas: [
        { key: 'Diario', icon: '📓', css: 'area-diario' },
        { key: 'Dinero', icon: '💰', css: 'area-dinero' },
        { key: 'Aprendizaje', icon: '📚', css: 'area-aprendizaje' },
        { key: 'Relaciones', icon: '❤️', css: 'area-relaciones' },
        { key: 'Viajes', icon: '✈️', css: 'area-viajes' },
        { key: 'Historia', icon: '📖', css: 'area-historia' },
        { key: 'Random', icon: '🎲', css: 'area-random' }
    ],

    async render() {
        await this.renderCards();
        await this.renderTimeline();
    },

    async renderCards() {
        const grid = document.getElementById('areasGrid');
        grid.innerHTML = '';
        for (const area of this.areas) {
            const entries = await Storage.getByArea(area.key);
            const ideas = entries.flatMap(e => e.keyIdeas || []);
            const card = document.createElement('div');
            card.className = `area-card ${area.css}`;
            card.innerHTML = `
                <span class="area-card-icon">${area.icon}</span>
                <div class="area-card-name">${area.key}</div>
                <div class="area-card-count">${ideas.length} ideas</div>
                <ul class="area-card-ideas">
                    ${ideas.length ? ideas.map(i => `<li>${i}</li>`).join('') : '<li>Sin ideas aún</li>'}
                </ul>`;
            card.addEventListener('click', () => card.classList.toggle('expanded'));
            grid.appendChild(card);
        }
    },

    async renderTimeline() {
        const tl = document.getElementById('timeline');
        const allEntries = await Storage.getEntries();
        const entries = allEntries.filter(e => e.processed);
        if (!entries.length) {
            tl.innerHTML = '<p class="placeholder">Escribe entradas en tu diario para ver la línea de tiempo</p>';
            return;
        }
        const areaColors = {
            Diario: '#5D6D7E', Dinero: '#27AE60', Aprendizaje: '#2E86AB', Relaciones: '#E74C3C',
            Viajes: '#F39C12', Historia: '#8E44AD', Random: '#7F8C8D'
        };
        tl.innerHTML = entries.map(e => {
            const d = new Date(e.date).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
            const color = areaColors[e.area] || '#7F8C8D';
            return `<div class="timeline-item" style="--dot-color:${color}" onclick="location.hash='diario';setTimeout(()=>{document.getElementById('entrySelector').value='${e.id}';DiaryView.loadEntry('${e.id}')},100)">
                <div class="timeline-date">${d}</div>
                <div class="timeline-entry-title">${e.title}</div>
            </div>`;
        }).join('');
        // Apply dot colors
        tl.querySelectorAll('.timeline-item').forEach(item => {
            item.style.setProperty('--dot-bg', item.style.getPropertyValue('--dot-color'));
        });
    }
};

// ---- FLASHCARDS VIEW ----
const FlashcardsView = {
    cards: [],
    index: 0,

    async render() {
        this.cards = await Storage.getAllFlashcards();
        const empty = document.getElementById('flashcardEmpty');
        const player = document.getElementById('flashcardPlayer');
        if (!this.cards.length) {
            empty.style.display = 'block';
            player.style.display = 'none';
            return;
        }
        empty.style.display = 'none';
        player.style.display = 'block';
        this.index = 0;
        this.showCard();
        this.renderDots();
    },

    showCard() {
        const card = this.cards[this.index];
        if (!card) return;
        document.getElementById('fcQuestion').textContent = card.question;
        document.getElementById('fcAnswer').textContent = card.answer;
        document.getElementById('fcCurrent').textContent = this.index + 1;
        document.getElementById('fcTotal').textContent = this.cards.length;
        document.getElementById('flashcard').classList.remove('flipped');
        this.updateDots();
    },

    renderDots() {
        const dots = document.getElementById('fcDots');
        const maxDots = Math.min(this.cards.length, 10);
        dots.innerHTML = '';
        for (let i = 0; i < maxDots; i++) {
            const dot = document.createElement('span');
            dot.className = 'fc-dot' + (i === 0 ? ' active' : '');
            dots.appendChild(dot);
        }
    },

    updateDots() {
        const dots = document.querySelectorAll('.fc-dot');
        dots.forEach((d, i) => d.classList.toggle('active', i === this.index % dots.length));
    },

    flip() { document.getElementById('flashcard').classList.toggle('flipped'); },

    next() {
        if (this.index < this.cards.length - 1) { this.index++; this.showCard(); }
    },

    prev() {
        if (this.index > 0) { this.index--; this.showCard(); }
    }
};

// ---- SETTINGS ----
const Settings = {
    open() {
        document.getElementById('providerSelect').value = Storage.getProvider();
        document.getElementById('groqKeyInput').value = Storage.getGroqKey();
        document.getElementById('apiKeyInput').value = Storage.getApiKey();
        document.getElementById('modelSelect').value = Storage.getModel();
        this.toggleProvider();
        this.updateStorageInfo();
        document.getElementById('settingsModal').style.display = 'flex';
    },
    close(e) {
        if (e && e.target !== document.getElementById('settingsModal')) return;
        document.getElementById('settingsModal').style.display = 'none';
    },
    toggleProvider() {
        const provider = document.getElementById('providerSelect').value;
        document.getElementById('groqSettings').style.display = provider === 'groq' ? 'block' : 'none';
        document.getElementById('geminiSettings').style.display = provider === 'gemini' ? 'block' : 'none';
    },
    save() {
        const provider = document.getElementById('providerSelect').value;
        Storage.setProvider(provider);
        Storage.setGroqKey(document.getElementById('groqKeyInput').value.trim());
        Storage.setApiKey(document.getElementById('apiKeyInput').value.trim());
        Storage.setModel(document.getElementById('modelSelect').value);
        document.getElementById('settingsModal').style.display = 'none';
        const name = provider === 'groq' ? '🚀 Groq' : '🔮 Gemini';
        App.toast(`✅ Guardado (${name})`);
    },
    async exportData() {
        await Storage.exportData();
        App.toast('📦 Backup descargado');
    },
    async importData() {
        const input = document.getElementById('importFile');
        input.click();
        input.onchange = async () => {
            const file = input.files[0];
            if (!file) return;
            try {
                const count = await Storage.importData(file);
                App.toast(`✅ ${count} entradas restauradas`);
                await DiaryView.loadSelector();
                DiaryView.newEntry();
            } catch (err) {
                App.toast('❌ ' + err.message);
            }
            input.value = '';
        };
    },
    async updateStorageInfo() {
        const infoEl = document.getElementById('storageInfo');
        if (!infoEl) return;
        const info = await Storage.getStorageInfo();
        const entries = await Storage.getEntries();
        if (info) {
            infoEl.textContent = `📊 ${entries.length} entradas · ${info.usedMB} MB usados de ${info.quotaMB} MB`;
        } else {
            infoEl.textContent = `📊 ${entries.length} entradas`;
        }
    }
};

// ---- PWA INSTALL ----
const PWAInstall = {
    deferredPrompt: null,

    init() {
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            this.deferredPrompt = e;
            this.showInstallBanner();
        });
        window.addEventListener('appinstalled', () => {
            this.hideInstallBanner();
            App.toast('✅ ¡App instalada correctamente!');
        });
    },

    showInstallBanner() {
        const banner = document.getElementById('installBanner');
        if (banner) banner.style.display = 'flex';
    },

    hideInstallBanner() {
        const banner = document.getElementById('installBanner');
        if (banner) banner.style.display = 'none';
        this.deferredPrompt = null;
    },

    async install() {
        if (!this.deferredPrompt) return;
        this.deferredPrompt.prompt();
        const { outcome } = await this.deferredPrompt.userChoice;
        if (outcome === 'accepted') {
            App.toast('✅ ¡Instalando app!');
        }
        this.deferredPrompt = null;
        this.hideInstallBanner();
    }
};

// ---- APP ----
const App = {
    async init() {
        // Initialize IndexedDB and migrate from localStorage
        await Storage.init();
        await Storage.migrateFromLocalStorage();

        Router.init();
        await DiaryView.init();
        PWAInstall.init();

        // Register service worker
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('sw.js').catch(() => { });
        }
    },
    toast(msg) {
        const t = document.getElementById('toast');
        t.textContent = msg;
        t.classList.add('show');
        setTimeout(() => t.classList.remove('show'), 3000);
    }
};

// Add timeline dot color via CSS
const style = document.createElement('style');
style.textContent = `.timeline-item::before { background: var(--dot-color, #7F8C8D); }`;
document.head.appendChild(style);

document.addEventListener('DOMContentLoaded', () => App.init());
